import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IgleError, type Actor } from "@igle/shared";
import { runtime } from "./runtime";

export const SESSION_COOKIE = "igle_session";
export const PENDING_TWO_FACTOR_COOKIE = "igle_2fa_pending";
const BACKUP_CODES_REVEAL_COOKIE = "igle_backup_codes_reveal";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PENDING_TWO_FACTOR_TTL_MS = 5 * 60 * 1000;
const BACKUP_CODES_REVEAL_TTL_MS = 5 * 60 * 1000;

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

// NODE_ENV is "production" under `next start` regardless of whether this request actually
// arrived over HTTPS — a Secure cookie set for a plain-HTTP request is silently dropped by real
// browsers (unlike curl), so this checks the request's actual scheme instead: the reverse
// proxy's forwarded-proto header if there is one, else the request's own URL.
function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return forwardedProto ? forwardedProto.split(",")[0]?.trim() === "https" : new URL(request.url).protocol === "https:";
}

export async function createSessionCookie(sessionId: string, request: Request): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Holds the pending-2FA token between the password step and the code step — never the session cookie itself, so it can't be mistaken for a real login. */
export async function createPendingTwoFactorCookie(token: string, request: Request): Promise<void> {
  const store = await cookies();
  store.set(PENDING_TWO_FACTOR_COOKIE, token, {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_TWO_FACTOR_TTL_MS / 1000
  });
}

export async function getPendingTwoFactorToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(PENDING_TWO_FACTOR_COOKIE)?.value;
}

export async function clearPendingTwoFactorCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_TWO_FACTOR_COOKIE);
}

/**
 * Carries freshly-generated backup codes from the API route that created them to the /backup-codes
 * page that displays them — never persisted anywhere else in plaintext. Read via
 * peekBackupCodesRevealCookie; expiry (a few minutes) is what makes the reveal one-time in
 * practice, since a Server Component render can read cookies but isn't allowed to mutate them
 * (only Route Handlers/Server Actions can), so this can't also delete the cookie the moment
 * /backup-codes reads it.
 */
export async function createBackupCodesRevealCookie(codes: string[], request: Request): Promise<void> {
  const store = await cookies();
  store.set(BACKUP_CODES_REVEAL_COOKIE, codes.join(","), {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: BACKUP_CODES_REVEAL_TTL_MS / 1000
  });
}

/** Read-only: returns the pending backup codes, if the reveal cookie hasn't expired yet. */
export async function peekBackupCodesRevealCookie(): Promise<string[] | undefined> {
  const store = await cookies();
  const raw = store.get(BACKUP_CODES_REVEAL_COOKIE)?.value;
  return raw ? raw.split(",") : undefined;
}
