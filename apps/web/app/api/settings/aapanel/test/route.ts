import { NextResponse } from "next/server";
import { runtime } from "../../../../../lib/runtime";
import { requireActor } from "../../../../../lib/session";

export async function POST(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsRedirect = accept.includes("text/html");
  const actor = await requireActor();
  const form = await request.formData();
  const serverId = String(form.get("serverId") ?? "");

  const result = await runtime.deployService.testAaPanelConnection(serverId, actor);

  if (wantsRedirect) {
    const url = result.ok
      ? `/servers?testOk=${result.siteCount ?? 0}`
      : `/servers?error=${encodeURIComponent(result.error ?? "Connection test failed.")}`;
    return NextResponse.redirect(new URL(url, request.url), { status: 303 });
  }
  return NextResponse.json(result);
}
