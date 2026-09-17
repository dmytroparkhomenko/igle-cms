import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; revisionNumber: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, revisionNumber } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    const revision = await runtime.revisionService.restore(site, Number(revisionNumber), {
      id: (await requireActor()).id,
      name: (await requireActor()).email,
      email: (await requireActor()).email
    });
    await runtime.importService.reindexSite(site, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${site.id}?restored=${revision.revisionNumber}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json({ revision });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}?restoreError=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
