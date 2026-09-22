import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ notificationId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { notificationId } = await context.params;

  try {
    const actor = await requireActor();
    await runtime.notificationService.markRead(notificationId, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/notifications", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/notifications", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
