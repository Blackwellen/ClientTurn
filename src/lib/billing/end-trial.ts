/**
 * Ending a card-first trial today: "Upgrade now" (owner request 2026-09-27).
 *
 * A trial is already a Stripe subscription in `trialing` with a verified card
 * on file (checkout.ts). Converting it is therefore one call on that
 * subscription, never a second Checkout:
 *
 *   stripe.subscriptions.update(id, {
 *     trial_end: "now",                        -- the trial ends at this moment
 *     items: [{ id, price }],                  -- only when the plan changed
 *     proration_behavior: "none",
 *     payment_behavior: "error_if_incomplete",
 *     metadata: { business_id },
 *     expand: ["latest_invoice"],
 *   }, { idempotencyKey: "end-trial:<business>:<nonce>" })
 *
 * Stripe then starts the first paid period now and charges the saved card
 * for it straight away.
 *
 * ## Why `proration_behavior: "none"`
 *
 * Nothing has been charged during the trial, so there is nothing to credit
 * and no partial period to bill: ending the trial resets the billing cycle
 * anchor to now and the first invoice is simply one full period at the
 * (possibly new) price. Prorating would only add zero-value trial lines, and
 * on a price swap could net a trial-priced credit against the new price.
 * `plan-change.ts` makes the same call for a plan change during a trial.
 *
 * ## Why `payment_behavior: "error_if_incomplete"`
 *
 * A decline or an authentication (SCA) requirement makes Stripe return an
 * error and leave the subscription exactly as it was -- still trialling, no
 * half-converted `incomplete` state, no open invoice left to be retried
 * behind the owner's back. The workspace stays in its trial.
 *
 * For SCA only, a second call with `pending_if_incomplete` (and its own
 * idempotency key) asks Stripe for an invoice the owner can authenticate on
 * Stripe's hosted page. The trial ends only when that invoice is paid, as a
 * Stripe "pending update"; unpaid, the pending update expires and the trial
 * carries on as before.
 *
 * ## Never charging twice
 *
 *   * the subscription is re-read first: anything but `trialing` is not
 *     converted again (an `active` one is reported as already done);
 *   * the idempotency key is the workspace plus a nonce the modal generates
 *     once per confirmation, so a double click or a retried request replays
 *     Stripe's first answer instead of making a second charge.
 *
 * Pure of app wiring -- no `server-only`, no env, no Supabase -- and the
 * Stripe client is a parameter, so the call shape is unit-tested with a mock.
 * The service operation (services/operations/billing.ts) supplies the real
 * client, the price ids and the database follow-up.
 */

import type Stripe from "stripe";
import { selectPlanItem } from "./subscription-items.ts";

export type SelfServePlanId = "starter" | "growth" | "pro";
export type Interval = "month" | "year";

/** The slice of the Stripe client this module uses. The real client satisfies it. */
export type EndTrialStripe = {
  subscriptions: {
    retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<Stripe.Subscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.Subscription>;
  };
  invoices: {
    createPreview(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.Invoice>;
  };
};

export type EndTrialInput = {
  stripe: EndTrialStripe;
  businessId: string;
  subscriptionId: string;
  targetPlan: SelfServePlanId;
  /** Generated once per confirmation by the modal. */
  nonce: string;
  /** Price id for a plan and interval (server env); null when not configured. */
  priceIdFor: (plan: SelfServePlanId, interval: Interval) => string | null;
};

export type EndTrialOutcome =
  | {
      ok: true;
      kind: "converted";
      subscription: Stripe.Subscription;
      planChanged: boolean;
      amountPaidMinor: number | null;
      currency: string | null;
    }
  /** Not trialling any more and already active: nothing charged by this call. */
  | { ok: true; kind: "already_active"; subscription: Stripe.Subscription }
  | { ok: false; kind: "declined"; message: string; code: string | null }
  | {
      ok: false;
      kind: "requires_action";
      message: string;
      /** Stripe's hosted page for the invoice, where the owner authenticates. */
      hostedInvoiceUrl: string | null;
    }
  | { ok: false; kind: "not_trialing" | "no_price" | "wrong_workspace" | "failed"; message: string };

const NONCE = /^[A-Za-z0-9-]{8,64}$/;

export function isValidNonce(nonce: string): boolean {
  return NONCE.test(nonce);
}

/** One key per workspace and confirmation: a replay returns Stripe's first answer. */
export function endTrialIdempotencyKey(businessId: string, nonce: string): string {
  if (!isValidNonce(nonce)) throw new Error("Invalid confirmation nonce.");
  return `end-trial:${businessId}:${nonce}`;
}

/**
 * The subscription's PLAN item, by price, never by position: a voice item
 * (the Pro £100 item or the £11.99 number) can come first (subscription-items.ts).
 * A price is a plan price when `priceIdFor` gives it for some plan and interval.
 */
export function trialPlanItem<T extends Stripe.SubscriptionItem>(
  items: readonly T[],
  priceIdFor?: (plan: SelfServePlanId, interval: Interval) => string | null,
): T | null {
  const planFor = (priceId: string | null | undefined): string => {
    if (!priceId || !priceIdFor) return "trial";
    for (const plan of ["starter", "growth", "pro"] as const) {
      for (const interval of ["month", "year"] as const) if (priceIdFor(plan, interval) === priceId) return plan;
    }
    return "trial";
  };
  return selectPlanItem(items, planFor);
}

/** The interval the conversion is priced on: the plan item's own. */
export function intervalOf(
  subscription: Pick<Stripe.Subscription, "items">,
  priceIdFor?: (plan: SelfServePlanId, interval: Interval) => string | null,
): Interval {
  const item = trialPlanItem(subscription.items.data, priceIdFor);
  return item?.price?.recurring?.interval === "year" ? "year" : "month";
}

/**
 * The update that ends the trial. `items` is sent only when the plan changes,
 * so converting on the chosen tier touches nothing but the trial end.
 */
export function endTrialUpdateParams(input: {
  businessId: string;
  itemId: string;
  currentPriceId: string | null;
  targetPriceId: string;
  paymentBehavior: "error_if_incomplete" | "pending_if_incomplete";
}): Stripe.SubscriptionUpdateParams {
  const swap = input.currentPriceId !== input.targetPriceId;
  const params: Stripe.SubscriptionUpdateParams = {
    trial_end: "now",
    proration_behavior: "none",
    payment_behavior: input.paymentBehavior,
    expand: ["latest_invoice"],
    ...(swap ? { items: [{ id: input.itemId, price: input.targetPriceId }] } : {}),
  };
  // A pending update accepts only a narrow set of fields; metadata is not
  // one of them. It is already set on the subscription at checkout.
  if (input.paymentBehavior === "error_if_incomplete") {
    params.metadata = { business_id: input.businessId };
  }
  return params;
}

type StripeErrorLike = {
  type?: string;
  code?: string;
  decline_code?: string;
  message?: string;
  raw?: { code?: string; decline_code?: string; message?: string };
};

const SCA_CODES = new Set([
  "authentication_required",
  "invoice_payment_intent_requires_action",
  "payment_intent_action_required",
  "payment_intent_authentication_failure",
  "subscription_payment_intent_requires_action",
]);

/**
 * What a Stripe error means for the owner. Card errors carry a message Stripe
 * writes for the cardholder ("Your card has insufficient funds."), which is
 * safe to show; anything else is summarised without internals.
 */
export function classifyStripeError(error: unknown):
  | { kind: "requires_action"; message: string; code: string | null }
  | { kind: "declined"; message: string; code: string | null }
  | { kind: "failed"; message: string; code: string | null } {
  const e = (error ?? {}) as StripeErrorLike;
  const code = e.code ?? e.raw?.code ?? null;
  const decline = e.decline_code ?? e.raw?.decline_code ?? null;

  if ((code && SCA_CODES.has(code)) || (decline && SCA_CODES.has(decline))) {
    return {
      kind: "requires_action",
      code,
      message: "Your bank needs you to confirm this payment. Nothing has been charged yet.",
    };
  }
  if (e.type === "StripeCardError" || e.type === "card_error" || code === "card_declined" || decline) {
    const text = e.message ?? e.raw?.message;
    return {
      kind: "declined",
      code: decline ?? code,
      message: `${text ? text.replace(/\.?$/, ".") : "Your card was declined."} Nothing has been charged and your trial continues.`,
    };
  }
  if (code === "idempotency_key_in_use") {
    return { kind: "failed", code, message: "This upgrade is already being processed. Refresh in a moment." };
  }
  return { kind: "failed", code, message: "The upgrade could not be completed. Nothing has been charged; try again." };
}

function invoiceOf(subscription: Stripe.Subscription): Stripe.Invoice | null {
  const invoice = subscription.latest_invoice;
  return invoice && typeof invoice === "object" ? invoice : null;
}

export async function endTrialNow(input: EndTrialInput): Promise<EndTrialOutcome> {
  let key: string;
  try {
    key = endTrialIdempotencyKey(input.businessId, input.nonce);
  } catch {
    return { ok: false, kind: "failed", message: "The confirmation expired. Close this and try again." };
  }

  // Re-read before any charge: the current state decides, not the page.
  let subscription: Stripe.Subscription;
  try {
    subscription = await input.stripe.subscriptions.retrieve(input.subscriptionId);
  } catch (error) {
    return { ok: false, kind: "failed", message: classifyStripeError(error).message };
  }

  if (subscription.metadata?.business_id && subscription.metadata.business_id !== input.businessId) {
    return { ok: false, kind: "wrong_workspace", message: "This subscription belongs to another workspace." };
  }
  if (subscription.status === "active") return { ok: true, kind: "already_active", subscription };
  if (subscription.status !== "trialing") {
    return {
      ok: false,
      kind: "not_trialing",
      message: "This workspace is not in a trial any more. Manage the plan from Billing.",
    };
  }

  const item = trialPlanItem(subscription.items.data, input.priceIdFor);
  if (!item) return { ok: false, kind: "failed", message: "The subscription has no plan to start." };
  const interval = intervalOf(subscription, input.priceIdFor);
  const targetPriceId = input.priceIdFor(input.targetPlan, interval);
  if (!targetPriceId) {
    return {
      ok: false,
      kind: "no_price",
      message: "That plan is not available for self-serve billing yet. Contact support and we will set it up.",
    };
  }
  const currentPriceId = item.price?.id ?? null;

  try {
    const updated = await input.stripe.subscriptions.update(
      subscription.id,
      endTrialUpdateParams({
        businessId: input.businessId,
        itemId: item.id,
        currentPriceId,
        targetPriceId,
        paymentBehavior: "error_if_incomplete",
      }),
      { idempotencyKey: key },
    );
    const invoice = invoiceOf(updated);
    if (updated.status === "active" || updated.status === "trialing") {
      return {
        ok: true,
        kind: "converted",
        subscription: updated,
        planChanged: currentPriceId !== targetPriceId,
        amountPaidMinor: invoice?.amount_paid ?? null,
        currency: invoice?.currency ?? null,
      };
    }
    // error_if_incomplete should never leave anything else; if it does, the
    // invoice's own page is the way to finish paying it.
    return {
      ok: false,
      kind: "requires_action",
      message: "The payment needs confirming before your plan starts.",
      hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
    };
  } catch (error) {
    const classified = classifyStripeError(error);
    if (classified.kind === "declined") {
      return { ok: false, kind: "declined", message: classified.message, code: classified.code };
    }
    if (classified.kind === "failed") return { ok: false, kind: "failed", message: classified.message };
    return requestAuthenticatedPayment(input, subscription.id, item.id, currentPriceId, targetPriceId, key, classified.message);
  }
}

/**
 * SCA: ask Stripe for an invoice the owner can authenticate, as a pending
 * update. The trial ends only when it is paid. A failure here still returns
 * `requires_action`, without a URL: the caller then offers the billing portal.
 */
async function requestAuthenticatedPayment(
  input: EndTrialInput,
  subscriptionId: string,
  itemId: string,
  currentPriceId: string | null,
  targetPriceId: string,
  key: string,
  message: string,
): Promise<EndTrialOutcome> {
  try {
    const pending = await input.stripe.subscriptions.update(
      subscriptionId,
      endTrialUpdateParams({
        businessId: input.businessId,
        itemId,
        currentPriceId,
        targetPriceId,
        paymentBehavior: "pending_if_incomplete",
      }),
      { idempotencyKey: `${key}:authenticate` },
    );
    return {
      ok: false,
      kind: "requires_action",
      message,
      hostedInvoiceUrl: invoiceOf(pending)?.hosted_invoice_url ?? null,
    };
  } catch {
    return { ok: false, kind: "requires_action", message, hostedInvoiceUrl: null };
  }
}

/* ------------------------------------------------------------- preview */

export type EndTrialPreview = { amountDueMinor: number; currency: string };

/**
 * What the card would be charged if the trial ended now on `targetPlan`:
 * Stripe's own preview of the first invoice (tax and discounts included),
 * so the confirmation step states the real amount. Null when it cannot be
 * previewed; the modal then shows the catalogue price.
 */
export async function previewEndTrialCharge(input: {
  stripe: EndTrialStripe;
  subscriptionId: string;
  targetPlan: SelfServePlanId;
  priceIdFor: EndTrialInput["priceIdFor"];
}): Promise<EndTrialPreview | null> {
  try {
    const subscription = await input.stripe.subscriptions.retrieve(input.subscriptionId);
    if (subscription.status !== "trialing") return null;
    const item = trialPlanItem(subscription.items.data, input.priceIdFor);
    if (!item) return null;
    const targetPriceId = input.priceIdFor(input.targetPlan, intervalOf(subscription, input.priceIdFor));
    if (!targetPriceId) return null;
    const preview = await input.stripe.invoices.createPreview({
      subscription: subscription.id,
      subscription_details: {
        trial_end: "now",
        proration_behavior: "none",
        ...(item.price?.id !== targetPriceId ? { items: [{ id: item.id, price: targetPriceId }] } : {}),
      },
    });
    return { amountDueMinor: preview.amount_due, currency: preview.currency };
  } catch {
    return null;
  }
}
