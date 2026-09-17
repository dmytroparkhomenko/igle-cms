import { NextResponse, type NextRequest } from "next/server";
import { runtime } from "./lib/runtime";
import { resolveRequestOrigin, SESSION_COOKIE } from "./lib/session";

// Real session validation needs file-system access to the state store — not available on the
// default Edge runtime, so this middleware runs as plain Node.js (stable since Next.js 15.2).
export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"]
};

const publicPaths = ["/login", "/api/auth/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!isPublic) {
    const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
    const actor = await runtime.authService.getActorForSession(sessionId);
    if (!actor) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please log in." } }, { status: 401 });
      }
      const loginUrl = new URL("/login", resolveRequestOrigin(request));
      return NextResponse.redirect(loginUrl);
    }
  }

  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  return response;
}
