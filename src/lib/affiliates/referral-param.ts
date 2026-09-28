/**
 * The referral as a URL parameter (owner decision 2026-09-28).
 *
 * Browser-safe (no `node:crypto`), so the page's `ReferralCapture` and the
 * server share one definition. Signing and verifying stay server-side in
 * `attribution-core.ts` / `attribution.ts`.
 *
 * The `ct_ref` COOKIE is an affiliate-tracking cookie, which the ICO treats
 * as not strictly necessary, so it is set only after the visitor accepts
 * non-essential cookies (the site's banner, `lib/marketing/consent.ts`). `/r`
 * therefore does not set it: it carries the same signed value in the landing
 * URL as `?ct_ref=`. Without consent that parameter is carried from page to
 * page and into signup in the same visit, in the URL only, with no storage
 * on the device. With consent, `/api/affiliates/referral` turns it into the
 * httpOnly cookie. Same value, same signature, same expiry.
 */

export const REFERRAL_PARAM = "ct_ref";

/** Longest signed value `serialiseCookie` can produce, with headroom. */
const MAX_TOKEN_LENGTH = 400;

/** Shape check only (the signature is verified server-side by `parseCookie`). */
export function looksLikeReferralToken(raw: string | null | undefined): raw is string {
  if (!raw || raw.length > MAX_TOKEN_LENGTH) return false;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw);
}

/** Adds (or replaces) the referral parameter on a same-site path or URL. */
export function withReferralParam(href: string, token: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.searchParams.set(REFERRAL_PARAM, token);
  return url.pathname + url.search + url.hash;
}
