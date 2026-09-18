import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const sourceSiteId = String(form.get("sourceSiteId") ?? "").trim();
    if (!sourceSiteId) throw new IgleError("SOURCE_REQUIRED", "Pick a site to mirror.", 400);

    const result = await runtime.mirrorService.connect(site, sourceSiteId, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}?mirrored=${result.copiedPages}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?mirrorError=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
