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
    const affiliateLinkOverride = String(form.get("affiliateLinkOverride") ?? "");

    await runtime.siteService.updateSettings(site, { affiliateLinkOverride }, actor);

    if (wantsRedirect) {
      const destination = new URL(`/sites/${site.id}/affiliate-link`, resolveRequestOrigin(request));
      destination.searchParams.set("updated", "1");
      return NextResponse.redirect(destination, { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      const destination = new URL(`/sites/${siteId}/affiliate-link`, resolveRequestOrigin(request));
      destination.searchParams.set("error", formatted.body.error.message);
      return NextResponse.redirect(destination, { status: 303 });
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
