import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertCan, normalizeSitePath, resolveInside, type Actor } from "@igle/shared";
import { parsePageSEO } from "@igle/html-engine";
import { readPagesMetadata, writePagesMetadata, writeSiteMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
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
        ogDescription: parsed.ogDescription.state
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

function routeForFile(filePath: string, urlStyle: "html-ext" | "clean" | "clean-slash"): string {
  if (filePath === "index.html" || filePath === "index.htm") return "/";
  const withoutExt = filePath.replace(/\.(html|htm)$/i, "");
  if (urlStyle === "html-ext") return `/${filePath}`;
  if (urlStyle === "clean-slash") return `/${withoutExt}/`;
  return `/${withoutExt}`;
}

function internalName(filePath: string): string {
  const name = filePath.replace(/\.(html|htm)$/i, "").split("/").filter(Boolean).at(-1) ?? "Home";
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
