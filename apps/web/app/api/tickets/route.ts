import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { TicketPriority, TicketSpecialistType } from "@igle/core";
import { runtime } from "../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../lib/session";

const specialistTypes: TicketSpecialistType[] = ["developer", "designer", "seo", "copywriter"];
const priorities: TicketPriority[] = ["low", "medium", "high", "urgent"];

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    await requireActor();
    const form = await request.formData();
    const title = String(form.get("title") ?? "");
    const description = String(form.get("description") ?? "");
    const specialistType = String(form.get("specialistType") ?? "") as TicketSpecialistType;
    const priority = String(form.get("priority") ?? "medium") as TicketPriority;
    const siteIdRaw = String(form.get("siteId") ?? "").trim();
    const deadlineRaw = String(form.get("deadline") ?? "").trim();
    const assigneeIdRaw = String(form.get("assigneeId") ?? "").trim();

    if (!specialistTypes.includes(specialistType)) {
      throw new IgleError("INVALID_TICKET", "Choose a valid specialist type.", 400);
    }
    if (!priorities.includes(priority)) {
      throw new IgleError("INVALID_TICKET", "Choose a valid priority.", 400);
    }

    const ticket = await runtime.ticketService.create({
      title,
      description,
      specialistType,
      priority,
      siteId: siteIdRaw === "" ? undefined : siteIdRaw,
      deadline: deadlineRaw === "" ? undefined : deadlineRaw,
      assigneeId: assigneeIdRaw === "" ? undefined : assigneeIdRaw
    });

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/tickets/${ticket.id}?created=1`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ticket });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/tickets?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
