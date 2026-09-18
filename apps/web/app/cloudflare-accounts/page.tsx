import { IgleError } from "@igle/shared";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function CloudflareAccountsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; added?: string; removed?: string; testOk?: string; testError?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { error, added, removed, testOk, testError } = await searchParams;

  let accounts: Awaited<ReturnType<typeof runtime.cloudflareAccountService.list>> = [];
  let forbidden = false;
  try {
    accounts = await runtime.cloudflareAccountService.list(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  if (forbidden) {
    return (
      <>
        <div className="toolbar">
          <h1>Cloudflare accounts</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>Only administrators can manage Cloudflare accounts.</p>
        </article>
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Cloudflare accounts</h1>
          <p className="muted">
            Register a separate Cloudflare account per group of domains you don&apos;t want linkable to each other —
            the Domains screen lets you pick which account each domain goes through.
          </p>
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {error}
        </article>
      ) : null}
      {added ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Cloudflare account added.
        </article>
      ) : null}
      {removed ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Cloudflare account removed.
        </article>
      ) : null}
      {testOk ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Connected — Cloudflare returned {testOk} zone{testOk === "1" ? "" : "s"} for this token.
        </article>
      ) : null}
      {testError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          Connection failed: {testError}
        </article>
      ) : null}

      <div className="settings-card" style={{ marginBottom: 28, maxWidth: 560 }}>
        <div className="settings-card-header">
          <h2>Add a Cloudflare account</h2>
        </div>
        <form method="post" action="/api/cloudflare-accounts" style={{ display: "grid", gap: 10 }}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input type="text" id="name" name="name" placeholder="e.g. Account 1" required />
          </div>
          <div className="field">
            <label htmlFor="apiToken">API token</label>
            <input type="password" id="apiToken" name="apiToken" autoComplete="off" required />
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              A scoped API token (My Profile → API Tokens → Create Token), not the legacy Global API Key. Needs Zone:Edit
              and DNS:Edit permissions.
            </p>
          </div>
          <div className="field">
            <label htmlFor="accountId">Cloudflare account ID (optional)</label>
            <input type="text" id="accountId" name="accountId" placeholder="From the dashboard sidebar" />
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Only needed if this token has access to more than one Cloudflare account — disambiguates which one a new
              zone gets created in.
            </p>
          </div>
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add account
          </button>
        </form>
      </div>

      <h2>Registered accounts ({accounts.length})</h2>
      <div className="list">
        {accounts.map((account) => (
          <div key={account.id} className="list-row">
            <div className="main">
              <h3>{account.name}</h3>
              <p className="muted">
                token {account.apiTokenPreview}
                {account.accountId ? ` · account ${account.accountId}` : ""} · {account.domainCount} domain
                {account.domainCount === 1 ? "" : "s"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <form method="post" action={`/api/cloudflare-accounts/${account.id}/test`}>
                <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5 }}>
                  Test connection
                </button>
              </form>
              {account.domainCount === 0 ? (
                <form method="post" action={`/api/cloudflare-accounts/${account.id}/delete`}>
                  <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5 }}>
                    Remove
                  </button>
                </form>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>
                  Disconnect its domains first to remove
                </span>
              )}
            </div>
          </div>
        ))}
        {accounts.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No Cloudflare accounts registered yet.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
