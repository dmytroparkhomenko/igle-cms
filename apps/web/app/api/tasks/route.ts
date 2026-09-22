import { NextResponse } from "next/server";
import { apiError, IgleError, taskCategories, type TaskCategory } from "@igle/shared";
import type { TaskPriority } from "@igle/core";
import { runtime } from "../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../lib/session";

const priorities: TaskPriority[] = ["low", "medium", "high", "urgent"];

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const title = String(form.get("title") ?? "");
    const description = String(form.get("description") ?? "");
    const category = String(form.get("category") ?? "") as TaskCategory;
    const priority = String(form.get("priority") ?? "medium") as TaskPriority;
    const siteIdRaw = String(form.get("siteId") ?? "").trim();
    const deadlineRaw = String(form.get("deadline") ?? "").trim();
    const assigneeIdRaw = String(form.get("assigneeId") ?? "").trim();

    if (!(taskCategories as readonly string[]).includes(category)) {
      throw new IgleError("INVALID_TASK", "Choose a valid category.", 400);
    }
    if (!priorities.includes(priority)) {
      throw new IgleError("INVALID_TASK", "Choose a valid priority.", 400);
    }

    const task = await runtime.taskService.create(
      {
        title,
        description,
        category,
        priority,
        siteId: siteIdRaw === "" ? undefined : siteIdRaw,
        deadline: deadlineRaw === "" ? undefined : deadlineRaw,
        assigneeId: assigneeIdRaw === "" ? undefined : assigneeIdRaw
      },
      actor
    );

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/tasks/${task.id}?created=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/tasks?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
