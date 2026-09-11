import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";

export async function PATCH(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  try {
    const { siteId, pageId } = await context.params;
    const site = await runtime.siteService.get(siteId, runtime.systemActor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    const body = (await request.json()) as { seoTitle?: string; metaDescription?: string; h1?: string };
    const result = await runtime.seoService.updateFields(site, pageId, body, runtime.systemActor);
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
