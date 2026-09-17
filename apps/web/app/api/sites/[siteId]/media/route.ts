import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

/**
 * Uploads a file into the site's media folder and returns its path — nothing else. The visual
 * editor calls this to get a usable `src` for an image before queuing the actual page patch, so
 * the upload itself doesn't create a revision; only clicking "Save changes" does.
 */
export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await context.params;
    const actor = await requireActor();
    const site = await runtime.siteService.get(siteId, actor);
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new IgleError("VALIDATION_ERROR", "A file is required.", 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await runtime.mediaService.saveUpload(site, { buffer, mimeType: file.type, originalName: file.name }, actor);
    return NextResponse.json({ src: saved.path });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
