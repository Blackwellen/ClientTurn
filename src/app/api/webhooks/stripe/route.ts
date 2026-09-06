import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  stripe,
  mapSubscriptionStatus,
  planForPriceId,
  entitlementsForPlan,
} from "@/lib/billing/stripe";
import { recordAudit } from "@/lib/audit";
import { creditTokenPurchase } from "@/lib/billing/token-service";

export const dynamic = "force-dynamic";

const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // One-off AI token top-ups. `checkout.session.completed` is the only place
  // tokens are ever granted -- nothing in the app credits an allowance,
  // because nothing in the app has seen the money.
  "checkout.session.completed",
  "checkout.session.expired",
  "charge.refunded",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = serverEnv.stripe.webhookSecret;

  if (!signature || !secret) {
    return NextResponse.json({ error: "not configured" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Idempotent inbox: a Stripe retry must never re-apply a transition.
  const { error: inboxError } = await supabase.from("webhook_events").insert({
    provider: "stripe",
    external_event_id: event.id,
    event_type: event.type,
    status: "processing",
  });

  if (inboxError?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (HANDLED.has(event.type)) {
      await applyEvent(event);
    }

    await supabase
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "stripe")
      .eq("external_event_id", event.id);
  } catch (error) {
    await supabase
      .from("webhook_events")
      .update({
        status: "failed",
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("provider", "stripe")
      .eq("external_event_id", event.id);

    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function applyEvent(event: Stripe.Event) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired"
  ) {
    await applyTokenCheckout(event);
    return;
  }

  if (event.type === "charge.refunded") {
    await applyTokenRefund(event);
    return;
  }

  const supabase = createAdminClient();

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const businessId = subscription.metadata?.business_id;
    if (!businessId) return;

    const item = subscription.items.data[0];
    const priceId = item?.price?.id ?? null;
    const plan =
      event.type === "customer.subscription.deleted"
        ? "trial"
        : planForPriceId(priceId);

    const status =
      event.type === "customer.subscription.deleted"
        ? "CANCELLED"
        : mapSubscriptionStatus(subscription.status);

    const periodStart = item?.current_period_start;
    const periodEnd = item?.current_period_end;

    await supabase
      .from("subscriptions")
      .update({
        stripe_customer_id: String(subscription.customer),
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        plan,
        status,
        billing_interval:
          item?.price?.recurring?.interval === "year" ? "year" : "month",
        current_period_start: periodStart
          ? new Date(periodStart * 1000).toISOString()
          : null,
        current_period_end: periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        cancelled_at: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
        ...entitlementsForPlan(plan),
      })
      .eq("business_id", businessId);

    await recordAudit({
      businessId,
      actorType: "provider",
      action: "billing.plan_changed",
      entityType: "subscription",
      metadata: { plan, status, stripe_event: event.type },
    });
    return;
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = String(invoice.customer);
    await supabase
      .from("subscriptions")
      .update({ status: "PAST_DUE" })
      .eq("stripe_customer_id", customerId);
  }
}

/* ------------------------------------------------------------ ai tokens */

/**
 * Marks a token purchase paid and credits the allowance.
 *
 * Idempotent three times over, because a double credit gives real money away:
 * the webhook inbox rejects a replayed Stripe event id, the purchase row's
 * `credited_at` guards the credit, and `credit_ai_tokens` keys its ledger row.
 */
async function applyTokenCheckout(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== "ai_tokens") return;

  const purchaseId = session.metadata?.purchase_id;
  if (!purchaseId) return;

  const supabase = createAdminClient();

  if (event.type === "checkout.session.expired") {
    await supabase
      .from("ai_token_purchases")
      .update({ status: "EXPIRED" })
      .eq("id", purchaseId)
      .eq("status", "PENDING");
    return;
  }

  // Only a genuinely paid session grants anything. An unpaid completed session
  // (an async payment method still clearing) stays PENDING until it settles.
  if (session.payment_status !== "paid") return;

  const { data: purchase } = await supabase
    .from("ai_token_purchases")
    .update({
      status: "PAID",
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    })
    .eq("id", purchaseId)
    .in("status", ["PENDING", "PAID"])
    .select("id, business_id, tokens, pack_key")
    .maybeSingle();

  if (!purchase) return;

  const credited = await creditTokenPurchase(purchase.id);

  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    action: "billing.tokens_purchased",
    entityType: "ai_token_purchase",
    entityId: purchase.id,
    metadata: {
      packKey: purchase.pack_key,
      tokens: Number(purchase.tokens),
      credited,
      stripe_event: event.type,
    },
  });
}

/**
 * A refunded top-up is marked REFUNDED but the tokens are NOT clawed back.
 * Reversing an allowance a workspace may already have spent would put them
 * into a negative balance they cannot clear, and support can adjust the
 * balance deliberately if that is genuinely wanted.
 */
async function applyTokenRefund(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  if (charge.metadata?.kind !== "ai_tokens") return;

  const purchaseId = charge.metadata?.purchase_id;
  if (!purchaseId) return;

  const supabase = createAdminClient();
  const { data: purchase } = await supabase
    .from("ai_token_purchases")
    .update({ status: "REFUNDED" })
    .eq("id", purchaseId)
    .eq("status", "PAID")
    .select("id, business_id")
    .maybeSingle();

  if (!purchase) return;

  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    action: "billing.tokens_refunded",
    entityType: "ai_token_purchase",
    entityId: purchase.id,
    metadata: { stripe_event: event.type, tokensClawedBack: false },
  });
}
