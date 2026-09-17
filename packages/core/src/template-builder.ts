import path from "node:path";

export interface DiscoveredPage {
  /** Path of the source HTML file relative to the zip root, e.g. "bono/index.html". */
  originPath: string;
  /** Canonical key used to match hrefs pointing at this page, e.g. "bono", "" for home. */
  matchKey: string;
  /** Site route, e.g. "/bono", "/". */
  route: string;
  /** Manifest pageType key, e.g. "bono", "home". */
  pageKey: string;
}

const ignoredBasenames = new Set([".DS_Store", "Thumbs.db"]);
const ignoredPrefixes = ["__MACOSX/", ".git/"];

export function isIgnoredPath(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  if (ignoredBasenames.has(basename)) return true;
  return ignoredPrefixes.some((prefix) => `${relativePath}/`.startsWith(prefix) || relativePath.startsWith(prefix));
}

/** Strips extension and a trailing "/index" or bare "index", giving a canonical origin key. */
export function deriveMatchKey(originPath: string): string {
  let value = originPath.replace(/\.html?$/i, "");
  value = value.replace(/(^|\/)index$/i, "$1").replace(/\/+$/, "");
  // path.posix.normalize/join can resolve a reference straight back to "." (e.g. "../" from one
  // folder down to root) — that's the same "root itself" as the empty string, not a real page.
  if (value === ".") value = "";
  return value;
}

export function matchKeyToRoute(matchKey: string): string {
  return matchKey === "" ? "/" : `/${matchKey}`;
}

export function matchKeyToPageKey(matchKey: string): string {
  if (matchKey === "") return "home";
  return matchKey
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function discoverPages(htmlFilePaths: string[]): DiscoveredPage[] {
  const seen = new Map<string, DiscoveredPage>();
  for (const originPath of htmlFilePaths) {
    const matchKey = deriveMatchKey(originPath);
    seen.set(matchKey, {
      originPath,
      matchKey,
      route: matchKeyToRoute(matchKey),
      pageKey: matchKeyToPageKey(matchKey)
    });
  }
  return [...seen.values()];
}

export type RewriteKind = "page" | "asset" | "external";

export interface RewriteResult {
  value: string;
  kind: RewriteKind;
  /** Set when kind === "asset": the file's path relative to the zip root, for copying. */
  assetOriginPath?: string;
}

const externalHrefPattern = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resolves one href/src value found in `originPath` (relative to the zip root) into either the
 * matching page's route, an absolute "/assets/..." path, or leaves external/special links (http,
 * mailto, tel, data, javascript, #fragment) untouched. Any depth of nesting is handled uniformly
 * by resolving through the source file's actual directory — the flat single-directory convention
 * this CMS's templates render into doesn't have to match the uploaded zip's original layout.
 */
export function rewriteReference(hrefValue: string, originPath: string, pagesByMatchKey: Map<string, DiscoveredPage>): RewriteResult {
  if (externalHrefPattern.test(hrefValue) || hrefValue.startsWith("#")) {
    return { value: hrefValue, kind: "external" };
  }

  const [pathPart, suffix] = splitOffQueryOrHash(hrefValue);
  if (pathPart === "") return { value: hrefValue, kind: "external" };

  let resolved: string;
  if (pathPart.startsWith("/")) {
    resolved = path.posix.normalize(pathPart.slice(1));
  } else {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(originPath), pathPart));
  }
  resolved = resolved.replace(/^(\.\.\/)+/, "").replace(/^\.$/, "");

  const matchKey = deriveMatchKey(resolved);
  const page = pagesByMatchKey.get(matchKey);
  if (page) {
    return { value: `${page.route}${suffix}`, kind: "page" };
  }

  return { value: `/assets/${resolved}${suffix}`, kind: "asset", assetOriginPath: resolved };
}

function splitOffQueryOrHash(value: string): [string, string] {
  const index = value.search(/[?#]/);
  if (index === -1) return [value, ""];
  return [value.slice(0, index), value.slice(index)];
}

const hrefSrcAttrPattern = /(\s(?:href|src)=")([^"]*)(")/gi;

/** Rewrites every href/src attribute in an HTML document, collecting non-page targets to copy as assets. */
export function rewritePageReferences(
  html: string,
  originPath: string,
  pagesByMatchKey: Map<string, DiscoveredPage>,
  assetOriginPaths: Set<string>
): string {
  return html.replace(hrefSrcAttrPattern, (full, prefix: string, value: string, suffix: string) => {
    const result = rewriteReference(value, originPath, pagesByMatchKey);
    if (result.kind === "asset" && result.assetOriginPath) assetOriginPaths.add(result.assetOriginPath);
    return `${prefix}${result.value}${suffix}`;
  });
}

export interface ExtractedSeo {
  seoTitle: string | undefined;
  metaDescription: string | undefined;
}

/** Extracts <title>/meta-description and swaps the four canonical SEO surfaces for {{page.*}} placeholders. */
export function templatizeSeo(html: string): { html: string; seo: ExtractedSeo } {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const descriptionMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/i, "<title>{{page.seoTitle}}</title>");
  out = out.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, "$1{{page.metaDescription}}$2");
  out = out.replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, "$1{{page.seoTitle}}$2");
  out = out.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, "$1{{page.metaDescription}}$2");

  return {
    html: out,
    seo: {
      seoTitle: titleMatch?.[1]?.trim(),
      metaDescription: descriptionMatch?.[1]?.trim()
    }
  };
}

/** Strips a source domain's absolute URLs to relative, and maps bare text mentions of it to {{site.name}}. */
export function stripSourceDomain(html: string, domain: string): string {
  const cleanDomain = domain.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!cleanDomain) return html;
  let out = html.replaceAll(`https://${cleanDomain}`, "").replaceAll(`http://${cleanDomain}`, "");
  out = out.replaceAll(cleanDomain, "{{site.name}}");
  return out;
}

const caseVariant = { upper: (s: string) => s.toUpperCase(), lower: (s: string) => s.toLowerCase(), title: (s: string) => s };

/** Replaces every case-variant occurrence of `brandName` with a {{fields.brandName}} token, preserving casing style. */
export function parameterizeBrand(html: string, brandName: string): string {
  const trimmed = brandName.trim();
  if (!trimmed) return html;
  let out = html;
  out = out.replaceAll(caseVariant.upper(trimmed), "{{fields.brandName | upper}}");
  out = out.replaceAll(trimmed, "{{fields.brandName}}");
  out = out.replaceAll(caseVariant.lower(trimmed), "{{fields.brandName | lower}}");
  return out;
}

export function slugifyTemplateKey(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `template-${Date.now().toString(36)}`;
}
