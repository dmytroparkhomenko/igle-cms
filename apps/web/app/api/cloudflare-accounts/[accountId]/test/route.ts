import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor, resolveRequestOrigin } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const { accountId } = await context.params;
    const actor = await requireActor();
    const result = await runtime.cloudflareAccountService.testConnection(accountId, actor);

    if (wantsRedirect) {
      const url = result.ok
        ? `/cloudflare-accounts?testOk=${result.zoneCount ?? 0}`
        : `/cloudflare-accounts?testError=${encodeURIComponent(result.error ?? "Connection failed.")}`;
      return NextResponse.redirect(new URL(url, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(result);
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
