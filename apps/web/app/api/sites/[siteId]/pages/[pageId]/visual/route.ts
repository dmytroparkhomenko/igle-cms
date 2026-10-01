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

    // Each participant in this page's real-time collab room (see CollabService) saves only their
    // own stack of pending patches, attributed to whoever is actually signed in and posting this
    // request (see applyVisualEdits -> commitRevision's `user`) — one revision per person's own
    // save, never a combined one. Nothing here needs to touch anyone else's room state: a save
    // only ever clears the saving participant's own entry, which the client already announces
    // through the normal /collab/sync flow once its own patches are cleared locally.
    const result = await runtime.seoService.applyVisualEdits(site, pageId, patches, (await requireActor()));
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
