import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { StructuralPatch } from "@igle/html-engine";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  try {
    const { siteId, pageId } = await context.params;
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const body = (await request.json()) as { patches: StructuralPatch[] };
    const patches = body.patches ?? [];
    if (!patches.every((patch) => Number.isInteger(patch.nodeId) && patch.nodeId >= 0)) {
      throw new IgleError("VALIDATION_ERROR", "Every patch requires a valid nodeId.", 400);
    }

    const result = await runtime.seoService.applyVisualEdits(site, pageId, patches, (await requireActor()));
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
