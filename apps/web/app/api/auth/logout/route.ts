import { NextResponse } from "next/server";
import { runtime } from "../../../../lib/runtime";
import { SESSION_COOKIE, clearSessionCookie } from "../../../../lib/session";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) await runtime.authService.logout(sessionId);
  await clearSessionCookie();

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }
  return NextResponse.json({ ok: true });
}
