import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { userId } = await context.params;

  try {
    const actor = await requireActor();
    const state = await runtime.stateStore.read();
    const email = state.users.find((user) => user.id === userId)?.email ?? "that member";
    await runtime.authService.adminResetTwoFactor(userId, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/team?twoFactorReset=${encodeURIComponent(email)}`, resolveRequestOrigin(request)), {
        status: 303
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/team?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
