import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

const codeAreaStyle = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--text)",
  background: "var(--panel)",
  resize: "vertical" as const,
  tabSize: 2
};

export default async function HeaderFooterEditor({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ updated?: string; skipped?: string; element?: string; error?: string }>;
}) {
  const { siteId } = await params;
  const { updated, skipped, element, error } = await searchParams;
  const actor = await requireActorOrRedirect();
  const site = await runtime.siteService.get(siteId, actor);
  if (!site) notFound();

  const [headerHtml, footerHtml] = await Promise.all([
    runtime.seoService.getSharedElement(site, "header", actor),
    runtime.seoService.getSharedElement(site, "footer", actor)
  ]);

  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 14 }}>
        <Link href={`/sites/${site.id}`}>&larr; Back to {site.metadata.name}</Link>
      </p>
      <div className="toolbar">
        <div>
          <h1>Header/Footer</h1>
          <p className="muted">
            Edit the header or footer once — saving applies it to every page on this site that has one, in a single
            revision.
          </p>
        </div>
      </div>

      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Updated the {element} on {updated} page{updated === "1" ? "" : "s"}.
          {skipped ? ` ${skipped} page${skipped === "1" ? "" : "s"} had no matching element and were left unchanged.` : ""}
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          {error}
        </article>
      ) : null}

      <article className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Header</h2>
        {headerHtml ? (
          <form method="post" action={`/api/sites/${site.id}/header-footer`} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="element" value="header" />
            <textarea name="html" defaultValue={headerHtml} spellCheck={false} rows={16} style={codeAreaStyle} />
            <button className="button" type="submit" style={{ justifySelf: "start" }}>
              Save header to all pages
            </button>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No <code>&lt;header&gt;</code> element found on any page of this site.
          </p>
        )}
      </article>

      <article className="card">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Footer</h2>
        {footerHtml ? (
          <form method="post" action={`/api/sites/${site.id}/header-footer`} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="element" value="footer" />
            <textarea name="html" defaultValue={footerHtml} spellCheck={false} rows={16} style={codeAreaStyle} />
            <button className="button" type="submit" style={{ justifySelf: "start" }}>
              Save footer to all pages
            </button>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No <code>&lt;footer&gt;</code> element found on any page of this site.
          </p>
        )}
      </article>
    </>
  );
}
