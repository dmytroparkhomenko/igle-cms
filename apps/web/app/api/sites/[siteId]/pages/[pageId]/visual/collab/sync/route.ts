import { NextResponse } from "next/server";
import { apiError, assertCan, IgleError } from "@igle/shared";
import type { StructuralPatch } from "@igle/html-engine";
import { runtime } from "../../../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../../../lib/session";

/** Pushes one participant's current full pending-patch list to their room — see CollabService.sync. */
export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  try {
    const { siteId, pageId } = await context.params;
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);
    assertCan(actor, "sites.edit", site.id);

    const body = (await request.json()) as { connectionId?: string; patches?: StructuralPatch[]; selectedNodeId?: number };
    if (!body.connectionId) throw new IgleError("VALIDATION_ERROR", "connectionId is required.", 400);
    const patches = body.patches ?? [];
    if (!patches.every((patch) => Number.isInteger(patch.nodeId) && patch.nodeId >= 0)) {
      throw new IgleError("VALIDATION_ERROR", "Every patch requires a valid nodeId.", 400);
    }

    runtime.collabService.sync(site.id, pageId, body.connectionId, patches, body.selectedNodeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
