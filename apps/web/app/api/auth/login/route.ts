import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { createPendingTwoFactorCookie, resolveRequestOrigin } from "../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const result = await runtime.authService.createSession(email, password);
    await createPendingTwoFactorCookie(result.pendingTwoFactorToken, request);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/login/verify", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true, setupRequired: result.setupRequired });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
