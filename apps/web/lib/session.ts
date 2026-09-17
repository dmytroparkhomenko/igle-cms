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
