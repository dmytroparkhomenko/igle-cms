import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor } from "../../../../../../lib/session";

/** Streams an attachment's bytes back — the first file-download response in this app, everything else is JSON or a redirect. Auth is enforced here directly (not by middleware, which skips /api/*). */
export async function GET(request: Request, context: { params: Promise<{ taskId: string; attachmentId: string }> }) {
  try {
    await requireActor();
    const { taskId, attachmentId } = await context.params;
    const found = await runtime.taskService.getAttachment(taskId, attachmentId);
    if (!found) throw new IgleError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);

    const buffer = await fs.readFile(found.absolutePath);
    const encodedName = encodeURIComponent(found.attachment.filename);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": found.attachment.mimeType || "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    const formatted = apiError(error);
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
