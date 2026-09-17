import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ serverId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { serverId } = await context.params;

  try {
    const actor = await requireActor();
    await runtime.serverService.remove(serverId, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/servers?removed=1", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/servers?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
