/**
 * Where the partner sign-in may send someone after they sign in.
 *
 * The partner login only ever lands inside the partner portal. A generic
 * same-origin check would make it a redirector into the customer app, which
 * is not what a partner is signing in for.
 *
 * Same-origin first (backslashes, control characters, "//host"), then the
 * RESOLVED path: "/affiliates/../app" passed the old prefix check but lands in
 * the customer app (surface QA 2026-09-30).
 *
 * Pure, so it is tested directly.
 */
import { safeRelativePath } from "../security/safe-redirect.ts";

export const PARTNER_HOME = "/affiliates/app";

export function partnerPath(value: string | undefined | null): string {
  const safe = safeRelativePath(value);
  if (!safe) return PARTNER_HOME;

  let resolved: URL;
  try {
    resolved = new URL(safe, "https://clientturn.invalid");
  } catch {
    return PARTNER_HOME;
  }
  const pathname = resolved.pathname;

  // Only the partner surfaces, and never the sign-in page itself (a loop).
  if (pathname.startsWith("/affiliates/login")) return PARTNER_HOME;
  if (pathname !== "/affiliates" && !pathname.startsWith("/affiliates/")) return PARTNER_HOME;

  // The normalised form, so what is checked is exactly what is followed.
  return `${pathname}${resolved.search}${resolved.hash}`;
}
