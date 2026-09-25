import Link from "next/link";
import { AutoRefresh } from "../../AutoRefresh";
import { runtime } from "../../../lib/runtime";
import { requireActorOrRedirect } from "../../../lib/session";

export const dynamic = "force-dynamic";

const statusChipClass: Record<string, string> = {
  running: "chip-medium",
  done: "chip-done",
  failed: "chip-urgent"
};

export default async function ImportRunsPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const actor = await requireActorOrRedirect();
  if (actor.role !== "administrator") {
    return (
      <>
        <div className="toolbar">
          <h1>Import activity</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can view import activity.</p>
        </article>
      </>
    );
  }

  const { server: serverFilter } = await searchParams;
  const state = await runtime.stateStore.read();
  const servers = new Map(state.servers.map((server) => [server.id, server]));

  const runs = (state.importRuns ?? [])
    .filter((run) => !serverFilter || run.serverId === serverFilter)
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const anyRunning = runs.some((run) => run.status === "running");
  const filteredServer = serverFilter ? servers.get(serverFilter) : undefined;

  return (
    <>
      {anyRunning ? <AutoRefresh /> : null}
      <div className="toolbar">
        <div>
          <h1>Import activity</h1>
          <p className="muted">
            {filteredServer ? `Runs for ${filteredServer.name}` : "Every aaPanel \"Sync sites\" run, most recent first"} — full per-domain logs, not just
            the last summary.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {filteredServer ? (
            <Link href="/servers/imports" className="button button-ghost">
              All servers
            </Link>
          ) : null}
          <Link href="/servers" className="button button-ghost">
            Back to servers
          </Link>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="list">
          <div className="list-row">
            <div className="main">
              <h3>No import runs yet</h3>
              <p className="muted">Click "Sync sites" on a connected aaPanel server to start one.</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="list">
        {runs.map((run) => {
          const durationMs = (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime();
          const durationLabel = durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`;
          const imported = run.entries.filter((entry) => entry.status === "imported" || entry.status === "imported-locked").length;
          const failed = run.entries.filter((entry) => entry.status === "failed").length;
          const pct = run.sitesTotal ? Math.round((run.sitesChecked / run.sitesTotal) * 100) : undefined;

          return (
            <Link className="list-row" href={`/servers/imports/${run.id}`} key={run.id}>
              <div className="main">
                <h3>{run.serverName}</h3>
                <p className="muted">
                  {run.sitesTotal !== undefined ? `${run.sitesChecked}/${run.sitesTotal} checked${pct !== undefined ? ` (${pct}%)` : ""}` : `${run.sitesChecked} checked`}
                  {" · "}
                  {imported} imported{failed > 0 ? ` · ${failed} failed` : ""}
                  {" · "}
                  {new Date(run.startedAt).toLocaleString()}
                  {" · "}
                  {durationLabel}
                  {run.status === "running" ? " so far" : " total"}
                </p>
              </div>
              {run.status === "running" && run.currentDomain ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  {run.currentDomain}
                </span>
              ) : null}
              <span className={`chip ${statusChipClass[run.status]}`}>{run.status}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
