import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor } from "../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const country = String(form.get("country") ?? "");
    const url = String(form.get("url") ?? "");

    await runtime.affiliateLinkService.set(country, url, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/integrations?updated=1", request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(formatted.body.error.message)}`, request.url), { status: 303 });
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
