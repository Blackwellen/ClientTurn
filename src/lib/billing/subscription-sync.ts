import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import { syncReferralLifecycle } from "@/lib/affiliates/lifecycle";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import { enqueue } from "@/lib/jobs/queue";
import { SUBSCRIPTION_WELCOME_KIND, shouldQueueWelcome, welcomeJobKey } from "@/lib/email/subscription-welcome";
import { stripe, mapSubscriptionStatus, planForPriceId, entitlementsForPlan } from "./stripe";
import { recordTermsAcceptance } from "./terms-acceptance";
import { PLANS } from "./plans";
import { selectPlanItem } from "./subscription-items";
import { syncVoiceItems, voicePriceIds } from "./voice-subscription-sync";

/**
 * Mirrors a Stripe subscription onto `subscriptions`, from either direction:
 *
 *   * the webhook (`customer.subscription.*`, `checkout.session.completed`) --
 *     no Stripe I/O, only the payload it was handed;
 *   * the Checkout return page, which reads the session back from Stripe so
 *     the owner lands in a usable workspace without waiting for the webhook.
 *
 * Both write the same fixed values for the same Stripe state, so whichever
 * arrives second is a no-op in effect.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function iso(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export async function applyStripeSubscription(
  subscription: Stripe.Subscription,
  context: { eventType: string; eventId?: string; deleted?: boolean },
): Promise<{ businessId: string; status: string } | null> {
  const businessId = subscription.metadata?.business_id;
  if (!businessId) return null;

  // The plan item by price, never by position: a voice item (OD-2) can sit
  // anywhere in `items.data` (subscription-items.ts).
  const items = subscription.items?.data ?? [];
  const item = selectPlanItem(items, planForPriceId, voicePriceIds()) ?? undefined;
  const priceId = item?.price?.id ?? null;
  const deleted = context.deleted ?? false;
  const plan = planForPriceId(priceId);
  const status = deleted ? "CANCELLED" : mapSubscriptionStatus(subscription.status);
  const trialing = !deleted && subscription.status === "trialing";
  const paymentMethodId = idOf(subscription.default_payment_method);

  const update = await db()
    .from("subscriptions")
    .update({
      stripe_customer_id: idOf(subscription.customer),
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      // The chosen tier is kept even when cancelled: it is what a resubscribe
      // is offered, and lifecycle.ts, not the plan column, decides access.
      plan,
      status,
      billing_interval: item?.price?.recurring?.interval === "year" ? "year" : "month",
      current_period_start: iso(item?.current_period_start),
      current_period_end: iso(item?.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      cancelled_at: iso(subscription.canceled_at),
      ...(subscription.trial_end ? { trial_ends_at: iso(subscription.trial_end) } : {}),
      ...(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
      ...entitlementsForPlan(plan, trialing),
    })
    .eq("business_id", businessId)
    .select("business_id");
  // Throws on failure: the webhook marks the event failed and Stripe retries.
  assertWrite(update, "stripe: subscription mirror", {
    businessId,
    eventId: context.eventId,
    eventType: context.eventType,
  });

  if (paymentMethodId) {
    // A default payment method on a Checkout-created subscription is a card
    // Stripe has already validated (SetupIntent succeeded). Recorded once.
    logWriteError(
      await db()
        .from("subscriptions")
        .update({ payment_method_verified_at: new Date().toISOString() })
        .eq("business_id", businessId)
        .is("payment_method_verified_at", null),
      "stripe: payment method verified",
      { businessId },
    );
  }

  await recordAudit({
    businessId,
    actorType: "provider",
    action: "billing.plan_changed",
    entityType: "subscription",
    metadata: { plan, status, stripe_event: context.eventType },
  });

  await syncReferralLifecycle({
    businessId,
    subscriptionStatus: subscription.status,
    deleted,
    planKey: deleted ? "trial" : plan,
  });

  // Voice items (the Pro voice item, the dedicated number) are mirrored into
  // `business_entitlement_grants` separately. A failure there is logged and
  // never breaks the plan mirror above.
  await syncVoiceItems(subscription, { businessId, deleted, eventId: context.eventId });

  // Active on a paid plan (a trial that converted, or a direct subscribe):
  // the one welcome email about the plan and its add-ons.
  if (shouldQueueWelcome({ status, plan, alreadySent: false })) {
    await queueSubscriptionWelcome({ businessId, subscriptionId: subscription.id, plan });
  }

  return { businessId, status };
}

/**
 * Queues the subscription welcome email once per Stripe subscription.
 *
 * Two guards: the job's idempotency key (which dedupes the webhook and the
 * Checkout return page racing each other) and the durable marker row in
 * `subscription_welcome_emails` (0149), which outlives the purged job row, so
 * a later `customer.subscription.updated` (a renewal, a plan change, a
 * recovered payment) never sends it again. Enqueue first, then mark: a failed
 * mark only means the next event re-enqueues under the same key.
 */
export async function queueSubscriptionWelcome(input: {
  businessId: string;
  subscriptionId: string;
  plan: string;
}): Promise<"queued" | "already_sent"> {
  const markers = db().from("subscription_welcome_emails");
  const { data: existing, error: readError } = await markers
    .select("stripe_subscription_id")
    .eq("stripe_subscription_id", input.subscriptionId)
    .maybeSingle();
  if (readError) {
    // Unknown is not "not sent": skip rather than risk a second email.
    console.error("[stripe] welcome marker read failed", { businessId: input.businessId, message: readError.message });
    return "already_sent";
  }
  if (!shouldQueueWelcome({ status: "ACTIVE", plan: input.plan, alreadySent: Boolean(existing) })) {
    return "already_sent";
  }

  await enqueue(
    "notification.send",
    { kind: SUBSCRIPTION_WELCOME_KIND, businessId: input.businessId },
    {
      businessId: input.businessId,
      idempotencyKey: welcomeJobKey(input.subscriptionId),
    },
  );
  logWriteError(
    await db()
      .from("subscription_welcome_emails")
      .upsert(
        { stripe_subscription_id: input.subscriptionId, business_id: input.businessId, plan: input.plan },
        { onConflict: "stripe_subscription_id", ignoreDuplicates: true },
      ),
    "stripe: welcome email marker",
    { businessId: input.businessId },
  );
  return "queued";
}

/** Records the card's brand and last four, for the billing page. */
async function recordCardDetails(businessId: string, paymentMethod: Stripe.PaymentMethod | null) {
  if (!paymentMethod) return;
  logWriteError(
    await db()
      .from("subscriptions")
      .update({
        payment_method_id: paymentMethod.id,
        payment_method_brand: paymentMethod.card?.brand ?? paymentMethod.type,
        payment_method_last4: paymentMethod.card?.last4 ?? null,
        payment_method_verified_at: new Date().toISOString(),
      })
      .eq("business_id", businessId),
    "stripe: card details",
    { businessId },
  );
}

/**
 * `checkout.session.completed` for a subscription Checkout: the terms were
 * accepted there (Checkout will not complete without the box ticked). The
 * subscription row itself is written by `customer.subscription.created`.
 */
export async function applySubscriptionCheckout(
  session: Stripe.Checkout.Session,
  context: { eventId?: string; ip?: string | null; userAgent?: string | null },
): Promise<void> {
  if (session.mode !== "subscription" || session.metadata?.kind !== "subscription") return;
  const businessId = session.metadata?.business_id;
  if (!businessId) return;

  if (session.consent?.terms_of_service === "accepted") {
    await recordTermsAcceptance({
      businessId,
      userId: session.metadata?.user_id || null,
      source: "checkout",
      acceptedAt: new Date((session.created ?? Date.now() / 1000) * 1000),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      stripeCheckoutSessionId: session.id,
      termsVersion: session.metadata?.terms_version || undefined,
    });
    await recordAudit({
      businessId,
      actorUserId: session.metadata?.user_id || null,
      actorType: "provider",
      action: "billing.terms_accepted",
      entityType: "subscription",
      metadata: { source: "checkout", terms_version: session.metadata?.terms_version ?? null },
    });
  }

  const customerId = idOf(session.customer);
  if (customerId) {
    assertWrite(
      await db()
        .from("subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("business_id", businessId)
        .is("stripe_customer_id", null),
      "stripe: record customer",
      { businessId, eventId: context.eventId },
    );
  }
}

export type CheckoutReturn =
  | { ok: true; status: string }
  | { ok: false; reason: "not_found" | "wrong_workspace" | "not_complete" };

/**
 * The Checkout return page. Reads the session back from Stripe (the source of
 * truth) and applies it, so the owner is let in the moment Stripe has
 * confirmed the subscription rather than whenever the webhook lands.
 */
export async function confirmCheckoutReturn(input: {
  sessionId: string;
  businessId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<CheckoutReturn> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(input.sessionId, {
      expand: ["subscription", "subscription.default_payment_method"],
    });
  } catch {
    return { ok: false, reason: "not_found" };
  }

  if (session.metadata?.business_id !== input.businessId) {
    return { ok: false, reason: "wrong_workspace" };
  }
  if (session.status !== "complete" || !session.subscription || typeof session.subscription === "string") {
    return { ok: false, reason: "not_complete" };
  }

  await applySubscriptionCheckout(session, { ip: input.ip, userAgent: input.userAgent });
  const applied = await applyStripeSubscription(session.subscription, {
    eventType: "checkout.return",
  });

  const paymentMethod = session.subscription.default_payment_method;
  await recordCardDetails(
    input.businessId,
    paymentMethod && typeof paymentMethod === "object" ? paymentMethod : null,
  );

  return { ok: true, status: applied?.status ?? "INCOMPLETE" };
}

/** `customer.subscription.trial_will_end`: three days' notice, with the price. */
export async function notifyTrialEnding(subscription: Stripe.Subscription): Promise<void> {
  const businessId = subscription.metadata?.business_id;
  if (!businessId || !subscription.trial_end) return;

  const planItem = selectPlanItem(subscription.items?.data ?? [], planForPriceId, voicePriceIds());
  const plan = planForPriceId(planItem?.price?.id);
  const price = planItem?.price;
  const amount =
    price?.unit_amount != null
      ? new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency: (price.currency ?? "gbp").toUpperCase(),
        }).format(price.unit_amount / 100)
      : null;
  const endsOn = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(
    new Date(subscription.trial_end * 1000),
  );
  const planName = plan === "trial" ? "your plan" : `the ${PLANS[plan as keyof typeof PLANS]?.name ?? plan} plan`;

  await queueNotification({
    businessId,
    type: "billing",
    severity: "info",
    title: `Your free trial ends on ${endsOn}`,
    body:
      `Your card will be charged${amount ? ` ${amount}` : ""} for ${planName} on ${endsOn}. ` +
      "Nothing to do if you are staying. To change plan or cancel before then, open Billing.",
    linkUrl: "/app/settings?section=billing",
    dedupeKey: `trial_will_end:${subscription.id}:${subscription.trial_end}`,
  });
}
