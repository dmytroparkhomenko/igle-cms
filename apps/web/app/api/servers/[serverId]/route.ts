import { NextResponse } from "next/server";
import { apiError } from "@igle/shared";
import { runtime } from "../../../../lib/runtime";
import { requireActor , resolveRequestOrigin} from "../../../../lib/session";

export async function POST(request: Request, context: { params: Promise<{ serverId: string }> }) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const { serverId } = await context.params;

  try {
    const actor = await requireActor();
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const publicIp = String(form.get("publicIp") ?? "").trim();
    const restricted = form.get("restricted") === "on";
    const sshPortRaw = String(form.get("sshPort") ?? "").trim();

    await runtime.serverService.update(
      serverId,
      {
        name,
        publicIp,
        restricted,
        baseUrl: String(form.get("baseUrl") ?? "").trim(),
        apiKey: String(form.get("apiKey") ?? "").trim(),
        sshHost: String(form.get("sshHost") ?? "").trim(),
        ...(sshPortRaw ? { sshPort: Number(sshPortRaw) } : {}),
        sshUsername: String(form.get("sshUsername") ?? "").trim(),
        sshPassword: String(form.get("sshPassword") ?? "").trim(),
        sshPrivateKey: String(form.get("sshPrivateKey") ?? "").trim()
      },
      actor
    );

    if (wantsRedirect) {
      return NextResponse.redirect(new URL("/servers?updated=1", resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const formatted = apiError(error);
    if (wantsRedirect) {
      return NextResponse.redirect(new URL(`/servers?error=${encodeURIComponent(formatted.body.error.message)}`, resolveRequestOrigin(request)), { status: 303 });
    }
    return NextResponse.json(formatted.body, { status: formatted.status });
  }
}
