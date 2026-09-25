import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { TaskPriority, TaskStatus } from "@igle/core";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

const statuses: TaskStatus[] = ["open", "in-progress", "done", "cancelled"];
const priorities: TaskPriority[] = ["low", "medium", "high", "urgent"];

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { taskId } = await context.params;

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const status = String(form.get("status") ?? "");
    const priority = String(form.get("priority") ?? "");
    const deadlineRaw = form.has("deadline") ? String(form.get("deadline") ?? "").trim() : undefined;
    const assigneeIdRaw = form.has("assigneeId") ? String(form.get("assigneeId") ?? "").trim() : undefined;

    if (status && !statuses.includes(status as TaskStatus)) throw new IgleError("INVALID_TASK", "Invalid status.", 400);
    if (priority && !priorities.includes(priority as TaskPriority)) throw new IgleError("INVALID_TASK", "Invalid priority.", 400);

    await runtime.taskService.update(
      taskId,
      {
        status: status ? (status as TaskStatus) : undefined,
        priority: priority ? (priority as TaskPriority) : undefined,
        deadline: deadlineRaw === undefined ? undefined : deadlineRaw === "" ? null : deadlineRaw,
        assigneeId: assigneeIdRaw === undefined ? undefined : assigneeIdRaw === "" ? null : assigneeIdRaw
      },
      actor
    );

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
