import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { runtime } from "../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../lib/session";

export default async function BulkSeoEditor({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ updated?: string; skipped?: string; error?: string }>;
}) {
  const { siteId } = await params;
  const { updated, skipped, error } = await searchParams;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const pages = state.pages
    .filter((page) => page.siteId === site.id && !page.deletedAt)
    .slice()
    .sort((a, b) => a.route.localeCompare(b.route));

  const locked = (state_: string | undefined) => state_ === "manual-source" || state_ === "ambiguous";

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Bulk SEO editor — {site.metadata.name}</h1>
          <p className="muted">{pages.length} pages. Edit any cell, then save — everything changes as one revision.</p>
        </div>
        <Link href={`/sites/${site.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to site
        </Link>
      </div>

      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
          Saved as revision #{updated}
          {skipped && Number(skipped) > 0 ? ` — ${skipped} field(s) skipped (Manual Source or Ambiguous).` : "."}
        </article>
      ) : null}
      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          Save failed: {error}
        </article>
      ) : null}

      <form method="post" action={`/api/sites/${site.id}/bulk-seo`}>
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <input type="checkbox" name="fillEmptyOnly" defaultChecked />
          Fill empty fields only (uncheck to overwrite existing values)
        </label>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={thStyle}>Page</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>H1</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => {
                const titleLocked = locked(page.fieldStates.seoTitle);
                const descriptionLocked = locked(page.fieldStates.metaDescription);
                const h1Locked = locked(page.fieldStates.h1);
                return (
                  <tr key={page.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ ...tdStyle, minWidth: 160 }}>
                      <Link href={`/sites/${site.id}/pages/${page.id}`}>{page.internalName}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{page.route}</div>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        name={`seoTitle[${page.id}]`}
                        defaultValue={page.seoTitle ?? ""}
                        disabled={titleLocked}
                        title={titleLocked ? `Excluded: ${page.fieldStates.seoTitle}` : undefined}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        name={`metaDescription[${page.id}]`}
                        defaultValue={page.metaDescription ?? ""}
                        disabled={descriptionLocked}
                        title={descriptionLocked ? `Excluded: ${page.fieldStates.metaDescription}` : undefined}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        name={`h1[${page.id}]`}
                        defaultValue={page.h1 ?? ""}
                        disabled={h1Locked}
                        title={h1Locked ? `Excluded: ${page.fieldStates.h1}` : undefined}
                        style={cellInputStyle}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button className="button" type="submit" style={{ marginTop: 16 }}>
          Save all changes
        </button>
      </form>
    </>
  );
}

const thStyle: CSSProperties = { padding: "10px 12px", fontSize: 12.5, color: "var(--muted)" };
const tdStyle: CSSProperties = { padding: "6px 12px", verticalAlign: "top" };
const cellInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 200,
  border: "1px solid var(--line)",
  borderRadius: 4,
  padding: "6px 8px",
  font: "inherit",
  fontSize: 13,
  color: "var(--text)",
  background: "var(--panel)"
};
