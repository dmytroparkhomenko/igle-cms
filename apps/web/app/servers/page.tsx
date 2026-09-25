import Link from "next/link";
import { IgleError } from "@igle/shared";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function ServersPage({
  searchParams
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    updated?: string;
    removed?: string;
    testOk?: string;
    importQueued?: string;
    exclusionsUpdated?: string;
    vultrAccountId?: string;
    prefillName?: string;
    prefillHost?: string;
    vultrAdded?: string;
    vultrRemoved?: string;
    vultrTestOk?: string;
    vultrTestError?: string;
    vultrError?: string;
  }>;
}) {
  const actor = await requireActorOrRedirect();
  const {
    error,
    added,
    updated,
    removed,
    testOk,
    importQueued,
    exclusionsUpdated,
    vultrAccountId,
    prefillName,
    prefillHost,
    vultrAdded,
    vultrRemoved,
    vultrTestOk,
    vultrTestError,
    vultrError
  } = await searchParams;

  let servers: Awaited<ReturnType<typeof runtime.serverService.list>> = [];
  let vultrAccounts: Awaited<ReturnType<typeof runtime.vultrAccountService.list>> = [];
  let forbidden = false;
  try {
    [servers, vultrAccounts] = await Promise.all([runtime.serverService.list(actor), runtime.vultrAccountService.list(actor)]);
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

  let vultrInstances: Awaited<ReturnType<typeof runtime.vultrAccountService.listInstances>> = [];
  let vultrInstancesError: string | undefined;
  if (vultrAccountId) {
    try {
      vultrInstances = await runtime.vultrAccountService.listInstances(vultrAccountId, actor);
    } catch (err) {
      vultrInstancesError = err instanceof Error ? err.message : "Failed to list instances.";
    }
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
          Connected — the server returned {testOk} site{testOk === "1" ? "" : "s"} for this credential.
        </article>
      ) : null}
      {importQueued ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Sync queued — new sites will start appearing here within a few seconds, and already-tracked ones get re-checked for WordPress/MODX.
        </article>
      ) : null}
      {exclusionsUpdated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Import exclusions saved.
        </article>
      ) : null}
      {vultrError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {vultrError}
        </article>
      ) : null}
      {vultrAdded ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Vultr account added.
        </article>
      ) : null}
      {vultrRemoved ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Vultr account removed.
        </article>
      ) : null}
      {vultrTestOk ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Connected — Vultr returned {vultrTestOk} instance{vultrTestOk === "1" ? "" : "s"} for this token.
        </article>
      ) : null}
      {vultrTestError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          Vultr connection failed: {vultrTestError}
        </article>
      ) : null}

      <div className="settings-card panel-kind-switch" style={{ marginBottom: 28, maxWidth: 560 }}>
        <div className="settings-card-header">
          <h2>Add a server</h2>
        </div>
        <form method="post" action="/api/servers" style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input type="text" id="name" name="name" placeholder="e.g. Production VPS" defaultValue={prefillName ?? ""} required />
          </div>
          <div className="field">
            <label htmlFor="kind">Panel type</label>
            <select id="kind" name="kind" defaultValue={prefillHost ? "cloudpanel" : "aapanel"}>
              <option value="aapanel">aaPanel (REST API)</option>
              <option value="cloudpanel">CloudPanel (SSH)</option>
            </select>
          </div>

          <div className="field kind-aapanel-field">
            <label htmlFor="baseUrl">aaPanel base URL</label>
            <input type="text" id="baseUrl" name="baseUrl" placeholder="http://1.2.3.4:8888" />
          </div>
          <div className="field kind-aapanel-field">
            <label htmlFor="apiKey">API key</label>
            <input type="password" id="apiKey" name="apiKey" autoComplete="off" />
          </div>

          <div className="field kind-cloudpanel-field">
            <label htmlFor="sshHost">SSH host</label>
            <input type="text" id="sshHost" name="sshHost" placeholder="1.2.3.4" defaultValue={prefillHost ?? ""} />
          </div>
          <div className="field-row kind-cloudpanel-field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label htmlFor="sshPort">SSH port</label>
              <input type="text" id="sshPort" name="sshPort" placeholder="22" />
            </div>
            <div className="field">
              <label htmlFor="sshUsername">SSH username</label>
              <input type="text" id="sshUsername" name="sshUsername" placeholder="root" />
            </div>
          </div>
          <div className="field kind-cloudpanel-field">
            <label htmlFor="sshPassword">SSH password</label>
            <input type="password" id="sshPassword" name="sshPassword" autoComplete="off" placeholder="Leave blank if using a private key" />
          </div>
          <div className="field kind-cloudpanel-field">
            <label htmlFor="sshPrivateKey">SSH private key</label>
            <textarea id="sshPrivateKey" name="sshPrivateKey" rows={4} placeholder="Leave blank if using a password" style={{ font: "inherit", fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 8, borderRadius: 6, border: "1px solid var(--line)" }} />
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              CloudPanel has no REST API — Igle connects over SSH and runs its <code>clpctl</code> CLI. Provide either a
              password or a private key, not both.
            </p>
          </div>

          <div className="field">
            <label htmlFor="publicIp">Public IP (for DNS)</label>
            <input type="text" id="publicIp" name="publicIp" placeholder="Auto-detected from the host if left blank" defaultValue={prefillHost ?? ""} />
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              What a domain&apos;s DNS record should point at to reach this server — used when connecting a domain on the
              Domains screen. Only needed if it differs from the address above.
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

      <div className="settings-card" style={{ marginBottom: 28, maxWidth: 640 }}>
        <div className="settings-card-header">
          <h2>Import from Vultr</h2>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Register a Vultr Personal Access Token to browse an account&apos;s instances below and pull in a name/IP
            without copying them by hand — read-only discovery, so it doesn&apos;t need any special token scope.
            Deploys still go through whichever panel (aaPanel or CloudPanel) runs on the instance itself.
          </p>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--accent)" }}>Manage Vultr accounts ({vultrAccounts.length})</summary>
            <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
              <form method="post" action="/api/vultr-accounts" style={{ display: "grid", gap: 10, maxWidth: 420 }}>
                <div className="field">
                  <label htmlFor="vultrName">Name</label>
                  <input type="text" id="vultrName" name="name" placeholder="e.g. Vultr — PBN" required />
                </div>
                <div className="field">
                  <label htmlFor="vultrApiToken">API token</label>
                  <input type="password" id="vultrApiToken" name="apiToken" autoComplete="off" required />
                  <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                    Account → API in the Vultr dashboard — a Personal Access Token.
                  </p>
                </div>
                <button className="button" type="submit" style={{ justifySelf: "start" }}>
                  Add account
                </button>
              </form>

              <div className="list">
                {vultrAccounts.map((account) => (
                  <div key={account.id} className="list-row">
                    <div className="main">
                      <h3>{account.name}</h3>
                      <p className="muted">token {account.apiTokenPreview}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <form method="post" action={`/api/vultr-accounts/${account.id}/test`}>
                        <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                          Test connection
                        </button>
                      </form>
                      <form method="post" action={`/api/vultr-accounts/${account.id}/delete`}>
                        <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5 }}>
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
                {vultrAccounts.length === 0 ? (
                  <div className="list-row">
                    <p className="muted" style={{ margin: 0 }}>No Vultr accounts registered yet.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          {vultrAccounts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Add a Vultr account above to list its instances here.
            </p>
          ) : (
            <>
              <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select name="vultrAccountId" defaultValue={vultrAccountId ?? ""} style={{ flex: 1 }}>
                  <option value="" disabled>
                    Pick a Vultr account…
                  </option>
                  {vultrAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <button className="button" type="submit">
                  Browse instances
                </button>
              </form>

              {vultrInstancesError ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>{vultrInstancesError}</p> : null}

              {vultrAccountId && !vultrInstancesError ? (
                <div className="list">
                  {vultrInstances.map((instance) => (
                    <div className="list-row" key={instance.id}>
                      <div className="main">
                        <h3>{instance.label}</h3>
                        <p className="muted">
                          {instance.mainIp} · {instance.region} · {instance.plan} · {instance.os} · {instance.powerStatus}
                        </p>
                      </div>
                      <Link
                        href={`/servers?prefillName=${encodeURIComponent(instance.label)}&prefillHost=${encodeURIComponent(instance.mainIp)}#name`}
                        className="button"
                        style={{ fontSize: 12.5, flexShrink: 0 }}
                      >
                        Use this
                      </Link>
                    </div>
                  ))}
                  {vultrInstances.length === 0 ? (
                    <div className="list-row">
                      <p className="muted" style={{ margin: 0 }}>No instances on this account.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <h2>Registered servers ({servers.length})</h2>
      <div className="list">
        {servers.map((server) => (
          <div key={server.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="main">
                <h3>
                  {server.name}{" "}
                  <span className="status" style={{ marginLeft: 6, fontSize: 11 }}>
                    {server.kind === "cloudpanel" ? "CloudPanel" : "aaPanel"}
                  </span>{" "}
                  {server.restricted ? <span className="status" style={{ marginLeft: 6, color: "var(--warn)", borderColor: "var(--warn)" }}>Restricted</span> : null}
                </h3>
                <p className="muted">
                  {server.credentialPreview} · {server.siteCount} site{server.siteCount === 1 ? "" : "s"}
                  {server.publicIp ? ` · DNS target ${server.publicIp}` : " · no public IP set for DNS"}
                </p>
                {server.kind === "aapanel" && server.autoImportStatus ? <p className="muted" style={{ fontSize: 12.5 }}>{importStatusLabel(server)}</p> : null}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <form method="post" action="/api/settings/aapanel/test">
                  <input type="hidden" name="serverId" value={server.id} />
                  <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                    Test connection
                  </button>
                </form>
                {server.kind === "aapanel" ? (
                  <form method="post" action={`/api/servers/${server.id}/import`}>
                    <button
                      className="button"
                      type="submit"
                      disabled={server.autoImportStatus === "running"}
                      style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}
                    >
                      {server.autoImportStatus === "running" ? "Syncing…" : "Sync sites"}
                    </button>
                  </form>
                ) : null}
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
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--accent)" }}>Edit</summary>
              <form method="post" action={`/api/servers/${server.id}`} style={{ display: "grid", gap: 10, marginTop: 12, maxWidth: 420 }}>
                <div className="field">
                  <label htmlFor={`name-${server.id}`}>Name</label>
                  <input type="text" id={`name-${server.id}`} name="name" defaultValue={server.name} required />
                </div>
                {server.kind === "aapanel" ? (
                  <>
                    <div className="field">
                      <label htmlFor={`baseUrl-${server.id}`}>aaPanel base URL</label>
                      <input type="text" id={`baseUrl-${server.id}`} name="baseUrl" defaultValue={server.baseUrl} required />
                    </div>
                    <div className="field">
                      <label htmlFor={`apiKey-${server.id}`}>API key</label>
                      <input
                        type="password"
                        id={`apiKey-${server.id}`}
                        name="apiKey"
                        autoComplete="off"
                        placeholder={`Leave blank to keep the current key (${server.credentialPreview})`}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor={`sshHost-${server.id}`}>SSH host</label>
                      <input type="text" id={`sshHost-${server.id}`} name="sshHost" defaultValue={server.sshHost} required />
                    </div>
                    <div className="field-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                      <div className="field">
                        <label htmlFor={`sshPort-${server.id}`}>SSH port</label>
                        <input type="text" id={`sshPort-${server.id}`} name="sshPort" defaultValue={server.sshPort ?? 22} />
                      </div>
                      <div className="field">
                        <label htmlFor={`sshUsername-${server.id}`}>SSH username</label>
                        <input type="text" id={`sshUsername-${server.id}`} name="sshUsername" defaultValue={server.sshUsername ?? "root"} />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`sshPassword-${server.id}`}>SSH password</label>
                      <input
                        type="password"
                        id={`sshPassword-${server.id}`}
                        name="sshPassword"
                        autoComplete="off"
                        placeholder="Leave blank to keep the current credential"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`sshPrivateKey-${server.id}`}>SSH private key</label>
                      <textarea
                        id={`sshPrivateKey-${server.id}`}
                        name="sshPrivateKey"
                        rows={4}
                        placeholder="Leave blank to keep the current credential"
                        style={{ font: "inherit", fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                      />
                    </div>
                  </>
                )}
                <div className="field">
                  <label htmlFor={`publicIp-${server.id}`}>Public IP (for DNS)</label>
                  <input
                    type="text"
                    id={`publicIp-${server.id}`}
                    name="publicIp"
                    defaultValue={server.publicIp ?? ""}
                    placeholder="e.g. 203.0.113.5"
                  />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" name="restricted" defaultChecked={server.restricted} />
                  Restricted — only administrators granted access can deploy here
                </label>
                <button className="button" type="submit" style={{ justifySelf: "start" }}>
                  Save changes
                </button>
              </form>
              {server.kind === "aapanel" ? (
                <form
                  method="post"
                  action={`/api/servers/${server.id}/import-exclusions`}
                  style={{ display: "grid", gap: 8, marginTop: 16, maxWidth: 420 }}
                >
                  <div className="field">
                    <label htmlFor={`importExclusions-${server.id}`}>Never auto-import these domains</label>
                    <textarea
                      id={`importExclusions-${server.id}`}
                      name="domains"
                      rows={3}
                      defaultValue={(server.autoImportExcludedDomains ?? []).join("\n")}
                      placeholder={"One domain per line — e.g. an unrelated app registered as a \"site\" in aaPanel, not real Igle CMS content."}
                      style={{ font: "inherit", fontSize: 12.5, padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                    />
                  </div>
                  <button className="button" type="submit" style={{ justifySelf: "start", fontSize: 12.5 }}>
                    Save exclusions
                  </button>
                </form>
              ) : null}
            </details>
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

function importStatusLabel(server: {
  autoImportStatus?: string | undefined;
  autoImportCurrentDomain?: string | undefined;
  autoImportSitesChecked?: number | undefined;
  autoImportSummary?: { imported: number; locked: number; relocked: number; skipped: number; excluded: number; failed: number; errors: Array<{ domain: string; message: string }> } | undefined;
}): string {
  const summary = server.autoImportSummary;
  switch (server.autoImportStatus) {
    case "pending":
      return "Site import queued.";
    case "running": {
      const checked = server.autoImportSitesChecked;
      if (!checked) return "Importing sites from this server…";
      return `Importing sites from this server… (${checked} checked so far${server.autoImportCurrentDomain ? `, currently: ${server.autoImportCurrentDomain}` : ""})`;
    }
    case "done":
      if (!summary) return "Site import finished.";
      return `Site import: ${summary.imported} imported${summary.locked > 0 ? ` (${summary.locked} locked — WordPress/MODX)` : ""}, ${summary.skipped} already here${summary.relocked > 0 ? ` (${summary.relocked} newly locked on re-check)` : ""}${summary.excluded > 0 ? `, ${summary.excluded} excluded` : ""}${summary.failed > 0 ? `, ${summary.failed} failed` : ""}.`;
    case "failed": {
      const message = summary?.errors[0]?.message;
      return `Site import failed${message ? `: ${message}` : "."}`;
    }
    default:
      return "";
  }
}
