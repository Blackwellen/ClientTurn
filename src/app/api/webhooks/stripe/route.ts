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
import {
  accrueCommission,
  reverseCommission,
} from "@/lib/affiliates/commissions";
import { syncReferralLifecycle } from "@/lib/affiliates/lifecycle";

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
  // Affiliate commission is accrued and reversed from these, never from a page.
  // A dispute is treated as a reversal at the point it is opened rather than
  // when it is lost: money that is being clawed back should stop looking
  // payable immediately.
  "charge.dispute.created",
]);

/**
 * The signing secrets this route will accept, most likely first.
 *
 * Both Stripe destinations post here, and each signs with its own secret, so
 * verification tries each in turn rather than assuming which one sent this
 * delivery. Order is by expected volume: snapshot events are the ones the
 * product acts on.
 */
type SecretKind = "snapshot" | "thin" | "legacy" | "local";

function candidateSecrets(): { kind: SecretKind; secret: string }[] {
  const { snapshot, thin, legacy, local } = serverEnv.stripe.webhookSecrets;
  return [
    { kind: "snapshot" as const, secret: snapshot },
    { kind: "thin" as const, secret: thin },
    { kind: "legacy" as const, secret: legacy },
    { kind: "local" as const, secret: local },
  ].filter((entry): entry is { kind: SecretKind; secret: string } => Boolean(entry.secret));
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secrets = candidateSecrets();

  if (!signature || secrets.length === 0) {
    return NextResponse.json({ error: "not configured" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event | null = null;
  let destination: SecretKind | null = null;

  for (const candidate of secrets) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, candidate.secret);
      destination = candidate.kind;
      break;
    } catch {
      // Signed by a different destination, or not by Stripe at all. Keep
      // trying; a delivery that matches none is rejected below.
    }
  }

  if (!event || !destination) {
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
    // v2 "thin" events (`v2.core.*`) are Accounts v2 / Connect territory.
    // Nothing here consumes them, but they are verified and acknowledged so
    // Stripe stops retrying, and recorded so an unexpected one is visible
    // rather than silently dropped.
    if (HANDLED.has(event.type)) {
      await applyEvent(event);
    }

    await supabase
      .from("webhook_events")
      .update({
        status: HANDLED.has(event.type) ? "processed" : "ignored",
        processed_at: new Date().toISOString(),
      })
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

  return NextResponse.json({ received: true, destination });
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
    // A refund can be either a token top-up or a subscription payment that
    // earned an affiliate commission. Both are attempted; each is a no-op for
    // the other's charges.
    await applyTokenRefund(event);
    await applyAffiliateRefund(event);
    return;
  }

  if (event.type === "charge.dispute.created") {
    await applyAffiliateChargeback(event);
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

    // Keep the referral's lifecycle in step with the subscription. Trial and
    // churn are subscription facts, not payment facts, so they are mirrored
    // here rather than inferred from the commission ledger.
    await syncReferralLifecycle({
      businessId,
      subscriptionStatus: subscription.status,
      deleted: event.type === "customer.subscription.deleted",
      planKey: plan,
    });
    return;
  }

  if (event.type === "invoice.paid") {
    await applyAffiliateAccrual(event);
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

/* ---------------------------------------------------------- affiliates */

/**
 * Accrues affiliate commission for a paid invoice.
 *
 * This is the *only* place commission is created. Nothing in `src/app` outside
 * this webhook calls `accrueCommission`, because commission must originate from
 * Stripe telling us money actually moved — not from a browser reporting that it
 * thinks it did.
 *
 * Idempotency is layered: the webhook inbox rejects a replayed event id, and
 * the ledger's unique `idempotency_key` rejects a second accrual for the same
 * invoice even if the event arrives under a new id.
 */
async function applyAffiliateAccrual(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;

  const businessId = await businessForInvoice(invoice);
  if (!businessId) return;

  // Net of discounts and credit, which is what the customer actually paid.
  const amountPaidMinor = invoice.amount_paid ?? 0;
  if (amountPaidMinor <= 0) return;

  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000)
    : new Date();

  const result = await accrueCommission({
    businessId,
    amountPaidMinor,
    currency: (invoice.currency ?? "gbp").toUpperCase(),
    invoiceId: invoice.id ?? `invoice_${event.id}`,
    paymentIndex: await paymentIndexFor(businessId, invoice),
    periodMonth: `${periodStart.getUTCFullYear()}-${String(
      periodStart.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`,
  });

  if (result.status === "created") {
    await recordAudit({
      businessId,
      actorType: "provider",
      action: "affiliate.commission_created",
      entityType: "affiliate_commission",
      entityId: result.commissionId,
      metadata: { stripe_event: event.type, amountMinor: result.amountMinor },
    });
  }
}

/**
 * How many payments this subscription has already made.
 *
 * Decides whether a payment earns the new-customer rate or a renewal rate, and
 * whether it is still inside a recurring plan's month window. Counted from our
 * own ledger rather than from Stripe, because the ledger is what the commission
 * plan is applied against and a mismatch there is a mispayment.
 */
async function paymentIndexFor(
  businessId: string,
  invoice: Stripe.Invoice,
): Promise<number> {
  // A subscription's very first invoice is unambiguous.
  if (invoice.billing_reason === "subscription_create") return 0;

  const { count } = await createAdminClient()
    .from("affiliate_commissions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .in("entry_type", ["NEW_CUSTOMER", "RENEWAL"]);

  return count ?? 0;
}

/** Resolves the tenant an invoice belongs to, via the mirrored subscription. */
async function businessForInvoice(
  invoice: Stripe.Invoice,
): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("business_id")
    .eq("stripe_customer_id", String(invoice.customer))
    .maybeSingle();

  return data?.business_id ?? null;
}

/** Reverses commission when a subscription charge is refunded. */
async function applyAffiliateRefund(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  // Token top-ups are handled by `applyTokenRefund` and never earn commission.
  if (charge.metadata?.kind === "ai_tokens") return;

  const invoiceId = invoiceIdOf(charge);
  if (!invoiceId) return;

  await reverseCommission({
    invoiceId,
    reason: "REFUND",
    // Proportional, so a partial refund takes back a proportional commission.
    refundedMinor: charge.amount_refunded ?? undefined,
  });
}

/** Reverses commission the moment a chargeback is opened. */
async function applyAffiliateChargeback(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;

  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  let invoiceId: string | null = null;
  try {
    invoiceId = invoiceIdOf(await stripe.charges.retrieve(chargeId));
  } catch {
    return;
  }

  if (!invoiceId) return;

  await reverseCommission({ invoiceId, reason: "CHARGEBACK" });
}

/**
 * The invoice a charge belongs to.
 *
 * Read through a cast because the pinned Stripe typings for this API version
 * no longer declare `invoice` on `Charge`, while the API still returns it. The
 * shape is narrowed here rather than trusted: anything that is not a string or
 * an object with a string id yields null, and the caller then does nothing.
 */
function invoiceIdOf(charge: unknown): string | null {
  const value = (charge as { invoice?: unknown }).invoice;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
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
