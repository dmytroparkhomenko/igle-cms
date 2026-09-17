import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { StructuralPatch } from "@igle/html-engine";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../../../lib/session";

/**
 * Immediate-submit image replace for the plain "Images on this page" list (the SEO fields page
 * has no batching/queueing — every form there saves right away). The visual editor has its own
 * deferred version of this same idea; both end up going through applyVisualEdits, which is what
 * actually strips a stale srcset and propagates the change to every other place the same image
 * appears.
 */
export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, pageId } = await context.params;

  try {
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const nodeIdRaw = form.get("nodeId");
    if (typeof nodeIdRaw !== "string" || !/^\d+$/.test(nodeIdRaw.trim())) {
      throw new IgleError("VALIDATION_ERROR", "A valid nodeId is required.", 400);
    }
    const nodeId = Number(nodeIdRaw);

    const url = form.get("url");
    const file = form.get("file");
    const altRaw = form.get("alt");

    let src: string;
    if (file instanceof File && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const saved = await runtime.mediaService.saveUpload(site, { buffer, mimeType: file.type, originalName: file.name }, actor);
      src = saved.path;
    } else if (typeof url === "string" && url.trim() !== "") {
      src = url.trim();
    } else {
      throw new IgleError("VALIDATION_ERROR", "Provide either a file to upload or an image URL.", 400);
    }

    const patches: StructuralPatch[] = [
      { nodeId, op: "setAttr", attrName: "src", value: src },
      { nodeId, op: "removeAttr", attrName: "srcset" }
    ];
    if (altRaw !== null) patches.push({ nodeId, op: "setAttr", attrName: "alt", value: String(altRaw) });

    const result = await runtime.seoService.applyVisualEdits(site, pageId, patches, actor, "media");

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${site.id}/pages/${pageId}?updated=${result.revisionNumber}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/pages/${pageId}?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
