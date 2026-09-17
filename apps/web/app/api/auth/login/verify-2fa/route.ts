import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import {
  clearPendingTwoFactorCookie,
  createSessionCookie,
  getPendingTwoFactorToken,
  resolveRequestOrigin
} from "../../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const pendingToken = await getPendingTwoFactorToken();
    if (!pendingToken) throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);

    const form = await request.formData();
    const code = String(form.get("code") ?? "");

    const { sessionId } = await runtime.authService.verifyTwoFactorAndCreateSession(pendingToken, code);
    await clearPendingTwoFactorCookie();
    await createSessionCookie(sessionId, request);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (formatted.body.error.code === "TWO_FACTOR_EXPIRED" || formatted.body.error.code === "TOO_MANY_ATTEMPTS") {
      await clearPendingTwoFactorCookie();
    }
    if (wantsRedirect) {
      const target = formatted.body.error.code === "TWO_FACTOR_EXPIRED" || formatted.body.error.code === "TOO_MANY_ATTEMPTS" ? "/login" : "/login/verify";
      return NextResponse.redirect(
        new URL(`${target}?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
