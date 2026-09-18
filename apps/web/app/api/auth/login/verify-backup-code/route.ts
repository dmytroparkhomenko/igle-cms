import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { clearPendingTwoFactorCookie, getPendingTwoFactorToken, resolveRequestOrigin } from "../../../../../lib/session";

/**
 * The lost-device path: a valid backup code retires the old secret and drops the sign-in straight
 * back into setup (same pending token, now showing a fresh QR code) instead of granting a session
 * outright — see verifyBackupCodeAndRestartSetup. Nothing here is a full login by itself.
 */
export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const pendingToken = await getPendingTwoFactorToken();
    if (!pendingToken) throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);

    const form = await request.formData();
    const code = String(form.get("code") ?? "");

    await runtime.authService.verifyBackupCodeAndRestartSetup(pendingToken, code);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/login/verify?backupAccepted=1", resolveRequestOrigin(request)), { status: 303 });
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
