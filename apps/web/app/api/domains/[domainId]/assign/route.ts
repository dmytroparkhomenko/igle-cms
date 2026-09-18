import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ domainId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const { domainId } = await context.params;
    const actor = await requireActor();
    const form = await request.formData();
    const siteId = String(form.get("siteId") ?? "").trim();
    if (!siteId) throw new IgleError("VALIDATION_ERROR", "Pick a site to assign this domain to.", 400);

    const site = await runtime.siteService.get(siteId, actor);
    const result = await runtime.domainService.assignToSite(domainId, siteId, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/domains?assigned=${encodeURIComponent(site?.metadata.name ?? result.domain)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/domains?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
