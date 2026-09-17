import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parsePageSEO } from "@igle/html-engine";
import { renderTemplateHtml, validateTemplateManifest, type TemplateManifest, type TemplatePageType } from "@igle/templates";
import { assertCan, effectiveSiteLanguageTag, IgleError, matchesSiteLanguage, type Actor, type SiteMetadata } from "@igle/shared";
import { ensureIgleMetadata } from "./metadata-store.js";
import { RevisionService } from "./revision-service.js";
import { JsonStateStore, id } from "./state-store.js";
import type { PageIndexRecord, SiteRecord } from "./types.js";
import { extractZipBuffer } from "./zip-extract.js";
import {
  discoverPages,
  isIgnoredPath,
  parameterizeBrand,
  rewritePageReferences,
  slugifyTemplateKey,
  stripSourceDomain,
  templatizeSeo,
  type DiscoveredPage
} from "./template-builder.js";

export interface TemplateSummary {
  key: string;
  version: string;
  name: string;
  description?: string | undefined;
  pageCount: number;
  source: "builtin" | "custom";
}

export interface CreateSiteFromTemplateInput {
  name: string;
  slug: string;
  templateKey: string;
  language?: string | undefined;
  locale?: string | undefined;
}

export interface UploadTemplateInput {
  name: string;
  description?: string | undefined;
  sourceDomain?: string | undefined;
  brandName?: string | undefined;
  zipBuffer: Buffer;
}

export interface UploadTemplateReport {
  key: string;
  pagesFound: number;
  assetsFound: number;
  rejectedFiles: Array<{ path: string; reason: string }>;
}

export class TemplateService {
  constructor(
    private readonly builtinTemplatesDir: string,
    private readonly customTemplatesDir: string,
    private readonly dataDir: string,
    private readonly stateStore: JsonStateStore,
    private readonly revisionService: RevisionService
  ) {}

  async list(): Promise<TemplateSummary[]> {
    const builtin = await this.listDir(this.builtinTemplatesDir, "builtin");
    const custom = await this.listDir(this.customTemplatesDir, "custom");
    return [...builtin, ...custom];
  }

  private async listDir(dir: string, source: "builtin" | "custom"): Promise<TemplateSummary[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const summaries: TemplateSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const raw = await fs.readFile(path.join(dir, entry.name, "template.json"), "utf8").catch(() => undefined);
      const manifest = raw ? await this.parseManifest(raw).catch(() => undefined) : undefined;
      if (manifest) {
        summaries.push({ key: manifest.key, version: manifest.version, name: manifest.name, description: manifest.description, pageCount: manifest.pageTypes.length, source });
      }
    }
    return summaries;
  }

  private async parseManifest(raw: string): Promise<TemplateManifest> {
    return validateTemplateManifest(JSON.parse(raw));
  }

  /** Custom (uploaded) templates are checked first, so a developer can knowingly reuse a built-in key to override it. */
  private async resolveTemplateDir(templateKey: string): Promise<{ dir: string; source: "builtin" | "custom" }> {
    const customPath = path.join(this.customTemplatesDir, templateKey, "template.json");
    if (await fileExists(customPath)) return { dir: this.customTemplatesDir, source: "custom" };
    return { dir: this.builtinTemplatesDir, source: "builtin" };
  }

  async loadManifest(templateKey: string): Promise<TemplateManifest> {
    const { dir } = await this.resolveTemplateDir(templateKey);
    const raw = await fs.readFile(path.join(dir, templateKey, "template.json"), "utf8");
    return this.parseManifest(raw);
  }

  /** Renders the template's home page (or its first page type) with default field values — for the gallery preview, not tied to any real site. */
  async renderPreview(templateKey: string): Promise<string> {
    let manifest: TemplateManifest;
    try {
      manifest = await this.loadManifest(templateKey);
    } catch {
      throw new IgleError("TEMPLATE_NOT_FOUND", `Template "${templateKey}" was not found.`, 404);
    }
    const pageType = manifest.pageTypes.find((item) => item.route === "/") ?? manifest.pageTypes[0];
    if (!pageType) throw new IgleError("TEMPLATE_EMPTY", "Template has no pages.", 404);

    const { dir } = await this.resolveTemplateDir(templateKey);
    const source = await fs.readFile(path.join(dir, templateKey, pageType.file), "utf8");
    const fieldValues = Object.fromEntries(pageType.fields.map((field) => [field.key, field.default ?? ""]));
    return renderTemplateHtml(source, {
      site: { name: manifest.name, locale: "en-US", language: "en" },
      page: { seoTitle: pageType.seoTitle ?? manifest.name, metaDescription: pageType.metaDescription ?? "" },
      fields: fieldValues
    });
  }

  async assetsDirFor(templateKey: string): Promise<string> {
    const { dir } = await this.resolveTemplateDir(templateKey);
    return path.join(dir, templateKey, "assets");
  }

  async createSite(input: CreateSiteFromTemplateInput, actor: Actor): Promise<SiteRecord> {
    assertCan(actor, "sites.create");
    let manifest: TemplateManifest;
    try {
      manifest = await this.loadManifest(input.templateKey);
    } catch {
      throw new IgleError("TEMPLATE_NOT_FOUND", `Template "${input.templateKey}" was not found.`, 404);
    }

    const now = new Date().toISOString();
    const siteId = id("site");
    const repoPath = path.join(this.dataDir, "sites", siteId, "repo");
    const metadata: SiteMetadata = {
      id: siteId,
      name: input.name,
      slug: input.slug,
      alternateDomains: [],
      language: input.language ?? "en",
      locale: input.locale ?? "en-US",
      urlStyle: "clean",
      wwwMode: "non-www",
      https: true,
      deploymentTarget: "local",
      status: "draft",
      sourceType: "template",
      templateKey: manifest.key,
      templateVersion: manifest.version,
      seoLimits: { titleMin: 30, titleMax: 60, descriptionMin: 70, descriptionMax: 160 },
      sitemap: { enabled: true },
      robots: { mode: "cms-generated" },
      metaRobots: "index",
      createdAt: now,
      updatedAt: now
    };

    await this.revisionService.initializeRepository(repoPath);

    const { dir: templateDir } = await this.resolveTemplateDir(input.templateKey);
    const assetsDir = path.join(templateDir, input.templateKey, "assets");
    await fs.cp(assetsDir, path.join(repoPath, "assets"), { recursive: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });

    const effectiveLang = effectiveSiteLanguageTag(metadata);
    const pages: PageIndexRecord[] = [];
    for (const pageType of manifest.pageTypes) {
      const source = await fs.readFile(path.join(templateDir, input.templateKey, pageType.file), "utf8");
      const fieldValues = Object.fromEntries(pageType.fields.map((field) => [field.key, field.default ?? ""]));
      const html = renderTemplateHtml(source, {
        site: { name: metadata.name, locale: metadata.locale, language: metadata.language },
        page: { seoTitle: pageType.seoTitle ?? metadata.name, metaDescription: pageType.metaDescription ?? "" },
        fields: fieldValues
      });

      const filePath = routeToFilePath(pageType.route);
      const absolutePath = path.join(repoPath, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, html, "utf8");

      const parsed = parsePageSEO(html);
      pages.push({
        id: id("page"),
        siteId,
        filePath,
        route: pageType.route,
        internalName: pageType.name,
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
          lang: parsed.lang === undefined ? "absent" : matchesSiteLanguage(parsed.lang, effectiveLang) ? "inherited" : "explicit"
        },
        h1Count: parsed.h1Count,
        wordCount: parsed.wordCount,
        imagesCount: parsed.imagesCount,
        imagesMissingAlt: parsed.imagesMissingAlt,
        inSitemap: true,
        fileHash: hash(html),
        auditIssues: parsed.issues
      });
    }

    await ensureIgleMetadata(repoPath, metadata, {
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

    const site: SiteRecord = { id: siteId, slug: input.slug, repoPath, metadata };
    await this.stateStore.update((state) => {
      state.sites.push(site);
      state.pages.push(...pages);
    });

    const revision = await this.revisionService.commitRevision({
      site,
      source: "template",
      title: `Created site from template "${manifest.name}"`,
      user: { id: actor.id, name: actor.email, email: actor.email }
    });

    site.headRevisionId = revision.id;
    await this.stateStore.update((state) => {
      const existing = state.sites.find((item) => item.id === site.id);
      if (existing) existing.headRevisionId = revision.id;
      for (const page of state.pages.filter((item) => item.siteId === siteId)) page.lastRevisionId = revision.id;
    });

    return site;
  }

  /**
   * Converts an uploaded static HTML site into a reusable template: discovers every .html file
   * as a page (any folder depth), rewrites all internal links/asset references to this CMS's
   * flat-file, clean-URL layout, wires <title>/meta-description to {{page.*}} placeholders, and
   * optionally strips a source domain and/or parameterizes a brand/product name. Everything else
   * is left exactly as uploaded — deeper parameterization is a manual follow-up (editing
   * template.json or the page files directly), same as for the built-in templates.
   */
  async uploadTemplate(input: UploadTemplateInput, actor: Actor): Promise<{ key: string; report: UploadTemplateReport }> {
    assertCan(actor, "templates.manage");

    const name = input.name.trim();
    if (!name) throw new IgleError("VALIDATION_ERROR", "Template name is required.", 400);

    const key = await this.uniqueTemplateKey(slugifyTemplateKey(name));
    const stagingDir = path.join(this.dataDir, "tmp", `template-upload-${id("tpl")}`);
    await fs.mkdir(stagingDir, { recursive: true });

    try {
      const zipReport = await extractZipBuffer(input.zipBuffer, stagingDir);
      const sourceRoot = await resolveSingleRootDirectory(stagingDir);
      const allFiles = (await listFilesRecursive(sourceRoot)).filter((filePath) => !isIgnoredPath(filePath));
      const htmlFiles = allFiles.filter((filePath) => /\.html?$/i.test(filePath));
      if (htmlFiles.length === 0) {
        throw new IgleError("TEMPLATE_EMPTY", "No .html files were found in the uploaded archive.", 400);
      }

      const pages = discoverPages(htmlFiles);
      const pagesByMatchKey = new Map<string, DiscoveredPage>(pages.map((page) => [page.matchKey, page]));
      const assetOriginPaths = new Set<string>();

      const targetDir = path.join(this.customTemplatesDir, key);
      await fs.mkdir(path.join(targetDir, "pages"), { recursive: true });

      const pageTypes: TemplatePageType[] = [];
      for (const page of pages) {
        let html = await fs.readFile(path.join(sourceRoot, page.originPath), "utf8");
        html = rewritePageReferences(html, page.originPath, pagesByMatchKey, assetOriginPaths);
        if (input.sourceDomain) html = stripSourceDomain(html, input.sourceDomain);
        const { html: templatizedHtml, seo } = templatizeSeo(html);
        html = templatizedHtml;

        const fields: TemplatePageType["fields"] = [];
        if (input.brandName?.trim()) {
          html = parameterizeBrand(html, input.brandName);
          fields.push({ key: "brandName", type: "text", selector: "title", label: "Brand/product name", default: input.brandName.trim() });
        }

        const pageFile = `pages/${page.pageKey}.html`;
        await fs.writeFile(path.join(targetDir, pageFile), html, "utf8");
        pageTypes.push({
          key: page.pageKey,
          name: internalNameForPageKey(page.pageKey),
          file: pageFile,
          route: page.route,
          ...(seo.seoTitle ? { seoTitle: seo.seoTitle } : {}),
          ...(seo.metaDescription ? { metaDescription: seo.metaDescription } : {}),
          fields
        });
      }

      // Every non-HTML file is copied verbatim under assets/, preserving its original relative
      // location — that keeps files' own internal relative references (e.g. a CSS file's
      // url(../fonts/x.woff)) working without needing to parse and rewrite non-HTML formats too.
      const nonHtmlFiles = allFiles.filter((filePath) => !/\.html?$/i.test(filePath));
      let assetsFound = 0;
      for (const filePath of nonHtmlFiles) {
        const destination = path.join(targetDir, "assets", filePath);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(sourceRoot, filePath), destination);
        assetsFound += 1;
      }

      const trimmedDescription = input.description?.trim();
      const manifest: TemplateManifest = {
        key,
        version: "0.1.0",
        name,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        pageTypes
      };
      await fs.writeFile(path.join(targetDir, "template.json"), JSON.stringify(manifest, null, 2), "utf8");

      return {
        key,
        report: {
          key,
          pagesFound: pages.length,
          assetsFound,
          rejectedFiles: zipReport.rejectedFiles
        }
      };
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }

  async deleteTemplate(templateKey: string, actor: Actor): Promise<void> {
    assertCan(actor, "templates.manage");
    const { source } = await this.resolveTemplateDir(templateKey);
    if (source === "builtin") {
      throw new IgleError("TEMPLATE_NOT_DELETABLE", "Built-in templates can't be deleted — only uploaded ones.", 400);
    }
    await fs.rm(path.join(this.customTemplatesDir, templateKey), { recursive: true, force: true });
  }

  private async uniqueTemplateKey(baseKey: string): Promise<string> {
    let candidate = baseKey;
    let suffix = 2;
    while ((await fileExists(path.join(this.builtinTemplatesDir, candidate, "template.json"))) || (await fileExists(path.join(this.customTemplatesDir, candidate, "template.json")))) {
      candidate = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}

function routeToFilePath(route: string): string {
  if (route === "/") return "index.html";
  return `${route.replace(/^\/+|\/+$/g, "")}.html`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function internalNameForPageKey(pageKey: string): string {
  return pageKey
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const ignoredTopLevelDirnames = new Set(["__MACOSX", ".git"]);

async function resolveSingleRootDirectory(stagingDir: string): Promise<string> {
  const entries = (await fs.readdir(stagingDir, { withFileTypes: true })).filter((entry) => !ignoredTopLevelDirnames.has(entry.name));
  const [onlyEntry] = entries;
  if (entries.length === 1 && onlyEntry && onlyEntry.isDirectory()) {
    return path.join(stagingDir, onlyEntry.name);
  }
  return stagingDir;
}

async function listFilesRecursive(root: string, relative = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, next)));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}
