import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../../lib/runtime";
import { requireActor } from "../../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string; pageId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId, pageId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
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
      const saved = await runtime.mediaService.saveUpload(
        site,
        { buffer, mimeType: file.type, originalName: file.name },
        (await requireActor())
      );
      src = saved.path;
    } else if (typeof url === "string" && url.trim() !== "") {
      src = url.trim();
    } else {
      throw new IgleError("VALIDATION_ERROR", "Provide either a file to upload or an image URL.", 400);
    }

    const input: { src: string; alt?: string } = { src };
    if (altRaw !== null) input.alt = String(altRaw);

    const result = await runtime.seoService.replaceImage(site, pageId, nodeId, input, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${site.id}/pages/${pageId}?updated=${result.revisionNumber}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/pages/${pageId}?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
