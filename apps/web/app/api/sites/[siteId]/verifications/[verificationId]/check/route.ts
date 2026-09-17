import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; verificationId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, verificationId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const verifications = await runtime.verificationService.list(site);
    const verification = verifications.find((item) => item.id === verificationId);
    if (!verification) throw new IgleError("VERIFICATION_NOT_FOUND", "Verification was not found.", 404);

    const result = await runtime.verificationService.checkReachable(site, verification);

    if (wantsRedirect) {
      const url = result.ok
        ? `/sites/${site.id}/scripts?checkedOk=1`
        : `/sites/${site.id}/scripts?checkedError=${encodeURIComponent(result.error ?? "Not reachable.")}`;
      return NextResponse.redirect(new URL(url, request.url), { status: 303 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/scripts?verificationError=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
