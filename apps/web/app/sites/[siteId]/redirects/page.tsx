import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export default async function RedirectsPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ added?: string; deleted?: string; error?: string }>;
}) {
  const { siteId } = await params;
  const { added, deleted, error } = await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const redirects = await runtime.redirectService.list(site);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Redirects — {site.metadata.name}</h1>
          <p className="muted">301/302 redirects applied when this site deploys.</p>
        </div>
        <Link href={`/sites/${site.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to site
        </Link>
      </div>

      {added ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Redirect added.
        </article>
      ) : null}
      {deleted ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Redirect removed.
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <div className="list" style={{ marginBottom: 28 }}>
        {redirects.map((redirect) => (
          <div className="list-row" key={redirect.id}>
            <div className="main">
              <h3>{redirect.from}</h3>
              <p className="muted">
                → {redirect.to} · {redirect.status}
              </p>
            </div>
            <form method="post" action={`/api/sites/${site.id}/redirects/${redirect.id}/delete`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                Delete
              </button>
            </form>
          </div>
        ))}
        {redirects.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>No redirects yet</h3>
              <p className="muted">Add one below.</p>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="card"
        method="post"
        action={`/api/sites/${site.id}/redirects`}
        style={{ display: "grid", gap: 10, maxWidth: 420 }}
      >
        <h2>Add redirect</h2>
        <label className="muted" htmlFor="from">
          From (internal path)
        </label>
        <input type="text" id="from" name="from" placeholder="/old-page" required />

        <label className="muted" htmlFor="to">
          To (path or full URL)
        </label>
        <input type="text" id="to" name="to" placeholder="/new-page" required />

        <label className="muted" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue="301">
          <option value="301">301 — Permanent</option>
          <option value="302">302 — Temporary</option>
        </select>

        <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 6 }}>
          Add redirect
        </button>
      </form>
    </>
  );
}
