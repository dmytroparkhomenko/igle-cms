import * as cheerio from "cheerio";
import * as parse5 from "parse5";
import { createHash } from "node:crypto";
import type { FieldState } from "@igle/shared";
import { IgleError } from "@igle/shared";

export interface SourceRange {
  start: number;
  end: number;
}

export interface ParsedField {
  value?: string | undefined;
  state: FieldState;
  range?: SourceRange | undefined;
  readOnly?: boolean | undefined;
  reason?: string | undefined;
  occurrences: number;
}

export interface ParsedImage {
  src: string;
  alt?: string | undefined;
  decorative: boolean;
  nodeId: number;
}

export interface ParsedPageSEO {
  lang?: string | undefined;
  seoTitle: ParsedField;
  metaDescription: ParsedField;
  h1: ParsedField;
  canonical: ParsedField;
  robots: ParsedField;
  ogTitle: ParsedField;
  ogDescription: ParsedField;
  images: ParsedImage[];
  h1Count: number;
  wordCount: number;
  imagesCount: number;
  imagesMissingAlt: number;
  issues: Array<{ code: string; severity: "error" | "warning"; message: string }>;
  hashes: Record<string, string>;
}

export interface SeoPatchInput {
  seoTitle?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  canonical?: string | null;
  robots?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  lang?: string | null;
  favicon?: string | null;
}

interface ElementNode {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ElementNode[];
  parentNode?: ElementNode | undefined;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  };
  value?: string;
}

export function stableHash(value: string | undefined): string {
  return createHash("sha256").update(value ?? "").digest("hex");
}

export function parsePageSEO(html: string): ParsedPageSEO {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  attachParents(document);
  const $ = cheerio.load(html);

  const titleNodes = findElements(document, "title");
  const descriptionNodes = findMetaByName(document, "description");
  const h1Nodes = findElements(document, "h1").filter((node) => isInsideBody(node));
  const canonicalNodes = findLinksByRel(document, "canonical");
  const robotsNodes = findMetaByName(document, "robots");
  const ogTitleNodes = findMetaByProperty(document, "og:title");
  const ogDescriptionNodes = findMetaByProperty(document, "og:description");
  const htmlNode = findElements(document, "html")[0];
  const imageNodeIds: number[] = [];
  walkElementsWithId(document, (node, id) => {
    if (node.tagName === "img") imageNodeIds.push(id);
  });
  const images: ParsedImage[] = $("img")
    .toArray()
    .map((element, index) => {
      const item = $(element);
      const alt = item.attr("alt");
      const image: ParsedImage = {
        src: item.attr("src") ?? "",
        decorative: alt === "",
        nodeId: imageNodeIds[index] ?? -1
      };
      if (alt !== undefined) image.alt = alt;
      return image;
    });

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const fields = {
    seoTitle: elementTextField(titleNodes, "DUPLICATE_TITLE", "Multiple <title> elements found."),
    metaDescription: attributeField(descriptionNodes, "content", "DUPLICATE_DESCRIPTION", "Multiple meta descriptions found."),
    h1: h1Field(h1Nodes),
    canonical: attributeField(canonicalNodes, "href", "DUPLICATE_CANONICAL", "Multiple canonical links found."),
    robots: attributeField(robotsNodes, "content", "DUPLICATE_ROBOTS", "Multiple robots meta tags found."),
    ogTitle: attributeField(ogTitleNodes, "content", "DUPLICATE_OG_TITLE", "Multiple og:title tags found."),
    ogDescription: attributeField(
      ogDescriptionNodes,
      "content",
      "DUPLICATE_OG_DESCRIPTION",
      "Multiple og:description tags found."
    )
  };

  const issues: ParsedPageSEO["issues"] = Object.values(fields)
    .filter((field) => field.state === "ambiguous")
    .map((field) => ({
      code: field.reason?.split(":")[0] ?? "AMBIGUOUS_FIELD",
      severity: "error" as const,
      message: field.reason ?? "Ambiguous SEO field."
    }));

  if (h1Nodes.length === 0) {
    issues.push({ code: "NO_H1", severity: "warning", message: "Page has no H1." });
  }
  if (h1Nodes.length > 1) {
    issues.push({ code: "MULTIPLE_H1", severity: "warning", message: "Page has multiple H1 elements." });
  }

  const missingAlt = images.filter((image) => image.alt === undefined).length;
  if (missingAlt > 0) {
    issues.push({ code: "IMAGE_ALT_MISSING", severity: "warning", message: `${missingAlt} images are missing ALT text.` });
  }

  return {
    lang: attr(htmlNode, "lang"),
    ...fields,
    images,
    h1Count: h1Nodes.length,
    wordCount: bodyText.length === 0 ? 0 : bodyText.split(/\s+/).length,
    imagesCount: images.length,
    imagesMissingAlt: missingAlt,
    issues,
    hashes: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, stableHash(field.value)]))
  };
}

export function applyPageSEO(html: string, fields: SeoPatchInput): { html: string; patches: SourceRange[] } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  attachParents(document);
  const ms = new TextPatcher(html);
  const patches: SourceRange[] = [];

  const titleNodes = findElements(document, "title");
  const descriptionNodes = findMetaByName(document, "description");
  const h1Nodes = findElements(document, "h1").filter((node) => isInsideBody(node));
  const canonicalNodes = findLinksByRel(document, "canonical");
  const faviconNodes = findLinksByRel(document, "icon");
  const robotsNodes = findMetaByName(document, "robots");
  const ogTitleNodes = findMetaByProperty(document, "og:title");
  const ogDescriptionNodes = findMetaByProperty(document, "og:description");
  const htmlNode = findElements(document, "html")[0];
  const headNode = findElements(document, "head")[0];

  if (fields.lang !== undefined) {
    applySingletonAttribute(ms, html, htmlNode ? [htmlNode] : [], headNode, "html", "lang", fields.lang, patches, '<html lang="">');
  }

  if (fields.seoTitle !== undefined) {
    applySingletonElementText(ms, html, titleNodes, headNode, "title", fields.seoTitle, patches);
  }

  if (fields.metaDescription !== undefined) {
    applySingletonAttribute(
      ms,
      html,
      descriptionNodes,
      headNode,
      "meta",
      "content",
      fields.metaDescription,
      patches,
      '<meta name="description" content="">'
    );
  }

  if (fields.canonical !== undefined) {
    applySingletonAttribute(ms, html, canonicalNodes, headNode, "link", "href", fields.canonical, patches, '<link rel="canonical" href="">');
  }

  if (fields.favicon !== undefined) {
    applyFaviconLinks(ms, html, faviconNodes, headNode, fields.favicon, patches);
  }

  if (fields.robots !== undefined) {
    applySingletonAttribute(ms, html, robotsNodes, headNode, "meta", "content", fields.robots, patches, '<meta name="robots" content="">');
  }

  if (fields.ogTitle !== undefined) {
    applySingletonAttribute(
      ms,
      html,
      ogTitleNodes,
      headNode,
      "meta",
      "content",
      fields.ogTitle,
      patches,
      '<meta property="og:title" content="">'
    );
  }

  if (fields.ogDescription !== undefined) {
    applySingletonAttribute(
      ms,
      html,
      ogDescriptionNodes,
      headNode,
      "meta",
      "content",
      fields.ogDescription,
      patches,
      '<meta property="og:description" content="">'
    );
  }

  if (fields.h1 !== undefined) {
    if (h1Nodes.length !== 1) {
      throw new IgleError("AMBIGUOUS_H1", "H1 can only be edited as a field when exactly one H1 exists.", 409);
    }

    const node = h1Nodes[0];
    if (!node) throw new IgleError("AMBIGUOUS_H1", "H1 not found.", 409);
    const range = innerRange(node);
    if (!range) {
      throw new IgleError("UNPATCHABLE_H1", "H1 source location is unavailable.", 422);
    }

    const childElements = (node.childNodes ?? []).filter((child) => child.tagName);
    if (childElements.length > 0) {
      throw new IgleError("READ_ONLY_H1", "H1 contains child elements and must be edited visually or in source.", 409);
    }

    ms.overwrite(range.start, range.end, fields.h1 === null ? "" : escapeHtmlText(fields.h1));
    patches.push(range);
  }

  return { html: ms.toString(), patches };
}

/**
 * Assigns every element a stable index in document order. The same numbering is recomputed
 * (over a fresh parse) at both annotation time (serving the editable preview) and patch time
 * (applying a saved edit), so a "node id" round-trips correctly as long as the underlying
 * document structure hasn't changed between the two — the same assumption CON-05 makes
 * acceptable for a single-editor session.
 */
function walkElementsWithId(root: ElementNode, callback: (node: ElementNode, id: number) => void): void {
  let counter = 0;
  visit(root, (node) => {
    if (node.tagName) {
      callback(node, counter);
      counter += 1;
    }
  });
}

/**
 * Preview-only transform: inserts a `data-igle-node="N"` attribute into every element's start
 * tag so the editor bridge script can identify elements. Never written to site files — only to
 * the bytes served by the preview origin (VIS-02).
 */
export function annotateNodesForEditing(html: string): string {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  walkElementsWithId(document, (node, id) => {
    const insertPos = startTagInsertOffset(node);
    if (insertPos === undefined) return;
    ms.appendLeft(insertPos, ` data-igle-node="${id}"`);
  });
  return ms.toString();
}

/**
 * Preview-only transform: neutralizes executable <script> tags (VIS-02) so page behavior
 * doesn't interfere with editing. Never written to site files.
 */
export function neutralizeScripts(html: string): string {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  for (const node of findElements(document, "script")) {
    const currentType = attr(node, "type");
    const isExecutable = !currentType || /(java|ecma)script|^module$/i.test(currentType);
    if (!isExecutable) continue;

    if (currentType) {
      const range = attrValueRange(node, "type", html);
      if (range) {
        ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), "type", "igle/inert"));
        continue;
      }
    }
    const insertPos = startTagInsertOffset(node);
    if (insertPos !== undefined) ms.appendLeft(insertPos, ` type="igle/inert"`);
  }
  return ms.toString();
}

export interface StructuralPatch {
  nodeId: number;
  op:
    | "setInnerHtml"
    | "setAttr"
    | "removeAttr"
    | "removeNode"
    | "duplicateNode"
    | "setStyle"
    | "setHoverStyle"
    | "moveUp"
    | "moveDown"
    | "wrapInAnchor"
    | "unwrapAnchor"
    | "insertHtml";
  attrName?: string;
  value?: string;
  /** For op "setStyle"/"setHoverStyle": the CSS property to set (e.g. "color", "background-color"). */
  styleProperty?: string;
  /** For op "insertHtml": where to splice `value` relative to `nodeId` — "before"/"after" as a new
   * sibling, "prepend"/"append" as a new first/last child. */
  position?: "before" | "after" | "prepend" | "append";
}

/** Finds the outer HTML of the first `<tagName>` element in a page — used to seed a shared-navigation editor with real current markup. */
export function extractFirstElementByTag(html: string, tagName: string): string | undefined {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const [target] = findElements(document, tagName);
  const location = target?.sourceCodeLocation;
  if (!location) return undefined;
  return html.slice(location.startOffset, location.endOffset);
}

/**
 * Replaces the first `<tagName>` element's entire outer HTML with `newOuterHtml` — the mechanism
 * behind site-wide navigation editing (SOT: real sites duplicate header/footer markup on every
 * page rather than sharing a template partial, so "edit the header once" means finding and
 * replacing that same element on every page's own file, not editing a single shared source).
 */
export function replaceElementByTag(html: string, tagName: string, newOuterHtml: string): { html: string; found: boolean } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const [target] = findElements(document, tagName);
  const location = target?.sourceCodeLocation;
  if (!location) return { html, found: false };
  const ms = new TextPatcher(html);
  ms.overwrite(location.startOffset, location.endOffset, newOuterHtml);
  return { html: ms.toString(), found: true };
}

/** Reads one element's current attribute value, located by node id — used to capture an "old" value (e.g. an image's src) before a patch overwrites it, so other places that shared that same value can be found afterward. */
export function getNodeAttribute(html: string, nodeId: number, attrName: string): string | undefined {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  let target: ElementNode | undefined;
  walkElementsWithId(document, (node, id) => {
    if (id === nodeId) target = node;
  });
  return attr(target, attrName);
}

/** Reads one element's tag name, located by node id — used to check e.g. "is this the src of an <img>?" before deciding whether a setAttr patch should trigger site-wide image propagation. */
export function getNodeTagName(html: string, nodeId: number): string | undefined {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  let tagName: string | undefined;
  walkElementsWithId(document, (node, id) => {
    if (id === nodeId) tagName = node.tagName;
  });
  return tagName;
}

/**
 * Splits a page into what comes before its `<header>`, the markup between `</header>` and
 * `<footer>`, and what comes after — the code editor shows and edits only the middle: header and
 * footer are shared across every page and edited once on the dedicated screen, so exposing them
 * again in each page's own source view is both redundant and a way to accidentally fork them.
 * Falls back to treating the whole document as "middle" when a page has neither element.
 */
export function extractPageBodyMiddle(html: string): { before: string; middle: string; after: string } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const [headerNode] = findElements(document, "header");
  const [footerNode] = findElements(document, "footer");
  const headerEnd = headerNode?.sourceCodeLocation?.endOffset;
  const footerStart = footerNode?.sourceCodeLocation?.startOffset;
  const start = typeof headerEnd === "number" ? headerEnd : 0;
  const end = typeof footerStart === "number" && footerStart >= start ? footerStart : html.length;
  return { before: html.slice(0, start), middle: html.slice(start, end), after: html.slice(end) };
}

/** Rebuilds a full page from a possibly-edited middle, keeping the surrounding header/footer bytes exactly as they were read from disk. */
export function replacePageBodyMiddle(html: string, newMiddle: string): string {
  const { before, after } = extractPageBodyMiddle(html);
  return `${before}${newMiddle}${after}`;
}

const CTA_DEAD_HREF_PATTERN = /^(#|#!|javascript:void\(0\);?|javascript:;)$/i;
const CTA_CLASS_PATTERN = /aff-link|affiliate/i;
const CTA_REL_PATTERN = /\bsponsored\b/i;

export interface CtaTagResult {
  html: string;
  count: number;
}

/**
 * Auto-detects and marks affiliate CTA anchors with `data-igle-cta="<slot>"`, and neutralizes a
 * real destination already sitting in their href (rewritten to "#") so it stops being visible and
 * crawlable in the page's raw HTML — from then on the click-redirect script (see
 * affiliateClickScript / renameCtaAttribute, baked in at Deploy build time by @igle/build) is what
 * actually sends the click on, not the href.
 *
 * Three independent signals, each confirmed against real production markup rather than assumed:
 *  - a dead/placeholder href already (`#`, `#!`, `javascript:void(0)`...)
 *  - `rel="sponsored"` — the standard, purpose-built marker for a paid/affiliate link, and what
 *    real templates here actually put on a real hardcoded destination (Google's own recommended
 *    rel value for affiliate links) — this is the common case: most real CTAs are a plain
 *    `<a href="https://real-offer.example/?pid=123" rel="sponsored ...">`, not a dead href at all
 *  - an existing `aff-link`/`affiliate` class, or an existing `data-dynamic-link` marker
 *
 * Deliberately excludes guessing from an arbitrary external href alone — confirmed on real sites
 * to sit right next to a real `rel="sponsored"` CTA is exactly the kind of legitimate outbound
 * link (a regulator page, a responsible-gambling resource) that must never be cloaked.
 *
 * Idempotent: an element already carrying `data-igle-cta` is left untouched. Backfills
 * `target="_blank"` and a safe `rel` when missing.
 */
export function tagAffiliateCtas(html: string): CtaTagResult {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  let count = 0;

  for (const node of findElements(document, "a")) {
    if (attr(node, "data-igle-cta") !== undefined) continue;
    const href = (attr(node, "href") ?? "").trim();
    const dynamicLink = attr(node, "data-dynamic-link");
    const isDeadHref = CTA_DEAD_HREF_PATTERN.test(href);
    const isMarkedClass = CTA_CLASS_PATTERN.test(attr(node, "class") ?? "");
    const isSponsored = CTA_REL_PATTERN.test(attr(node, "rel") ?? "");
    if (!isDeadHref && !isMarkedClass && !isSponsored && dynamicLink === undefined) continue;

    const insertPos = startTagInsertOffset(node);
    if (insertPos === undefined) continue;
    const slot = dynamicLink?.trim() || "default";
    ms.appendLeft(insertPos, ` data-igle-cta="${escapeHtmlAttribute(slot)}"`);
    if (attr(node, "target") === undefined) ms.appendLeft(insertPos, ` target="_blank"`);
    if (attr(node, "rel") === undefined) ms.appendLeft(insertPos, ` rel="sponsored nofollow noopener noreferrer"`);

    if (!isDeadHref) {
      const hrefRange = attrValueRange(node, "href", html);
      if (hrefRange) {
        ms.overwrite(hrefRange.start, hrefRange.end, replaceAttributeValue(html.slice(hrefRange.start, hrefRange.end), "href", "#"));
      }
    }
    count += 1;
  }

  return { html: ms.toString(), count };
}

export interface UnmarkedExternalLink {
  nodeId: number;
  href: string;
  text: string;
}

const SAFE_EXTERNAL_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"]);

/**
 * Read-only audit: every `<a>` pointing to an absolute external URL that isn't already tagged
 * `data-igle-cta` and isn't on a small built-in allowlist of known-safe hosts (fonts/CDNs). Catches
 * what `tagAffiliateCtas` deliberately won't touch automatically — a real, hardcoded affiliate URL
 * with no placeholder href and no marker class at all (confirmed to happen: a real template had a
 * live tracking link baked directly into 6 anchors, fully crawlable). Callers should additionally
 * exclude the site's own production domain, which this function has no knowledge of.
 */
export function findUnmarkedExternalLinks(html: string): UnmarkedExternalLink[] {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const results: UnmarkedExternalLink[] = [];
  walkElementsWithId(document, (node, id) => {
    if (node.tagName !== "a" || attr(node, "data-igle-cta") !== undefined) return;
    const href = (attr(node, "href") ?? "").trim();
    if (!/^https?:\/\//i.test(href)) return;
    let host: string;
    try {
      host = new URL(href).hostname.toLowerCase();
    } catch {
      return;
    }
    if (SAFE_EXTERNAL_HOSTS.has(host)) return;
    results.push({ nodeId: id, href, text: (textContent(node) ?? "").slice(0, 140) });
  });
  return results;
}

export interface TaggedCtaLink {
  nodeId: number;
  tagName: string;
  slot: string;
  text: string;
  href: string | null;
}

/**
 * Every element already carrying `data-igle-cta`, regardless of how it got tagged (auto-detection,
 * or the visual editor's "Mark as affiliate link" toggle, wrap included) — the full inventory of
 * this site's affiliate links, as opposed to findUnmarkedExternalLinks's narrower "still needs
 * attention" audit. Read-only.
 */
export function findTaggedCtaLinks(html: string): TaggedCtaLink[] {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const results: TaggedCtaLink[] = [];
  walkElementsWithId(document, (node, id) => {
    const slot = attr(node, "data-igle-cta");
    if (slot === undefined) return;
    results.push({
      nodeId: id,
      tagName: node.tagName ?? "",
      slot,
      text: (textContent(node) ?? "").slice(0, 140),
      href: node.tagName === "a" ? (attr(node, "href") ?? null) : null
    });
  });
  return results;
}

/**
 * The attribute name a site's authoring markup carries `data-igle-cta` as once it's actually
 * shipped (see renameCtaAttribute) — deliberately generic-looking rather than CMS-branded, since
 * this ends up in the raw HTML of a real, public affiliate site (see IGLE-14: routing clicks
 * through the CMS's own infrastructure was rejected specifically because it's a visible tell that
 * ties every managed site back to one shared origin).
 */
export const CTA_SHIP_ATTR = "data-go";

/**
 * Renames every `data-igle-cta` (the internal authoring/editing marker) to `toAttr` in the final
 * shipped HTML — called once at Deploy build time (@igle/build), never during authoring/preview,
 * so the visual editor and preview bridge keep working against the stable `data-igle-cta` name
 * throughout editing. Also keeps the CMS's own footprint scanner (which rejects any leftover
 * `data-igle-*` marker in a build) satisfied even when no affiliate link is configured at all —
 * see bakeAffiliateLinks in @igle/build, which always renames regardless of whether it also
 * injects a click script.
 */
export function renameCtaAttribute(html: string, fromAttr: string, toAttr: string): { html: string; count: number } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  let count = 0;
  for (const node of findElementsWithAttr(document, fromAttr)) {
    const range = attrValueRange(node, fromAttr, html);
    if (!range) continue;
    const value = attr(node, fromAttr) ?? "";
    ms.overwrite(range.start, range.end, `${toAttr}="${escapeHtmlAttribute(value)}"`);
    count += 1;
  }
  return { html: ms.toString(), count };
}

function findElementsWithAttr(root: ElementNode, attrName: string): ElementNode[] {
  const results: ElementNode[] = [];
  visit(root, (node) => {
    if (node.tagName && attr(node, attrName) !== undefined) results.push(node);
  });
  return results;
}

/**
 * The actual click-redirect script — bakes `url` directly into the script text, so a real
 * visitor's click resolves entirely client-side, on the site's own domain, with zero request back
 * to the CMS (see IGLE-14). This means changing a site's affiliate link only takes effect on that
 * site's *next Deploy*, not instantly — the trade made deliberately in exchange for never routing
 * a real visitor's click through shared CMS infrastructure.
 *
 * Delegated (one listener on `document`, `.closest("[attr]")` per click) rather than a per-element
 * listener attached up front: during CMS preview/editing, an element can be marked live via
 * postMessage without a reload, so an upfront querySelectorAll scan would miss it — delegation
 * checks at click time instead. In the final shipped build there's no live-tagging concern, but
 * the same script text is used in both places (see apps/preview's own injection) so there's one
 * source of truth for its behavior.
 */
export function affiliateClickScript(url: string, attrName: string = CTA_SHIP_ATTR): string {
  return `<script>document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("[${attrName}]"):null;if(!t)return;e.preventDefault();var u=${JSON.stringify(url)};if(t.getAttribute("target")==="_blank"){window.open(u,"_blank","noopener,noreferrer");}else{window.location.href=u;}});</script>`;
}

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const REWRITABLE_ATTRS: Array<{ tag: string; attrName: string }> = [
  { tag: "a", attrName: "href" },
  { tag: "link", attrName: "href" },
  { tag: "script", attrName: "src" },
  { tag: "img", attrName: "src" }
];

function isRewritableRelativeUrl(value: string | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("#")) return false;
  if (URL_SCHEME_PATTERN.test(value)) return false; // http:, https:, mailto:, tel:, javascript:, data:, etc.
  return true;
}

/** Resolves a relative reference against an absolute base path exactly like a browser would (WHATWG URL algorithm) — used both to compute "resolved relative to this page's own nested position" and "resolved as if the page were at the site root," so a caller can compare the two. */
export function resolveRelativeReference(value: string, baseAbsolutePath: string): string {
  const resolved = new URL(value, `http://igle-internal.invalid${baseAbsolutePath}`);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export interface RelativeReference {
  tag: string;
  attrName: string;
  value: string;
}

/** Finds the distinct relative (non-absolute, non-external) href/src values used on a page — nav links, the canonical tag, stylesheets, scripts, images. Pure/read-only. */
export function findRelativeReferences(html: string): RelativeReference[] {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const seen = new Set<string>();
  const results: RelativeReference[] = [];
  for (const { tag, attrName } of REWRITABLE_ATTRS) {
    for (const node of findElements(document, tag)) {
      const value = attr(node, attrName);
      if (!isRewritableRelativeUrl(value)) continue;
      const key = `${tag}:${attrName}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ tag, attrName, value });
    }
  }
  return results;
}

/**
 * Rewrites href/src values found by findRelativeReferences, using `resolve` to decide each
 * value's final absolute form (return the same value, or undefined, to leave it untouched). A
 * relative reference like "bono/" or "./bono/" only resolves correctly from a page whose URL
 * happens to sit at exactly the depth the author assumed — often the site root, sometimes not,
 * depending on how the markup was authored — so the actual resolution decision (page-relative vs.
 * root-relative vs. left alone) is the caller's to make; this just applies it.
 */
export function absolutizeRelativeReferences(
  html: string,
  resolve: (reference: RelativeReference) => string | undefined
): { html: string; count: number } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  let count = 0;

  for (const { tag, attrName } of REWRITABLE_ATTRS) {
    for (const node of findElements(document, tag)) {
      const value = attr(node, attrName);
      if (!isRewritableRelativeUrl(value)) continue;
      const resolved = resolve({ tag, attrName, value });
      if (resolved === undefined || resolved === value) continue;
      const range = attrValueRange(node, attrName, html);
      if (!range) continue;
      ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), attrName, resolved));
      count += 1;
    }
  }

  return { html: ms.toString(), count };
}

/**
 * Replaces the `src` of every `<img>` whose current src exactly equals `oldSrc` — the mechanism
 * behind site-wide image replacement (a logo or hero image reused across many pages gets updated
 * everywhere it appears, not just on the page where the edit started). Also strips any `srcset`
 * on those elements: a browser prefers `srcset` over `src` whenever both are present, so a stale
 * `srcset` left pointing at the old image would make the `src` swap invisible.
 *
 * Also rewrites `<picture><source srcset="...">` candidates that reference `oldSrc` — a `<source>`
 * has no `src` attribute at all, only `srcset`, and a browser prefers a matching `<source>` over
 * the `<picture>`'s trailing `<img>` fallback. Without this, replacing an image used inside a
 * `<picture>` (common for responsive/format-negotiated images — several real sites in this app
 * use exactly this pattern) updates the `<img>` but the visible, rendered image never changes,
 * since the browser keeps loading the untouched `<source>`.
 *
 * Also rewrites a matching `<link rel="preload" as="image" href="...">` — some real sites here
 * preload their hero image this way for LCP. This one doesn't affect what's visibly rendered (the
 * `<img>` swap alone does that), only the browser's fetch priority — but leaving it pointed at
 * `oldSrc` wastes a preload fetch on an image the page no longer uses.
 */
export function replaceImageSrcEverywhere(html: string, oldSrc: string, newSrc: string): { html: string; count: number } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  attachParents(document);
  const ms = new TextPatcher(html);
  let count = 0;
  const swappedImgPictures = new Set<ElementNode>();
  for (const node of findElements(document, "img")) {
    if (attr(node, "src") !== oldSrc) continue;
    const range = attrValueRange(node, "src", html);
    if (!range) continue;
    ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), "src", newSrc));
    removeAttributeFromNode(ms, html, node, "srcset");
    count += 1;
    if (node.parentNode?.tagName === "picture") swappedImgPictures.add(node.parentNode);
  }
  const rewrittenSources = new Set<ElementNode>();
  for (const node of findElements(document, "source")) {
    const srcset = attr(node, "srcset");
    if (!srcset) continue;
    const rewritten = rewriteSrcsetForOldSrc(srcset, oldSrc, newSrc);
    if (rewritten === undefined) continue;
    const range = attrValueRange(node, "srcset", html);
    if (!range) continue;
    ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), "srcset", rewritten));
    rewrittenSources.add(node);
    count += 1;
  }
  // A <picture>'s <source> always wins over its <img> fallback whenever its media query matches —
  // so swapping the <img> above is invisible unless every sibling <source> ends up pointing at the
  // new image too. The loop just above already handles a <source> whose srcset happened to
  // string-match oldSrc; anything left over in a picture whose <img> was just swapped is dropped
  // instead of guessed at, since there's no reliable way to know which new asset should represent
  // each breakpoint. Confirmed live: a real page's <source srcset="assets/foo.webp"> (relative)
  // never matched its sibling <img src="/slug/assets/foo.webp"> (absolute) being replaced, silently
  // leaving the "replaced" image invisible at every viewport width the sources' media queries
  // covered between them (here, literally all of them).
  for (const picture of swappedImgPictures) {
    for (const child of picture.childNodes ?? []) {
      if (child.tagName !== "source" || rewrittenSources.has(child)) continue;
      const loc = child.sourceCodeLocation;
      if (!loc) continue;
      ms.remove(loc.startOffset, loc.endOffset);
      count += 1;
    }
  }
  for (const node of findElements(document, "link")) {
    if ((attr(node, "rel") ?? "").toLowerCase() !== "preload") continue;
    if ((attr(node, "as") ?? "").toLowerCase() !== "image") continue;
    if (attr(node, "href") !== oldSrc) continue;
    const range = attrValueRange(node, "href", html);
    if (!range) continue;
    ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), "href", newSrc));
    count += 1;
  }
  return { html: ms.toString(), count };
}

/** Rewrites the URL of any `srcset` candidate exactly matching oldSrc, preserving each candidate's width/pixel-density descriptor and the list's order. Returns undefined (no-op) if nothing matched, so callers can skip touching a node whose srcset is unrelated. */
function rewriteSrcsetForOldSrc(srcsetValue: string, oldSrc: string, newSrc: string): string | undefined {
  let changed = false;
  const rewritten = srcsetValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((candidate) => {
      const spaceIndex = candidate.search(/\s/);
      const url = spaceIndex === -1 ? candidate : candidate.slice(0, spaceIndex);
      const descriptor = spaceIndex === -1 ? "" : candidate.slice(spaceIndex);
      if (url !== oldSrc) return candidate;
      changed = true;
      return `${newSrc}${descriptor}`;
    });
  return changed ? rewritten.join(", ") : undefined;
}

function removeAttributeFromNode(ms: TextPatcher, html: string, node: ElementNode, attrName: string): void {
  const loc = node.sourceCodeLocation?.startTag ?? node.sourceCodeLocation;
  if (!loc) return;
  const tagSource = html.slice(loc.startOffset, loc.endOffset);
  const match = new RegExp(`\\s${attrName}\\s*=\\s*("[^"]*"|'[^']*')`, "i").exec(tagSource);
  if (match && match.index !== undefined) {
    ms.remove(loc.startOffset + match.index, loc.startOffset + match.index + match[0].length);
  }
}

const HOVER_STYLE_MARKER = "data-igle-hover-styles";

/**
 * data-igle-* markers this cleans up before a build ships, instead of letting them block the
 * build as a footprint violation. Two different reasons something ends up here:
 *  - HOVER_STYLE_MARKER: *intentionally* written into a page's saved HTML by applyStructuralPatches'
 *    setHoverStyle handling, purely so a later edit can re-find the same shared `<style>` tag — not
 *    a bug, just bookkeeping with no purpose once the page is actually shipped.
 *  - "data-igle-node": *not* intentional — a real, now-fixed bug (see sanitizeInlineHtml) let the
 *    preview-only node-id marker leak into saved content via "Edit as HTML" or double-click text
 *    edits on anything with nested child elements, confirmed the cause of a site failing every
 *    deploy. sanitizeInlineHtml stops this from happening to any *new* save; this entry exists
 *    purely to unblock sites whose already-saved files were contaminated before that fix landed —
 *    kept here rather than requiring everyone affected to hand-edit every page through the code
 *    editor first.
 * `data-igle-cta` isn't here: it's handled separately, by renaming (not stripping) to the shipped
 * `data-go` attribute, since it's still needed at click time.
 *
 * Deliberately an explicit allowlist, not "strip anything starting with data-igle-": an unexpected
 * marker reaching here that isn't one of these two known, now-understood cases is exactly the kind
 * of accidental-CMS-footprint bug scanFootprint exists to catch — this cleans up specific, known
 * cases without quietly defeating that safety net for anything genuinely new and unexpected.
 */
const KNOWN_RESIDUAL_MARKER_ATTRS = new Set([HOVER_STYLE_MARKER, "data-igle-node"]);

/** Strips every attribute in KNOWN_RESIDUAL_MARKER_ATTRS from the final build output — see that
 * constant for which markers these are and why. Run unconditionally, after any marker-renaming
 * step (see finalizeAuthoringMarkup in @igle/build), so using a feature that writes one of these
 * once doesn't block that page's deploys forever. */
export function stripResidualAuthoringMarkers(html: string): { html: string; count: number } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  let count = 0;
  visit(document, (node) => {
    if (!node.tagName) return;
    for (const attribute of node.attrs ?? []) {
      if (!KNOWN_RESIDUAL_MARKER_ATTRS.has(attribute.name)) continue;
      removeAttributeFromNode(ms, html, node, attribute.name);
      count += 1;
    }
  });
  return { html: ms.toString(), count };
}

/** Escapes a string for use as a literal (non-wildcard) fragment inside a `new RegExp(...)`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sets (or clears) one property in the `{ ... }` declaration block of a `#<elementId>:hover` rule
 * inside a shared stylesheet's text content, preserving every other rule and every other property
 * already in that same rule — same idea as mergeStyleDeclaration, just for a rule embedded in a
 * block of CSS text rather than a single inline `style="..."` attribute.
 */
function mergeHoverRule(styleBlockContent: string, elementId: string, property: string, value: string): string {
  const selector = `#${elementId}:hover`;
  const ruleRegex = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`);
  const match = ruleRegex.exec(styleBlockContent);
  const currentDeclarations = match ? match[1]! : "";
  const nextDeclarations = mergeStyleDeclaration(currentDeclarations, property, value);
  const newRule = `${selector} { ${nextDeclarations} }`;
  if (!match) {
    const trimmed = styleBlockContent.trim();
    return trimmed ? `${trimmed}\n${newRule}` : newRule;
  }
  return styleBlockContent.slice(0, match.index) + newRule + styleBlockContent.slice(match.index + match[0]!.length);
}

/**
 * Applies one or more edits located by node id (from annotateNodesForEditing / ParsedImage.nodeId)
 * in a single pass, so a batch of visual-editor changes lands as one minimal set of splices and
 * one revision. Node ids are resolved by re-walking a fresh parse of the CURRENT file content;
 * if the element can no longer be found the document changed since the editor loaded it.
 *
 * setStyle and setHoverStyle both accumulate in memory (pendingInlineStyle / hoverStyleContent)
 * across every patch in the batch before writing anything, instead of computing each patch's
 * result from the untouched original HTML the way every other op here does: two patches touching
 * the same inline `style` attribute (e.g. text color, then background color, saved together) would
 * otherwise both overwrite the exact same attribute range, and since neither builds on the other,
 * whichever is processed last would silently win and discard the other's change entirely.
 */
export function applyStructuralPatches(html: string, patches: StructuralPatch[]): { html: string } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  attachParents(document);
  const nodesById = new Map<number, ElementNode>();
  walkElementsWithId(document, (node, id) => nodesById.set(id, node));

  const ms = new TextPatcher(html);
  const pendingInlineStyle = new Map<number, string>();
  const ensuredElementIds = new Map<number, string>();
  let hoverStyleTag: ElementNode | undefined;
  let hoverStyleTagLoaded = false;
  let hoverStyleContent = "";

  function ensureElementId(target: ElementNode, nodeId: number): string {
    const already = ensuredElementIds.get(nodeId);
    if (already) return already;
    const existing = attr(target, "id");
    const resolvedId = existing ?? `igle-el-${nodeId}`;
    if (!existing) {
      const insertPos = startTagInsertOffset(target);
      if (insertPos !== undefined) ms.appendLeft(insertPos, ` id="${escapeHtmlAttribute(resolvedId)}"`);
    }
    ensuredElementIds.set(nodeId, resolvedId);
    return resolvedId;
  }

  for (const patch of patches) {
    const target = nodesById.get(patch.nodeId);
    if (!target) {
      throw new IgleError(
        "NODE_NOT_FOUND",
        "The selected element could not be located — the page may have changed. Reload the editor and try again.",
        409
      );
    }

    if (patch.op === "setInnerHtml") {
      const range = innerRange(target);
      if (!range) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be edited this way.", 422);
      ms.overwrite(range.start, range.end, sanitizeInlineHtml(patch.value ?? ""));
      continue;
    }

    if (patch.op === "setAttr") {
      if (!patch.attrName) throw new IgleError("INVALID_PATCH", "attrName is required for setAttr.", 400);
      const existing = attrValueRange(target, patch.attrName, html);
      if (existing) {
        ms.overwrite(
          existing.start,
          existing.end,
          replaceAttributeValue(html.slice(existing.start, existing.end), patch.attrName, patch.value ?? "")
        );
      } else {
        const insertPos = startTagInsertOffset(target);
        if (insertPos === undefined) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be edited.", 422);
        ms.appendLeft(insertPos, ` ${patch.attrName}="${escapeHtmlAttribute(patch.value ?? "")}"`);
      }
      continue;
    }

    if (patch.op === "removeAttr") {
      if (!patch.attrName) throw new IgleError("INVALID_PATCH", "attrName is required for removeAttr.", 400);
      removeAttributeFromNode(ms, html, target, patch.attrName);
    }

    if (patch.op === "removeNode") {
      const location = target.sourceCodeLocation;
      if (!location) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be removed.", 422);
      ms.remove(location.startOffset, location.endOffset);
      continue;
    }

    if (patch.op === "duplicateNode") {
      const location = target.sourceCodeLocation;
      if (!location) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be duplicated.", 422);
      const outerHtml = html.slice(location.startOffset, location.endOffset);
      ms.appendLeft(location.endOffset, outerHtml);
      continue;
    }

    // Splices arbitrary new markup in relative to `target` — "before"/"after" are the same shape
    // as duplicateNode's own insertion point (startOffset/endOffset), "prepend"/"append" reuse
    // innerRange, the same helper setInnerHtml already relies on. The one new thing duplicateNode
    // didn't need: sanitizeInlineHtml, since unlike a duplicate (always a byte-for-byte copy of
    // markup already present and already safe), this value arrives from the client (e.g. a
    // scanned/copied element's outerHTML) the same way a setInnerHtml edit's value does.
    if (patch.op === "insertHtml") {
      const sanitized = sanitizeInlineHtml(patch.value ?? "");
      if (patch.position === "before" || patch.position === "after") {
        const location = target.sourceCodeLocation;
        if (!location) throw new IgleError("UNPATCHABLE_NODE", "Cannot insert content next to this element.", 422);
        ms.appendLeft(patch.position === "before" ? location.startOffset : location.endOffset, sanitized);
      } else {
        const range = innerRange(target);
        if (!range) throw new IgleError("UNPATCHABLE_NODE", "This element cannot contain inserted content.", 422);
        ms.appendLeft(patch.position === "prepend" ? range.start : range.end, sanitized);
      }
      continue;
    }

    if (patch.op === "moveUp" || patch.op === "moveDown") {
      const location = target.sourceCodeLocation;
      if (!location) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be moved.", 422);
      // Swaps this element's outer HTML with its adjacent ELEMENT sibling's — text/whitespace
      // siblings in between are skipped and left exactly where they are. Two non-overlapping
      // range overwrites achieve the same result as an actual reorder without needing to touch
      // anything else in the document.
      const elementSiblings = (target.parentNode?.childNodes ?? []).filter((node) => Boolean(node.tagName));
      const index = elementSiblings.indexOf(target);
      const swapWith = patch.op === "moveUp" ? elementSiblings[index - 1] : elementSiblings[index + 1];
      const swapLocation = swapWith?.sourceCodeLocation;
      if (!swapWith || !swapLocation) continue; // already first/last among its siblings — nothing to do
      const targetHtml = html.slice(location.startOffset, location.endOffset);
      const swapHtml = html.slice(swapLocation.startOffset, swapLocation.endOffset);
      ms.overwrite(location.startOffset, location.endOffset, swapHtml);
      ms.overwrite(swapLocation.startOffset, swapLocation.endOffset, targetHtml);
      continue;
    }

    if (patch.op === "wrapInAnchor") {
      const location = target.sourceCodeLocation;
      if (!location) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be marked as an affiliate link.", 422);
      const outerHtml = html.slice(location.startOffset, location.endOffset);
      const slot = patch.value?.trim() || "default";
      const wrapper = `<a data-igle-cta="${escapeHtmlAttribute(slot)}" href="#" target="_blank" rel="sponsored nofollow noopener noreferrer">${outerHtml}</a>`;
      ms.overwrite(location.startOffset, location.endOffset, wrapper);
      continue;
    }

    if (patch.op === "unwrapAnchor") {
      const parent = target.parentNode;
      const parentLocation = parent?.sourceCodeLocation;
      if (!parent || parent.tagName !== "a" || attr(parent, "data-igle-cta") === undefined || !parentLocation) {
        throw new IgleError(
          "UNWRAP_MISMATCH",
          "This element's affiliate-link wrapper couldn't be found — it may have been hand-edited. Remove it via Edit as HTML instead.",
          409
        );
      }
      const elementChildren = (parent.childNodes ?? []).filter((node) => Boolean(node.tagName));
      if (elementChildren.length !== 1 || elementChildren[0] !== target) {
        throw new IgleError(
          "UNWRAP_MISMATCH",
          "This element's affiliate-link wrapper contains other content and can't be automatically unwrapped — remove it via Edit as HTML instead.",
          409
        );
      }
      const location = target.sourceCodeLocation;
      if (!location) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be unmarked.", 422);
      const innerHtml = html.slice(location.startOffset, location.endOffset);
      ms.overwrite(parentLocation.startOffset, parentLocation.endOffset, innerHtml);
      continue;
    }

    if (patch.op === "setStyle") {
      if (!patch.styleProperty) throw new IgleError("INVALID_PATCH", "styleProperty is required for setStyle.", 400);
      const base = pendingInlineStyle.get(patch.nodeId) ?? attr(target, "style") ?? "";
      pendingInlineStyle.set(patch.nodeId, mergeStyleDeclaration(base, patch.styleProperty, withImportant(patch.value)));
      continue;
    }

    if (patch.op === "setHoverStyle") {
      if (!patch.styleProperty) throw new IgleError("INVALID_PATCH", "styleProperty is required for setHoverStyle.", 400);
      if (!hoverStyleTagLoaded) {
        hoverStyleTag = findElements(document, "style").find((node) => attr(node, HOVER_STYLE_MARKER) !== undefined);
        const range = hoverStyleTag ? innerRange(hoverStyleTag) : undefined;
        hoverStyleContent = range ? html.slice(range.start, range.end) : "";
        hoverStyleTagLoaded = true;
      }
      const elementId = ensureElementId(target, patch.nodeId);
      hoverStyleContent = mergeHoverRule(hoverStyleContent, elementId, patch.styleProperty, withImportant(patch.value));
      continue;
    }
  }

  for (const [nodeId, nextStyle] of pendingInlineStyle) {
    const target = nodesById.get(nodeId)!;
    const existing = attrValueRange(target, "style", html);
    if (existing) {
      ms.overwrite(existing.start, existing.end, replaceAttributeValue(html.slice(existing.start, existing.end), "style", nextStyle));
    } else {
      const insertPos = startTagInsertOffset(target);
      if (insertPos !== undefined) ms.appendLeft(insertPos, ` style="${escapeHtmlAttribute(nextStyle)}"`);
    }
  }

  if (hoverStyleTagLoaded) {
    if (hoverStyleTag) {
      const range = innerRange(hoverStyleTag);
      if (range) ms.overwrite(range.start, range.end, hoverStyleContent);
    } else {
      // Inserted as the very last thing in <body> (not <head>) deliberately: every other element's
      // node-order id comes before it in document order, so creating this tag for the first time
      // never shifts any other element's id — only elements structurally after the insertion point
      // do, and nothing else is. Placement in the document has no effect on whether the CSS rule
      // applies; browsers treat a <style> in <body> the same as one in <head>.
      const bodyNode = findElements(document, "body")[0];
      const insertion = bodyNode?.sourceCodeLocation?.endTag?.startOffset;
      if (insertion !== undefined) ms.appendLeft(insertion, `<style ${HOVER_STYLE_MARKER}="1">${hoverStyleContent}</style>`);
    }
  }

  return { html: ms.toString() };
}

function startTagInsertOffset(node: ElementNode): number | undefined {
  const loc = node.sourceCodeLocation?.startTag ?? node.sourceCodeLocation;
  if (!loc || !node.tagName) return undefined;
  return loc.startOffset + 1 + node.tagName.length;
}

/**
 * Minimal safety net for visual-editor text commits: strips executable content, not a full
 * sanitizer. Also strips any `data-igle-*` attribute — the real, confirmed source of a site
 * failing every deploy with "Forbidden CMS marker data-igle- found": the preview bridge's
 * `describe(el)`/double-click-commit both hand back `el.innerHTML` verbatim, and *every* element
 * carries a `data-igle-node` marker in edit mode (see annotateNodesForEditing), including nested
 * children of whatever was selected — so editing a container ("Edit as HTML") or double-clicking
 * text that happens to wrap a nested element (a link, a span) captures those markers along with
 * it, and nothing used to strip them before the value was written straight to the saved file. This
 * is the single chokepoint every setInnerHtml-based save (double-click text, Edit as HTML, rich
 * text) already passes through, so fixing it here closes the leak at its source regardless of
 * which editing surface it came from.
 */
function sanitizeInlineHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sdata-igle-[a-z0-9-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function findElements(root: ElementNode, tagName: string): ElementNode[] {
  const results: ElementNode[] = [];
  visit(root, (node) => {
    if (node.tagName?.toLowerCase() === tagName.toLowerCase()) results.push(node);
  });
  return results;
}

function findMetaByName(root: ElementNode, name: string): ElementNode[] {
  return findElements(root, "meta").filter((node) => attr(node, "name")?.toLowerCase() === name.toLowerCase());
}

function findMetaByProperty(root: ElementNode, property: string): ElementNode[] {
  return findElements(root, "meta").filter((node) => attr(node, "property")?.toLowerCase() === property.toLowerCase());
}

function findLinksByRel(root: ElementNode, rel: string): ElementNode[] {
  return findElements(root, "link").filter((node) =>
    (attr(node, "rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .includes(rel.toLowerCase())
  );
}

function visit(node: ElementNode, callback: (node: ElementNode) => void): void {
  callback(node);
  for (const child of node.childNodes ?? []) visit(child, callback);
}

function attachParents(node: ElementNode, parent?: ElementNode): void {
  node.parentNode = parent;
  for (const child of node.childNodes ?? []) attachParents(child, node);
}

function attr(node: ElementNode | undefined, name: string): string | undefined {
  return node?.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function isInsideBody(node: ElementNode): boolean {
  return isInsideTag(node, "body");
}

function isInsideTag(node: ElementNode, tagName: string): boolean {
  let current: ElementNode | undefined = node.parentNode;
  while (current) {
    if (current.tagName === tagName) return true;
    current = current.parentNode;
  }
  return false;
}

function elementTextField(nodes: ElementNode[], code: string, message: string): ParsedField {
  if (nodes.length === 0) return { state: "absent", occurrences: 0 };
  if (nodes.length > 1) return { state: "ambiguous", occurrences: nodes.length, readOnly: true, reason: `${code}: ${message}` };

  const node = nodes[0];
  const value = textContent(node);
  return { value, state: "explicit", occurrences: 1, range: innerRange(node) };
}

function h1Field(nodes: ElementNode[]): ParsedField {
  if (nodes.length === 0) return { state: "absent", occurrences: 0 };
  if (nodes.length > 1) return { state: "ambiguous", occurrences: nodes.length, readOnly: true, reason: "MULTIPLE_H1: Multiple H1 elements found." };

  const node = nodes[0];
  const hasChildElement = (node?.childNodes ?? []).some((child) => Boolean(child.tagName));
  return {
    value: textContent(node),
    state: "explicit",
    occurrences: 1,
    range: innerRange(node),
    readOnly: hasChildElement,
    reason: hasChildElement ? "H1 contains child elements and must be edited visually or in source." : undefined
  };
}

function attributeField(nodes: ElementNode[], attrName: string, code: string, message: string): ParsedField {
  if (nodes.length === 0) return { state: "absent", occurrences: 0 };
  if (nodes.length > 1) return { state: "ambiguous", occurrences: nodes.length, readOnly: true, reason: `${code}: ${message}` };

  const node = nodes[0];
  return {
    value: attr(node, attrName),
    state: "explicit",
    occurrences: 1,
    range: attrValueRange(node, attrName)
  };
}

function textContent(node: ElementNode | undefined): string | undefined {
  if (!node) return undefined;
  let value = "";
  visit(node, (child) => {
    if (child.nodeName === "#text") value += child.value ?? "";
  });
  return value.trim();
}

function innerRange(node: ElementNode | undefined): SourceRange | undefined {
  const location = node?.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) return undefined;
  return { start: location.startTag.endOffset, end: location.endTag.startOffset };
}

function attrValueRange(node: ElementNode | undefined, attrName: string, html?: string): SourceRange | undefined {
  const location = node?.sourceCodeLocation;
  const attrLocation =
    location?.attrs?.[attrName] ??
    location?.attrs?.[attrName.toLowerCase()] ??
    Object.entries(location?.attrs ?? {}).find(([key]) => key.toLowerCase() === attrName.toLowerCase())?.[1];
  if (location && typeof attrLocation?.startOffset === "number" && typeof attrLocation.endOffset === "number") {
    return { start: attrLocation.startOffset, end: attrLocation.endOffset };
  }

  if (!location?.startTag || !html) return undefined;
  const tagSource = html.slice(location.startTag.startOffset, location.startTag.endOffset);
  const match = new RegExp(`\\s${attrName}\\s*=\\s*(["']).*?\\1`, "i").exec(tagSource);
  if (!match || match.index === undefined) return undefined;
  return {
    start: location.startTag.startOffset + match.index + 1,
    end: location.startTag.startOffset + match.index + match[0].length
  };
}

function applySingletonElementText(
  ms: TextPatcher,
  html: string,
  nodes: ElementNode[],
  headNode: ElementNode | undefined,
  tagName: string,
  value: string | null,
  patches: SourceRange[]
): void {
  if (nodes.length > 1) {
    throw new IgleError("AMBIGUOUS_FIELD", `${tagName} has multiple occurrences.`, 409);
  }

  const node = nodes[0];
  if (node) {
    const location = node.sourceCodeLocation;
    if (value === null) {
      if (!location) throw new IgleError("UNPATCHABLE_FIELD", `${tagName} source location is unavailable.`, 422);
      ms.remove(location.startOffset, location.endOffset);
      patches.push({ start: location.startOffset, end: location.endOffset });
      return;
    }

    const range = innerRange(node);
    if (!range) throw new IgleError("UNPATCHABLE_FIELD", `${tagName} source location is unavailable.`, 422);
    ms.overwrite(range.start, range.end, escapeHtmlText(value));
    patches.push(range);
    return;
  }

  if (value === null) return;
  const insertion = headInsertionOffset(headNode, html);
  const lineEnding = html.includes("\r\n") ? "\r\n" : "\n";
  const snippet = `${lineEnding}  <${tagName}>${escapeHtmlText(value)}</${tagName}>`;
  ms.appendLeft(insertion, snippet);
  patches.push({ start: insertion, end: insertion });
}

/**
 * Favicon gets its own update path instead of applySingletonAttribute's "more than one, throw"
 * behavior — real and imported sites commonly carry several `<link rel="icon"...>` tags (separate
 * size variants, or both `rel="icon"` and `rel="shortcut icon"`), which isn't the kind of genuine
 * conflict multiple `<title>` tags would be. Uploading a new favicon should point every one of
 * them at the new image, not silently skip the page — confirmed the actual cause of "favicon
 * won't change": applySingletonAttribute threw AMBIGUOUS_FIELD on any page with more than one
 * icon link, and SEOService.applyFaviconToAllPages swallows that into a skip, not an error.
 */
function applyFaviconLinks(
  ms: TextPatcher,
  html: string,
  nodes: ElementNode[],
  headNode: ElementNode | undefined,
  value: string | null,
  patches: SourceRange[]
): void {
  if (nodes.length === 0) {
    if (value === null) return;
    const insertion = headInsertionOffset(headNode, html);
    const lineEnding = html.includes("\r\n") ? "\r\n" : "\n";
    const snippet = `${lineEnding}  <link rel="icon" href="${escapeHtmlAttribute(value)}">`;
    ms.appendLeft(insertion, snippet);
    patches.push({ start: insertion, end: insertion });
    return;
  }

  for (const node of nodes) {
    if (value === null) {
      const location = node.sourceCodeLocation;
      if (!location) continue;
      ms.remove(location.startOffset, location.endOffset);
      patches.push({ start: location.startOffset, end: location.endOffset });
      continue;
    }
    const range = attrValueRange(node, "href", html);
    if (!range) continue;
    const replacement = replaceAttributeValue(html.slice(range.start, range.end), "href", value);
    ms.overwrite(range.start, range.end, replacement);
    patches.push(range);
  }
}

function applySingletonAttribute(
  ms: TextPatcher,
  html: string,
  nodes: ElementNode[],
  headNode: ElementNode | undefined,
  tagName: string,
  attrName: string,
  value: string | null,
  patches: SourceRange[],
  emptyElement: string
): void {
  if (nodes.length > 1) {
    throw new IgleError("AMBIGUOUS_FIELD", `${tagName} has multiple occurrences.`, 409);
  }

  const node = nodes[0];
  if (node) {
    const location = node.sourceCodeLocation;
    if (value === null) {
      if (!location) throw new IgleError("UNPATCHABLE_FIELD", `${tagName} source location is unavailable.`, 422);
      ms.remove(location.startOffset, location.endOffset);
      patches.push({ start: location.startOffset, end: location.endOffset });
      return;
    }

    const range = attrValueRange(node, attrName, html);
    if (!range) throw new IgleError("UNPATCHABLE_FIELD", `${attrName} source location is unavailable.`, 422);
    const replacement = replaceAttributeValue(html.slice(range.start, range.end), attrName, value);
    ms.overwrite(range.start, range.end, replacement);
    patches.push(range);
    return;
  }

  if (value === null) return;
  const insertion = headInsertionOffset(headNode, html);
  const lineEnding = html.includes("\r\n") ? "\r\n" : "\n";
  const snippet = `${lineEnding}  ${emptyElement.replace(`${attrName}=""`, `${attrName}="${escapeHtmlAttribute(value)}"`)}`;
  ms.appendLeft(insertion, snippet);
  patches.push({ start: insertion, end: insertion });
}

/**
 * Appends `!important` to a non-empty style value before it's merged into an inline `style="..."`
 * attribute or a `:hover` rule — an inline declaration already beats any *normal*-priority CSS
 * rule, but real templates commonly mark button/CTA colors `!important` in their own stylesheet,
 * which would otherwise still win over a plain visual-editor override. An empty value (property
 * being cleared, not set) is left alone — mergeStyleDeclaration/mergeHoverRule both treat that as
 * "delete this property," which "!important" would only get in the way of.
 */
function withImportant(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? "" : `${trimmed} !important`;
}

/** Sets one property in an inline `style="..."` value, preserving every other declaration already there. */
function mergeStyleDeclaration(currentStyle: string, property: string, value: string): string {
  const declarations = new Map<string, string>();
  for (const part of currentStyle.split(";")) {
    const colonIndex = part.indexOf(":");
    if (colonIndex === -1) continue;
    const name = part.slice(0, colonIndex).trim().toLowerCase();
    const val = part.slice(colonIndex + 1).trim();
    if (name) declarations.set(name, val);
  }
  const propertyKey = property.trim().toLowerCase();
  if (value.trim() === "") {
    declarations.delete(propertyKey);
  } else {
    declarations.set(propertyKey, value.trim());
  }
  return [...declarations.entries()].map(([name, val]) => `${name}: ${val}`).join("; ");
}

function replaceAttributeValue(attributeSource: string, attrName: string, value: string): string {
  const match = attributeSource.match(new RegExp(`^(${attrName}\\s*=\\s*)(["']?)([\\s\\S]*?)(\\2)$`, "i"));
  if (!match) return `${attrName}="${escapeHtmlAttribute(value)}"`;

  const quote = match[2] || '"';
  return `${match[1]}${quote}${escapeHtmlAttribute(value)}${quote}`;
}

function headInsertionOffset(headNode: ElementNode | undefined, html: string): number {
  if (headNode?.sourceCodeLocation?.startTag) return headNode.sourceCodeLocation.startTag.endOffset;
  const htmlNode = findElements(parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode, "html")[0];
  return htmlNode?.sourceCodeLocation?.startTag?.endOffset ?? 0;
}

function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
}

class TextPatcher {
  private readonly operations: Array<{ start: number; end: number; replacement: string }> = [];

  constructor(private readonly source: string) {}

  overwrite(start: number, end: number, replacement: string): void {
    this.operations.push({ start, end, replacement });
  }

  remove(start: number, end: number): void {
    this.overwrite(start, end, "");
  }

  appendLeft(offset: number, text: string): void {
    this.overwrite(offset, offset, text);
  }

  toString(): string {
    let output = this.source;
    const sorted = [...this.operations].sort((a, b) => b.start - a.start || b.end - a.end);
    for (const operation of sorted) {
      output = `${output.slice(0, operation.start)}${operation.replacement}${output.slice(operation.end)}`;
    }
    return output;
  }
}
