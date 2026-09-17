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
      <VisualEditorClient
        siteId={site.id}
        siteSlug={site.slug}
        pageId={page.id}
        pageRoute={page.route}
        previewOrigin={previewOrigin}
      />
    </>
  );
}
