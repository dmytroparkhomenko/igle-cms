"use client";

import { useState } from "react";

interface DeploymentResult {
  status: "success" | "failed" | "rolled-back";
  revisionNumber: number;
  target: "local" | "aapanel";
  error?: string;
  sslError?: string;
}

export function DeployButton({ siteId, disabled }: { siteId: string; disabled: boolean }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "done" | "error"; result?: DeploymentResult; error?: string }>({
    kind: "idle"
  });

  async function deploy() {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sites/${siteId}/deploy`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", error: body?.error?.message ?? "Deploy failed." });
        return;
      }
      setState({ kind: "done", result: body.deployment as DeploymentResult });
    } catch (error) {
      setState({ kind: "error", error: error instanceof Error ? error.message : "Deploy failed." });
    }
  }

  return (
    <>
      <button className="button" type="button" disabled={disabled} onClick={deploy}>
        Deploy to production
      </button>

      {state.kind !== "idle" ? (
        <div className="deploy-modal-backdrop" role="dialog" aria-modal="true" aria-label="Deployment status">
          <div className="deploy-modal">
            {state.kind === "loading" ? (
              <>
                <div className="deploy-spinner" aria-hidden="true" />
                <h3>Deploying…</h3>
                <p className="muted">Building the site, uploading it, and checking it&apos;s live. This can take a moment.</p>
              </>
            ) : null}

            {state.kind === "done" && state.result ? (
              <>
                <h3 style={{ color: state.result.status === "success" ? "var(--accent)" : "var(--warn)" }}>
                  {state.result.status === "success" ? "Deployed successfully" : "Deploy finished with issues"}
                </h3>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  Revision #{state.result.revisionNumber}
                  {state.result.target === "aapanel" ? " · aaPanel VPS" : " · Local filesystem"}
                </p>
                {state.result.error ? (
                  <p style={{ color: "var(--warn)", margin: "8px 0 0", fontSize: 13.5 }}>{state.result.error}</p>
                ) : null}
                {state.result.sslError ? (
                  <p style={{ color: "var(--warn)", margin: "8px 0 0", fontSize: 13.5 }}>SSL: {state.result.sslError}</p>
                ) : null}
                <button className="button" type="button" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                  Done
                </button>
              </>
            ) : null}

            {state.kind === "error" ? (
              <>
                <h3 style={{ color: "var(--warn)" }}>Deploy failed</h3>
                <p style={{ margin: "8px 0 0", fontSize: 13.5 }}>{state.error}</p>
                <button className="button" type="button" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                  Close
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
