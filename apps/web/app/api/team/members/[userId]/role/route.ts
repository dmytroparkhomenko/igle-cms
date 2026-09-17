import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { userId } = await context.params;

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const roleInput = String(form.get("role") ?? "administrator");
    const role = roleInput === "editor" ? "editor" : "administrator";

    await runtime.authService.updateTeamMemberRole(userId, role, actor);

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/team?updated=1", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(
        new URL(`/team?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)),
        { status: 303 }
      );
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
