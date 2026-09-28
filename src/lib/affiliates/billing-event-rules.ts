/**
 * What the Stripe webhook hands the affiliate ledger for a refund or a
 * dispute (affiliate audit 17, §2 and §8).
 *
 * Pure: the webhook only verifies, records and enqueues. It must never call
 * Stripe inside the request (CLAUDE.md), and the old chargeback path did
 * (`stripe.charges.retrieve`). The payload below is everything the job needs;
 * the job resolves the invoice (and may call Stripe, which is allowed there).
 *
 * The invoice id is read from the charge where the event's API version still
 * carries it; newer versions (2025-03-31 onwards) removed `charge.invoice`,
 * which is why the job falls back to the invoice payments of the
 * PaymentIntent. Before this, a refund on a current API version never
 * reversed any commission, because the invoice id was simply absent.
 */

export type AffiliateBillingEvent =
  | {
      kind: "refund";
      eventId: string;
      chargeId: string;
      paymentIntentId: string | null;
      invoiceId: string | null;
      /** Cumulative across every refund of this charge. */
      amountRefundedMinor: number;
      chargeAmountMinor: number | null;
    }
  | {
      kind: "dispute_opened" | "dispute_closed";
      eventId: string;
      disputeId: string;
      chargeId: string | null;
      paymentIntentId: string | null;
      invoiceId: string | null;
      disputedMinor: number;
      status: string | null;
    };

/** Top-up charges never earned commission; their own refund handlers own them. */
const NON_COMMISSION_KINDS = new Set(["ai_tokens", "message_credits", "voice_pack"]);

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function refundEvent(eventId: string, charge: unknown): AffiliateBillingEvent | null {
  const c = charge as {
    id?: string;
    amount?: number;
    amount_refunded?: number;
    metadata?: Record<string, string> | null;
    payment_intent?: unknown;
    invoice?: unknown;
  };
  if (!c?.id) return null;
  if (c.metadata?.kind && NON_COMMISSION_KINDS.has(c.metadata.kind)) return null;
  const refunded = Math.max(0, Number(c.amount_refunded ?? 0));
  if (refunded <= 0) return null;
  return {
    kind: "refund",
    eventId,
    chargeId: c.id,
    paymentIntentId: idOf(c.payment_intent),
    invoiceId: idOf(c.invoice),
    amountRefundedMinor: refunded,
    chargeAmountMinor: typeof c.amount === "number" ? c.amount : null,
  };
}

export function disputeEvent(
  eventId: string,
  type: "charge.dispute.created" | "charge.dispute.closed",
  dispute: unknown,
): AffiliateBillingEvent | null {
  const d = dispute as { id?: string; amount?: number; status?: string; charge?: unknown; payment_intent?: unknown };
  if (!d?.id) return null;
  const charge = d.charge as { invoice?: unknown } | string | null | undefined;
  return {
    kind: type === "charge.dispute.created" ? "dispute_opened" : "dispute_closed",
    eventId,
    disputeId: d.id,
    chargeId: idOf(d.charge),
    paymentIntentId: idOf(d.payment_intent),
    invoiceId: charge && typeof charge === "object" ? idOf(charge.invoice) : null,
    disputedMinor: Math.max(0, Number(d.amount ?? 0)),
    status: d.status ?? null,
  };
}

/** The job's dedupe key: one ledger pass per Stripe event. */
export function billingEventJobKey(event: AffiliateBillingEvent): string {
  return `affiliate.billing_event:${event.eventId}`;
}
