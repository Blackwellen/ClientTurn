/**
 * Same-origin check for cookie-authenticated route handlers that change state
 * (CSRF). Server Actions get this from Next.js; a plain route handler does not.
 *
 * Rules:
 * - `Sec-Fetch-Site`, when a browser sends it, must be `same-origin`.
 * - The `Origin` header must be present and be one of the allowed origins.
 *   Every current browser sends Origin on a POST `fetch`, so a request
 *   without one is not from our page. Falls back to `Referer` only when
 *   Origin is absent (some privacy proxies strip it).
 * - Neither present: refused. The old check accepted a missing Origin
 *   (gap audit 15 §3).
 *
 * Pure: no server-only import, so it is tested directly.
 */

export type HeaderReader = { get(name: string): string | null };

function normalise(origin: string): string {
  return origin.replace(/\/$/, "").toLowerCase();
}

export function isSameOriginRequest(
  headers: HeaderReader,
  allowedOrigins: readonly (string | null | undefined)[],
): boolean {
  const allowed = allowedOrigins
    .filter((o): o is string => Boolean(o))
    .map((o) => {
      try {
        return normalise(new URL(o).origin);
      } catch {
        return null;
      }
    })
    .filter((o): o is string => Boolean(o));
  if (allowed.length === 0) return false;

  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;

  const origin = headers.get("origin");
  if (origin && origin !== "null") return allowed.includes(normalise(origin));

  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return allowed.includes(normalise(new URL(referer).origin));
  } catch {
    return false;
  }
}
