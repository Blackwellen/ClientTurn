import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Authorises a call to `/api/cron/*`.
 *
 * * The secret is compared in constant time. Both sides are hashed first so
 *   the comparison is over equal-length buffers and the length of the real
 *   secret is not leaked either.
 * * In production only the `Authorization: Bearer <secret>` header counts.
 *   pg_cron (0024b `clientturn_dispatch_cron`) sends the header; a `?secret=`
 *   query string ends up in access logs, so it is accepted in development
 *   only, for a hand-driven `curl`.
 * * No secret configured means nothing is authorised.
 *
 * Pure apart from node:crypto, so tests can import it directly.
 */
export function isCronAuthorized(
  request: Request,
  secret: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization");
  let provided: string | null = null;
  if (header?.startsWith("Bearer ")) provided = header.slice("Bearer ".length);
  else if (nodeEnv !== "production") provided = new URL(request.url).searchParams.get("secret");
  if (!provided) return false;
  return safeEqual(provided, secret);
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
