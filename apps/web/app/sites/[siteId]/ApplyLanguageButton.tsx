"use client";

import { useState } from "react";

export function ApplyLanguageButton({ siteId }: { siteId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function apply() {
    if (
      !window.confirm(
        "Rewrite <html lang> on every page of this site to match the Language/Country saved above? Pages with their own manually-set language will be overwritten too. Save any pending changes to Language/Country first — this uses what's already saved, not what's currently typed."
      )
    ) {
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sites/${siteId}/localization/apply-all`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", message: body?.error?.message ?? "Failed." });
        return;
      }
      const count = (body.updatedPageIds as unknown[] | undefined)?.length ?? 0;
      setState({
        kind: "done",
        message: `Rewrote <html lang> on ${count} page${count === 1 ? "" : "s"} — saved as revision #${body.revisionNumber}.`
      });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Failed." });
    }
  }

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <button
        type="button"
        className="button"
        style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 0" }}
        onClick={apply}
        disabled={state.kind === "loading"}
      >
        {state.kind === "loading" ? "Rewriting…" : "Rewrite language on all pages"}
      </button>
      {state.kind === "done" ? <p style={{ color: "var(--accent)", fontSize: 12, margin: 0 }}>{state.message}</p> : null}
      {state.kind === "error" ? <p style={{ color: "var(--warn)", fontSize: 12, margin: 0 }}>{state.message}</p> : null}
    </div>
  );
}
