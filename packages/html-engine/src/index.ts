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
  const images: ParsedImage[] = $("img")
    .toArray()
    .map((element) => {
      const item = $(element);
      const alt = item.attr("alt");
      const image: ParsedImage = {
        src: item.attr("src") ?? "",
        decorative: alt === ""
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
  const headNode = findElements(document, "head")[0];

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
