import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "../../../AutoRefresh";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const statusChipClass: Record<string, string> = {
  imported: "chip-done",
  "imported-locked": "chip-done",
  relocked: "chip-medium",
  "skipped-exists": "chip-low",
  excluded: "chip-low",
  failed: "chip-urgent"
};

const statusLabel: Record<string, string> = {
  imported: "Imported",
  "imported-locked": "Imported (locked)",
  relocked: "Re-locked",
  "skipped-exists": "Already here",
  excluded: "Excluded",
  failed: "Failed"
};

export default async function ImportRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const actor = await requireActorOrRedirect();
  const { runId } = await params;

  if (actor.role !== "administrator") {
    return (
      <>
        <div className="toolbar">
          <h1>Import run</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can view import activity.</p>
        </article>
      </>
    );
  }

  const state = await runtime.stateStore.read();
  const run = (state.importRuns ?? []).find((item) => item.id === runId);
  if (!run) notFound();

  const entries = run.entries.slice().sort((a, b) => b.at.localeCompare(a.at));
  const pct = run.sitesTotal ? Math.round((run.sitesChecked / run.sitesTotal) * 100) : undefined;

  return (
    <>
      {run.status === "running" ? <AutoRefresh /> : null}
      <div className="toolbar">
        <div>
          <h1>{run.serverName}</h1>
          <p className="muted">
            Started {new Date(run.startedAt).toLocaleString()} by {run.actorEmail}
            {run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/servers/imports?server=${run.serverId}`} className="button button-ghost">
            Other runs for this server
          </Link>
          <Link href="/servers/imports" className="button button-ghost">
            All runs
          </Link>
        </div>
      </div>

      <article className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`chip ${run.status === "done" ? "chip-done" : run.status === "failed" ? "chip-urgent" : "chip-medium"}`} style={{ fontSize: 13, padding: "5px 12px" }}>
            {run.status}
          </span>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              PROGRESS
            </p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {run.sitesTotal !== undefined ? `${run.sitesChecked} / ${run.sitesTotal}${pct !== undefined ? ` (${pct}%)` : ""}` : `${run.sitesChecked} checked`}
            </p>
          </div>
          {run.status === "running" && run.currentDomain ? (
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                CURRENTLY
              </p>
              <p style={{ margin: 0, fontWeight: 600 }}>{run.currentDomain}</p>
            </div>
          ) : null}
        </div>
        {run.sitesTotal ? (
          <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: "var(--bg)", overflow: "hidden", border: "1px solid var(--line)" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, Math.round((run.sitesChecked / run.sitesTotal) * 100))}%`,
                background: run.status === "failed" ? "var(--danger)" : "var(--accent)",
                transition: "width 0.3s ease"
              }}
            />
          </div>
        ) : null}
        {run.runError ? (
          <p style={{ color: "var(--danger)", fontSize: 13, margin: "14px 0 0" }}>{run.runError}</p>
        ) : null}
      </article>

      <h2>Log ({entries.length})</h2>
      <div className="list">
        {entries.map((entry, index) => (
          <div className="list-row" key={`${entry.domain}-${entry.at}-${index}`}>
            <div className="main">
              <h3>{entry.siteId ? <Link href={`/sites/${entry.siteId}`}>{entry.domain || "(no domain reported)"}</Link> : entry.domain || "(no domain reported)"}</h3>
              {entry.message ? <p className="muted">{entry.message}</p> : null}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {new Date(entry.at).toLocaleTimeString()}
            </span>
            <span className={`chip ${statusChipClass[entry.status] ?? "chip-low"}`}>{statusLabel[entry.status] ?? entry.status}</span>
          </div>
        ))}
        {entries.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>
              {run.status === "running" ? "Just started — nothing logged yet." : "No entries."}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
