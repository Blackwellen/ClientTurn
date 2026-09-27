/**
 * Public quote access tokens (/q/[token]).
 *
 * Scheme:
 *   - 32 random bytes from the OS CSPRNG (256 bits), base64url without
 *     padding = 43 characters. The raw token exists only in the link sent
 *     to the customer; it is never stored or logged.
 *   - At rest: SHA-256(token) as lower-case hex in
 *     `quote_access_tokens.token_hash` (unique). A leaked table gives no
 *     working link. SHA-256 without a salt is sufficient because the input
 *     is 256 bits of randomness, not a guessable password.
 *   - Lookup is by hash; the stored hash is then compared again in
 *     constant time, so no timing difference depends on a partial match.
 *   - Every token is bound to one revision, carries an expiry, and is
 *     revoked when that revision is superseded (REVISE) or withdrawn.
 *   - Every failure returns the same public result ("not available"), so a
 *     caller cannot tell a wrong token from an expired or revoked one. The
 *     detailed reason is for server logs only (never the token itself).
 *
 * The page reads through a security-definer RPC that takes the HASH and
 * returns customer-facing fields only (13-quote-schema-draft.sql).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_BYTES = 32;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type IssuedToken = {
  /** Goes in the link only. Never persisted. */
  token: string;
  /** Persisted. */
  tokenHash: string;
  revisionId: string;
  expiresAt: string;
};

export type StoredToken = {
  tokenHash: string;
  revisionId: string;
  expiresAt: string;
  revokedAt: string | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generatePublicToken(input: { revisionId: string; expiresAt: string }, random: (n: number) => Buffer = randomBytes): IssuedToken {
  const bytes = random(TOKEN_BYTES);
  if (bytes.length < TOKEN_BYTES) throw new Error("Token randomness too short.");
  const token = Buffer.from(bytes).toString("base64url");
  return { token, tokenHash: hashToken(token), revisionId: input.revisionId, expiresAt: input.expiresAt };
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (!HASH_PATTERN.test(a) || !HASH_PATTERN.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export type TokenCheckReason = "MALFORMED" | "UNKNOWN" | "MISMATCH" | "REVOKED" | "EXPIRED" | "SUPERSEDED";

export type TokenCheck =
  | { ok: true; revisionId: string }
  | { ok: false; reason: TokenCheckReason; publicMessage: string };

export const TOKEN_UNAVAILABLE_MESSAGE = "This quote link is not available. Ask the sender for a new link.";

function refuse(reason: TokenCheckReason): TokenCheck {
  return { ok: false, reason, publicMessage: TOKEN_UNAVAILABLE_MESSAGE };
}

/**
 * Verify a presented token against the row found by its hash (or null when
 * the lookup found nothing). `currentRevisionId`, when given, refuses a
 * token for a revision that is no longer the quote's current one.
 */
export function verifyPublicToken(
  presented: string,
  stored: StoredToken | null,
  now: string,
  currentRevisionId?: string,
): TokenCheck {
  if (typeof presented !== "string" || !TOKEN_PATTERN.test(presented)) return refuse("MALFORMED");
  const presentedHash = hashToken(presented);
  if (!stored) return refuse("UNKNOWN");
  if (!constantTimeEqualHex(presentedHash, stored.tokenHash)) return refuse("MISMATCH");
  if (stored.revokedAt !== null) return refuse("REVOKED");
  if (Date.parse(now) >= Date.parse(stored.expiresAt)) return refuse("EXPIRED");
  if (currentRevisionId !== undefined && currentRevisionId !== stored.revisionId) return refuse("SUPERSEDED");
  return { ok: true, revisionId: stored.revisionId };
}

/** Revocation on revision: every live token of the superseded revision is revoked at `now`. */
export function revokeForRevision(tokens: readonly StoredToken[], supersededRevisionId: string, now: string): StoredToken[] {
  return tokens.map((token) =>
    token.revisionId === supersededRevisionId && token.revokedAt === null ? { ...token, revokedAt: now } : token,
  );
}

/** Token expiry: the quote's validity plus a grace period to view (never sign) an expired quote. */
export function tokenExpiry(validUntil: string, graceDays = 30): string {
  const at = new Date(Date.parse(validUntil));
  at.setUTCDate(at.getUTCDate() + graceDays);
  return at.toISOString();
}
