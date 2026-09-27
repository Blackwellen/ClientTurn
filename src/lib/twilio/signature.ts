/**
 * The Twilio request signature, in one place. Pure (node:crypto only), with no
 * `server-only` marker, so the SMS webhook, the voice webhooks, the voice
 * protocol module and the tests all share exactly one implementation.
 *
 * Algorithm (Twilio security docs): HMAC-SHA1 over the full URL Twilio posted
 * to, with every POST parameter appended as key + value in sorted key order,
 * base64 encoded, keyed by the AUTH TOKEN of the account that owns the number.
 * Never an API key secret (gap map F7): an `SK…` secret verifies nothing, and
 * every callback would be refused with 403.
 *
 * Previously duplicated in `messaging/twilio.ts` and
 * `voice/providers/twilio-protocol.ts`; both now import from here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/**
 * Constant-time comparison of the `X-Twilio-Signature` header against the
 * expected value. A missing signature or a missing token is a refusal, never a
 * pass: no token means verification is impossible.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined,
): boolean {
  if (!signature || !authToken) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** An `application/x-www-form-urlencoded` body as a flat record (last value wins). */
export function formToRecord(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) out[key] = value;
  return out;
}
