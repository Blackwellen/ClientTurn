import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signing and verifying outgoing webhooks.
 *
 * The scheme is the one Stripe uses, and it is worth saying why rather than
 * just that it is conventional:
 *
 *   * **The timestamp is inside the signed material.** Signing the body alone
 *     lets anyone who once saw a valid request replay it forever. Signing
 *     `timestamp.body` means a receiver can reject anything older than its own
 *     tolerance, and a replay outside that window fails.
 *   * **The signature is over the exact bytes sent.** Not over a re-serialised
 *     object — key order would differ and every signature would fail
 *     intermittently, which is the worst possible failure mode because it looks
 *     like a network problem.
 *   * **Comparison is constant time.** A receiver that compares with `===`
 *     leaks the signature a byte at a time; we cannot make them use this
 *     function, but we can make the one we ship correct and document it.
 *
 * No `server-only`: the verification half is exactly what a customer needs, so
 * this module is safe to hold up as the reference implementation, and the tests
 * import it directly.
 */

/** The header carrying the signature. */
export const SIGNATURE_HEADER = "clientturn-signature";

/** How stale a request may be before a well-behaved receiver rejects it. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** `whsec_` then 32 bytes of CSPRNG output — recognisable in a leak. */
export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * Builds the header value: `t=<unix seconds>,v1=<hex hmac>`.
 *
 * The scheme is versioned so a future algorithm can be added as `v2=` alongside
 * `v1=` and receivers that only know `v1` keep working through the change.
 */
export function signPayload(
  payload: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

export type SignatureVerification =
  | { ok: true }
  | { ok: false; reason: "MALFORMED" | "STALE" | "MISMATCH" };

/**
 * Verifies a header against the raw body.
 *
 * `payload` must be the exact string received, before JSON parsing.
 */
export function verifySignature(
  payload: string,
  header: string | null,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): SignatureVerification {
  if (!header) return { ok: false, reason: "MALFORMED" };

  let timestamp: number | null = null;
  const candidates: string[] = [];

  for (const part of header.split(",")) {
    const [name, value] = part.split("=", 2);
    if (!name || value === undefined) continue;
    if (name.trim() === "t") timestamp = Number(value.trim());
    if (name.trim() === "v1") candidates.push(value.trim());
  }

  if (timestamp === null || !Number.isFinite(timestamp) || candidates.length === 0) {
    return { ok: false, reason: "MALFORMED" };
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "STALE" };

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  for (const candidate of candidates) {
    const offered = Buffer.from(candidate, "utf8");
    // Length is checked first because timingSafeEqual throws on a mismatch, and
    // a differing length reveals nothing an attacker does not already know.
    if (offered.length !== expectedBuffer.length) continue;
    if (timingSafeEqual(offered, expectedBuffer)) return { ok: true };
  }

  return { ok: false, reason: "MISMATCH" };
}

/** Last six characters, for showing which secret is in force. */
export function secretHint(secret: string): string {
  return secret.slice(-6);
}
