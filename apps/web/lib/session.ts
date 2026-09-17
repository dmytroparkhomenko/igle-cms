import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IgleError, type Actor } from "@igle/shared";
import { runtime } from "./runtime";

export const SESSION_COOKIE = "igle_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export async function getCurrentActor(): Promise<Actor | undefined> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  return runtime.authService.getActorForSession(sessionId);
}

/** For Server Components: redirects to /login if nobody's signed in, so pages never render for an anonymous visitor. */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * For Route Handlers: throws instead of redirecting, so it flows through the same
 * apiError()/wantsRedirect handling every route already has. Middleware already blocks
 * anonymous requests to these routes, so this should only fire defensively.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new IgleError("UNAUTHENTICATED", "Please log in.", 401);
  return actor;
}

/**
 * The origin (scheme + host) a browser actually used to reach this request. Self-hosted behind a
 * reverse proxy (Caddy, then aaPanel's own nginx, then whatever the visitor typed), a Route
 * Handler's own `request.url` can reflect the app's internal bind address — e.g.
 * "http://localhost:3000" — rather than the public-facing one, which turns every
 * `NextResponse.redirect(new URL(path, request.url))` into a redirect to a host the visitor's
 * browser can't reach. Reading the actual forwarded headers (which Caddy sets by default) instead
 * of trusting request.url's parsed origin fixes every one of those redirects at once.
 */
export function resolveRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (new URL(request.url).protocol === "https:" ? "https" : "http");
  return `${protocol}://${host}`;
}

export async function createSessionCookie(sessionId: string, request: Request): Promise<void> {
  // NODE_ENV is "production" under `next start` regardless of whether this request actually
  // arrived over HTTPS — a Secure cookie set for a plain-HTTP request is silently dropped by
  // real browsers (unlike curl), so this checks the request's actual scheme instead: the
  // reverse proxy's forwarded-proto header if there is one, else the request's own URL.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto ? forwardedProto.split(",")[0]?.trim() === "https" : new URL(request.url).protocol === "https:";

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
