import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { stripe } from "@/lib/billing/stripe";
import { recordAudit } from "@/lib/audit";
import { creditTokenPurchase } from "@/lib/billing/token-service";
import { recordTopUpTermsAcceptance } from "@/lib/billing/terms-acceptance";
import {
  applyStripeSubscription,
  applySubscriptionCheckout,
  notifyTrialEnding,
} from "@/lib/billing/subscription-sync";
import { recordInvoiceFailure, recordInvoicePaid } from "@/lib/billing/dunning";
import {
  applyMessageCreditCheckout,
  applyMessageCreditRefund,
} from "@/lib/billing/message-credits";
import { accrueCommission } from "@/lib/affiliates/commissions";
import { commissionBaseMinor, isCommissionableInvoice } from "@/lib/affiliates/ledger-rules";
import {
  billingEventJobKey,
  disputeEvent,
  refundEvent,
  type AffiliateBillingEvent,
} from "@/lib/affiliates/billing-event-rules";
import { enqueue } from "@/lib/jobs/queue";
import { recordUpsellConversion } from "@/lib/billing/upsell-service";
import { applyVoicePackCheckout, applyVoicePackRefund } from "@/lib/billing/voice-webhook";
import { recordInvoiceActionRequired } from "@/lib/billing/dunning";
import { recordPaidInvoice } from "@/lib/billing/invoice-ledger";
import { recordDisputeClosed, recordDisputeOpened } from "@/lib/billing/disputes";
import {
  asCompletedCheckoutEvent,
  asyncPaymentFailedNotice,
  checkoutEventMeaning,
  invoiceAmounts,
  oneOffKindOf,
} from "@/lib/billing/stripe-events";
import { queueNotification } from "@/lib/jobs/handlers/shared";

export const dynamic = "force-dynamic";

const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Three days' notice before the card is first charged (8.10).
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  // 3-D Secure (SCA) on a renewal: the owner is sent to confirm it
  // (dunning.ts `recordInvoiceActionRequired`). No access change by itself.
  "invoice.payment_action_required",
  // One-off AI token top-ups. `checkout.session.completed` is the only place
  // tokens are ever granted -- nothing in the app credits an allowance,
  // because nothing in the app has seen the money.
  "checkout.session.completed",
  "checkout.session.expired",
  // Delayed payment methods (bank debits): a completed session is "unpaid"
  // and grants nothing until one of these arrives (stripe-events.ts).
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
  // Affiliate commission is accrued and reversed from these, never from a page.
  // A dispute is treated as a reversal at the point it is opened rather than
  // when it is lost: money that is being clawed back should stop looking
  // payable immediately.
  "charge.dispute.created",
  // A chargeback also claws back the disputed purchase's unused tokens,
  // minutes or credit, and a won dispute gives them back (billing/disputes.ts).
  "charge.dispute.closed",
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
    // A duplicate of an event whose earlier attempt *failed* is Stripe's retry
    // doing its job, and must be re-applied: answering "duplicate" there would
    // drop the transition for good. The conditional update is the claim, so
    // two concurrent retries cannot both re-apply. Every transition below is
    // idempotent (fixed-value updates, conditional status moves, keyed
    // ledgers), which is what makes re-applying safe.
    const { data: reclaimed, error: reclaimError } = await supabase
      .from("webhook_events")
      .update({ status: "processing", last_error: null })
      .eq("provider", "stripe")
      .eq("external_event_id", event.id)
      .eq("status", "failed")
      .select("id");
    if (reclaimError) {
      console.error("[stripe webhook] could not reclaim failed event", {
        eventId: event.id,
        code: reclaimError.code,
        message: reclaimError.message,
      });
      return NextResponse.json({ error: "inbox unavailable" }, { status: 500 });
    }
    if (!reclaimed?.length) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } else if (inboxError) {
    // No inbox row means no idempotency guard. Refuse, and let Stripe retry,
    // rather than apply a transition that a retry could apply again.
    console.error("[stripe webhook] inbox insert failed", {
      eventId: event.id,
      code: inboxError.code,
      message: inboxError.message,
    });
    return NextResponse.json({ error: "inbox unavailable" }, { status: 500 });
  }

  try {
    // v2 "thin" events (`v2.core.*`) are Accounts v2 / Connect territory.
    // Nothing here consumes them, but they are verified and acknowledged so
    // Stripe stops retrying, and recorded so an unexpected one is visible
    // rather than silently dropped.
    if (HANDLED.has(event.type)) {
      await applyEvent(event);
    }

    logWriteError(
      await supabase
        .from("webhook_events")
        .update({
          status: HANDLED.has(event.type) ? "processed" : "ignored",
          processed_at: new Date().toISOString(),
        })
        .eq("provider", "stripe")
        .eq("external_event_id", event.id),
      "stripe webhook: mark processed",
      { eventId: event.id, eventType: event.type },
    );
  } catch (error) {
    logWriteError(
      await supabase
        .from("webhook_events")
        .update({
          status: "failed",
          last_error: error instanceof Error ? error.message : String(error),
        })
        .eq("provider", "stripe")
        .eq("external_event_id", event.id),
      "stripe webhook: mark failed",
      { eventId: event.id, eventType: event.type },
    );

    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true, destination });
}

async function applyEvent(event: Stripe.Event) {
  const checkoutMeaning = checkoutEventMeaning(event.type);
  if (checkoutMeaning === "async_failed") {
    await applyAsyncPaymentFailed(event);
    return;
  }
  if (checkoutMeaning) {
    // A delayed payment that has now cleared is applied exactly as a paid
    // `checkout.session.completed`: every grant below is keyed on its
    // purchase or session, so nothing is credited twice.
    const grantEvent = asCompletedCheckoutEvent(event);
    // Each is a no-op for the others' sessions (keyed on metadata.kind).
    await applyTokenCheckout(grantEvent);
    await applyMessageCreditCheckout(grantEvent);
    await applyWhatsappUpsellConversion(grantEvent);
    // Voice minute packs (OD-2): credits minutes, keyed on the session id.
    await applyVoicePackCheckout(grantEvent);
    // Terms and customer id are recorded from the original completion only.
    if (event.type === "checkout.session.completed") {
      await applySubscriptionCheckout(event.data.object as Stripe.Checkout.Session, {
        eventId: event.id,
      });
    }
    return;
  }

  if (event.type === "charge.refunded") {
    // A refund can be a token top-up, a message-credit top-up or a
    // subscription payment that earned an affiliate commission. All are
    // attempted; each is a no-op for the others' charges. A top-up refund
    // only marks the purchase and queues `billing.refund_reverse`, which
    // reverses the purchase's UNUSED credit off the request path.
    await applyTokenRefund(event);
    await applyMessageCreditRefund(event);
    await applyVoicePackRefund(event);
    // Affiliate commission: queued, never applied here (the invoice may have
    // to be resolved through Stripe, which a webhook must not call).
    await enqueueAffiliateBillingEvent(refundEvent(event.id, event.data.object));
    return;
  }

  if (event.type === "charge.dispute.created") {
    await enqueueAffiliateBillingEvent(disputeEvent(event.id, event.type, event.data.object));
    // Records the dispute and QUEUES the clawback of the purchase's unused
    // units (no ledger work on the request path), and tells the owner.
    await recordDisputeOpened(event.data.object as Stripe.Dispute, event.id);
    return;
  }

  if (event.type === "charge.dispute.closed") {
    await recordDisputeClosed(event.data.object as Stripe.Dispute, event.id);
    // A WON dispute re-accrues the commission it reversed (affiliate audit 17).
    await enqueueAffiliateBillingEvent(disputeEvent(event.id, event.type, event.data.object));
    return;
  }

  if (event.type === "invoice.payment_action_required") {
    await recordInvoiceActionRequired(event.data.object as Stripe.Invoice, event.id);
    return;
  }

  if (event.type === "customer.subscription.trial_will_end") {
    await notifyTrialEnding(event.data.object as Stripe.Subscription);
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    // Throws on a failed write: the catch above marks the event failed and
    // answers 500, and Stripe's retry re-applies it.
    await applyStripeSubscription(event.data.object as Stripe.Subscription, {
      eventType: event.type,
      eventId: event.id,
      deleted: event.type === "customer.subscription.deleted",
    });
    return;
  }

  if (event.type === "invoice.paid") {
    // Stops any daily retry of this invoice immediately, then accrues
    // affiliate commission for the payment.
    await recordInvoicePaid(event.data.object as Stripe.Invoice, event.id);
    // The real amounts (paid, discounts, tax) and the subscription's real MRR,
    // for admin revenue (billing/invoice-ledger.ts).
    await recordPaidInvoice(event.data.object as Stripe.Invoice, event.id);
    await applyAffiliateAccrual(event);
    return;
  }

  if (event.type === "invoice.payment_failed") {
    // Opens the daily retry (dunning) for a subscription invoice. No Stripe
    // I/O here: the retry itself is the daily job's.
    await recordInvoiceFailure(event.data.object as Stripe.Invoice, event.id);
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

  // What the customer actually paid, VAT included (the invite rule and the
  // scale a later refund is measured on).
  const amountPaidMinor = invoice.amount_paid ?? 0;
  if (amountPaidMinor <= 0) return;

  // A subscription's first PAID invoice is the moment a workspace becomes a
  // paying customer -- the point to invite them to the Zapier integration.
  // With a card-first trial the `subscription_create` invoice is £0 (returned
  // above), so the first paid one is the post-trial `subscription_cycle`.
  // Any paid subscription invoice qualifies; the key is the business alone
  // (not the invoice), so it fires exactly once per workspace, ever.
  if (
    isFirstPaidInviteCandidate(invoice.billing_reason ?? null, amountPaidMinor) &&
    !(await integrationsInviteAlreadySent(businessId))
  ) {
    await enqueue(
      "notification.send",
      { kind: "developer_integrations_invite", businessId },
      {
        businessId,
        idempotencyKey: `notification.send:developer-integrations-invite:${businessId}`,
      },
    );
  }

  // Only subscription money earns commission, on the amount actually paid
  // net of VAT, discounts and credit (ledger-rules.ts, audit 17 §2).
  if (!isCommissionableInvoice(invoice.billing_reason ?? null)) return;
  const amounts = invoiceAmounts(invoice as unknown as Parameters<typeof invoiceAmounts>[0]);
  const baseMinor = commissionBaseMinor({
    amountPaidMinor: amounts.amountPaidMinor,
    totalMinor: Math.max(0, Number(invoice.total ?? 0)),
    totalExcludingTaxMinor: amounts.totalExcludingTaxMinor,
  });
  if (baseMinor <= 0) return;

  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000)
    : new Date();
  const paidAtUnix = (invoice as unknown as { status_transitions?: { paid_at?: number | null } })
    .status_transitions?.paid_at;

  const result = await accrueCommission({
    businessId,
    amountPaidMinor: baseMinor,
    grossPaidMinor: amountPaidMinor,
    currency: (invoice.currency ?? "gbp").toUpperCase(),
    invoiceId: invoice.id ?? `invoice_${event.id}`,
    periodMonth: `${periodStart.getUTCFullYear()}-${String(
      periodStart.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`,
    paidAt: paidAtUnix ? new Date(paidAtUnix * 1000).toISOString() : undefined,
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
 * The job's idempotency key only lasts as long as the finished job row, which
 * retention purges. The notification row it writes is kept, so it is the
 * durable "already invited" marker. A failed read errs towards not inviting.
 */
async function integrationsInviteAlreadySent(businessId: string): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .ilike("title", "Connect Client Turn to%Zapier%");
  if (error) {
    console.error("[stripe] integrations invite check failed", { businessId, message: error.message });
    return true;
  }
  return (count ?? 0) > 0;
}

/** Paid subscription invoices; the idempotency key makes only the first count. */
function isFirstPaidInviteCandidate(billingReason: string | null, amountPaidMinor: number): boolean {
  return (
    amountPaidMinor > 0 &&
    (billingReason === "subscription_create" ||
      billingReason === "subscription_cycle" ||
      billingReason === "subscription_update")
  );
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

/**
 * Queues a refund or dispute for the affiliate ledger (`affiliate.billing_event`).
 * One job per Stripe event; the job resolves the invoice and applies the
 * keyed reversal or re-accrual (lib/affiliates/billing-events.ts).
 */
async function enqueueAffiliateBillingEvent(payload: AffiliateBillingEvent | null) {
  if (!payload) return;
  await enqueue("affiliate.billing_event", payload as unknown as Record<string, unknown>, {
    idempotencyKey: billingEventJobKey(payload),
  });
}

/* ------------------------------------------------ delayed payment failed */

/**
 * `checkout.session.async_payment_failed`: a bank-debit payment for a one-off
 * pack failed after Checkout completed. The purchase row (AI tokens, SMS or
 * WhatsApp credit) moves PENDING -> FAILED; a voice pack has no row until it
 * is paid. Nothing was ever granted, the subscription is untouched, and the
 * owner is told. Replay-safe: the status move is conditional and the notice
 * is keyed on the session.
 */
async function applyAsyncPaymentFailed(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const kind = oneOffKindOf(session.metadata?.kind);
  const businessId = session.metadata?.business_id;
  if (!kind || !businessId) return;

  const purchaseId = session.metadata?.purchase_id;
  const table =
    kind === "ai_tokens" ? "ai_token_purchases" : kind === "message_credits" ? "message_credit_purchases" : null;
  if (table && purchaseId) {
    assertWrite(
      await (createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient)
        .from(table)
        .update({ status: "FAILED" })
        .eq("id", purchaseId)
        .eq("status", "PENDING"),
      "stripe webhook: mark delayed payment failed",
      { eventId: event.id, purchaseId },
    );
  }

  const notice = asyncPaymentFailedNotice(kind);
  await queueNotification({
    businessId,
    type: "billing",
    severity: "warning",
    title: notice.title,
    body: notice.body,
    linkUrl: "/app/settings?section=billing",
    dedupeKey: `async_payment_failed:${session.id}`,
  });
  await recordAudit({
    businessId,
    actorUserId: null,
    actorType: "provider",
    action: "billing.async_payment_failed",
    entityType: kind === "ai_tokens" ? "ai_token_purchase" : kind === "message_credits" ? "message_credit_purchase" : "voice_minute_pack",
    entityId: purchaseId ?? null,
    metadata: { sessionId: session.id, stripe_event: event.type },
  });
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
    assertWrite(
      await supabase
        .from("ai_token_purchases")
        .update({ status: "EXPIRED" })
        .eq("id", purchaseId)
        .eq("status", "PENDING"),
      "stripe webhook: expire token purchase",
      { eventId: event.id, purchaseId },
    );
    return;
  }

  // Only a genuinely paid session grants anything. An unpaid completed session
  // (an async payment method still clearing) stays PENDING until it settles.
  if (session.payment_status !== "paid") return;

  const paidUpdate = await supabase
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
  // A failed update used to read as "no such purchase" and return, leaving a
  // paid top-up uncredited. Throwing lets Stripe's retry credit it; the
  // credit itself is guarded by `credited_at` and the ledger key.
  assertWrite(paidUpdate, "stripe webhook: mark token purchase paid", {
    eventId: event.id,
    purchaseId,
  });
  const purchase = paidUpdate.data;

  if (!purchase) return;

  const credited = await creditTokenPurchase(purchase.id);
  // Analytics only: credited to an upsell when it follows a click on one.
  await recordUpsellConversion({
    businessId: purchase.business_id,
    offer: "ai_token_pack",
    ref: `ai_tokens:${purchase.id}`,
  });
  // The top-up terms (clause 9.9: non-refundable once any credit is used)
  // accepted at Checkout, stored with the purchase's session.
  await recordTopUpTermsAcceptance(session, purchase.business_id);

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
 * `charge.refunded` for an AI token pack (the owner refunded it in Stripe).
 *
 * Owner policy 2026-09-27: top-up credit is non-refundable once any of it is
 * used, and a refund reverses ONLY the pack's unused tokens. This is the
 * ack-fast half: mark the purchase REFUNDED and queue
 * `billing.refund_reverse`, which does the reversal (FIFO, never below zero)
 * off the request path. Replay-safe: the status move is conditional, the job
 * is keyed on the purchase and Stripe's cumulative refunded amount, and the
 * reversal RPC keys its ledger row on the same pair.
 */
async function applyTokenRefund(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  const purchaseId = await tokenPurchaseForCharge(charge);
  if (!purchaseId) return;

  const supabase = createAdminClient();
  assertWrite(
    await supabase
      .from("ai_token_purchases")
      .update({ status: "REFUNDED" })
      .eq("id", purchaseId)
      .eq("status", "PAID"),
    "stripe webhook: mark token purchase refunded",
    { eventId: event.id, purchaseId },
  );

  // Re-read rather than trusting the update: a retry of an event whose first
  // attempt already moved the status must still queue the reversal.
  const { data: purchase, error } = await supabase
    .from("ai_token_purchases")
    .select("id, business_id, status")
    .eq("id", purchaseId)
    .maybeSingle();
  if (error) throw new Error(`token purchase read failed: ${error.message}`);
  if (!purchase || purchase.status !== "REFUNDED") return;

  const amountRefundedMinor = Number(charge.amount_refunded ?? 0);
  await enqueue(
    "billing.refund_reverse",
    { kind: "ai_tokens", purchaseId: purchase.id, amountRefundedMinor },
    {
      businessId: purchase.business_id,
      idempotencyKey: `billing.refund_reverse:ai_tokens:${purchase.id}:${amountRefundedMinor}`,
    },
  );

  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    actorType: "provider",
    action: "billing.tokens_refunded",
    entityType: "ai_token_purchase",
    entityId: purchase.id,
    metadata: { stripe_event: event.type, amountRefundedMinor, unusedTokenReversal: "queued" },
  });
}

/**
 * The token purchase a refunded charge paid for: from the charge metadata
 * copied off the PaymentIntent, else by the PaymentIntent id recorded when the
 * purchase was paid. A charge tagged for anything else is not ours.
 */
async function tokenPurchaseForCharge(charge: Stripe.Charge): Promise<string | null> {
  if (charge.metadata?.kind === "ai_tokens" && charge.metadata.purchase_id) {
    return charge.metadata.purchase_id;
  }
  if (charge.metadata?.kind) return null;
  const paymentIntent =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) return null;
  const { data } = await createAdminClient()
    .from("ai_token_purchases")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * A paid WhatsApp token pack, credited to an upsell when it follows a click on
 * one (upsell-moments `attributePurchase`). Analytics only and never throws;
 * the pack itself is credited by `applyMessageCreditCheckout`.
 */
async function applyWhatsappUpsellConversion(event: Stripe.Event) {
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== "message_credits" || session.payment_status !== "paid") return;
  const businessId = session.metadata?.business_id;
  const purchaseId = session.metadata?.purchase_id;
  if (!businessId || !purchaseId || !session.metadata?.bundle_key?.startsWith("whatsapp")) return;
  await recordUpsellConversion({ businessId, offer: "whatsapp_tokens", ref: `message_credits:${purchaseId}` });
}
