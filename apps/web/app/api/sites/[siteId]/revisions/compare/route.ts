import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor } from "../../../../../../lib/session";

export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await context.params;
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    const url = new URL(request.url);
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    const diff = await runtime.revisionService.compare(site, from, to);
    return NextResponse.json({ diff });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
