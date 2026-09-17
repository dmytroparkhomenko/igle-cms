import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export default async function ScriptsPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{
    added?: string;
    updated?: string;
    deleted?: string;
    error?: string;
    verificationAdded?: string;
    verificationDeleted?: string;
    verificationError?: string;
    checkedOk?: string;
    checkedError?: string;
  }>;
}) {
  const { siteId } = await params;
  const { added, updated, deleted, error, verificationAdded, verificationDeleted, verificationError, checkedOk, checkedError } =
    await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const scripts = await runtime.scriptService.list(site);
  const verifications = await runtime.verificationService.list(site);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Scripts — {site.metadata.name}</h1>
          <p className="muted">Custom snippets injected at build time by placement, environment and page.</p>
        </div>
        <Link href={`/sites/${site.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to site
        </Link>
      </div>

      {added ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Script added.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Script updated.
        </article>
      ) : null}
      {deleted ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Script removed.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}
      {verificationAdded ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Verification file added.
        </article>
      ) : null}
      {verificationDeleted ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Verification file removed.
        </article>
      ) : null}
      {verificationError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {verificationError}
        </article>
      ) : null}
      {checkedOk ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Verified — the file is live on the site and matches what was deployed.
        </article>
      ) : null}
      {checkedError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          Not reachable yet: {checkedError}
        </article>
      ) : null}

      <h2>Search console verification</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 13.5 }}>
        Adds the exact file Google/Bing ask for at your site&apos;s root. Paste just the verification code they give you —
        Igle builds the right filename and content.
      </p>
      <div className="list" style={{ marginBottom: 16 }}>
        {verifications.map((verification) => (
          <div className="list-row" key={verification.id} style={{ alignItems: "center" }}>
            <div className="main">
              <h3>{verification.provider === "google" ? "Google Search Console" : "Bing Webmaster"}</h3>
              <p className="muted">/{verification.filePath}</p>
            </div>
            <form method="post" action={`/api/sites/${site.id}/verifications/${verification.id}/check`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}>
                Check live
              </button>
            </form>
            <form method="post" action={`/api/sites/${site.id}/verifications/${verification.id}/delete`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                Delete
              </button>
            </form>
          </div>
        ))}
        {verifications.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No verification files yet</h3>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 32 }}>
        <form className="card" method="post" action={`/api/sites/${site.id}/verifications`} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Google Search Console</h2>
          <input type="hidden" name="provider" value="google" />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Search Console → Settings → Ownership verification → HTML file method. Paste the code from the filename it gives
            you (<code>google</code>
            <em>code</em>
            <code>.html</code>).
          </p>
          <label className="muted" htmlFor="googleCode">
            Verification code
          </label>
          <input type="text" id="googleCode" name="code" placeholder="e.g. a1b2c3d4e5f6g7h8" required />
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add Google verification
          </button>
        </form>

        <form className="card" method="post" action={`/api/sites/${site.id}/verifications`} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Bing Webmaster Tools</h2>
          <input type="hidden" name="provider" value="bing" />
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Webmaster Tools → Settings → Verify ownership → XML file method. Paste just the code inside{" "}
            <code>&lt;user&gt;</code>.
          </p>
          <label className="muted" htmlFor="bingCode">
            Verification code
          </label>
          <input type="text" id="bingCode" name="code" placeholder="e.g. A1B2C3D4E5F6G7H8" required />
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add Bing verification
          </button>
        </form>
      </div>

      <h2>Scripts</h2>
      <div className="list" style={{ marginBottom: 28 }}>
        {scripts.map((script) => (
          <div className="list-row" key={script.id} style={{ alignItems: "center" }}>
            <div className="main">
              <h3>{script.name}</h3>
              <p className="muted">
                {script.placement} · {script.environment} · {script.enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <form method="post" action={`/api/sites/${site.id}/scripts/${script.id}/toggle`}>
              <input type="hidden" name="enabled" value={script.enabled ? "false" : "true"} />
              <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}>
                {script.enabled ? "Disable" : "Enable"}
              </button>
            </form>
            <form method="post" action={`/api/sites/${site.id}/scripts/${script.id}/delete`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                Delete
              </button>
            </form>
          </div>
        ))}
        {scripts.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No scripts yet</h3>
              <p className="muted">Add Google Analytics, GTM, or a custom snippet below.</p>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 20 }}>
        <form className="card" method="post" action={`/api/sites/${site.id}/scripts/preset`} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Google Analytics 4</h2>
          <input type="hidden" name="type" value="ga4" />
          <label className="muted" htmlFor="ga4Id">
            Measurement ID
          </label>
          <input type="text" id="ga4Id" name="id" placeholder="G-XXXXXXXXXX" required />
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add GA4
          </button>
        </form>

        <form className="card" method="post" action={`/api/sites/${site.id}/scripts/preset`} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Google Tag Manager</h2>
          <input type="hidden" name="type" value="gtm" />
          <label className="muted" htmlFor="gtmId">
            Container ID
          </label>
          <input type="text" id="gtmId" name="id" placeholder="GTM-XXXXXXX" required />
          <button className="button" type="submit" style={{ justifySelf: "start" }}>
            Add GTM
          </button>
        </form>
      </div>

      <form
        className="card"
        method="post"
        action={`/api/sites/${site.id}/scripts`}
        style={{ display: "grid", gap: 10, maxWidth: 480 }}
      >
        <h2 style={{ margin: 0, fontSize: 15 }}>Custom script</h2>
        <label className="muted" htmlFor="name">
          Name
        </label>
        <input type="text" id="name" name="name" required />

        <label className="muted" htmlFor="code">
          Code
        </label>
        <textarea
          id="code"
          name="code"
          rows={5}
          required
          placeholder="<script>...</script>"
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="muted" htmlFor="placement">
              Placement
            </label>
            <select id="placement" name="placement" defaultValue="head-end" style={selectStyle}>
              <option value="head-start">Start of &lt;head&gt;</option>
              <option value="head-end">End of &lt;head&gt;</option>
              <option value="body-start">Start of &lt;body&gt;</option>
              <option value="body-end">End of &lt;body&gt;</option>
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="environment">
              Environment
            </label>
            <select id="environment" name="environment" defaultValue="production" style={selectStyle}>
              <option value="production">Production only</option>
              <option value="preview">Preview only</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
          Add script
        </button>
      </form>
    </>
  );
}

const selectStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  font: "inherit",
  background: "var(--panel)",
  color: "var(--text)"
} as const;
