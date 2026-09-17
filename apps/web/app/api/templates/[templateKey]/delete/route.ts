import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ templateKey: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { templateKey } = await context.params;

  try {
    await runtime.templateService.deleteTemplate(templateKey, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/templates?deleted=${encodeURIComponent(templateKey)}`, request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/templates/${templateKey}?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
