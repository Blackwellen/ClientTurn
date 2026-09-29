import { NextResponse, type NextRequest } from "next/server";
import {
  ACTIVITY_COOKIE,
  ACTIVITY_COOKIE_MAX_AGE_SECONDS,
  PREV_ACTIVITY_HEADER,
  isActivityTrackedPath,
  signActivity,
} from "./security-policy";

/**
 * The key that signs the idle-timeout activity cookie and the idle hand-off
 * token. Its own secret when set, else the admin step-up secret (a separate
 * HMAC domain prefix keeps the two uses apart). Development may fall back to
 * the service-role key; production never does. Null = idle timeout is not
 * enforced (documented in docs/security/MFA_AND_SESSIONS.md), because an
 * unsigned timestamp would let anyone at an unattended keyboard extend it.
 */
export function activitySigningKey(): string | null {
  return (
    process.env.SESSION_ACTIVITY_SECRET ||
    process.env.ADMIN_STEP_UP_SECRET ||
    (process.env.NODE_ENV === "production" ? null : process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    null
  );
}

/**
 * Runs in the proxy after the Supabase session refresh. For a signed-in
 * person's app or API request it:
 *   1. passes the activity cookie it received on to the page as a request
 *      header (the page compares it with the workspace's idle timeout), and
 *   2. refreshes the cookie to now.
 * A client-supplied copy of the header is always removed first, so the page
 * only ever sees the value the proxy put there.
 */
export function withActivity(
  request: NextRequest,
  response: NextResponse,
  userId: string | null,
): NextResponse {
  const key = activitySigningKey();
  const tracked = Boolean(userId && key && isActivityTrackedPath(request.nextUrl.pathname));
  const spoofed = request.headers.has(PREV_ACTIVITY_HEADER);
  if (!tracked && !spoofed) return response;

  const headers = new Headers(request.headers);
  headers.delete(PREV_ACTIVITY_HEADER);
  if (tracked) {
    const previous = request.cookies.get(ACTIVITY_COOKIE)?.value;
    if (previous) headers.set(PREV_ACTIVITY_HEADER, previous);
  }

  // A redirect or rewrite from the session refresh is returned untouched.
  if (response.headers.get("location") || response.headers.get("x-middleware-rewrite")) {
    return response;
  }

  const next = NextResponse.next({ request: { headers } });
  for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);

  if (tracked && userId && key) {
    next.cookies.set(ACTIVITY_COOKIE, signActivity(userId, Date.now(), key), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ACTIVITY_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return next;
}
