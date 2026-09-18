import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const apiToken = String(form.get("apiToken") ?? "").trim();
    const accountId = String(form.get("accountId") ?? "").trim();

    await runtime.cloudflareAccountService.add({ name, apiToken, ...(accountId ? { accountId } : {}) }, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/cloudflare-accounts?added=1", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/cloudflare-accounts?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
