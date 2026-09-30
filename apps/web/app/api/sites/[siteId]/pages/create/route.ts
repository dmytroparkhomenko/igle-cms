import { NextResponse } from "next/server";
import { apiError, IgleError, type Actor } from "@igle/shared";
import type { PageIndexRecord, SiteRecord } from "@igle/core";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../../lib/session";

/** Best-effort — a template with no shared <header>/<footer> at all shouldn't fail page creation. */
async function syncNavigationFrom(site: SiteRecord, referencePageId: string, actor: Actor): Promise<void> {
  for (const element of ["header", "footer"] as const) {
    await runtime.seoService.syncSharedElementFromPage(site, referencePageId, element, actor).catch(() => undefined);
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "");

    let page: PageIndexRecord;
    if (mode === "duplicate") {
      const sourcePageId = String(formData.get("sourcePageId") ?? "");
      const internalName = String(formData.get("internalName") ?? "");
      if (!sourcePageId) throw new IgleError("VALIDATION_ERROR", "Choose a page to duplicate.", 400);
      const result = await runtime.pageService.duplicate(site, sourcePageId, actor, internalName || undefined);
      page = result.page;
    } else if (mode === "template") {
      const pageTypeKey = String(formData.get("pageTypeKey") ?? "");
      if (!pageTypeKey) throw new IgleError("VALIDATION_ERROR", "Choose a page type to add.", 400);
      const result = await runtime.templateService.instantiatePageType(site, pageTypeKey, actor);
      page = result.page;
    } else {
      throw new IgleError("VALIDATION_ERROR", "mode must be 'duplicate' or 'template'.", 400);
    }

    const state = await runtime.stateStore.read();
    const otherPages = state.pages.filter((item) => item.siteId === site.id && !item.deletedAt && item.id !== page.id);
    const referencePage = otherPages.find((item) => item.route === "/") ?? otherPages[0];
    if (referencePage) await syncNavigationFrom(site, referencePage.id, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}/pages/${page.id}?created=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ page });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?pageError=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
