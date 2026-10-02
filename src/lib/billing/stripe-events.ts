/**
 * The pure decisions the Stripe webhook makes about invoices, Checkout
 * sessions and disputes (gap audit 15, batch 2). No `server-only`, no Stripe
 * SDK, no I/O: `tests/stripe-webhook-dunning.test.ts` imports this directly,
 * so every rule below is asserted without a network or a database.
 *
 * ## The rules
 *
 * 1. **Only the subscription governs access.** A failed ONE-OFF payment (an AI
 *    token pack, an SMS or WhatsApp top-up, a voice minute pack, a manual
 *    invoice) never moves the workspace to PAST_DUE and never opens dunning.
 *    The purchase simply stays unpaid and grants nothing. Only an invoice
 *    that bills the subscription (`billing_reason` subscription_*) is dunned.
 *
 * 2. **Add-on items follow the subscription.** The Pro voice item and the
 *    dedicated-number item are items ON the subscription, so they are billed
 *    on its invoice and dunned with it: full use in the grace days, paused
 *    with sending from day 3, gone when the subscription is cancelled.
 *
 * 3. **SCA and delayed payment methods.** `invoice.payment_action_required`
 *    (3-D Secure on a renewal) tells the owner to authenticate on Stripe's
 *    hosted invoice page; it changes no access by itself (the failure, if
 *    any, arrives as `invoice.payment_failed`). A Checkout session paid by a
 *    delayed method completes with `payment_status: "unpaid"` and grants
 *    nothing; `checkout.session.async_payment_succeeded` is then applied
 *    exactly like a paid `checkout.session.completed` (every grant is keyed
 *    on the session or purchase, so it credits once), and
 *    `checkout.session.async_payment_failed` marks the purchase FAILED and
 *    tells the owner.
 */

/** The fields of a Stripe invoice these rules read. */
export type InvoiceFacts = {
  id?: string | null;
  billing_reason?: string | null;
  subscriptionId: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
};

/** `billing_reason` values that bill the subscription itself. */
export const SUBSCRIPTION_BILLING_REASONS = [
  "subscription_create",
  "subscription_cycle",
  "subscription_update",
  "subscription_threshold",
  // Older API versions label a subscription's own invoice this way.
  "subscription",
] as const;

/**
 * Whether an invoice bills the subscription (and so may be dunned and may
 * move the workspace to PAST_DUE). An invoice with no subscription is always
 * one-off. One linked to a subscription but raised by hand (`manual`) is a
 * one-off charge too: failing it must not lock anyone out.
 */
export function isSubscriptionInvoice(invoice: InvoiceFacts): boolean {
  if (!invoice.subscriptionId) return false;
  const reason = invoice.billing_reason ?? null;
  // No reason on the payload (a very old API version): the subscription link
  // is all there is, and it is a subscription invoice.
  if (reason === null) return true;
  return (SUBSCRIPTION_BILLING_REASONS as readonly string[]).includes(reason);
}

export type InvoiceFailureDecision =
  | { action: "dun"; subscriptionId: string }
  | { action: "ignore"; reason: "one_off" | "no_invoice" };

/** What `invoice.payment_failed` should do. */
export function invoiceFailureDecision(invoice: InvoiceFacts): InvoiceFailureDecision {
  if (!invoice.id) return { action: "ignore", reason: "no_invoice" };
  if (!isSubscriptionInvoice(invoice) || !invoice.subscriptionId) {
    return { action: "ignore", reason: "one_off" };
  }
  return { action: "dun", subscriptionId: invoice.subscriptionId };
}

/* ------------------------------------------------------------ checkout */

/** Checkout events the webhook handles, and what each one means. */
export type CheckoutEventMeaning =
  /** Money has moved (or the session needed none): grant. */
  | "grant"
  /** The session closed without payment: expire the pending purchase. */
  | "expire"
  /** A delayed payment method failed: fail the purchase, tell the owner. */
  | "async_failed";

export function checkoutEventMeaning(type: string): CheckoutEventMeaning | null {
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return "grant";
    case "checkout.session.expired":
      return "expire";
    case "checkout.session.async_payment_failed":
      return "async_failed";
    default:
      return null;
  }
}

/**
 * `async_payment_succeeded` carries the same session, now with
 * `payment_status: "paid"`. Re-labelled as `checkout.session.completed` it
 * runs through exactly the handlers a card payment does. Each is idempotent
 * on its purchase or session id, so a session that was somehow already
 * credited is not credited again.
 */
export function asCompletedCheckoutEvent<T extends { type: string }>(event: T): T {
  if (event.type !== "checkout.session.async_payment_succeeded") return event;
  return { ...event, type: "checkout.session.completed" };
}

/** Metadata kinds a one-off top-up Checkout carries (checkout.ts, token-actions.ts, voice-purchase.ts). */
export const ONE_OFF_CHECKOUT_KINDS = ["ai_tokens", "message_credits", "voice_pack"] as const;
export type OneOffCheckoutKind = (typeof ONE_OFF_CHECKOUT_KINDS)[number];

export function oneOffKindOf(metadataKind: string | null | undefined): OneOffCheckoutKind | null {
  return (ONE_OFF_CHECKOUT_KINDS as readonly string[]).includes(metadataKind ?? "")
    ? (metadataKind as OneOffCheckoutKind)
    : null;
}

const ONE_OFF_LABEL: Record<OneOffCheckoutKind, string> = {
  ai_tokens: "AI credit pack",
  message_credits: "top-up",
  voice_pack: "voice minute pack",
};

/** The owner notice for a delayed one-off payment that failed. */
export function asyncPaymentFailedNotice(kind: OneOffCheckoutKind): { title: string; body: string } {
  const label = ONE_OFF_LABEL[kind];
  return {
    title: `Your ${label} payment did not go through`,
    body:
      `The bank payment for your ${label} failed, so nothing was added to your balance and you have not been charged. ` +
      "Your subscription and everything else are unaffected. Buy the pack again from Billing to retry.",
  };
}

/** The owner notice when a renewal needs 3-D Secure (SCA). */
export function actionRequiredNotice(input: { hostedInvoiceUrl: string | null; amountDueMinor: number | null; currency: string | null }): {
  title: string;
  body: string;
  linkUrl: string;
} {
  const amount =
    input.amountDueMinor === null
      ? "your subscription payment"
      : new Intl.NumberFormat("en-GB", { style: "currency", currency: (input.currency ?? "gbp").toUpperCase() }).format(
          input.amountDueMinor / 100,
        );
  return {
    title: "Your bank needs you to confirm a payment",
    body:
      `Your card issuer asked for authentication (3-D Secure) before we can take ${amount}. ` +
      "Open the secure Stripe page to confirm it. Nothing is paused yet; if it stays unconfirmed, the usual failed-payment steps apply.",
    linkUrl: input.hostedInvoiceUrl ?? "/api/billing/portal",
  };
}

/* ------------------------------------------------------------ invoice amounts */

/** A Stripe invoice's amounts, as the webhook stores them (`billing_invoices`). */
export type InvoiceAmounts = {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalExcludingTaxMinor: number;
  amountPaidMinor: number;
};

type AmountList = readonly { amount?: number | null }[] | null | undefined;

function sumAmounts(list: AmountList): number {
  return (list ?? []).reduce((total, entry) => total + Math.max(0, Number(entry?.amount ?? 0)), 0);
}

/**
 * Reads the amounts off an invoice payload across Stripe API versions:
 * `total_discount_amounts` and `total_taxes` (newer) or `tax` (older). Every
 * figure is minor units, never negative.
 */
export function invoiceAmounts(invoice: {
  currency?: string | null;
  subtotal?: number | null;
  total?: number | null;
  total_excluding_tax?: number | null;
  amount_paid?: number | null;
  tax?: number | null;
  total_discount_amounts?: AmountList;
  total_taxes?: AmountList;
}): InvoiceAmounts {
  const taxMinor = invoice.total_taxes ? sumAmounts(invoice.total_taxes) : Math.max(0, Number(invoice.tax ?? 0));
  const total = Math.max(0, Number(invoice.total ?? 0));
  const totalExcludingTax =
    invoice.total_excluding_tax != null ? Math.max(0, Number(invoice.total_excluding_tax)) : Math.max(0, total - taxMinor);
  return {
    currency: (invoice.currency ?? "gbp").toLowerCase(),
    subtotalMinor: Math.max(0, Number(invoice.subtotal ?? 0)),
    discountMinor: sumAmounts(invoice.total_discount_amounts),
    taxMinor,
    totalExcludingTaxMinor: totalExcludingTax,
    amountPaidMinor: Math.max(0, Number(invoice.amount_paid ?? 0)),
  };
}

/**
 * Monthly recurring revenue from a paid subscription invoice: what the
 * customer actually pays per month, after discounts and coupons and before
 * VAT (VAT is not revenue). Annual invoices are divided by 12.
 *
 * Only a full-period invoice can set MRR: `subscription_create` (the first
 * paid period) and `subscription_cycle` (a renewal). A proration invoice
 * (`subscription_update`) is a part-period adjustment, and a £0 trial invoice
 * says nothing about the price; both return null so the stored MRR is left
 * as it was.
 */
export function mrrMinorFromInvoice(input: {
  billingReason: string | null | undefined;
  amounts: InvoiceAmounts;
  interval: "month" | "year" | string | null | undefined;
}): number | null {
  if (input.billingReason !== "subscription_create" && input.billingReason !== "subscription_cycle") return null;
  const net = input.amounts.totalExcludingTaxMinor;
  if (net <= 0) return null;
  return input.interval === "year" ? Math.round(net / 12) : net;
}

/* ------------------------------------------------------------ disputes */

export type DisputeOutcome = "open" | "won" | "lost";

/**
 * A dispute's status as the clawback cares about it. Stripe's statuses:
 * warning_needs_response, warning_under_review, warning_closed,
 * needs_response, under_review, won, lost (and `prevented` on some methods).
 * An inquiry closed in our favour (`warning_closed`) and a prevented dispute
 * are wins: the money stays, so anything clawed back is restored.
 */
export function disputeOutcome(status: string | null | undefined): DisputeOutcome {
  switch (status) {
    case "won":
    case "warning_closed":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    default:
      return "open";
  }
}

/**
 * The amount a dispute claws back against, for the FIFO reversal. A dispute
 * reverses the purchase in proportion to the disputed amount, exactly as a
 * refund of that amount would (refundability.ts `refundReversalAmount`): a
 * full-amount dispute takes back every still-unused unit of the purchase and
 * never anything already used.
 */
export function disputeClawbackAmount(input: { disputedMinor: number | null | undefined; chargeAmountMinor: number | null | undefined }): number {
  const disputed = Math.max(0, Number(input.disputedMinor ?? 0));
  const charged = Math.max(0, Number(input.chargeAmountMinor ?? 0));
  if (charged > 0) return Math.min(disputed, charged);
  return disputed;
}

/** Idempotency keys: one clawback and one restore per dispute, ever. */
export function disputeReversalKey(disputeId: string): string {
  return `dispute:${disputeId}`;
}

export function disputeRestoreKey(disputeId: string): string {
  return `dispute_won:${disputeId}`;
}

export function disputeNotice(input: {
  outcome: DisputeOutcome;
  kindLabel: string;
  reversedUnits: number;
  unitLabel: string;
}): { title: string; body: string; severity: "warning" | "error" | "info" } {
  const units = `${input.reversedUnits.toLocaleString("en-GB")} unused ${input.unitLabel}`;
  if (input.outcome === "won") {
    return {
      severity: "info",
      title: "Payment dispute closed in your favour",
      body:
        input.reversedUnits > 0
          ? `The dispute on your ${input.kindLabel} was resolved, so the ${units} held back have been returned to your balance.`
          : `The dispute on your ${input.kindLabel} was resolved. Nothing had been held back.`,
    };
  }
  if (input.outcome === "lost") {
    return {
      severity: "error",
      title: "Payment dispute closed",
      body: `The dispute on your ${input.kindLabel} was decided against the payment. The ${units} removed when it opened stay removed.`,
    };
  }
  return {
    severity: "warning",
    title: "A payment was disputed with your bank",
    body:
      input.reversedUnits > 0
        ? `A payment for your ${input.kindLabel} is being disputed, so its ${units} have been held back from your balance. They come back if the dispute closes in the payment's favour.`
        : `A payment for your ${input.kindLabel} is being disputed. No unused balance was left to hold back.`,
  };
}

/* ------------------------------------------------------------ deploy safety */

/**
 * A Postgres/PostgREST error meaning "that table or column does not exist
 * yet": migration 0165 not applied. The billing batch-2 writers treat it as
 * "skip and log" so shipping the code before the migration never fails a
 * Stripe event that the rest of the webhook handles correctly.
 */
export function isSchemaMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || code === "PGRST202") return true;
  return /does not exist|could not find the (table|function)|schema cache/i.test(error.message ?? "");
}
