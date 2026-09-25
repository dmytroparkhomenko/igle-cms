import Link from "next/link";
import { IgleError } from "@igle/shared";
import { domainStatusColor, domainStatusLabel } from "../../lib/domain-status";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function DomainsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; connected?: string; removed?: string; assigned?: string; connect?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { error, connected, removed, assigned, connect } = await searchParams;

  let domains: Awaited<ReturnType<typeof runtime.domainService.list>> = [];
  let forbidden = false;
  try {
    domains = await runtime.domainService.list(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  if (forbidden) {
    return (
      <>
        <div className="toolbar">
          <h1>Domains</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can connect domains.</p>
        </article>
      </>
    );
  }

  const [cloudflareAccounts, servers, sites] = await Promise.all([
    runtime.cloudflareAccountService.listSelectable(actor),
    runtime.serverService.listSelectable(actor),
    runtime.siteService.list(actor)
  ]);
  const sitesById = new Map(sites.map((site) => [site.id, site.metadata.name]));

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Domains</h1>
          <p className="muted">
            Connect a domain through a Cloudflare account and a server — keeps every site&apos;s real origin hidden
            behind Cloudflare instead of pointing straight at a VPS.
          </p>
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {error}
        </article>
      ) : null}
      {connected ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Connected <strong>{connected}</strong>. If its nameservers aren&apos;t already pointed at Cloudflare, set them
          at your registrar now — see the nameservers listed below.
        </article>
      ) : null}
      {removed ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Domain disconnected.
        </article>
      ) : null}
      {assigned ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Assigned to <strong>{assigned}</strong>.
        </article>
      ) : null}
      {connect ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          Connecting <strong>{connect}</strong> through Cloudflare — once it&apos;s live, assign it to the site below to
          replace the direct-to-server domain.
        </article>
      ) : null}

      <div className="settings-card" style={{ marginBottom: 28, maxWidth: 560 }}>
        <div className="settings-card-header">
          <h2>Connect a domain</h2>
        </div>
        {cloudflareAccounts.length === 0 || servers.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {cloudflareAccounts.length === 0 ? (
              <>
                Register a <Link href="/cloudflare-accounts">Cloudflare account</Link> first.
              </>
            ) : (
              <>
                Register a <Link href="/servers">server</Link> first.
              </>
            )}
          </p>
        ) : (
          <form method="post" action="/api/domains" style={{ display: "grid", gap: 10 }}>
            <div className="field">
              <label htmlFor="domain">Domain</label>
              <input type="text" id="domain" name="domain" defaultValue={connect ?? ""} placeholder="example.com" required />
            </div>
            <div className="field">
              <label htmlFor="cloudflareAccountId">Cloudflare account</label>
              <select id="cloudflareAccountId" name="cloudflareAccountId" required>
                {cloudflareAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="serverId">Server (deploy target / DNS origin)</label>
              <select id="serverId" name="serverId" required>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                    {server.restricted ? " (restricted)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button className="button" type="submit" style={{ justifySelf: "start" }}>
              Connect domain
            </button>
          </form>
        )}
      </div>

      <h2>Connected domains ({domains.length})</h2>
      <div className="list">
        {domains.map((domain) => (
          <div key={domain.id} className="list-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div className="main">
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {domain.domain}
                  <span className="badge" style={{ background: domainStatusColor[domain.status], color: "#fff" }}>
                    {domainStatusLabel[domain.status] ?? domain.status}
                  </span>
                </h3>
                <p className="muted" style={{ margin: 0 }}>
                  {domain.siteId ? `Assigned to ${sitesById.get(domain.siteId) ?? domain.siteId}` : "Not assigned to a site yet"}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <form method="post" action={`/api/domains/${domain.id}/refresh`}>
                  <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                    Check status
                  </button>
                </form>
                {domain.zoneActive && domain.status !== "ssl_active" ? (
                  <form method="post" action={`/api/domains/${domain.id}/issue-ssl`}>
                    <button className="button" type="submit" style={{ fontSize: 12.5 }}>
                      Issue origin SSL &amp; lock down
                    </button>
                  </form>
                ) : null}
                <form method="post" action={`/api/domains/${domain.id}/delete`}>
                  <button className="button button-danger" type="submit" style={{ fontSize: 12.5 }}>
                    Disconnect
                  </button>
                </form>
              </div>
            </div>

            {domain.status === "pending_nameservers" && domain.nameservers && domain.nameservers.length > 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                Set these nameservers at your registrar: <code>{domain.nameservers.join(", ")}</code>
              </p>
            ) : null}
            {domain.lastError ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>{domain.lastError}</p>
            ) : null}

            {!domain.siteId && sites.length > 0 ? (
              <form method="post" action={`/api/domains/${domain.id}/assign`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select name="siteId" required style={{ fontSize: 12.5 }}>
                  <option value="">Assign to a site…</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.metadata.name}
                    </option>
                  ))}
                </select>
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                  Assign
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {domains.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No domains connected yet.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
