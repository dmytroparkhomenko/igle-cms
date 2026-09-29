import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { StructuralPatch } from "@igle/html-engine";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../../../lib/session";

/**
 * Diffs the submitted form against the "original_<nodeId>" hidden values the bulk-edit page
 * rendered each field with, and turns whichever fields actually changed into ordinary
 * setInnerHtml StructuralPatches — then applies them through the exact same applyVisualEdits the
 * visual editor's own save route calls. A field left untouched produces no patch at all, so
 * submitting the form without changing anything is a safe no-op, not an empty revision.
 */
export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const { siteId, pageId } = await context.params;
  try {
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const patches: StructuralPatch[] = [];
    for (const [key, value] of form.entries()) {
      const match = /^html_(\d+)$/.exec(key);
      if (!match) continue;
      const nodeId = Number(match[1]);
      const original = form.get(`original_${nodeId}`);
      const next = String(value);
      if (typeof original === "string" && next !== original) {
        patches.push({ nodeId, op: "setInnerHtml", value: next });
      }
    }

    if (patches.length === 0) {
      return NextResponse.redirect(new URL(`/sites/${siteId}/pages/${pageId}/bulk-edit`, resolveRequestOrigin(request)), { status: 303 });
    }

    const result = await runtime.seoService.applyVisualEdits(site, pageId, patches, actor);
    const destination = new URL(`/sites/${siteId}/pages/${pageId}/bulk-edit`, resolveRequestOrigin(request));
    destination.searchParams.set("updated", String(result.revisionNumber));
    destination.searchParams.set("count", String(patches.length));
    return NextResponse.redirect(destination, { status: 303 });
  } catch (error) {
    const formatted = apiError(error);
    const destination = new URL(`/sites/${siteId}/pages/${pageId}/bulk-edit`, resolveRequestOrigin(request));
    destination.searchParams.set("error", formatted.body.error.message);
    return NextResponse.redirect(destination, { status: 303 });
  }
}
