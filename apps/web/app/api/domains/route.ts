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
    const domain = String(form.get("domain") ?? "").trim();
    const cloudflareAccountId = String(form.get("cloudflareAccountId") ?? "").trim();
    const serverId = String(form.get("serverId") ?? "").trim();

    const result = await runtime.domainService.connect({ domain, cloudflareAccountId, serverId }, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/domains?connected=${encodeURIComponent(result.domain)}`, resolveRequestOrigin(request)), {
        status: 303
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/domains?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
