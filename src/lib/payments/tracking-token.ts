/**
 * Checkout tracking tokens (payments/tracking.ts). Pure apart from
 * `node:crypto`; kept apart so the rest of the tracking rules stay
 * browser-safe for the settings form.
 */

import { createHmac, randomBytes } from "node:crypto";

/** 18 random bytes, base64url: 24 characters from Stripe's permitted alphabet. */
export function newCheckoutToken(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * A token derived from the send key under a server secret. The same send key
 * always yields the same token, so a retried turn that re-queues the same
 * message (the send key dedupes it) records the same token as the text that
 * actually went out. HMAC output is unguessable without the secret and says
 * nothing about the lead.
 */
export function derivedCheckoutToken(secret: string, sendKey: string): string {
  return createHmac("sha256", `checkout-ref:${secret}`).update(sendKey, "utf8").digest("base64url").slice(0, 24);
}
