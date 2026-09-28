import "server-only";
import { disputeOutcome } from "@/lib/billing/stripe-events";
import {
  reaccrueDisputedCommission,
  reverseInvoiceCommission,
} from "./commissions";
import type { AffiliateBillingEvent } from "./billing-event-rules";

/**
 * The `affiliate.billing_event` job (audit 17 §2): a refund, an opened
 * dispute or a closed dispute, applied to the commission ledger off the
 * webhook request.
 *
 * Retry-safe: every ledger write is keyed (see `commissions.ts`), and the
 * invoice is re-resolved on each attempt.
 */

export type InvoiceResolver = (input: {
  invoiceId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
}) => Promise<string | null>;

/**
 * The default resolver: the id the event carried, else Stripe's invoice
 * payments for the PaymentIntent (reading the charge first if only that is
 * known). Stripe is called here, in the job, never in the webhook.
 */
export async function stripeInvoiceResolver(input: {
  invoiceId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
}): Promise<string | null> {
  if (input.invoiceId) return input.invoiceId;
  const { stripe } = await import("@/lib/billing/stripe");
  let paymentIntent = input.paymentIntentId;
  if (!paymentIntent && input.chargeId) {
    const charge = await stripe.charges.retrieve(input.chargeId);
    const legacy = (charge as unknown as { invoice?: unknown }).invoice;
    if (typeof legacy === "string") return legacy;
    paymentIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  }
  if (!paymentIntent) return null;
  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntent },
    limit: 1,
  });
  const invoice = payments.data[0]?.invoice;
  return typeof invoice === "string" ? invoice : (invoice?.id ?? null);
}

export type BillingEventOutcome =
  | { status: "no_invoice" }
  | { status: "reversed"; reversedMinor: number }
  | { status: "reaccrued"; rows: number }
  | { status: "nothing" };

export async function applyAffiliateBillingEvent(
  event: AffiliateBillingEvent,
  resolve: InvoiceResolver = stripeInvoiceResolver,
): Promise<BillingEventOutcome> {
  if (event.kind === "dispute_closed") {
    // Only a WIN changes the ledger: a lost dispute keeps its reversal.
    if (disputeOutcome(event.status ?? "") !== "won") return { status: "nothing" };
    const rows = await reaccrueDisputedCommission({ disputeId: event.disputeId });
    return { status: "reaccrued", rows };
  }

  const invoiceId = await resolve({
    invoiceId: event.invoiceId,
    paymentIntentId: event.paymentIntentId,
    chargeId: event.chargeId,
  });
  if (!invoiceId) return { status: "no_invoice" };

  if (event.kind === "refund") {
    const result = await reverseInvoiceCommission({
      invoiceId,
      reason: "REFUND",
      sourceRef: `refund:${event.chargeId}`,
      cumulativeMinor: event.amountRefundedMinor,
      grossPaidMinor: event.chargeAmountMinor,
    });
    return result.status === "reversed" ? { status: "reversed", reversedMinor: result.reversedMinor } : { status: "nothing" };
  }

  const result = await reverseInvoiceCommission({
    invoiceId,
    reason: "CHARGEBACK",
    sourceRef: `dispute:${event.disputeId}`,
    cumulativeMinor: event.disputedMinor,
  });
  return result.status === "reversed" ? { status: "reversed", reversedMinor: result.reversedMinor } : { status: "nothing" };
}
