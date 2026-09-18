/** Finds the href of the first `<link rel="icon">` (or "shortcut icon") tag in a page's raw HTML. */
export function extractFaviconHref(html: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const relMatch = /rel\s*=\s*["']([^"']+)["']/i.exec(tag);
    const rel = (relMatch?.[1] ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon")) continue;
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (hrefMatch?.[1]) return hrefMatch[1];
  }
  return undefined;
}
