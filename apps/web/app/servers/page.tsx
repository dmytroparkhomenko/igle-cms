import { IgleError } from "@igle/shared";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function ServersPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; added?: string; updated?: string; removed?: string; testOk?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { error, added, updated, removed, testOk } = await searchParams;

  let servers: Awaited<ReturnType<typeof runtime.serverService.list>> = [];
  let forbidden = false;
  try {
    servers = await runtime.serverService.list(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  if (forbidden) {
    return (
      <>
        <div className="toolbar">
          <h1>Servers</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can manage servers.</p>
        </article>
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Servers</h1>
          <p className="muted">Register each VPS sites can deploy to. Mark one Restricted to limit who can deploy there.</p>
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {error}
        </article>
      ) : null}
      {added ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Server added.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Server updated.
        </article>
      ) : null}
      {removed ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Server removed.
        </article>
      ) : null}
      {testOk ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Connected — aaPanel returned {testOk} site{testOk === "1" ? "" : "s"} for this key.
        </article>
      ) : null}

      <div className="settings-card" style={{ marginBottom: 28, maxWidth: 560 }}>
        <div className="settings-card-header">
          <h2>Add a server</h2>
        </div>
        <form method="post" action="/api/servers" style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input type="text" id="name" name="name" placeholder="e.g. Production VPS" required />
          </div>
          <div className="field">
            <label htmlFor="baseUrl">aaPanel base URL</label>
            <input type="text" id="baseUrl" name="baseUrl" placeholder="http://1.2.3.4:8888" required />
          </div>
          <div className="field">
            <label htmlFor="apiKey">API key</label>
            <input type="password" id="apiKey" name="apiKey" autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="publicIp">Public IP (for DNS)</label>
            <input type="text" id="publicIp" name="publicIp" placeholder="Auto-detected from the base URL if left blank" />
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              What a domain&apos;s DNS record should point at to reach this server — used when connecting a domain on the
              Domains screen. Only needed if it differs from the base URL&apos;s own address.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="restricted" />
            Restricted — only administrators granted access can deploy here
          </label>
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add server
          </button>
        </form>
      </div>

      <h2>Registered servers ({servers.length})</h2>
      <div className="list">
        {servers.map((server) => (
          <div key={server.id} className="list-row">
            <div className="main">
              <h3>
                {server.name} {server.restricted ? <span className="status" style={{ marginLeft: 6, color: "var(--warn)", borderColor: "var(--warn)" }}>Restricted</span> : null}
              </h3>
              <p className="muted">
                {server.baseUrl} · key {server.apiKeyPreview} · {server.siteCount} site{server.siteCount === 1 ? "" : "s"}
                {server.publicIp ? ` · DNS target ${server.publicIp}` : " · no public IP set for DNS"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <form method="post" action="/api/settings/aapanel/test">
                <input type="hidden" name="serverId" value={server.id} />
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                  Test connection
                </button>
              </form>
              {server.siteCount === 0 ? (
                <form method="post" action={`/api/servers/${server.id}/delete`}>
                  <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5 }}>
                    Remove
                  </button>
                </form>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  Move its sites off first to remove
                </span>
              )}
            </div>
          </div>
        ))}
        {servers.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No servers registered yet.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
