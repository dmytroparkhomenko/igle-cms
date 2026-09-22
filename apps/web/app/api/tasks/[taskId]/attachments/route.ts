import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { taskId } = await context.params;

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new IgleError("VALIDATION_ERROR", "A file is required.", 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    await runtime.taskService.addAttachment(taskId, { buffer, mimeType: file.type, originalName: file.name }, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/tasks/${taskId}?updated=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/tasks/${taskId}?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
