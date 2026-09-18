import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { effectiveSiteLanguageTag, scriptsMetadataSchema, validatePagesMetadata, validateSiteMetadata } from "@igle/shared";

export interface FootprintIssue {
  filePath: string;
  token: string;
}

const forbiddenTokens = ["data-igle-", "igle-editor", "igle-bridge"];
const execFile = promisify(execFileCallback);

export interface BuildManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface BuildIssue {
  class: "error" | "warning";
  code: string;
  filePath?: string;
  message: string;
}

export interface BuildSiteInput {
  siteId: string;
  repoPath: string;
  commitSha: string;
  buildsRoot: string;
  buildId?: string;
  productionBaseUrl?: string;
  minifyHtml?: boolean;
  /** Mirror pair (see MirrorService/DeployService) — when set, every page gets reciprocal hreflang tags gluing this build's domain to the partner's. */
  hreflangPartner?: { baseUrl: string; languageTag: string };
}

export interface BuildSiteResult {
  buildId: string;
  buildPath: string;
  manifest: BuildManifestEntry[];
  issues: BuildIssue[];
}

export async function buildSite(input: BuildSiteInput): Promise<BuildSiteResult> {
  const buildId = input.buildId ?? `build_${Date.now()}`;
  const buildPath = path.join(input.buildsRoot, input.siteId, buildId);
  await fs.rm(buildPath, { recursive: true, force: true });
  await fs.mkdir(buildPath, { recursive: true });

  const archive = await gitArchive(input.repoPath, input.commitSha);
  await extractTar(buildPath, archive);
  await removeBuildExcludedFiles(buildPath);

  const site = validateSiteMetadata(await readJsonFromArchive(input.repoPath, input.commitSha, ".igle/site.json"));
  const pages = validatePagesMetadata(await readJsonFromArchive(input.repoPath, input.commitSha, ".igle/pages.json"));
  const scripts = scriptsMetadataSchema.parse(await readJsonFromArchive(input.repoPath, input.commitSha, ".igle/scripts.json"));

  await injectScripts(buildPath, scripts.scripts.filter((script) => script.enabled && ["production", "both"].includes(script.environment)));
  if (site.sitemap.enabled) {
    await writeSitemap(buildPath, site, pages.pages, input.productionBaseUrl, input.repoPath, input.commitSha);
  }
  if (site.robots.mode === "cms-generated") {
    const sitemapLine = site.sitemap.enabled ? `Sitemap: ${canonicalBase(site, input.productionBaseUrl)}/sitemap.xml\n` : "";
    await fs.writeFile(path.join(buildPath, "robots.txt"), `User-agent: *\nAllow: /\n${sitemapLine}`, "utf8");
  }
  if (site.metaRobots === "noindex") {
    await injectNoindexMeta(buildPath);
  }
  if (input.hreflangPartner) {
    await injectHreflang(buildPath, pages.pages, canonicalBase(site, input.productionBaseUrl), effectiveSiteLanguageTag(site), input.hreflangPartner);
  }

  const issues = await validateBuild(buildPath);
  const footprintIssues = await scanFootprint(buildPath);
  issues.push(
    ...footprintIssues.map((issue) => ({
      class: "error" as const,
      code: "FOOTPRINT_MARKER",
      filePath: issue.filePath,
      message: `Forbidden CMS marker "${issue.token}" found in build output.`
    }))
  );

  return {
    buildId,
    buildPath,
    manifest: await buildManifest(buildPath),
    issues
  };
}

export async function scanFootprint(root: string): Promise<FootprintIssue[]> {
  const issues: FootprintIssue[] = [];
  for (const filePath of await listFiles(root)) {
    if (filePath === ".igle" || filePath.startsWith(".igle/")) continue;
    const absolutePath = path.join(root, filePath);
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    for (const token of forbiddenTokens) {
      if (content.includes(token)) issues.push({ filePath, token });
    }
  }
  return issues;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, next)));
    if (entry.isFile()) files.push(next);
  }
  return files;
}

async function removeBuildExcludedFiles(buildPath: string): Promise<void> {
  await fs.rm(path.join(buildPath, ".igle"), { recursive: true, force: true });
  await removeMatching(buildPath, (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    return filePath === ".htaccess" || [".php", ".asp", ".aspx", ".py", ".cgi", ".sh"].includes(ext);
  });
}

async function removeMatching(root: string, predicate: (filePath: string) => boolean): Promise<void> {
  for (const filePath of await listFiles(root)) {
    if (predicate(filePath)) await fs.rm(path.join(root, filePath), { force: true });
  }
}

async function injectScripts(
  buildPath: string,
  scripts: Array<{ code: string; placement: "head-start" | "head-end" | "body-start" | "body-end"; pages: { mode: string; paths: string[]; patterns: string[] } }>
): Promise<void> {
  const htmlFiles = (await listFiles(buildPath)).filter((filePath) => [".html", ".htm"].includes(path.extname(filePath).toLowerCase()));
  for (const filePath of htmlFiles) {
    const applicable = scripts.filter((script) => scriptApplies(script.pages, filePath));
    if (applicable.length === 0) continue;
    const absolutePath = path.join(buildPath, filePath);
    let html = await fs.readFile(absolutePath, "utf8");
    for (const script of applicable) {
      html = injectScript(html, script.placement, script.code);
    }
    await fs.writeFile(absolutePath, html, "utf8");
  }
}

/** Adds `<meta name="robots" content="noindex">` to every page that doesn't already declare its own robots meta tag — a page with an explicit tag (set per-page in the SEO fields) keeps controlling its own indexing. */
async function injectNoindexMeta(buildPath: string): Promise<void> {
  const htmlFiles = (await listFiles(buildPath)).filter((filePath) => [".html", ".htm"].includes(path.extname(filePath).toLowerCase()));
  for (const filePath of htmlFiles) {
    const absolutePath = path.join(buildPath, filePath);
    const html = await fs.readFile(absolutePath, "utf8");
    if (/<meta\s+[^>]*name\s*=\s*["']robots["']/i.test(html)) continue;
    if (!/<head[ >]/i.test(html)) continue;
    const updated = html.replace(/<head([^>]*)>/i, `<head$1>\n<meta name="robots" content="noindex">`);
    await fs.writeFile(absolutePath, updated, "utf8");
  }
}

/** Adds reciprocal `<link rel="alternate" hreflang>` tags (including a self-reference, as required for hreflang to be honored) to every page that has a same-route counterpart on the paired site — see BuildSiteInput.hreflangPartner. */
async function injectHreflang(
  buildPath: string,
  pages: Array<{ filePath: string; route: string }>,
  selfBase: string,
  selfLanguageTag: string,
  partner: { baseUrl: string; languageTag: string }
): Promise<void> {
  for (const page of pages) {
    const absolutePath = path.join(buildPath, page.filePath);
    const html = await fs.readFile(absolutePath, "utf8").catch(() => undefined);
    if (html === undefined || !/<head[ >]/i.test(html)) continue;
    const tags =
      `<link rel="alternate" hreflang="${xmlEscape(selfLanguageTag)}" href="${xmlEscape(`${selfBase}${page.route}`)}">\n` +
      `<link rel="alternate" hreflang="${xmlEscape(partner.languageTag)}" href="${xmlEscape(`${partner.baseUrl}${page.route}`)}">\n`;
    const updated = html.replace(/<head([^>]*)>/i, `<head$1>\n${tags}`);
    await fs.writeFile(absolutePath, updated, "utf8");
  }
}

function scriptApplies(pages: { mode: string; paths: string[]; patterns: string[] }, filePath: string): boolean {
  if (pages.mode === "all") return true;
  if (pages.mode === "selected") return pages.paths.includes(filePath);
  return pages.patterns.some((pattern) => simpleGlob(pattern, filePath));
}

function simpleGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function injectScript(html: string, placement: "head-start" | "head-end" | "body-start" | "body-end", code: string): string {
  const snippet = `\n${code}\n`;
  if (placement === "head-start") return html.replace(/<head([^>]*)>/i, `<head$1>${snippet}`);
  if (placement === "head-end") return html.replace(/<\/head>/i, `${snippet}</head>`);
  if (placement === "body-start") return html.replace(/<body([^>]*)>/i, `<body$1>${snippet}`);
  return html.replace(/<\/body>/i, `${snippet}</body>`);
}

async function writeSitemap(
  buildPath: string,
  site: { domain?: string | undefined; https: boolean; urlStyle: "html-ext" | "clean" | "clean-slash" },
  pages: Array<{ filePath: string; route: string; inSitemap: boolean }>,
  productionBaseUrl: string | undefined,
  repoPath: string,
  commitSha: string
): Promise<void> {
  const base = canonicalBase(site, productionBaseUrl);
  const included = pages.filter((page) => page.inSitemap);
  const urls = (
    await Promise.all(
      included.map(async (page) => {
        const lastmod = await lastModifiedAt(repoPath, commitSha, page.filePath);
        return `  <url><loc>${xmlEscape(`${base}${page.route}`)}</loc><lastmod>${lastmod}</lastmod></url>`;
      })
    )
  ).join("\n");
  await fs.writeFile(buildPath + "/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, "utf8");
}

async function lastModifiedAt(repoPath: string, commitSha: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await execFile(
      "git",
      ["log", "-1", "--format=%aI", commitSha, "--", filePath],
      { cwd: repoPath, encoding: "utf8" }
    );
    const date = stdout.trim();
    return date === "" ? new Date().toISOString().slice(0, 10) : date.slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function canonicalBase(site: { domain?: string | undefined; https: boolean }, productionBaseUrl?: string): string {
  if (productionBaseUrl) return productionBaseUrl.replace(/\/$/, "");
  const protocol = site.https ? "https" : "http";
  return `${protocol}://${site.domain ?? "example.invalid"}`;
}

async function validateBuild(buildPath: string): Promise<BuildIssue[]> {
  const issues: BuildIssue[] = [];
  const files = await listFiles(buildPath);
  if (!files.includes("index.html")) {
    issues.push({ class: "error", code: "NO_INDEX", message: "Build output has no root index.html." });
  }
  for (const filePath of files.filter((file) => [".html", ".htm"].includes(path.extname(file).toLowerCase()))) {
    const html = await fs.readFile(path.join(buildPath, filePath), "utf8");
    for (const href of [...html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1])) {
      if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("#")) continue;
      const target = href.startsWith("/") ? href.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(filePath), href));
      if (target && !(await fileExists(path.join(buildPath, target)))) {
        issues.push({ class: "warning", code: "MISSING_ASSET_OR_LINK", filePath, message: `Referenced file is missing: ${href}` });
      }
    }
  }
  return issues;
}

async function buildManifest(root: string): Promise<BuildManifestEntry[]> {
  const entries: BuildManifestEntry[] = [];
  for (const filePath of await listFiles(root)) {
    const absolutePath = path.join(root, filePath);
    const content = await fs.readFile(absolutePath);
    entries.push({
      path: filePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.byteLength
    });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function readJsonFromArchive(repoPath: string, commitSha: string, filePath: string): Promise<unknown> {
  const { stdout } = await execFile("git", ["show", `${commitSha}:${filePath}`], { cwd: repoPath, encoding: "utf8" });
  return JSON.parse(stdout);
}

async function gitArchive(repoPath: string, commitSha: string): Promise<Buffer> {
  const { stdout } = await execFile("git", ["archive", "--format=tar", commitSha], { cwd: repoPath, encoding: "buffer", maxBuffer: 1024 * 1024 * 100 });
  return stdout;
}

async function extractTar(buildPath: string, archive: Buffer): Promise<void> {
  const tarPath = path.join(buildPath, `.archive-${Date.now()}.tar`);
  await fs.writeFile(tarPath, archive);
  try {
    await execFile("tar", ["-xf", tarPath, "-C", buildPath]);
  } finally {
    await fs.rm(tarPath, { force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
