import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export default async function TrashPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ pageRestored?: string; pagePurged?: string; pageError?: string }>;
}) {
  const { siteId } = await params;
  const { pageRestored, pagePurged, pageError } = await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const trashedPages = state.pages
    .filter((page) => page.siteId === site.id && page.deletedAt)
    .slice()
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Trash — {site.metadata.name}</h1>
          <p className="muted">Deleted pages are kept here until you permanently delete them.</p>
        </div>
        <Link href={`/sites/${site.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to site
        </Link>
      </div>

      {pageRestored ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Page restored.
        </article>
      ) : null}
      {pagePurged ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Page permanently deleted.
        </article>
      ) : null}
      {pageError ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {pageError}
        </article>
      ) : null}

      <div className="list" style={{ marginBottom: 28 }}>
        {trashedPages.map((page) => (
          <div className="list-row" key={page.id} style={{ alignItems: "center" }}>
            <div className="main">
              <h3>{page.internalName}</h3>
              <p className="muted">
                {page.route} · Deleted {page.deletedAt ? new Date(page.deletedAt).toLocaleString() : ""}
              </p>
            </div>
            <form method="post" action={`/api/sites/${site.id}/pages/${page.id}/restore`}>
              <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", fontSize: 12.5, padding: "6px 10px" }}>
                Restore
              </button>
            </form>
            <details>
              <summary className="button button-danger" style={{ fontSize: 12.5, padding: "6px 10px", display: "inline-block", cursor: "pointer" }}>
                Delete permanently
              </summary>
              <form
                method="post"
                action={`/api/sites/${site.id}/pages/${page.id}/purge`}
                style={{ display: "grid", gap: 8, marginTop: 10, padding: 12, border: "1px solid var(--warn)", borderRadius: 6, minWidth: 260 }}
              >
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  This permanently deletes the page file. This cannot be undone.
                </p>
                <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <input type="checkbox" name="confirmed" required />I understand, delete permanently
                </label>
                <button
                  className="button"
                  type="submit"
                  style={{ background: "var(--warn)", borderColor: "var(--warn)", justifySelf: "start" }}
                >
                  Confirm permanent delete
                </button>
              </form>
            </details>
          </div>
        ))}
        {trashedPages.length === 0 ? (
          <div className="list-row">
            <div className="main">
              <h3>Trash is empty</h3>
              <p className="muted">Deleted pages will show up here.</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
