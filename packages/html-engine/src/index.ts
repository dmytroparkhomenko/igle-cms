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
    applySingletonAttribute(ms, html, faviconNodes, headNode, "link", "href", fields.favicon, patches, '<link rel="icon" href="">');
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
  op: "setInnerHtml" | "setAttr" | "removeAttr" | "removeNode" | "duplicateNode" | "setStyle";
  attrName?: string;
  value?: string;
  /** For op "setStyle": the CSS property to set (e.g. "color", "background-color"). */
  styleProperty?: string;
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
 */
export function replaceImageSrcEverywhere(html: string, oldSrc: string, newSrc: string): { html: string; count: number } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const ms = new TextPatcher(html);
  let count = 0;
  for (const node of findElements(document, "img")) {
    if (attr(node, "src") !== oldSrc) continue;
    const range = attrValueRange(node, "src", html);
    if (!range) continue;
    ms.overwrite(range.start, range.end, replaceAttributeValue(html.slice(range.start, range.end), "src", newSrc));
    removeAttributeFromNode(ms, html, node, "srcset");
    count += 1;
  }
  return { html: ms.toString(), count };
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

/**
 * Applies one or more edits located by node id (from annotateNodesForEditing / ParsedImage.nodeId)
 * in a single pass, so a batch of visual-editor changes lands as one minimal set of splices and
 * one revision. Node ids are resolved by re-walking a fresh parse of the CURRENT file content;
 * if the element can no longer be found the document changed since the editor loaded it.
 */
export function applyStructuralPatches(html: string, patches: StructuralPatch[]): { html: string } {
  const document = parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as ElementNode;
  const nodesById = new Map<number, ElementNode>();
  walkElementsWithId(document, (node, id) => nodesById.set(id, node));

  const ms = new TextPatcher(html);
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

    if (patch.op === "setStyle") {
      if (!patch.styleProperty) throw new IgleError("INVALID_PATCH", "styleProperty is required for setStyle.", 400);
      const currentStyle = attr(target, "style") ?? "";
      const nextStyle = mergeStyleDeclaration(currentStyle, patch.styleProperty, patch.value ?? "");
      const existing = attrValueRange(target, "style", html);
      if (existing) {
        ms.overwrite(existing.start, existing.end, replaceAttributeValue(html.slice(existing.start, existing.end), "style", nextStyle));
      } else {
        const insertPos = startTagInsertOffset(target);
        if (insertPos === undefined) throw new IgleError("UNPATCHABLE_NODE", "This element cannot be styled.", 422);
        ms.appendLeft(insertPos, ` style="${escapeHtmlAttribute(nextStyle)}"`);
      }
      continue;
    }
  }

  return { html: ms.toString() };
}

function startTagInsertOffset(node: ElementNode): number | undefined {
  const loc = node.sourceCodeLocation?.startTag ?? node.sourceCodeLocation;
  if (!loc || !node.tagName) return undefined;
  return loc.startOffset + 1 + node.tagName.length;
}

/** Minimal safety net for visual-editor text commits: strips executable content, not a full sanitizer. */
function sanitizeInlineHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
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
  let current: ElementNode | undefined = node.parentNode;
  while (current) {
    if (current.tagName === "body") return true;
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
