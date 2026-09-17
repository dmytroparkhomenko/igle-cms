import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { TicketPriority, TicketSpecialistType, TicketStatus } from "@igle/core";
import { runtime } from "../../../../../lib/runtime";

const statuses: TicketStatus[] = ["open", "in-progress", "done", "cancelled"];
const specialistTypes: TicketSpecialistType[] = ["developer", "designer", "seo", "copywriter"];
const priorities: TicketPriority[] = ["low", "medium", "high", "urgent"];

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { ticketId } = await context.params;

  try {
    const form = await request.formData();
    const status = String(form.get("status") ?? "");
    const priority = String(form.get("priority") ?? "");
    const specialistType = String(form.get("specialistType") ?? "");
    const deadlineRaw = form.has("deadline") ? String(form.get("deadline") ?? "").trim() : undefined;

    if (status && !statuses.includes(status as TicketStatus)) throw new IgleError("INVALID_TICKET", "Invalid status.", 400);
    if (priority && !priorities.includes(priority as TicketPriority)) throw new IgleError("INVALID_TICKET", "Invalid priority.", 400);
    if (specialistType && !specialistTypes.includes(specialistType as TicketSpecialistType)) {
      throw new IgleError("INVALID_TICKET", "Invalid specialist type.", 400);
    }

    await runtime.ticketService.update(ticketId, {
      status: status ? (status as TicketStatus) : undefined,
      priority: priority ? (priority as TicketPriority) : undefined,
      specialistType: specialistType ? (specialistType as TicketSpecialistType) : undefined,
      deadline: deadlineRaw === undefined ? undefined : deadlineRaw === "" ? null : deadlineRaw
    });

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/tickets/${ticketId}?updated=1`, request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/tickets/${ticketId}?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
