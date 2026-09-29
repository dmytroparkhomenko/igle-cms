import Link from "next/link";
import { notFound } from "next/navigation";
import { runtime } from "../../../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../../../lib/session";

const textareaStyle = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: 10,
  font: "inherit",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--text)",
  background: "var(--panel)",
  resize: "vertical" as const
};

export default async function BulkEditPage({
  params,
  searchParams
}: {
  params: Promise<{ siteId: string; pageId: string }>;
  searchParams: Promise<{ updated?: string; count?: string; error?: string }>;
}) {
  const { siteId, pageId } = await params;
  const { updated, count, error } = await searchParams;
  const actor = await requireActorOrRedirect();
  const site = await runtime.siteService.get(siteId, actor);
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const page = state.pages.find((item) => item.siteId === site.id && item.id === pageId);
  if (!page) notFound();

  const nodes = site.metadata.contentLocked ? [] : await runtime.seoService.listEditableTextNodes(site, pageId, actor);

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Bulk content edit — {page.internalName}</h1>
          <p className="muted">{page.route}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/sites/${site.id}/pages/${page.id}/visual`} className="button button-ghost">
            Visual editor
          </Link>
          <Link href={`/sites/${site.id}/pages/${page.id}/code`} className="button button-ghost">
            Code editor
          </Link>
          <Link href={`/sites/${site.id}/pages/${page.id}`} className="button button-ghost">
            Back to fields
          </Link>
        </div>
      </div>

      <article className="card" style={{ marginBottom: 16, fontSize: 13 }}>
        Every paragraph, heading, link, and button text on this page, in one list — for replacing a template's
        copy quickly instead of clicking through the visual editor one block at a time. Editing here, the visual
        editor, and the code editor all read and write the exact same page file, so nothing here conflicts with
        the others — whichever you save last is what sticks. Change only the fields you want; anything left as-is
        is left completely untouched.
      </article>

      {site.metadata.contentLocked ? (
        <article className="card" style={{ borderColor: "var(--warn)" }}>
          <strong>This site is locked.</strong> {site.metadata.contentLockReason ?? "Editing is disabled."} Bulk edit
          isn&apos;t available for locked sites.
        </article>
      ) : (
        <>
          {updated ? (
            <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
              Saved as revision #{updated} — {count} field{count === "1" ? "" : "s"} changed.
            </article>
          ) : null}
          {error ? (
            <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
              {error}
            </article>
          ) : null}

          {nodes.length === 0 ? (
            <article className="card">
              <p className="muted" style={{ margin: 0 }}>
                No paragraphs, headings, links, or button text found on this page to bulk-edit.
              </p>
            </article>
          ) : (
            <form method="post" action={`/api/sites/${site.id}/pages/${page.id}/bulk-edit`} style={{ display: "grid", gap: 14 }}>
              {nodes.map((node) => (
                <div className="card" key={node.nodeId} style={{ display: "grid", gap: 6 }}>
                  <label className="muted" htmlFor={`html_${node.nodeId}`} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="status" style={{ fontSize: 10.5, padding: "1px 7px" }}>
                      {node.tagName}
                    </span>
                    {node.preview.length > 70 ? `${node.preview.slice(0, 70)}…` : node.preview}
                  </label>
                  <input type="hidden" name={`original_${node.nodeId}`} value={node.html} />
                  <textarea
                    id={`html_${node.nodeId}`}
                    name={`html_${node.nodeId}`}
                    defaultValue={node.html}
                    rows={node.html.length > 140 ? 4 : node.html.length > 60 ? 2 : 1}
                    style={textareaStyle}
                  />
                </div>
              ))}
              <button className="button" type="submit" style={{ justifySelf: "start" }}>
                Save changed fields
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}
