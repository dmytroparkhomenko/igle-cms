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
    const email = String(form.get("email") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const roleInput = String(form.get("role") ?? "administrator");
    const role = roleInput === "editor" ? "editor" : "administrator";

    await runtime.authService.addTeamMember(name ? { email, name, role } : { email, role }, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/team?added=1", request.url), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/team?error=${encodeURIComponent(formatted.body.error.message)}`, request.url),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
