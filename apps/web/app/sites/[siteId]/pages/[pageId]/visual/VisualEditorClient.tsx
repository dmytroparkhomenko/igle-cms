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

interface PendingPatch {
  nodeId: number;
  op: "setInnerHtml" | "setAttr" | "setStyle" | "removeNode" | "duplicateNode";
  attrName?: string;
  styleProperty?: string;
  value?: string;
}

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

export function VisualEditorClient({
  siteId,
  siteSlug,
  pageId,
  pageRoute,
  previewOrigin
}: {
  siteId: string;
  siteSlug: string;
  pageId: string;
  pageRoute: string;
  previewOrigin: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [patches, setPatches] = useState<PendingPatch[]>([]);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [linkHrefDraft, setLinkHrefDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
  }, [previewOrigin]);

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

  function queueLinkHref() {
    if (!selected) return;
    setPatches((prev) => [
      ...prev.filter((patch) => !(patch.nodeId === selected.nodeId && patch.op === "setAttr" && patch.attrName === "href")),
      { nodeId: selected.nodeId, op: "setAttr", attrName: "href", value: linkHrefDraft }
    ]);
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

  async function savePatches(patchList: PendingPatch[]): Promise<{ revisionNumber: number }> {
    const response = await fetch(`/api/sites/${siteId}/pages/${pageId}/visual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patches: patchList })
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(error?.message ?? "Save failed.");
    }
    return body as { revisionNumber: number };
  }

  async function save() {
    if (patches.length === 0) return;
    setStatus({ kind: "saving" });
    try {
      const body = await savePatches(patches);
      setPatches([]);
      setSelected(null);
      setStatus({ kind: "saved", message: `Saved as revision #${body.revisionNumber}.` });
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

  async function removeBlock() {
    if (!selected) return;
    if (!window.confirm(`Remove this <${selected.tagName}> block? This can't be undone from here (though it stays in revision history).`)) return;
    postToFrame({ type: "removeNode", nodeId: selected.nodeId });
    setStatus({ kind: "saving" });
    try {
      const body = await savePatches([{ nodeId: selected.nodeId, op: "removeNode" }]);
      setSelected(null);
      setStatus({ kind: "saved", message: `Removed — saved as revision #${body.revisionNumber}.` });
      setReloadKey((key) => key + 1);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Remove failed." });
    }
  }

  async function duplicateBlock() {
    if (!selected) return;
    postToFrame({ type: "duplicateNode", nodeId: selected.nodeId });
    setStatus({ kind: "saving" });
    try {
      const body = await savePatches([{ nodeId: selected.nodeId, op: "duplicateNode" }]);
      setSelected(null);
      setStatus({ kind: "saved", message: `Duplicated — saved as revision #${body.revisionNumber}.` });
      setReloadKey((key) => key + 1);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Duplicate failed." });
    }
  }

  async function submitImageForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("nodeId", String(selected.nodeId));
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(`/api/sites/${siteId}/pages/${pageId}/image`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) throw new Error((body.error as { message?: string } | undefined)?.message ?? "Image replace failed.");
      setStatus({ kind: "saved", message: `Saved as revision #${body.revisionNumber as number}.` });
      setSelected(null);
      setReloadKey((key) => key + 1);
      form.reset();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Image replace failed." });
    }
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
                    Replace image
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
                    Link URL
                  </label>
                  <input type="text" value={linkHrefDraft} onChange={(event) => setLinkHrefDraft(event.target.value)} onBlur={queueLinkHref} />
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

              {selected.className ? (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  class: {selected.className}
                </p>
              ) : null}
            </div>
          ) : null}

          {interactive ? <p className="muted" style={{ fontSize: 12.5 }}>Turn off interactive mode to select and edit elements.</p> : null}

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
