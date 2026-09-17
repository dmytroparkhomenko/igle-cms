"use client";

import { useState } from "react";

export function FixLinksButton({ siteId }: { siteId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function fix() {
    if (
      !window.confirm(
        "Scan every page and rewrite relative links, images, stylesheets and scripts to absolute paths so they work no matter how the page is nested? This also corrects any page's stored URL if it didn't match how it's actually served. Lands as one revision — deploy afterward to publish it."
      )
    ) {
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sites/${siteId}/fix-links`, { method: "POST", headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", message: body?.error?.message ?? "Failed." });
        return;
      }
      const updated = (body.updatedPageIds as unknown[] | undefined)?.length ?? 0;
      const skipped = (body.skipped as unknown[] | undefined)?.length ?? 0;
      setState({
        kind: "done",
        message:
          updated > 0
            ? `Fixed links on ${updated} page${updated === 1 ? "" : "s"} — saved as revision #${body.revisionNumber}.${skipped ? ` ${skipped} page${skipped === 1 ? "" : "s"} couldn't be processed.` : ""}`
            : `No broken relative links found.${skipped ? ` ${skipped} page${skipped === 1 ? "" : "s"} couldn't be processed.` : ""}`
      });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Failed." });
    }
  }

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <button type="button" className="button" onClick={fix} disabled={state.kind === "loading"}>
        {state.kind === "loading" ? "Fixing…" : "Fix internal links"}
      </button>
      {state.kind === "done" ? <p style={{ color: "var(--accent)", fontSize: 12.5, margin: 0 }}>{state.message}</p> : null}
      {state.kind === "error" ? <p style={{ color: "var(--warn)", fontSize: 12.5, margin: 0 }}>{state.message}</p> : null}
    </div>
  );
}
