import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertCan, effectiveSiteLanguageTag, matchesSiteLanguage, normalizeSitePath, resolveInside, type Actor } from "@igle/shared";
import { parsePageSEO } from "@igle/html-engine";
import { readPagesMetadata, writePagesMetadata, writeSiteMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
import { extractZipBuffer } from "./zip-extract.js";
import type { PageIndexRecord, SiteRecord } from "./types.js";

export interface ImportReport {
  pagesFound: number;
  imagesFound: number;
  stylesheetsFound: number;
  javascriptFilesFound: number;
  totalBytes: number;
  ignoredFiles: string[];
  rejectedFiles: Array<{ path: string; reason: string }>;
  ambiguousSeoFiles: string[];
  serverSideFiles: string[];
}

const ignoredBasenames = new Set([".DS_Store", "Thumbs.db"]);
const ignoredPrefixes = ["__MACOSX/", ".git/"];
const serverSideExtensions = new Set([".php", ".asp", ".aspx", ".py", ".cgi", ".sh"]);

export class ImportService {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  validateEntry(entryPath: string, kind: "file" | "directory" | "symlink" | "hardlink" | "device" = "file"):
    | { ok: true; normalizedPath: string }
    | { ok: false; reason: string } {
    if (["symlink", "hardlink", "device"].includes(kind)) return { ok: false, reason: `${kind} entries are not allowed.` };
    try {
      return { ok: true, normalizedPath: normalizeSitePath(entryPath) };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Invalid path." };
    }
  }

  async importZip(site: SiteRecord, zipBuffer: Buffer, actor: Actor): Promise<{ revisionNumber: number; report: ImportReport }> {
    assertCan(actor, "sites.create");
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "igle-zip-"));
    try {
      const zipReport = await extractZipBuffer(zipBuffer, stagingDir);
      const sourceDirectory = await resolveSingleRootDirectory(stagingDir);
      const result = await this.importDirectory(site, sourceDirectory, actor);
      result.report.rejectedFiles.push(...zipReport.rejectedFiles);
      return result;
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }

  async importDirectory(site: SiteRecord, sourceDirectory: string, actor: Actor): Promise<{ revisionNumber: number; report: ImportReport }> {
    assertCan(actor, "sites.create");
    const report: ImportReport = {
      pagesFound: 0,
      imagesFound: 0,
      stylesheetsFound: 0,
      javascriptFilesFound: 0,
      totalBytes: 0,
      ignoredFiles: [],
      rejectedFiles: [],
      ambiguousSeoFiles: [],
      serverSideFiles: []
    };

    await clearImportedFiles(site.repoPath);
    await copyImportTree(sourceDirectory, site.repoPath, report);

    // A freshly-created site always starts at the "en"/"en-US" default (SOT default, not a
    // real signal) — detect the imported content's actual <html lang> before indexing pages,
    // so both the site's language setting and each page's fieldStates.lang ("inherited" vs
    // "explicit") reflect what was actually imported, not the placeholder default.
    const detectedLanguage = await detectDominantLanguage(site.repoPath);
    if (detectedLanguage) {
      site.metadata.language = detectedLanguage.language;
      if (detectedLanguage.country) {
        site.metadata.country = detectedLanguage.country;
        site.metadata.locale = `${detectedLanguage.language}-${detectedLanguage.country}`;
      } else {
        site.metadata.locale = detectedLanguage.language;
      }
    }

    const pages = await indexPages(site, report);
    site.metadata.sourceType = "import";
    site.metadata.updatedAt = new Date().toISOString();
    await writeSiteMetadata(site.repoPath, site.metadata);
    await writePagesMetadata(site.repoPath, {
      pages: pages.map((page) => ({
        id: page.id,
        filePath: page.filePath,
        route: page.route,
        internalName: page.internalName,
        inSitemap: page.inSitemap,
        fieldStates: {
          seoTitle: page.fieldStates.seoTitle ?? "absent",
          metaDescription: page.fieldStates.metaDescription ?? "absent",
          h1: page.fieldStates.h1 ?? "absent",
          canonical: page.fieldStates.canonical ?? "absent",
          robots: page.fieldStates.robots ?? "absent",
          ogTitle: page.fieldStates.ogTitle ?? "absent",
          ogDescription: page.fieldStates.ogDescription ?? "absent"
        },
        lastWrittenHashes: {}
      }))
    });

    await this.stateStore.update((state) => {
      state.pages = state.pages.filter((page) => page.siteId !== site.id).concat(pages);
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.metadata = site.metadata;
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "import",
      title: "Imported static site",
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    await this.stateStore.update((state) => {
      for (const page of state.pages.filter((item) => item.siteId === site.id)) {
        page.lastRevisionId = revision.id;
      }
    });

    return { revisionNumber: revision.revisionNumber, report };
  }

  /**
   * Rebuilds the page index from the site's current files (SOT-06). Needed after any
   * operation that changes files without going through a service that maintains the index
   * itself — restoring a revision is the main case: the files change, but nothing else
   * updates .igle/pages.json or the in-memory page records for the caller.
   */
  async reindexSite(site: SiteRecord, actor: Actor): Promise<PageIndexRecord[]> {
    assertCan(actor, "sites.read", site.id);
    const report: ImportReport = {
      pagesFound: 0,
      imagesFound: 0,
      stylesheetsFound: 0,
      javascriptFilesFound: 0,
      totalBytes: 0,
      ignoredFiles: [],
      rejectedFiles: [],
      ambiguousSeoFiles: [],
      serverSideFiles: []
    };
    const pages = await indexPages(site, report);
    await writePagesMetadata(site.repoPath, {
      pages: pages.map((page) => ({
        id: page.id,
        filePath: page.filePath,
        route: page.route,
        internalName: page.internalName,
        inSitemap: page.inSitemap,
        fieldStates: {
          seoTitle: page.fieldStates.seoTitle ?? "absent",
          metaDescription: page.fieldStates.metaDescription ?? "absent",
          h1: page.fieldStates.h1 ?? "absent",
          canonical: page.fieldStates.canonical ?? "absent",
          robots: page.fieldStates.robots ?? "absent",
          ogTitle: page.fieldStates.ogTitle ?? "absent",
          ogDescription: page.fieldStates.ogDescription ?? "absent"
        },
        lastWrittenHashes: {}
      }))
    });

    await this.stateStore.update((state) => {
      state.pages = state.pages.filter((page) => page.siteId !== site.id).concat(pages);
    });

    return pages;
  }
}

const ignoredTopLevelDirnames = new Set(["__MACOSX", ".git"]);

async function resolveSingleRootDirectory(stagingDir: string): Promise<string> {
  const entries = (await fs.readdir(stagingDir, { withFileTypes: true })).filter(
    (entry) => !ignoredBasenames.has(entry.name) && !ignoredTopLevelDirnames.has(entry.name)
  );
  const [onlyEntry] = entries;
  if (entries.length === 1 && onlyEntry && onlyEntry.isDirectory()) {
    return path.join(stagingDir, onlyEntry.name);
  }
  return stagingDir;
}

async function clearImportedFiles(repoPath: string): Promise<void> {
  const entries = await fs.readdir(repoPath);
  await Promise.all(
    entries.filter((entry) => entry !== ".git" && entry !== ".igle").map((entry) => fs.rm(path.join(repoPath, entry), { recursive: true, force: true }))
  );
}

async function copyImportTree(sourceDirectory: string, targetRoot: string, report: ImportReport, relative = ""): Promise<void> {
  const entries = await fs.readdir(path.join(sourceDirectory, relative), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.posix.join(relative, entry.name);
    if (ignoredBasenames.has(entry.name) || ignoredPrefixes.some((prefix) => `${relativePath}/`.startsWith(prefix) || relativePath.startsWith(prefix))) {
      report.ignoredFiles.push(relativePath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      report.rejectedFiles.push({ path: relativePath, reason: "Symlinks are rejected." });
      continue;
    }

    if (entry.isDirectory()) {
      await copyImportTree(sourceDirectory, targetRoot, report, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      report.rejectedFiles.push({ path: relativePath, reason: "Only regular files are accepted." });
      continue;
    }

    const normalized = normalizeSitePath(relativePath);
    const source = path.join(sourceDirectory, normalized);
    const destination = resolveInside(targetRoot, normalized);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    const stat = await fs.stat(destination);
    report.totalBytes += stat.size;

    const ext = path.extname(entry.name).toLowerCase();
    if ([".html", ".htm"].includes(ext)) report.pagesFound += 1;
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"].includes(ext)) report.imagesFound += 1;
    if (ext === ".css") report.stylesheetsFound += 1;
    if (ext === ".js") report.javascriptFilesFound += 1;
    if (serverSideExtensions.has(ext)) report.serverSideFiles.push(normalized);
  }
}

async function indexPages(site: SiteRecord, report: ImportReport): Promise<PageIndexRecord[]> {
  const filePaths = await listFiles(site.repoPath);
  const existingMetadata = await readPagesMetadata(site.repoPath).catch(() => ({ pages: [] }));
  const existingByPath = new Map(existingMetadata.pages.map((page) => [page.filePath, page]));
  const pages: PageIndexRecord[] = [];

  for (const filePath of filePaths.filter((file) => [".html", ".htm"].includes(path.extname(file).toLowerCase()))) {
    const absolutePath = resolveInside(site.repoPath, filePath);
    const html = await fs.readFile(absolutePath, "utf8");
    const parsed = parsePageSEO(html);
    if (parsed.issues.some((issue) => issue.severity === "error")) report.ambiguousSeoFiles.push(filePath);
    const existing = existingByPath.get(filePath);
    pages.push({
      id: existing?.id ?? id("page"),
      siteId: site.id,
      filePath,
      route: routeForFile(filePath, site.metadata.urlStyle),
      internalName: existing?.internalName ?? internalName(filePath),
      seoTitle: parsed.seoTitle.value,
      metaDescription: parsed.metaDescription.value,
      h1: parsed.h1.value,
      canonical: parsed.canonical.value,
      robots: parsed.robots.value,
      lang: parsed.lang,
      ogTitle: parsed.ogTitle.value,
      ogDescription: parsed.ogDescription.value,
      fieldStates: {
        seoTitle: parsed.seoTitle.state,
        metaDescription: parsed.metaDescription.state,
        h1: parsed.h1.state,
        canonical: parsed.canonical.state,
        robots: parsed.robots.state,
        ogTitle: parsed.ogTitle.state,
        ogDescription: parsed.ogDescription.state,
        lang: parsed.lang === undefined ? "absent" : matchesSiteLanguage(parsed.lang, effectiveSiteLanguageTag(site.metadata)) ? "inherited" : "explicit"
      },
      h1Count: parsed.h1Count,
      wordCount: parsed.wordCount,
      imagesCount: parsed.imagesCount,
      imagesMissingAlt: parsed.imagesMissingAlt,
      inSitemap: existing?.inSitemap ?? true,
      fileHash: hash(html),
      auditIssues: parsed.issues
    });
  }

  return pages;
}

async function detectDominantLanguage(repoPath: string): Promise<{ language: string; country?: string } | undefined> {
  const htmlFiles = (await listFiles(repoPath)).filter((file) => [".html", ".htm"].includes(path.extname(file).toLowerCase()));
  const counts = new Map<string, number>();
  for (const filePath of htmlFiles) {
    const html = await fs.readFile(resolveInside(repoPath, filePath), "utf8").catch(() => "");
    const match = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
    const tag = match?.[1]?.trim();
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const dominantTag = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominantTag) return undefined;
  const [language, country] = dominantTag.split("-");
  if (!language) return undefined;
  return country ? { language: language.toLowerCase(), country: country.toUpperCase() } : { language: language.toLowerCase() };
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".igle") continue;
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, next)));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

export function routeForFile(filePath: string, urlStyle: "html-ext" | "clean" | "clean-slash"): string {
  if (filePath === "index.html" || filePath === "index.htm") return "/";
  // A static file server resolves "folder/" to "folder/index.html" regardless of urlStyle — so
  // any "index.html" nested in a folder always gets a trailing-slash directory route, the same
  // way the top-level one does above. Only non-index files vary by urlStyle.
  const indexMatch = /^(.*)\/index\.html?$/i.exec(filePath);
  if (indexMatch) return `/${indexMatch[1]}/`;
  const withoutExt = filePath.replace(/\.(html|htm)$/i, "");
  if (urlStyle === "html-ext") return `/${filePath}`;
  if (urlStyle === "clean-slash") return `/${withoutExt}/`;
  return `/${withoutExt}`;
}

function internalName(filePath: string): string {
  const segments = filePath.replace(/\.(html|htm)$/i, "").split("/").filter(Boolean);
  const last = segments.at(-1);
  // "reviews/best-vpn/index.html" names the page from its folder ("Best Vpn"), not the
  // literal filename — otherwise every folder-style page in a site is named "Index".
  const name = last === "index" ? (segments.length > 1 ? segments.at(-2) : "home") : last;
  return (name ?? "Home").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
