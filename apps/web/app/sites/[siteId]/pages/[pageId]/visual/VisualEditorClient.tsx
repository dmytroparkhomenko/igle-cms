"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PreviewFrame } from "../../../../../PreviewFrame";
import { RichTextEditor, canUseRichText } from "./RichTextEditor";

interface AncestorRef {
  nodeId: number;
  tagName: string;
}

interface SelectedElement {
  nodeId: number;
  tagName: string;
  html: string;
  text: string;
  src: string | null;
  href: string | null;
  alt: string | null;
  className: string;
  color: string | null;
  backgroundColor: string | null;
  borderColor: string | null;
  borderWidth: string | null;
  borderRadius: string | null;
  padding: string | null;
  textAlign: string | null;
  letterSpacing: string | null;
  textTransform: string | null;
  fontFamily: string | null;
  fontSize: string | null;
  dataIgleCta: string | null;
  /** True when this element's own parent is the <a data-igle-cta> wrapper "Mark as affiliate
   * link" creates for a non-<a> element (see toggleAffiliateCta) — the marker itself lives on that
   * wrapper, not on this element, so dataIgleCta alone doesn't capture this case. */
  wrappedInCta: boolean;
  hasPrevSibling: boolean;
  hasNextSibling: boolean;
  ancestors: AncestorRef[];
}

interface NavPage {
  id: string;
  route: string;
  internalName: string;
}

interface PendingPatch {
  nodeId: number;
  op:
    | "setInnerHtml"
    | "setAttr"
    | "removeAttr"
    | "setStyle"
    | "setHoverStyle"
    | "removeNode"
    | "duplicateNode"
    | "moveUp"
    | "moveDown"
    | "wrapInAnchor"
    | "unwrapAnchor";
  attrName?: string;
  styleProperty?: string;
  value?: string;
}

/** #rrggbb -> "rgba(r, g, b, alpha)" — used to build a shadow color with some transparency; falls back to black if the input isn't a valid 6-digit hex (e.g. mid-typing in the hex field). */
function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(0, 0, 0, ${alpha})`;
  const int = parseInt(match[1]!, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/** A hex text field (typing a code is the primary way in) with a native color swatch alongside for a quick pick — the swatch mirrors the typed value when it's a valid 6-digit hex, and writes back a hex when used. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const isValidHex = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="field">
      <label className="muted" style={{ fontSize: 12.5 }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          spellCheck={false}
          style={{ width: 84, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
        />
        <input
          type="color"
          value={isValidHex ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          style={{ height: 30, width: 34, padding: 2, flexShrink: 0 }}
        />
      </div>
    </div>
  );
}

type ShadowSize = "none" | "small" | "medium" | "large";
const SHADOW_PRESETS: Record<Exclude<ShadowSize, "none">, { offsetY: number; blur: number; alpha: number }> = {
  small: { offsetY: 1, blur: 3, alpha: 0.3 },
  medium: { offsetY: 4, blur: 10, alpha: 0.3 },
  large: { offsetY: 10, blur: 25, alpha: 0.35 }
};

/**
 * Border, shadow, font and hover controls for the selected element — split out from the main
 * component and mounted with `key={selected.nodeId}` so its local draft state (shadow size/color,
 * hover colors — none of which the live DOM can be read back into, unlike text/background color)
 * resets cleanly whenever the selection changes, instead of carrying stale values over.
 */
function StyleControls({
  selected,
  queueStyle,
  queueHoverStyle
}: {
  selected: SelectedElement;
  queueStyle: (property: string, value: string) => void;
  queueHoverStyle: (property: string, value: string) => void;
}) {
  const [borderWidth, setBorderWidth] = useState(() => Math.round(parseFloat(selected.borderWidth ?? "0")) || 0);
  const [borderColor, setBorderColor] = useState(selected.borderColor ?? "#000000");
  const [borderRadius, setBorderRadius] = useState(() => Math.round(parseFloat(selected.borderRadius ?? "0")) || 0);
  const [padding, setPadding] = useState(() => Math.round(parseFloat(selected.padding ?? "0")) || 0);
  const [shadowSize, setShadowSize] = useState<ShadowSize>("none");
  const [shadowColor, setShadowColor] = useState("#000000");
  const [hoverBg, setHoverBg] = useState("#000000");
  const [hoverText, setHoverText] = useState("#ffffff");

  function applyBorder(nextWidth: number, nextColor: string) {
    setBorderWidth(nextWidth);
    setBorderColor(nextColor);
    if (nextWidth > 0) {
      queueStyle("border-style", "solid");
      queueStyle("border-width", `${nextWidth}px`);
      queueStyle("border-color", nextColor);
    } else {
      queueStyle("border-style", "none");
    }
  }

  function applyBorderRadius(next: number) {
    setBorderRadius(next);
    queueStyle("border-radius", `${next}px`);
  }

  function applyPadding(next: number) {
    setPadding(next);
    queueStyle("padding", `${next}px`);
  }

  function applyShadow(nextSize: ShadowSize, nextColor: string) {
    setShadowSize(nextSize);
    setShadowColor(nextColor);
    if (nextSize === "none") {
      queueStyle("box-shadow", "none");
      return;
    }
    const preset = SHADOW_PRESETS[nextSize];
    queueStyle("box-shadow", `0 ${preset.offsetY}px ${preset.blur}px ${hexToRgba(nextColor, preset.alpha)}`);
  }

  return (
    <>
      <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <p className="settings-section-title" style={{ margin: 0 }}>
          Border
        </p>
        <div className="field-row">
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Width (px)
            </label>
            <input
              type="number"
              min={0}
              max={20}
              value={borderWidth}
              onChange={(event) => applyBorder(Math.max(0, Number(event.target.value) || 0), borderColor)}
              style={{ width: 70 }}
            />
          </div>
          <ColorField label="Color" value={borderColor} onChange={(hex) => applyBorder(borderWidth, hex)} />
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Corner radius (px)
            </label>
            <input
              type="number"
              min={0}
              max={200}
              value={borderRadius}
              onChange={(event) => applyBorderRadius(Math.max(0, Number(event.target.value) || 0))}
              style={{ width: 70 }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <p className="settings-section-title" style={{ margin: 0 }}>
          Spacing
        </p>
        <div className="field">
          <label className="muted" style={{ fontSize: 12.5 }}>
            Padding, all sides (px)
          </label>
          <input
            type="number"
            min={0}
            max={200}
            value={padding}
            onChange={(event) => applyPadding(Math.max(0, Number(event.target.value) || 0))}
            style={{ width: 70 }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <p className="settings-section-title" style={{ margin: 0 }}>
          Shadow
        </p>
        <div className="field-row">
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Size
            </label>
            <select value={shadowSize} onChange={(event) => applyShadow(event.target.value as ShadowSize, shadowColor)}>
              <option value="none">None</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          {shadowSize !== "none" ? <ColorField label="Color" value={shadowColor} onChange={(hex) => applyShadow(shadowSize, hex)} /> : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <p className="settings-section-title" style={{ margin: 0 }}>
          Font
        </p>
        <div className="field-row">
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Family
            </label>
            <input
              type="text"
              defaultValue={selected.fontFamily ?? ""}
              onBlur={(event) => queueStyle("font-family", event.target.value)}
              placeholder="e.g. Poppins, sans-serif"
            />
          </div>
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Size
            </label>
            <input
              type="text"
              defaultValue={selected.fontSize ?? ""}
              onBlur={(event) => queueStyle("font-size", event.target.value)}
              placeholder="e.g. 16px"
              style={{ width: 80 }}
            />
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          Only applies a font already loaded on this page — match a family used elsewhere on the site.
        </p>
        <div className="field-row">
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Align
            </label>
            <select defaultValue={selected.textAlign ?? "left"} onChange={(event) => queueStyle("text-align", event.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Transform
            </label>
            <select defaultValue={selected.textTransform ?? "none"} onChange={(event) => queueStyle("text-transform", event.target.value)}>
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
          <div className="field">
            <label className="muted" style={{ fontSize: 12.5 }}>
              Letter spacing
            </label>
            <input
              type="text"
              defaultValue={selected.letterSpacing ?? ""}
              onBlur={(event) => queueStyle("letter-spacing", event.target.value)}
              placeholder="e.g. 0.5px"
              style={{ width: 90 }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <p className="settings-section-title" style={{ margin: 0 }}>
          Hover
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
          What this element changes to on mouseover — can&apos;t be read back from the page, so these always start
          blank/black regardless of any hover style already set.
        </p>
        <div className="field-row">
          <ColorField
            label="Background"
            value={hoverBg}
            onChange={(hex) => {
              setHoverBg(hex);
              queueHoverStyle("background-color", hex);
            }}
          />
          <ColorField
            label="Text"
            value={hoverText}
            onChange={(hex) => {
              setHoverText(hex);
              queueHoverStyle("color", hex);
            }}
          />
        </div>
      </div>
    </>
  );
}

const CUSTOM_LINK_TARGET = "__custom__";

/** Elements the "Mark as affiliate link" action is offered on — deliberately narrow: a section or
 * other large container marked as an affiliate link makes an entire block of the page clickable,
 * which is never the intent. Once something is already marked (or wrapped) it stays editable here
 * regardless of tag, so there's no dead end for cleaning up something tagged before this list
 * existed — only *starting* a new mark is restricted. */
const AFFILIATE_LINK_ALLOWED_TAGS = new Set(["a", "button", "img"]);

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      response.ok
        ? "The server sent back something unexpected. Try again — if this keeps happening, reload the page."
        : `Request failed (HTTP ${response.status}). Try again — if this keeps happening, reload the page.`
    );
  }
}

/** Strips a leading "./" or "/" and a trailing slash so different spellings of the same route (relative, root-relative, with or without a trailing slash) compare equal. */
function normalizeRoute(value: string): string {
  return value
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\/index\.html?$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function matchPageForHref(href: string | null | undefined, pages: NavPage[]): NavPage | undefined {
  if (!href) return undefined;
  const normalized = normalizeRoute(href);
  return pages.find((page) => normalizeRoute(page.route) === normalized);
}

export function VisualEditorClient({
  siteId,
  siteSlug,
  pageId,
  pageRoute,
  previewOrigin: previewOriginFallback,
  pages
}: {
  siteId: string;
  siteSlug: string;
  pageId: string;
  pageRoute: string;
  previewOrigin: string;
  pages: NavPage[];
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  // Undo/redo: `stack[index]` is always the current patches array — every user action pushes a new
  // snapshot (truncating any redo future first), and undo/redo just moves the pointer. Kept as one
  // state object (not separate stack/index states) so a commit is always a single atomic update —
  // two separate setStates here would risk one reading the other's pre-update value.
  const [editHistory, setEditHistory] = useState<{ stack: PendingPatch[][]; index: number }>({ stack: [[]], index: 0 });
  const patches = editHistory.stack[editHistory.index]!;
  // What to replay into the iframe once it finishes reloading after an undo/redo — reloading is
  // the only reliable way to "undo" a removeNode/duplicateNode in the live DOM, since neither has
  // an inverse the bridge script can apply directly. Stashed in a ref, not state, since it needs to
  // be read synchronously from the onLoad callback, not through a render cycle.
  const replayPatchesRef = useRef<PendingPatch[] | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [htmlEditorOpen, setHtmlEditorOpen] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [htmlEditorTab, setHtmlEditorTab] = useState<"rich" | "raw">("rich");
  const [linkHrefDraft, setLinkHrefDraft] = useState("");
  const [linkTarget, setLinkTarget] = useState<string>(CUSTOM_LINK_TARGET);
  const [reloadKey, setReloadKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // The server bakes PREVIEW_ORIGIN from its own env var (typically "http://localhost:3001"),
  // which only resolves correctly if the browser happens to be on the same machine as the
  // Docker host. Any other access path (LAN IP, VPS public IP, a real domain) makes the iframe
  // point at the wrong place and silently fails the postMessage origin check below — the
  // symptom is exactly "clicking an element does nothing." Re-deriving from the browser's own
  // location (keeping only the port from the server value) fixes this regardless of how the
  // app is actually being accessed. Starts from the server value to match SSR, corrects on mount.
  const [previewOrigin, setPreviewOrigin] = useState(previewOriginFallback);
  useEffect(() => {
    try {
      const port = new URL(previewOriginFallback).port || "3001";
      setPreviewOrigin(`${window.location.protocol}//${window.location.hostname}:${port}`);
    } catch {
      // Malformed fallback URL — keep using it as-is rather than guessing.
    }
  }, [previewOriginFallback]);

  const previewUrl = `${previewOrigin}/${siteSlug}${pageRoute}${interactive ? "" : "?igle_edit=1"}`;
  const richTextAvailable = useMemo(() => canUseRichText(htmlDraft), [htmlDraft]);
  useEffect(() => {
    if (htmlEditorTab === "rich" && !richTextAvailable) setHtmlEditorTab("raw");
  }, [htmlEditorTab, richTextAvailable]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      shellRef.current?.requestFullscreen();
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== previewOrigin) return;
      const data = event.data as { source?: string; type?: string; element?: SelectedElement; nodeId?: number; html?: string };
      if (!data || data.source !== "igle-preview") return;

      if (data.type === "select" && data.element) {
        setSelected(data.element);
        setLinkHrefDraft(data.element.href ?? "");
        const matched = matchPageForHref(data.element.href, pages);
        setLinkTarget(matched ? matched.id : CUSTOM_LINK_TARGET);
      }

      if (data.type === "textEdited" && typeof data.nodeId === "number") {
        const nodeId = data.nodeId;
        const html = data.html ?? "";
        commitPatches((prev) => [
          ...prev.filter((patch) => !(patch.nodeId === nodeId && patch.op === "setInnerHtml")),
          { nodeId, op: "setInnerHtml", value: html }
        ]);
        setStatus({ kind: "idle" });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOrigin, pages]);

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: "igle-editor", ...message }, previewOrigin);
    },
    [previewOrigin]
  );

  /** Every queuing function calls this instead of setPatches directly — records the resulting
   * array as a new history entry (dropping any redo future) so undo/redo has something to step
   * through. Takes an updater function, like setState itself, so it always sees the true latest
   * patches even from a stale-closure callback (e.g. the message listener above). */
  function commitPatches(updater: (prev: PendingPatch[]) => PendingPatch[]): void {
    setEditHistory((prev) => {
      const next = updater(prev.stack[prev.index]!);
      const truncated = [...prev.stack.slice(0, prev.index + 1), next];
      return { stack: truncated, index: truncated.length - 1 };
    });
  }

  function replayPatchToFrame(patch: PendingPatch): void {
    switch (patch.op) {
      case "setInnerHtml":
        postToFrame({ type: "setInnerHtml", nodeId: patch.nodeId, html: patch.value ?? "" });
        break;
      case "setAttr":
        postToFrame({ type: "setAttr", nodeId: patch.nodeId, attrName: patch.attrName, value: patch.value });
        break;
      case "removeAttr":
        postToFrame({ type: "removeAttr", nodeId: patch.nodeId, attrName: patch.attrName });
        break;
      case "setStyle":
        postToFrame({ type: "setStyle", nodeId: patch.nodeId, property: patch.styleProperty, value: patch.value });
        break;
      case "setHoverStyle":
        postToFrame({ type: "setHoverStyle", nodeId: patch.nodeId, property: patch.styleProperty, value: patch.value });
        break;
      case "removeNode":
        postToFrame({ type: "removeNode", nodeId: patch.nodeId });
        break;
      case "duplicateNode":
        postToFrame({ type: "duplicateNode", nodeId: patch.nodeId });
        break;
      case "moveUp":
        postToFrame({ type: "moveUp", nodeId: patch.nodeId });
        break;
      case "moveDown":
        postToFrame({ type: "moveDown", nodeId: patch.nodeId });
        break;
      case "wrapInAnchor":
        postToFrame({ type: "wrapInAnchor", nodeId: patch.nodeId });
        break;
      case "unwrapAnchor":
        postToFrame({ type: "unwrapAnchor", nodeId: patch.nodeId });
        break;
    }
  }

  function handleIframeLoad(): void {
    const toReplay = replayPatchesRef.current;
    if (!toReplay) return;
    replayPatchesRef.current = null;
    for (const patch of toReplay) replayPatchToFrame(patch);
  }

  function jumpHistory(nextIndex: number): void {
    replayPatchesRef.current = editHistory.stack[nextIndex] ?? [];
    setEditHistory((prev) => ({ ...prev, index: nextIndex }));
    setSelected(null);
    setStatus({ kind: "idle" });
    setReloadKey((key) => key + 1);
  }

  function undo(): void {
    if (editHistory.index === 0 || status.kind === "saving") return;
    jumpHistory(editHistory.index - 1);
  }

  function redo(): void {
    if (editHistory.index >= editHistory.stack.length - 1 || status.kind === "saving") return;
    jumpHistory(editHistory.index + 1);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Cross-origin: keystrokes typed inside the iframe (including a contenteditable text edit)
      // never reach this listener at all, so there's no risk of hijacking normal in-field undo —
      // this only ever fires for keys pressed while focus is on the CMS page itself.
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      // The "Edit as HTML" modal's rich-text tab has its own local undo/redo (editing the draft
      // before Apply) — let Ctrl/Cmd+Z stay scoped to that instead of also jumping the outer
      // document's patch history behind the open modal.
      if (htmlEditorOpen) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editHistory, status.kind, htmlEditorOpen]);

  /** For a whole section of mixed content (headings, paragraphs, lists, tables) rather than one
   * line of text — contenteditable is awkward for that much structure, and there's no way to
   * introduce a brand-new element type through it at all. This opens the selected element's real
   * innerHTML as a plain textarea: paste in a whole block written elsewhere (a different tool, an
   * AI writing assistant, whatever) and it replaces this element's content exactly, structure and
   * all — not constrained to editing text inside elements that already existed. */
  function openHtmlEditor() {
    if (!selected) return;
    setHtmlDraft(selected.html);
    setHtmlEditorTab(canUseRichText(selected.html) ? "rich" : "raw");
    setHtmlEditorOpen(true);
  }

  function applyHtmlEditor() {
    if (!selected) return;
    const nodeId = selected.nodeId;
    const html = htmlDraft;
    postToFrame({ type: "setInnerHtml", nodeId, html });
    commitPatches((prev) => [...prev.filter((patch) => !(patch.nodeId === nodeId && patch.op === "setInnerHtml")), { nodeId, op: "setInnerHtml", value: html }]);
    const strip = document.createElement("div");
    strip.innerHTML = html;
    setSelected((prev) => (prev ? { ...prev, html, text: strip.textContent ?? "" } : prev));
    setHtmlEditorOpen(false);
    setStatus({ kind: "idle" });
  }

  function selectParent() {
    if (!selected || selected.ancestors.length === 0) return;
    postToFrame({ type: "selectNode", nodeId: selected.ancestors[0]!.nodeId });
  }

  function queueAttr(nodeId: number, attrName: string, value: string) {
    postToFrame({ type: "setAttr", nodeId, attrName, value });
    commitPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === nodeId && (patch.op === "setAttr" || patch.op === "removeAttr") && patch.attrName === attrName)),
      { nodeId, op: "setAttr", attrName, value }
    ]);
  }

  function queueRemoveAttr(nodeId: number, attrName: string) {
    postToFrame({ type: "removeAttr", nodeId, attrName });
    commitPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === nodeId && (patch.op === "setAttr" || patch.op === "removeAttr") && patch.attrName === attrName)),
      { nodeId, op: "removeAttr", attrName }
    ]);
  }

  function queueLinkHref(value: string) {
    if (!selected) return;
    queueAttr(selected.nodeId, "href", value);
  }

  /** Works on any element (image, button, div, not just <a>), since a real CTA is often an image
   * or a styled div, not necessarily a link itself:
   * - An <a>: tags it in place with data-igle-cta and forces its href to "#" — tagging without
   *   neutralizing the href would leave a real destination sitting in the page's raw HTML, fully
   *   crawlable, defeating the point of cloaking it.
   * - Anything else, already inside a real <a>: also tags in place (no href to neutralize) — can't
   *   wrap here without creating invalid nested anchors, so this marks the inner element itself.
   * - Anything else: wraps it in a brand-new <a data-igle-cta href="#"> (see wrapInAnchor/
   *   unwrapAnchor) — a real anchor around the element reads as ordinary markup (cursor, semantics,
   *   raw HTML) rather than a data-attribute on an arbitrary tag, which is both more usable and
   *   less conspicuous than a bare marker. Unmarking reverses the wrap exactly (unwrapAnchor).
   */
  function toggleAffiliateCta() {
    if (!selected) return;

    if (selected.tagName === "a") {
      if (selected.dataIgleCta !== null) {
        queueRemoveAttr(selected.nodeId, "data-igle-cta");
        setSelected((prev) => (prev ? { ...prev, dataIgleCta: null } : prev));
      } else {
        queueAttr(selected.nodeId, "data-igle-cta", "default");
        queueAttr(selected.nodeId, "href", "#");
        setSelected((prev) => (prev ? { ...prev, dataIgleCta: "default", href: "#" } : prev));
      }
      return;
    }

    if (selected.wrappedInCta) {
      postToFrame({ type: "unwrapAnchor", nodeId: selected.nodeId });
      commitPatches((prev) => [...prev, { nodeId: selected.nodeId, op: "unwrapAnchor" }]);
      setSelected((prev) => (prev ? { ...prev, wrappedInCta: false } : prev));
      return;
    }

    const hasAnchorAncestor = selected.ancestors.some((ancestor) => ancestor.tagName === "a");
    if (hasAnchorAncestor) {
      if (selected.dataIgleCta !== null) {
        queueRemoveAttr(selected.nodeId, "data-igle-cta");
        setSelected((prev) => (prev ? { ...prev, dataIgleCta: null } : prev));
      } else {
        queueAttr(selected.nodeId, "data-igle-cta", "default");
        setSelected((prev) => (prev ? { ...prev, dataIgleCta: "default" } : prev));
      }
      return;
    }

    postToFrame({ type: "wrapInAnchor", nodeId: selected.nodeId });
    commitPatches((prev) => [...prev, { nodeId: selected.nodeId, op: "wrapInAnchor" }]);
    setSelected((prev) => (prev ? { ...prev, wrappedInCta: true } : prev));
  }

  function selectLinkTarget(value: string) {
    setLinkTarget(value);
    if (value === CUSTOM_LINK_TARGET) return;
    const target = pages.find((page) => page.id === value);
    if (!target) return;
    setLinkHrefDraft(target.route);
    queueLinkHref(target.route);
  }

  const SELECTED_STYLE_FIELDS: Record<string, keyof SelectedElement> = {
    color: "color",
    "background-color": "backgroundColor",
    "border-color": "borderColor",
    "border-width": "borderWidth",
    "border-radius": "borderRadius",
    padding: "padding",
    "text-align": "textAlign",
    "letter-spacing": "letterSpacing",
    "text-transform": "textTransform",
    "font-family": "fontFamily",
    "font-size": "fontSize"
  };

  function queueStyle(property: string, value: string) {
    if (!selected) return;
    postToFrame({ type: "setStyle", nodeId: selected.nodeId, property, value });
    commitPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === selected.nodeId && patch.op === "setStyle" && patch.styleProperty === property)),
      { nodeId: selected.nodeId, op: "setStyle", styleProperty: property, value }
    ]);
    const field = SELECTED_STYLE_FIELDS[property];
    if (field) setSelected((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  /** No selected-state field to keep in sync — a hover style can't be read back from the live DOM (see StyleControls). */
  function queueHoverStyle(property: string, value: string) {
    if (!selected) return;
    postToFrame({ type: "setHoverStyle", nodeId: selected.nodeId, property, value });
    commitPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === selected.nodeId && patch.op === "setHoverStyle" && patch.styleProperty === property)),
      { nodeId: selected.nodeId, op: "setHoverStyle", styleProperty: property, value }
    ]);
  }

  async function save() {
    if (patches.length === 0) return;
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(`/api/sites/${siteId}/pages/${pageId}/visual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches })
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) throw new Error((body.error as { message?: string } | undefined)?.message ?? "Save failed.");
      const otherPages = (body.updatedPageIds as unknown[] | undefined)?.length ?? 0;
      setEditHistory({ stack: [[]], index: 0 });
      setSelected(null);
      setStatus({
        kind: "saved",
        message:
          otherPages > 0
            ? `Saved as revision #${body.revisionNumber as number} — also updated on ${otherPages} other page${otherPages === 1 ? "" : "s"} where a replaced image appeared.`
            : `Saved as revision #${body.revisionNumber as number}.`
      });
      setReloadKey((key) => key + 1);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Save failed." });
    }
  }

  function discard() {
    setEditHistory({ stack: [[]], index: 0 });
    setSelected(null);
    setStatus({ kind: "idle" });
    setReloadKey((key) => key + 1);
  }

  function removeBlock() {
    if (!selected) return;
    postToFrame({ type: "removeNode", nodeId: selected.nodeId });
    commitPatches((prev) => [...prev.filter((patch) => patch.nodeId !== selected.nodeId), { nodeId: selected.nodeId, op: "removeNode" }]);
    setSelected(null);
    setStatus({ kind: "idle" });
  }

  function duplicateBlock() {
    if (!selected) return;
    postToFrame({ type: "duplicateNode", nodeId: selected.nodeId });
    commitPatches((prev) => [...prev, { nodeId: selected.nodeId, op: "duplicateNode" }]);
    setStatus({ kind: "idle" });
  }

  /** Swaps the selected element with its previous/next sibling (skipping over whitespace) — a real
   * DOM move in the live preview, not a content swap, so the element keeps its identity and stays
   * selected. Re-describes it afterward (same round-trip selectParent already uses) since its
   * position among siblings — and so whether the arrows should still be enabled — changed. */
  function moveBlock(direction: "up" | "down") {
    if (!selected) return;
    const op = direction === "up" ? "moveUp" : "moveDown";
    postToFrame({ type: op, nodeId: selected.nodeId });
    commitPatches((prev) => [...prev, { nodeId: selected.nodeId, op }]);
    postToFrame({ type: "selectNode", nodeId: selected.nodeId });
    setStatus({ kind: "idle" });
  }

  async function syncNavigation(element: "header" | "footer") {
    if (
      patches.length > 0 &&
      !window.confirm(
        `Sync uses what's already saved on this page — your ${patches.length} unsaved change(s) here won't be included unless you save first. Cancel to go save, or continue to sync the last-saved version?`
      )
    ) {
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(`/api/sites/${siteId}/pages/${pageId}/navigation-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ element })
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) throw new Error((body.error as { message?: string } | undefined)?.message ?? `Sync failed.`);
      const updated = (body.updatedPageIds as unknown[] | undefined)?.length ?? 0;
      const skipped = (body.skipped as unknown[] | undefined)?.length ?? 0;
      setStatus({
        kind: "saved",
        message: `Synced this page's ${element} to ${updated} page${updated === 1 ? "" : "s"}${skipped ? ` (${skipped} had no ${element})` : ""}.`
      });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Sync failed." });
    }
  }

  async function submitImageForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const url = String(formData.get("url") ?? "").trim();
    const file = formData.get("file");
    const alt = String(formData.get("alt") ?? "");
    const hasFile = file instanceof File && file.size > 0;
    if (!url && !hasFile) {
      setStatus({ kind: "error", message: "Provide either a file to upload or an image URL." });
      return;
    }

    let src = url;
    if (hasFile) {
      setStatus({ kind: "saving" });
      try {
        const uploadForm = new FormData();
        uploadForm.set("file", file as File);
        const response = await fetch(`/api/sites/${siteId}/media`, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: uploadForm
        });
        const body = await parseJsonResponse(response);
        if (!response.ok) throw new Error((body.error as { message?: string } | undefined)?.message ?? "Upload failed.");
        src = String(body.src ?? "");
      } catch (error) {
        setStatus({ kind: "error", message: error instanceof Error ? error.message : "Upload failed." });
        return;
      }
    }

    const nodeId = selected.nodeId;
    queueAttr(nodeId, "src", src);
    queueRemoveAttr(nodeId, "srcset");
    if (alt) queueAttr(nodeId, "alt", alt);
    setSelected((prev) => (prev ? { ...prev, src, alt: alt || prev.alt } : prev));
    setStatus({ kind: "idle" });
  }

  return (
    <div ref={shellRef} className={`visual-editor-shell ${isFullscreen ? "is-fullscreen" : ""}`}>
      <div className="visual-editor-grid">
        <div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={interactive} onChange={(event) => setInteractive(event.target.checked)} />
              Interactive mode (scripts run, editing disabled)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {patches.length > 0 ? (
                <span className="status">
                  {patches.length} unsaved change{patches.length === 1 ? "" : "s"}
                </span>
              ) : null}
              <button
                type="button"
                className="button"
                style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}
                onClick={() => syncNavigation("header")}
                title="Push this page's saved header to every other page"
              >
                Sync header
              </button>
              <button
                type="button"
                className="button"
                style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}
                onClick={() => syncNavigation("footer")}
                title="Push this page's saved footer to every other page"
              >
                Sync footer
              </button>
              <button
                type="button"
                className="button"
                style={{ background: "none", color: "var(--accent)", width: 26, height: 26, padding: 0, borderRadius: "50%" }}
                onClick={() => setShowInfo(true)}
                aria-label="How the visual editor works"
                title="How the visual editor works"
              >
                ⓘ
              </button>
              <button type="button" className="button" style={{ background: "none", color: "var(--accent)" }} onClick={toggleFullscreen}>
                {isFullscreen ? "Exit full screen" : "Full screen"}
              </button>
            </div>
          </div>
          <PreviewFrame
            reloadKey={reloadKey}
            frameRef={iframeRef}
            onIframeLoad={handleIframeLoad}
            src={previewUrl}
            title="Visual editor preview"
            hideFullscreenButton
            style={{ height: isFullscreen ? "calc(100vh - 96px)" : "70vh", border: "1px solid var(--line)", borderRadius: 8 }}
          />
        </div>

        <aside className="card" style={{ position: "sticky", top: 16 }}>
          {selected && selected.ancestors.length > 0 ? (
            <button type="button" className="button" style={{ background: "none", color: "var(--accent)", fontSize: 12, padding: "3px 0", marginBottom: 6 }} onClick={selectParent}>
              &uarr; Select parent &lt;{selected.ancestors[0]!.tagName}&gt;
            </button>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h3 style={{ margin: 0 }}>{selected ? `Selected: <${selected.tagName}>` : "Click an element to edit it"}</h3>
            {!interactive && selected && selected.tagName !== "img" ? (
              <button
                type="button"
                className="button button-secondary"
                style={{ fontSize: 12, padding: "4px 8px", flexShrink: 0 }}
                onClick={openHtmlEditor}
                title="Edit this element's full inner HTML — for sections with headings, lists, tables, or content you're pasting in from elsewhere"
              >
                Edit as HTML
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 10 }}>
            <button
              type="button"
              className="button button-secondary"
              style={{ fontSize: 12.5, padding: "9px 10px" }}
              onClick={undo}
              disabled={editHistory.index === 0 || status.kind === "saving"}
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
            >
              &#8630; Undo
            </button>
            <button
              type="button"
              className="button button-secondary"
              style={{ fontSize: 12.5, padding: "9px 10px" }}
              onClick={redo}
              disabled={editHistory.index >= editHistory.stack.length - 1 || status.kind === "saving"}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo"
            >
              &#8631; Redo
            </button>
          </div>

          {!interactive && selected ? (
            <div style={{ display: "grid", gap: 10 }}>
              {selected.tagName === "img" ? (
                <form onSubmit={submitImageForm} style={{ display: "grid", gap: 8 }}>
                  <p className="muted" style={{ margin: 0, fontSize: 12.5, wordBreak: "break-all" }}>
                    {selected.src}
                  </p>
                  <label className="muted" style={{ fontSize: 12.5 }}>
                    Replace with a URL
                  </label>
                  <input type="text" name="url" placeholder="https://example.com/image.jpg" />
                  <label className="muted" style={{ fontSize: 12.5 }}>
                    Or upload a file
                  </label>
                  <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif" />
                  <label className="muted" style={{ fontSize: 12.5 }}>
                    ALT text
                  </label>
                  <input type="text" name="alt" defaultValue={selected.alt ?? ""} />
                  <button className="button" type="submit">
                    Use this image
                  </button>
                </form>
              ) : null}

              {selected.tagName === "a" ? (
                <div style={{ display: "grid", gap: 6, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <label className="muted" style={{ fontSize: 12.5 }}>
                    Links to
                  </label>
                  <select value={linkTarget} onChange={(event) => selectLinkTarget(event.target.value)}>
                    <option value={CUSTOM_LINK_TARGET}>Custom / external URL&hellip;</option>
                    {pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.internalName} ({page.route})
                      </option>
                    ))}
                  </select>
                  {linkTarget === CUSTOM_LINK_TARGET ? (
                    <input
                      type="text"
                      value={linkHrefDraft}
                      onChange={(event) => setLinkHrefDraft(event.target.value)}
                      onBlur={() => queueLinkHref(linkHrefDraft)}
                      placeholder="https://example.com or /path"
                    />
                  ) : (
                    <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                      Links to <code>{pages.find((page) => page.id === linkTarget)?.route}</code>
                    </p>
                  )}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ fontSize: 12.5, padding: "9px 10px" }}
                  onClick={() => moveBlock("up")}
                  disabled={!selected.hasPrevSibling}
                  title="Move before the previous element at this level"
                  aria-label="Move up"
                >
                  &uarr; Move up
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ fontSize: 12.5, padding: "9px 10px" }}
                  onClick={() => moveBlock("down")}
                  disabled={!selected.hasNextSibling}
                  title="Move after the next element at this level"
                  aria-label="Move down"
                >
                  &darr; Move down
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <button type="button" className="button" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }} onClick={duplicateBlock}>
                  Duplicate block
                </button>
                <button type="button" className="button button-danger" style={{ fontSize: 12.5 }} onClick={removeBlock}>
                  Remove block
                </button>
              </div>

              {AFFILIATE_LINK_ALLOWED_TAGS.has(selected.tagName) || selected.dataIgleCta !== null || selected.wrappedInCta ? (
                <div style={{ display: "grid", gap: 6, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <p className="settings-section-title" style={{ margin: 0 }}>
                    Affiliate link
                  </p>
                  {selected.tagName !== "a" && !selected.wrappedInCta && selected.ancestors.some((ancestor) => ancestor.tagName === "a") ? (
                    <p className="muted" style={{ margin: 0, fontSize: 11.5, color: "var(--warn)" }}>
                      This is inside a &lt;a&gt; link — marking the link itself (use &uarr; Select parent above) also
                      hides its real href, not just this element.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: 12.5 }}
                    onClick={toggleAffiliateCta}
                    title="Sends clicks through the site's affiliate redirect instead of its current destination — also blanks an <a>'s href so a real destination URL never sits in the page's raw HTML"
                  >
                    {selected.dataIgleCta !== null || selected.wrappedInCta ? "✓ Marked as affiliate link — unmark" : "Mark as affiliate link"}
                  </button>
                </div>
              ) : null}

              {selected.className ? (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  class: {selected.className}
                </p>
              ) : null}

              <details style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  Styling
                </summary>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <p className="settings-section-title" style={{ margin: 0 }}>
                    Colors
                  </p>
                  <div className="field-row">
                    <ColorField label="Text" value={selected.color ?? "#000000"} onChange={(hex) => queueStyle("color", hex)} />
                    <ColorField
                      label="Background"
                      value={selected.backgroundColor ?? "#ffffff"}
                      onChange={(hex) => {
                        queueStyle("background-color", hex);
                        // Many real CTA buttons paint their background with a gradient/image, not a
                        // flat color — background-image always renders on top of background-color,
                        // so without this a background color change here would look like it did
                        // nothing on exactly those buttons.
                        queueStyle("background-image", "none");
                      }}
                    />
                  </div>
                </div>

                <StyleControls key={selected.nodeId} selected={selected} queueStyle={queueStyle} queueHoverStyle={queueHoverStyle} />
              </details>
            </div>
          ) : null}

          {interactive ? <p className="muted" style={{ fontSize: 12.5 }}>Turn off interactive mode to select and edit elements.</p> : null}

          <div style={{ display: "flex", gap: 8, marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <button className="button" type="button" onClick={save} disabled={status.kind === "saving" || patches.length === 0}>
              {status.kind === "saving" ? "Saving…" : "Save changes"}
            </button>
            <button
              className="button"
              type="button"
              onClick={discard}
              style={{ background: "none", color: "var(--accent)" }}
              disabled={patches.length === 0}
            >
              Discard
            </button>
          </div>
          {status.kind === "saved" ? <p style={{ color: "var(--accent)", fontSize: 12.5 }}>{status.message}</p> : null}
          {status.kind === "error" ? <p style={{ color: "var(--warn)", fontSize: 12.5 }}>{status.message}</p> : null}
        </aside>
      </div>

      {htmlEditorOpen && selected ? (
        <div
          className="deploy-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Edit as HTML"
          onClick={() => setHtmlEditorOpen(false)}
        >
          <div className="editor-info-modal" style={{ maxWidth: 760, width: "92vw", maxHeight: "88vh" }} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <h3 style={{ margin: 0 }}>
                Edit as HTML — &lt;{selected.tagName}&gt;
              </h3>
              <button
                type="button"
                className="button button-ghost"
                style={{ padding: "2px 6px" }}
                onClick={() => setHtmlEditorOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 10px" }}>
              Rich text only turns on for sections that are plain text markup — anything with custom classes or
              container elements can&apos;t round-trip through it safely, so it stays on Raw HTML instead, where you
              can also paste in a whole block written or generated elsewhere. Queued like any other edit — nothing is
              saved until you click Save changes, and it undoes the same way too.
            </p>
            <div className="segmented" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={htmlEditorTab === "rich" ? "active" : ""}
                onClick={() => setHtmlEditorTab("rich")}
                disabled={!richTextAvailable}
                title={richTextAvailable ? undefined : "This section has custom classes or container elements the rich text editor can't safely represent — edit it as raw HTML instead."}
              >
                Rich text
              </button>
              <button type="button" className={htmlEditorTab === "raw" ? "active" : ""} onClick={() => setHtmlEditorTab("raw")}>
                Raw HTML
              </button>
            </div>
            {htmlEditorTab === "rich" && richTextAvailable ? (
              <RichTextEditor key={selected.nodeId} html={htmlDraft} onChange={setHtmlDraft} />
            ) : (
              <textarea
                value={htmlDraft}
                onChange={(event) => setHtmlDraft(event.target.value)}
                rows={18}
                spellCheck={false}
                style={{
                  width: "100%",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: 10,
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  color: "var(--text)",
                  background: "var(--panel)",
                  resize: "vertical"
                }}
              />
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="button" type="button" onClick={applyHtmlEditor}>
                Apply
              </button>
              <button className="button button-ghost" type="button" onClick={() => setHtmlEditorOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showInfo ? (
        <div
          className="deploy-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="How the visual editor works"
          onClick={() => setShowInfo(false)}
        >
          <div className="editor-info-modal" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <h3 style={{ margin: 0 }}>How the visual editor works</h3>
              <button
                type="button"
                className="button"
                style={{ background: "none", color: "var(--muted)", padding: "2px 6px" }}
                onClick={() => setShowInfo(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <dl>
              <dt>Images</dt>
              <dd>
                Replacing an image updates it everywhere it appears — other spots on this page and every other page
                that uses the same image — as soon as you click &quot;Use this image&quot;. The preview updates
                immediately; nothing is saved until you click Save changes.
              </dd>
              <dt>Text</dt>
              <dd>
                Double-click any text in the preview to start editing it immediately. Click away (or elsewhere) to
                commit the change. For a whole section of mixed content — headings, paragraphs, lists, tables
                together — use the Edit as HTML button next to the selection heading instead: it's the section's raw
                markup in a plain text box, so you can paste in something written elsewhere (by another tool, an AI
                assistant, whatever) and it replaces the section exactly, not limited to elements that were already
                there.
              </dd>
              <dt>Links</dt>
              <dd>Linking to one of this site&apos;s own pages stays correct no matter where the site ends up hosted.</dd>
              <dt>Move up &amp; Move down</dt>
              <dd>
                Swaps the selected element with the previous/next element at the same level — a section past another
                section, or a block past its neighbor inside one. Grayed out at either end of the list.
              </dd>
              <dt>Duplicate &amp; Remove block</dt>
              <dd>Neither takes effect until you click Save changes — Discard any time before that.</dd>
              <dt>Undo &amp; Redo</dt>
              <dd>
                Steps back through your unsaved changes one at a time — Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z to redo
                (works whenever focus isn&apos;t inside a text field you&apos;re actively typing in). Discard still
                clears everything at once if that&apos;s what you actually want.
              </dd>
              <dt>Site navigation</dt>
              <dd>
                Edit the header or footer on this page (click into it above, like any other content), save, then sync
                it to every other page. Or edit them as raw HTML on the{" "}
                <a href={`/sites/${siteId}/header-footer`} style={{ color: "var(--accent)" }}>
                  Header/Footer
                </a>{" "}
                screen instead. To add a new link to the menu: click an existing nav link, Duplicate block, then
                select the copy to edit its text and Links-to target.
              </dd>
              <dt>Interactive mode</dt>
              <dd>Runs the page&apos;s real scripts so you can click through it normally, but turns off editing — turn it off again to select and edit elements.</dd>
              <dt>Mark as affiliate link</dt>
              <dd>
                Only offered on a link, button, or image — never a whole section or other container, since that
                would make a big block of the page clickable rather than the one control that should be. Routes its
                clicks through the site&apos;s affiliate redirect instead of wherever it currently points. For an
                <code>&lt;a&gt;</code>, blanks its href so no real destination URL sits in the page&apos;s raw HTML;
                anything else gets wrapped in a brand-new, neutralized <code>&lt;a&gt;</code> so it reads as ordinary
                markup instead of a bare data attribute. Most CTA buttons are tagged automatically already (a dead{" "}
                <code>#</code> href, <code>rel="sponsored"</code>, or a matching class) — use this for one that
                wasn&apos;t. If the element is already inside a real <code>&lt;a&gt;</code>, this marks that inner
                element directly instead of wrapping (to avoid nesting anchors) — select the parent link instead if
                you want the whole link cloaked.
              </dd>
              <dt>Border, Spacing, Shadow, Font, Hover</dt>
              <dd>
                Type a hex code directly (or use the swatch) for any color field. Changing the Background color also
                clears any gradient/image background a button&apos;s class set — otherwise it would still show through
                on top of the flat color. Every color and style change here is applied with <code>!important</code>,
                since real button/CTA classes commonly set their own colors that way too and would otherwise still
                win. Border, corner radius, padding, and Shadow apply immediately; Font (family/size), text align,
                transform, and letter spacing commit when you click away from or change the field — font family only
                works if that font is already loaded somewhere on the page, so match one already used elsewhere on
                the site. Hover sets what the element changes to on mouseover — hover the live preview to check it,
                since it can&apos;t be shown any other way; it always starts blank since a hover style can&apos;t be
                read back from the page.
              </dd>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
