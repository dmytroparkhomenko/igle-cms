"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface UncloakedLinkRow {
  pageId: string;
  pageInternalName: string;
  nodeId: number;
  href: string;
  text: string;
}

export interface TaggedLinkRow {
  pageId: string;
  pageInternalName: string;
  nodeId: number;
  tagName: string;
  slot: string;
  text: string;
  href: string | null;
}

function MarkAsAffiliateLinkButton({ siteId, row }: { siteId: string; row: UncloakedLinkRow }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function mark() {
    setState("loading");
    try {
      const response = await fetch(`/api/sites/${siteId}/pages/${row.pageId}/visual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patches: [
            { nodeId: row.nodeId, op: "setAttr", attrName: "data-igle-cta", value: "default" },
            { nodeId: row.nodeId, op: "setAttr", attrName: "href", value: "#" }
          ]
        })
      });
      if (!response.ok) {
        setState("error");
        return;
      }
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" className="button" style={{ fontSize: 12.5 }} onClick={mark} disabled={state === "loading"}>
      {state === "loading" ? "Marking…" : state === "error" ? "Failed — retry" : "Mark as affiliate link"}
    </button>
  );
}

function RescanButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "loading" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function rescan() {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sites/${siteId}/affiliate-ctas-rescan`, { method: "POST", headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", message: body?.error?.message ?? "Failed." });
        return;
      }
      setState({
        kind: "done",
        message:
          body.ctaLinksTagged > 0
            ? `Tagged ${body.ctaLinksTagged} link(s) across ${body.updatedPageIds.length} page(s).`
            : "No new affiliate CTA links found."
      });
      router.refresh();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Failed." });
    }
  }

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <button type="button" className="button" style={{ background: "none", color: "var(--accent)" }} onClick={rescan} disabled={state.kind === "loading"}>
        {state.kind === "loading" ? "Scanning…" : "Rescan for affiliate CTA links"}
      </button>
      {state.kind === "done" ? <p style={{ color: "var(--accent)", fontSize: 12.5, margin: 0 }}>{state.message}</p> : null}
      {state.kind === "error" ? <p style={{ color: "var(--warn)", fontSize: 12.5, margin: 0 }}>{state.message}</p> : null}
    </div>
  );
}

export function AffiliateCtaTools({
  siteId,
  taggedLinks,
  unmarkedLinks
}: {
  siteId: string;
  taggedLinks: TaggedLinkRow[];
  unmarkedLinks: UncloakedLinkRow[];
}) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Affiliate CTA links ({taggedLinks.length})</h2>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
        Dead-href buttons (<code>#</code>) and known CTA classes get tagged automatically when a template is
        uploaded or a page is created. Run this after hand-editing a page, or for a site imported before this
        existed.
      </p>
      <RescanButton siteId={siteId} />

      {taggedLinks.length > 0 ? (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <p className="settings-section-title" style={{ margin: "0 0 8px" }}>
            All tagged affiliate links
          </p>
          <div className="list">
            {taggedLinks.map((row) => (
              <div className="list-row" key={`${row.pageId}-${row.nodeId}`}>
                <div className="main">
                  <p style={{ margin: 0 }}>{row.text || `<${row.tagName}>`}</p>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: 12, wordBreak: "break-all" }}>
                    on {row.pageInternalName} · slot: {row.slot}
                    {row.href ? ` · href: ${row.href}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
          No affiliate links tagged on this site yet.
        </p>
      )}

      {unmarkedLinks.length > 0 ? (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <p className="settings-section-title" style={{ margin: "0 0 8px" }}>
            Links pointing off-site that aren&apos;t cloaked
          </p>
          <div className="list">
            {unmarkedLinks.map((row) => (
              <div className="list-row" key={`${row.pageId}-${row.nodeId}`}>
                <div className="main">
                  <p style={{ margin: 0 }}>{row.text || "(no text)"}</p>
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: 12, wordBreak: "break-all" }}>
                    {row.href} — on {row.pageInternalName}
                  </p>
                </div>
                <div className="side">
                  <MarkAsAffiliateLinkButton siteId={siteId} row={row} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
