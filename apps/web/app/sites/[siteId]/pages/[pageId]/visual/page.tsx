import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { runtime } from "../../../../../../lib/runtime";
import { requireActorOrRedirect } from "../../../../../../lib/session";
import { VisualEditorClient } from "./VisualEditorClient";

export default async function VisualEditorPage({ params }: { params: Promise<{ siteId: string; pageId: string }> }) {
  const { siteId, pageId } = await params;
  const site = await runtime.siteService.get(siteId, (await requireActorOrRedirect()));
  if (!site) notFound();

  const state = await runtime.stateStore.read();
  const page = state.pages.find((item) => item.siteId === site.id && item.id === pageId);
  if (!page) notFound();
  if (page.deletedAt) redirect(`/sites/${site.id}/trash`);

  const previewOrigin = process.env.PREVIEW_ORIGIN ?? "http://localhost:3001";
  // A page stored at e.g. "folder/index.html" gets the route "/folder/index" — technically
  // accurate to the file, but not the URL the folder actually resolves to on a static host
  // (and not what any hand-written link on the page points at, e.g. "./folder/"). The link
  // picker deals in the URL a visitor would actually use, so it canonicalizes that one case.
  const pages = state.pages
    .filter((item) => item.siteId === site.id && !item.deletedAt)
    .map((item) => ({ id: item.id, route: item.route.replace(/\/index$/i, "/") || "/", internalName: item.internalName }))
    .sort((a, b) => a.route.localeCompare(b.route));

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Visual editor — {page.internalName}</h1>
          <p className="muted">{page.route}</p>
        </div>
        <Link href={`/sites/${site.id}/pages/${page.id}`} className="button" style={{ background: "none", color: "var(--accent)" }}>
          Back to fields
        </Link>
      </div>
      {site.metadata.contentLocked ? (
        <article className="card" style={{ borderColor: "var(--warn)" }}>
          <strong>This site is locked.</strong> {site.metadata.contentLockReason ?? "Editing is disabled."} The visual editor
          isn&apos;t available for locked sites.
        </article>
      ) : (
        <VisualEditorClient
          siteId={site.id}
          siteSlug={site.slug}
          pageId={page.id}
          pageRoute={page.route}
          previewOrigin={previewOrigin}
          pages={pages}
        />
      )}
    </>
  );
}
