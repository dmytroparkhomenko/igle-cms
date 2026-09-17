import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const deployment = await runtime.deployService.deploy(site, (await requireActor()));

    if (wantsRedirect) {
      const url =
        deployment.status === "success"
          ? `/sites/${site.id}?deployed=${deployment.revisionNumber}`
          : `/sites/${site.id}?deployError=${encodeURIComponent(deployment.error ?? "Deployment failed.")}`;
      return NextResponse.redirect(new URL(url, request.url), { status: 303 });
    }
    return NextResponse.json({ deployment });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?deployError=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
