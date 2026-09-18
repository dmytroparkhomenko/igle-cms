import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new IgleError("VALIDATION_ERROR", "Choose an image file to upload.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await runtime.mediaService.saveUpload(site, { buffer, mimeType: file.type, originalName: file.name }, actor);
    const result = await runtime.seoService.applyFaviconToAllPages(site, saved.path, actor);

    if (wantsRedirect) {
      const query = new URLSearchParams({ faviconUpdated: String(result.updatedPageIds.length) });
      if (result.skipped.length > 0) query.set("faviconSkipped", String(result.skipped.length));
      return NextResponse.redirect(new URL(`/sites/${site.id}?${query.toString()}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?faviconError=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
