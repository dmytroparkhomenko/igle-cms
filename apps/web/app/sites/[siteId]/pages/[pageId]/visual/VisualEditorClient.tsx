"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PreviewFrame } from "../../../../../PreviewFrame";

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
  ancestors: AncestorRef[];
}

interface NavPage {
  id: string;
  route: string;
  internalName: string;
}

interface PendingPatch {
  nodeId: number;
  op: "setInnerHtml" | "setAttr" | "removeAttr" | "setStyle" | "removeNode" | "duplicateNode";
  attrName?: string;
  styleProperty?: string;
  value?: string;
}

const CUSTOM_LINK_TARGET = "__custom__";

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
  const [patches, setPatches] = useState<PendingPatch[]>([]);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [linkHrefDraft, setLinkHrefDraft] = useState("");
  const [linkTarget, setLinkTarget] = useState<string>(CUSTOM_LINK_TARGET);
  const [reloadKey, setReloadKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        setPatches((prev) => [
          ...prev.filter((patch) => !(patch.nodeId === nodeId && patch.op === "setInnerHtml")),
          { nodeId, op: "setInnerHtml", value: html }
        ]);
        setStatus({ kind: "idle" });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewOrigin, pages]);

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: "igle-editor", ...message }, previewOrigin);
    },
    [previewOrigin]
  );

  function startTextEdit() {
    if (!selected) return;
    postToFrame({ type: "startTextEdit", nodeId: selected.nodeId });
  }

  function selectParent() {
    if (!selected || selected.ancestors.length === 0) return;
    postToFrame({ type: "selectNode", nodeId: selected.ancestors[0]!.nodeId });
  }

  function queueAttr(nodeId: number, attrName: string, value: string) {
    postToFrame({ type: "setAttr", nodeId, attrName, value });
    setPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === nodeId && (patch.op === "setAttr" || patch.op === "removeAttr") && patch.attrName === attrName)),
      { nodeId, op: "setAttr", attrName, value }
    ]);
  }

  function queueRemoveAttr(nodeId: number, attrName: string) {
    postToFrame({ type: "removeAttr", nodeId, attrName });
    setPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === nodeId && (patch.op === "setAttr" || patch.op === "removeAttr") && patch.attrName === attrName)),
      { nodeId, op: "removeAttr", attrName }
    ]);
  }

  function queueLinkHref(value: string) {
    if (!selected) return;
    queueAttr(selected.nodeId, "href", value);
  }

  function selectLinkTarget(value: string) {
    setLinkTarget(value);
    if (value === CUSTOM_LINK_TARGET) return;
    const target = pages.find((page) => page.id === value);
    if (!target) return;
    setLinkHrefDraft(target.route);
    queueLinkHref(target.route);
  }

  function queueColor(property: "color" | "background-color", value: string) {
    if (!selected) return;
    postToFrame({ type: "setStyle", nodeId: selected.nodeId, property, value });
    setPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === selected.nodeId && patch.op === "setStyle" && patch.styleProperty === property)),
      { nodeId: selected.nodeId, op: "setStyle", styleProperty: property, value }
    ]);
    setSelected((prev) => (prev ? { ...prev, ...(property === "color" ? { color: value } : { backgroundColor: value }) } : prev));
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
      setPatches([]);
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
    setPatches([]);
    setSelected(null);
    setStatus({ kind: "idle" });
    setReloadKey((key) => key + 1);
  }

  function removeBlock() {
    if (!selected) return;
    postToFrame({ type: "removeNode", nodeId: selected.nodeId });
    setPatches((prev) => [...prev.filter((patch) => patch.nodeId !== selected.nodeId), { nodeId: selected.nodeId, op: "removeNode" }]);
    setSelected(null);
    setStatus({ kind: "idle" });
  }

  function duplicateBlock() {
    if (!selected) return;
    postToFrame({ type: "duplicateNode", nodeId: selected.nodeId });
    setPatches((prev) => [...prev, { nodeId: selected.nodeId, op: "duplicateNode" }]);
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {patches.length > 0 ? (
                <span className="status">
                  {patches.length} unsaved change{patches.length === 1 ? "" : "s"}
                </span>
              ) : null}
              <button type="button" className="button" style={{ background: "none", color: "var(--accent)" }} onClick={toggleFullscreen}>
                {isFullscreen ? "Exit full screen" : "Full screen"}
              </button>
            </div>
          </div>
          <PreviewFrame
            reloadKey={reloadKey}
            frameRef={iframeRef}
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
          <h3 style={{ marginTop: 0 }}>{selected ? `Selected: <${selected.tagName}>` : "Click an element to edit it"}</h3>

          {!interactive && selected ? (
            <div style={{ display: "grid", gap: 10 }}>
              {selected.tagName === "img" ? (
                <form onSubmit={submitImageForm} style={{ display: "grid", gap: 8 }}>
                  <p className="muted" style={{ margin: 0, fontSize: 12.5, wordBreak: "break-all" }}>
                    {selected.src}
                  </p>
                  <p
                    className="muted"
                    style={{
                      margin: 0,
                      fontSize: 11.5,
                      background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                      border: "1px solid var(--accent)",
                      borderRadius: 6,
                      padding: "6px 8px"
                    }}
                  >
                    Replacing this image updates it everywhere it appears — other spots on this page and every other
                    page that uses the same image — when you click Save changes below.
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
              ) : (
                <>
                  <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                    {selected.text?.slice(0, 140) || "(empty)"}
                  </p>
                  <button className="button" type="button" onClick={startTextEdit}>
                    Edit text
                  </button>
                  <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                    Click the highlighted text in the preview, then click away to commit.
                  </p>
                </>
              )}

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
                      Links to this site's own <code>{pages.find((page) => page.id === linkTarget)?.route}</code> page
                      — this stays correct no matter where the site is hosted.
                    </p>
                  )}
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <p className="settings-section-title" style={{ margin: 0 }}>
                  Colors
                </p>
                <div className="field-row">
                  <div className="field">
                    <label className="muted" style={{ fontSize: 12.5 }}>
                      Text
                    </label>
                    <input type="color" value={selected.color ?? "#000000"} onChange={(event) => queueColor("color", event.target.value)} style={{ height: 32, padding: 2 }} />
                  </div>
                  <div className="field">
                    <label className="muted" style={{ fontSize: 12.5 }}>
                      Background
                    </label>
                    <input
                      type="color"
                      value={selected.backgroundColor ?? "#ffffff"}
                      onChange={(event) => queueColor("background-color", event.target.value)}
                      style={{ height: 32, padding: 2 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <button type="button" className="button" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }} onClick={duplicateBlock}>
                  Duplicate block
                </button>
                <button type="button" className="button" style={{ background: "none", color: "var(--warn)", fontSize: 12.5 }} onClick={removeBlock}>
                  Remove block
                </button>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                Neither takes effect until you click Save changes — discard any time before that.
              </p>

              {selected.className ? (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  class: {selected.className}
                </p>
              ) : null}
            </div>
          ) : null}

          {interactive ? <p className="muted" style={{ fontSize: 12.5 }}>Turn off interactive mode to select and edit elements.</p> : null}

          <div style={{ display: "grid", gap: 8, marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <p className="settings-section-title" style={{ margin: 0 }}>
              Site navigation
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Edit the header or footer on this page (click into it above, like any other content), save, then sync it
              to every other page. Or edit them as raw HTML on the{" "}
              <a href={`/sites/${siteId}/header-footer`} style={{ color: "var(--accent)" }}>
                Header/Footer
              </a>{" "}
              screen instead. To add a new link to the menu: click an existing nav link, Duplicate block, then select
              the copy to edit its text and Links-to target.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="button" style={{ fontSize: 12.5 }} onClick={() => syncNavigation("header")}>
                Sync header
              </button>
              <button type="button" className="button" style={{ fontSize: 12.5 }} onClick={() => syncNavigation("footer")}>
                Sync footer
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
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
    </div>
  );
}
