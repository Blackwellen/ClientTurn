/**
 * Payment facts: what a provider told us, normalised, and how it is matched
 * to a lead (the direct-sale loop, step 2).
 *
 * Pure: zod only. Every provider shape is read defensively here and nowhere
 * else, so the webhook routes stay thin and the rules are asserted by
 * tests/direct-sale.test.ts with fixtures.
 *
 * ## Matching, strongest first
 *
 *   1. TOKEN -- the tracking token we put in the link came back
 *      (`client_reference_id` on Stripe, `reference` on the order-paid
 *      webhook) and names a checkout attempt in THIS workspace. Certain:
 *      applied automatically.
 *   2. SUBSCRIPTION -- a renewal of a subscription whose first payment is
 *      already matched to a lead. Recorded against that lead as revenue; no
 *      second WON, no second thank-you.
 *   3. EMAIL -- exactly one live lead in the workspace has the paying email.
 *      Lower confidence (a shared inbox, a colleague paying): recorded as
 *      REVIEW and applied only when a person confirms it.
 *   4. NONE -- UNMATCHED, shown to the owner to link by hand. Never dropped.
 */

import { z } from "zod";

export const BILLING_INTERVALS = ["day", "week", "month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const ORDER_PAID_SOURCES = ["shopify", "woocommerce", "gocardless", "paddle", "zapier", "other"] as const;

export type PaymentFact = {
  provider: "stripe" | "order_paid";
  /** order_paid only: where the order came from. */
  source: string | null;
  /** The provider's event id: (provider, event id) is the first idempotency key. */
  eventId: string;
  eventType: string;
  /** The order / session / subscription id: (workspace, provider, order id) is the second. */
  orderId: string;
  /** Our tracking token, when it came back. */
  reference: string | null;
  email: string | null;
  amountMinor: number;
  currency: string;
  recurring: boolean;
  interval: BillingInterval | null;
  intervalCount: number;
  subscriptionId: string | null;
  paidAt: string;
};

/** Currencies with no minor unit (Stripe's list, the common ones). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
}

export function toMinorUnits(major: number, currency: string): number {
  return Math.round(major * minorUnitFactor(currency));
}

export function toMajorUnits(minor: number, currency: string): number {
  return minor / minorUnitFactor(currency);
}

/**
 * Monthly recurring revenue for one payment, in minor units. Null for a
 * one-off payment or an unknown interval (never guessed).
 */
export function mrrMinor(input: {
  amountMinor: number;
  recurring: boolean;
  interval: BillingInterval | null;
  intervalCount?: number;
}): number | null {
  if (!input.recurring || !input.interval) return null;
  const count = Math.max(1, input.intervalCount ?? 1);
  const perInterval = input.amountMinor / count;
  switch (input.interval) {
    case "month":
      return Math.round(perInterval);
    case "year":
      return Math.round(perInterval / 12);
    case "week":
      return Math.round((perInterval * 52) / 12);
    case "day":
      return Math.round((perInterval * 365) / 12);
  }
}

/** Only a value that could be ours is treated as a token; anything else is noise. */
export function tokenFrom(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value.trim()) ? value.trim() : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return str(value);
  if (value && typeof value === "object") return str((value as { id?: unknown }).id);
  return null;
}

function emailOf(value: unknown): string | null {
  const text = str(value);
  return text && z.email().safeParse(text).success ? text.toLowerCase() : null;
}

function intervalOf(value: unknown): BillingInterval | null {
  return (BILLING_INTERVALS as readonly string[]).includes(String(value)) ? (value as BillingInterval) : null;
}

/* ------------------------------------------------------------------ Stripe */

export const STRIPE_PAYMENT_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
] as const;

export type NormaliseResult =
  | { kind: "fact"; fact: PaymentFact }
  | { kind: "ignore"; reason: string };

/**
 * A verified Stripe event from the customer's own account, as a payment
 * fact. `checkout.session.completed` with an unpaid session (a bank debit
 * still clearing) is ignored: its `async_payment_succeeded` follows.
 */
export function stripePaymentFact(event: unknown): NormaliseResult {
  if (!event || typeof event !== "object") return { kind: "ignore", reason: "not an event" };
  const e = event as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: unknown } };
  const eventId = str(e.id);
  const type = str(e.type);
  if (!eventId || !type) return { kind: "ignore", reason: "not an event" };
  if (!(STRIPE_PAYMENT_EVENTS as readonly string[]).includes(type)) return { kind: "ignore", reason: `unhandled ${type}` };
  const object = (e.data?.object ?? {}) as Record<string, unknown>;
  const created = typeof e.created === "number" ? new Date(e.created * 1000).toISOString() : new Date().toISOString();

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    const paymentStatus = str(object.payment_status);
    if (type === "checkout.session.completed" && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
      return { kind: "ignore", reason: `payment_status ${paymentStatus ?? "unknown"}` };
    }
    const currency = str(object.currency)?.toUpperCase();
    const amount = typeof object.amount_total === "number" ? object.amount_total : null;
    if (!currency || amount === null) return { kind: "ignore", reason: "no amount" };
    const sessionId = idOf(object.id);
    if (!sessionId) return { kind: "ignore", reason: "no session id" };
    const subscriptionId = object.mode === "subscription" ? idOf(object.subscription) : null;
    const details = (object.customer_details ?? {}) as Record<string, unknown>;
    return {
      kind: "fact",
      fact: {
        provider: "stripe",
        source: "stripe",
        eventId,
        eventType: type,
        // A subscription's order is the subscription: its first invoice.paid
        // (subscription_create) then collapses onto the same row.
        orderId: subscriptionId ?? sessionId,
        reference: tokenFrom(object.client_reference_id),
        email: emailOf(details.email) ?? emailOf(object.customer_email),
        amountMinor: amount,
        currency,
        recurring: object.mode === "subscription",
        interval: null,
        intervalCount: 1,
        subscriptionId,
        paidAt: created,
      },
    };
  }

  // invoice.paid
  const currency = str(object.currency)?.toUpperCase();
  const amount = typeof object.amount_paid === "number" ? object.amount_paid : null;
  const invoiceId = idOf(object.id);
  if (!currency || amount === null || !invoiceId) return { kind: "ignore", reason: "no amount" };
  if (amount === 0) return { kind: "ignore", reason: "zero-amount invoice" };
  const parent = (object.parent ?? {}) as { subscription_details?: { subscription?: unknown } };
  const subscriptionId = idOf(object.subscription) ?? idOf(parent.subscription_details?.subscription);
  const line = (((object.lines as { data?: unknown[] } | undefined)?.data ?? [])[0] ?? {}) as Record<string, unknown>;
  const price = (line.price ?? {}) as { recurring?: { interval?: unknown; interval_count?: unknown } };
  const plan = (line.plan ?? {}) as { interval?: unknown; interval_count?: unknown };
  const interval = intervalOf(price.recurring?.interval) ?? intervalOf(plan.interval);
  const intervalCount = Number(price.recurring?.interval_count ?? plan.interval_count ?? 1) || 1;
  const billingReason = str(object.billing_reason);
  const statusTransitions = (object.status_transitions ?? {}) as { paid_at?: unknown };
  return {
    kind: "fact",
    fact: {
      provider: "stripe",
      source: "stripe",
      eventId,
      eventType: type,
      orderId: subscriptionId && billingReason === "subscription_create" ? subscriptionId : invoiceId,
      reference: tokenFrom((object.metadata as Record<string, unknown> | undefined)?.client_reference_id),
      email: emailOf(object.customer_email),
      amountMinor: amount,
      currency,
      recurring: Boolean(subscriptionId),
      interval: subscriptionId ? interval : null,
      intervalCount,
      subscriptionId,
      paidAt:
        typeof statusTransitions.paid_at === "number"
          ? new Date(statusTransitions.paid_at * 1000).toISOString()
          : created,
    },
  };
}

/* ------------------------------------------------------- order-paid webhook */

/**
 * The documented body (docs/DEVELOPER_PLATFORM.md, "Order paid"). `amount` is
 * in MAJOR units (49.99), as a number or a numeric string, because that is
 * what Shopify, WooCommerce and Zapier hand you.
 */
export const orderPaidSchema = z.object({
  order_id: z.string().trim().min(1).max(200),
  event_id: z.string().trim().min(1).max(200).optional(),
  reference: z.string().trim().max(200).optional(),
  email: z.email().max(254).optional(),
  amount: z.union([
    z.number().nonnegative().finite(),
    z.string().trim().regex(/^\d+(?:\.\d{1,3})?$/, "amount must be a number like 49.99"),
  ]),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "currency must be a three-letter code"),
  recurring: z.boolean().optional(),
  interval: z.enum(BILLING_INTERVALS).optional(),
  subscription_id: z.string().trim().min(1).max(200).optional(),
  source: z.enum(ORDER_PAID_SOURCES).optional(),
  paid_at: z.iso.datetime({ offset: true }).optional(),
});
export type OrderPaidBody = z.infer<typeof orderPaidSchema>;

export function orderPaidFact(body: OrderPaidBody, now: Date = new Date()): PaymentFact {
  const currency = body.currency.toUpperCase();
  const major = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const recurring = body.recurring === true || Boolean(body.interval);
  return {
    provider: "order_paid",
    source: body.source ?? "other",
    eventId: body.event_id ?? body.order_id,
    eventType: "order.paid",
    orderId: body.order_id,
    reference: tokenFrom(body.reference),
    email: body.email ? body.email.toLowerCase() : null,
    amountMinor: toMinorUnits(major, currency),
    currency,
    recurring,
    interval: recurring ? (body.interval ?? null) : null,
    intervalCount: 1,
    subscriptionId: body.subscription_id ?? null,
    paidAt: body.paid_at ?? now.toISOString(),
  };
}

/* ---------------------------------------------------------------- matching */

export type PaymentMatch =
  | { kind: "TOKEN"; leadId: string; attemptId: string }
  | { kind: "SUBSCRIPTION"; leadId: string }
  | { kind: "EMAIL"; leadId: string }
  | { kind: "NONE"; candidates: number };

/**
 * Token first, then a known subscription, then email. An attempt from a
 * different workspace never matches (the caller looks it up scoped to the
 * workspace; this re-checks). Two or more leads with the email is NONE:
 * guessing between people is not a match.
 */
export function matchPayment(input: {
  businessId: string;
  attempt: { id: string; business_id: string; lead_id: string } | null;
  subscriptionLeadId: string | null;
  emailLeadIds: string[];
}): PaymentMatch {
  if (input.attempt && input.attempt.business_id === input.businessId) {
    return { kind: "TOKEN", leadId: input.attempt.lead_id, attemptId: input.attempt.id };
  }
  if (input.subscriptionLeadId) return { kind: "SUBSCRIPTION", leadId: input.subscriptionLeadId };
  const unique = [...new Set(input.emailLeadIds)];
  if (unique.length === 1) return { kind: "EMAIL", leadId: unique[0] };
  return { kind: "NONE", candidates: unique.length };
}

export type PaymentStatus = "MATCHED" | "REVIEW" | "UNMATCHED" | "LINKED";

export function paymentStatusFor(match: PaymentMatch): PaymentStatus {
  if (match.kind === "TOKEN" || match.kind === "SUBSCRIPTION") return "MATCHED";
  if (match.kind === "EMAIL") return "REVIEW";
  return "UNMATCHED";
}

/** Only certain matches are applied without a person. */
export function appliesAutomatically(match: PaymentMatch): boolean {
  return match.kind === "TOKEN" || match.kind === "SUBSCRIPTION";
}

/**
 * A second delivery for an order we already hold (the same subscription's
 * session and first invoice, a re-sent order webhook). What it may add:
 *
 *   * a token the first delivery lacked, on a payment not yet applied ->
 *     record it and re-match (a certain match supersedes a REVIEW);
 *   * a billing interval the first lacked -> record it (and the MRR).
 *
 * Nothing else changes: an applied payment is never re-applied.
 */
export function mergeDelivery(
  existing: {
    applied_at: string | null;
    status: string;
    reference: string | null;
    recurring_interval: string | null;
    amount_minor: number;
    recurring: boolean;
  },
  incoming: PaymentFact,
): { update: Record<string, unknown>; rematch: boolean } {
  const update: Record<string, unknown> = {};
  let rematch = false;
  if (!existing.applied_at && !existing.reference && incoming.reference) {
    update.reference = incoming.reference;
    rematch = true;
  }
  if (!existing.recurring_interval && incoming.interval) {
    update.recurring_interval = incoming.interval;
    update.recurring = true;
    update.mrr_minor = mrrMinor({
      amountMinor: existing.amount_minor || incoming.amountMinor,
      recurring: true,
      interval: incoming.interval,
      intervalCount: incoming.intervalCount,
    });
  }
  return { update, rematch };
}

/** The close reason recorded on the opportunity. */
export function wonReason(fact: {
  provider: string;
  source: string | null;
  amountMinor: number;
  currency: string;
  recurring: boolean;
  interval: BillingInterval | null;
  orderId: string;
}): string {
  const amount = formatMoney(fact.amountMinor, fact.currency);
  const cadence = fact.recurring && fact.interval ? ` per ${fact.interval}` : fact.recurring ? " (recurring)" : "";
  const via = fact.provider === "stripe" ? "Stripe" : sourceLabel(fact.source);
  return `Paid ${amount}${cadence} via ${via} (order ${fact.orderId.slice(0, 80)}).`;
}

export function sourceLabel(source: string | null): string {
  switch (source) {
    case "stripe":
      return "Stripe";
    case "shopify":
      return "Shopify";
    case "woocommerce":
      return "WooCommerce";
    case "gocardless":
      return "GoCardless";
    case "paddle":
      return "Paddle";
    case "zapier":
      return "Zapier";
    default:
      return "your order webhook";
  }
}

export function formatMoney(amountMinor: number, currency: string): string {
  const major = toMajorUnits(amountMinor, currency);
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(major);
  } catch {
    return `${major.toFixed(minorUnitFactor(currency) === 1 ? 0 : 2)} ${currency}`;
  }
}
