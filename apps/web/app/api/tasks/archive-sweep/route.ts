import { NextResponse } from "next/server";
import { apiError, assertCan } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../lib/session";

/** Manual equivalent of the worker's weekly sweep — an admin can run it on demand from the dashboard, with no day-of-week gating (unlike the automatic Sunday-only run). */
export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const actor = await requireActor();
    assertCan(actor, "tasks.manage");
    const result = await runtime.taskService.archiveCompletedAndCancelled();

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/tasks/dashboard?swept=${result.archivedTaskIds.length}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/tasks/dashboard?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
