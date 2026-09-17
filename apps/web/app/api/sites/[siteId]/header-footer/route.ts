import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const element = String(form.get("element") ?? "");
    if (element !== "header" && element !== "footer") {
      throw new IgleError("VALIDATION_ERROR", "element must be 'header' or 'footer'.", 400);
    }
    const html = String(form.get("html") ?? "");
    if (!html.trim()) throw new IgleError("VALIDATION_ERROR", "HTML content is required.", 400);

    const result = await runtime.seoService.replaceSharedElement(site, element, html, actor);

    if (wantsRedirect) {
      const query = new URLSearchParams({ updated: String(result.updatedPageIds.length), element });
      if (result.skipped.length > 0) query.set("skipped", String(result.skipped.length));
      return NextResponse.redirect(new URL(`/sites/${site.id}/header-footer?${query.toString()}`, request.url), { status: 303 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/header-footer?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
