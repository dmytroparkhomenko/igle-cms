import { NextResponse } from "next/server";
import { apiError, IgleError } from "@igle/shared";
import type { ScriptInput } from "@igle/core";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { siteId } = await context.params;

  try {
    const site = await runtime.siteService.get(siteId, (await requireActor()));
    if (!site) throw new IgleError("SITE_NOT_FOUND", "Site was not found.", 404);

    const form = await request.formData();
    const input: ScriptInput = {
      name: String(form.get("name") ?? ""),
      code: String(form.get("code") ?? ""),
      placement: String(form.get("placement") ?? "head-end") as ScriptInput["placement"],
      environment: String(form.get("environment") ?? "production") as ScriptInput["environment"]
    };

    await runtime.scriptService.addScript(site, input, (await requireActor()));

    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/sites/${site.id}/scripts?added=1`, request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/sites/${siteId}/scripts?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
