import { createHash, createHmac } from "node:crypto";

/**
 * The parts of referral attribution that are pure functions of their input
 * (V4 §31).
 *
 * Split out from `attribution.ts` — which imports `server-only` and
 * `next/headers` — so the cookie codec, the visitor hash and the bot filter can
 * be tested directly. These decide who gets paid, so they need tests that do
 * not require a running request.
 *
 * The signing secret is passed in rather than read from the environment here,
 * which is what keeps this module free of `server-only`.
 */

export type ReferralCookie = {
  affiliateId: string;
  linkId: string | null;
  clickedAt: string;
  expiresAt: string;
};

/** Upper bound on how long a referral cookie may live, whatever a plan says. */
export const MAX_COOKIE_DAYS = 90;

export const REFERRAL_COOKIE_NAME = "ct_ref";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function serialiseCookie(secret: string, value: ReferralCookie): string {
  const payload = [
    value.affiliateId,
    value.linkId ?? "",
    value.clickedAt,
    value.expiresAt,
  ].join("|");
  return `${Buffer.from(payload).toString("base64url")}.${sign(secret, payload)}`;
}

/**
 * Parses and verifies a referral cookie.
 *
 * Returns null for anything suspect — an unsigned value, a forged signature, a
 * malformed payload or an expired window. A cookie decides who earns a
 * commission, so every failure is silent refusal rather than partial trust.
 */
export function parseCookie(
  secret: string,
  raw: string | undefined,
  now: number = Date.now(),
): ReferralCookie | null {
  if (!raw) return null;

  const lastDot = raw.lastIndexOf(".");
  if (lastDot < 0) return null;

  let payload: string;
  try {
    payload = Buffer.from(raw.slice(0, lastDot), "base64url").toString("utf8");
  } catch {
    return null;
  }

  if (sign(secret, payload) !== raw.slice(lastDot + 1)) return null;

  const [affiliateId, linkId, clickedAt, expiresAt] = payload.split("|");
  if (!affiliateId || !clickedAt || !expiresAt) return null;

  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= now) return null;

  return { affiliateId, linkId: linkId || null, clickedAt, expiresAt };
}

/**
 * A stable, non-reversible identifier for a visitor.
 *
 * The IP and user agent are hashed together with a server-side salt and never
 * stored in the clear. Two visitors behind the same NAT collide, which is
 * acceptable: this is a de-duplication key for click counting, not an identity.
 */
export function visitorHash(
  secret: string,
  ip: string,
  userAgent: string,
): string {
  return createHash("sha256")
    .update(`${secret}:${ip}:${userAgent}`)
    .digest("hex")
    .slice(0, 40);
}

/**
 * Obvious non-humans, kept out of the attribution record.
 *
 * Deliberately conservative — a real person misclassified as a bot costs their
 * referrer a commission, which is worse than counting a crawler. Flagged clicks
 * are still stored (`is_bot`), so an affiliate's click count and our own
 * traffic analysis can disagree honestly rather than silently.
 */
export function looksAutomated(userAgent: string): boolean {
  if (!userAgent.trim()) return true;
  return /bot|crawler|spider|crawl|slurp|curl|wget|python-requests|headless|preview|monitor|scrape/i.test(
    userAgent,
  );
}

/** Clamps a plan's cookie window to something we are willing to honour. */
export function clampCookieDays(days: number): number {
  if (!Number.isFinite(days)) return 1;
  return Math.min(Math.max(Math.floor(days), 1), MAX_COOKIE_DAYS);
}
