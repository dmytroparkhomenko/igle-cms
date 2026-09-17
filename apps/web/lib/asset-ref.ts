import path from "node:path";

export type AssetRef = { kind: "absolute"; url: string } | { kind: "relative"; path: string };

/** Resolves an <img>/<link> src/href found in a page's raw HTML to something renderable: already-absolute URLs and data URIs pass through untouched, anything else becomes a path under the preview server's `/<slug>/...` — left for the caller to prefix with the (client-corrected) preview origin. */
export function resolveAssetRef(src: string, pageFilePath: string, slug: string): AssetRef {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return { kind: "absolute", url: src };
  const relative = src.startsWith("/") ? src.slice(1) : path.posix.join(path.posix.dirname(pageFilePath), src);
  return { kind: "relative", path: `/${slug}/${relative}` };
}
