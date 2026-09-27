/**
 * Send-key markers for the direct-sale loop. Pure, dependency-free, so the
 * send guard (jobs/send-core.ts) can read them.
 *
 * `payment-thanks:<payment id>` marks the thank-you queued once a payment is
 * confirmed. The guard lets it through WON (the payment is what made the lead
 * WON) and the paused flag (closing the deal switches follow-up off) -- for
 * `system` origin only. Opt-out, suppression, human takeover, channel health,
 * quiet hours and the policy gate all still bind.
 */

export const PAYMENT_THANKS_SEND_KEY_PREFIX = "payment-thanks:";

export function paymentThanksSendKey(paymentId: string): string {
  return `${PAYMENT_THANKS_SEND_KEY_PREFIX}${paymentId}`;
}

export function isPaymentThanksSendKey(sendKey: string | null | undefined): boolean {
  return Boolean(sendKey && sendKey.startsWith(PAYMENT_THANKS_SEND_KEY_PREFIX));
}
