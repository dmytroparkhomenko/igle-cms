import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  try {
    const { siteId, pageId } = await context.params;
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const body = (await request.json()) as { element?: string };
    if (body.element !== "header" && body.element !== "footer") {
      throw new IgleError("VALIDATION_ERROR", "element must be 'header' or 'footer'.", 400);
    }

    const result = await runtime.seoService.syncSharedElementFromPage(site, pageId, body.element, actor);
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
