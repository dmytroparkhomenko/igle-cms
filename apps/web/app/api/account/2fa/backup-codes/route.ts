import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { createBackupCodesRevealCookie, requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const code = String(form.get("code") ?? "");
    const { codes } = await runtime.authService.regenerateBackupCodes(actor, code);
    await createBackupCodesRevealCookie(codes, request);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/backup-codes", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true, codes });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/settings?twoFactorError=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
