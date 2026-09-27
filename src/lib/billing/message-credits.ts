import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import type { MessageCreditChannel } from "./plans";
import { recordTopUpTermsAcceptance } from "./terms-acceptance";
import {
  attributeUnusedCredit,
  type PurchaseRefundability,
  type RefundState,
  type TopUpPurchaseInput,
} from "./refundability";

/**
 * SMS top-up credits and WhatsApp tokens (8.9).
 *
 * Units per channel: an SMS credit is one UK segment; the WhatsApp balance is
 * in WhatsApp TOKENS (whatsapp-tokens.ts), spent per message by category --
 * never pence, never a £ balance (owner, 2026-09-27). Pre-token WhatsApp
 * message credits were converted to tokens by migration 0147.
 *
 * Same shape as AI token top-ups and deliberately the same guarantees: a
 * checkout only *proposes* a purchase (PENDING); the Stripe webhook is the only
 * thing that marks one PAID and credits it, idempotently three times over
 * (inbox, `credited_at`, the ledger key). Credits are spent only after the
 * plan's monthly allowance (limits.ts) and never expire.
 *
 * Refunds (owner policy 2026-09-27): top-up credit is non-refundable once any
 * of it is used. The owner issues a refund in Stripe; `charge.refunded` marks
 * the purchase REFUNDED and queues `billing.refund_reverse`, which reverses
 * ONLY the purchase's unused credit (FIFO, refundability.ts), never below zero.
 */

// The 0129 tables and RPCs post-date the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** SMS: segments. WhatsApp: tokens. */
export type CreditBalances = Record<MessageCreditChannel, number>;

export async function getCreditBalances(businessId: string): Promise<CreditBalances> {
  const { data, error } = await db()
    .from("message_credit_balances")
    .select("channel, balance")
    .eq("business_id", businessId);
  // A failed read is zero credit: the send gate then refuses rather than
  // spending credit it could not see, which is the safe direction.
  if (error) {
    console.error("[message-credits] balance read failed", { businessId, message: error.message });
  }

  const balances: CreditBalances = { sms: 0, whatsapp: 0 };
  for (const row of (data ?? []) as { channel: MessageCreditChannel; balance: number }[]) {
    balances[row.channel] = Number(row.balance);
  }
  return balances;
}

/**
 * WhatsApp tokens spent on messages since a date: the CONSUMPTION rows of the
 * credit ledger (refund reversals are not usage). The running-low rule reads
 * this, in tokens, the unit the balance is in. Throws on a failed read: zero
 * would read as "nothing used", which silences an alert.
 */
export async function whatsappTokensUsedSince(businessId: string, since: string): Promise<number> {
  const { data, error } = await db()
    .from("message_credit_ledger")
    .select("delta")
    .eq("business_id", businessId)
    .eq("channel", "whatsapp")
    .eq("reason", "CONSUMPTION")
    .gte("created_at", since);
  if (error) throw new Error(`Could not read WhatsApp token usage: ${error.message}`);
  return ((data ?? []) as { delta: number }[]).reduce((sum, row) => sum + Math.max(0, -Number(row.delta)), 0);
}

/**
 * Spends up to `quantity` credits (SMS segments / WhatsApp tokens) for a sent
 * message. Returns how many were spent. Idempotent on the message, so a
 * retried meter never spends twice.
 */
export async function consumeMessageCredits(input: {
  businessId: string;
  channel: MessageCreditChannel;
  quantity: number;
  messageId: string;
}): Promise<number> {
  if (input.quantity <= 0) return 0;
  const { data, error } = await db().rpc("consume_message_credits", {
    target_business_id: input.businessId,
    target_channel: input.channel,
    wanted: Math.ceil(input.quantity),
    idem_key: `consume:${input.messageId}`,
    source_message_id: input.messageId,
  });
  if (error) throw new Error(`consume_message_credits failed: ${error.message}`);
  return Number(data ?? 0);
}

export type CreditPurchaseRow = {
  id: string;
  bundleKey: string;
  channel: MessageCreditChannel;
  credits: number;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  creditedAt: string | null;
  /**
   * True only while none of this purchase's credit has been used (FIFO
   * attribution, refundability.ts). Refunds are issued in Stripe; this is the
   * owner's "can I still refund this?" signal.
   */
  refundable: boolean;
  /** refundable | in_use | refunded | not_credited; label: REFUND_STATE_LABEL. */
  refundState: RefundState;
  /** Credit from this purchase still unused (FIFO). */
  unusedCredits: number;
};

/**
 * FIFO refundability for every credited purchase of a business, per channel.
 * Reads all credited purchases (not a display page): the newest take the
 * remaining balance first. A failed read reports nothing as refundable, which
 * is the safe direction for a refund decision.
 */
async function refundabilityFor(businessId: string) {
  const [purchases, balances] = await Promise.all([
    db()
      .from("message_credit_purchases")
      .select("id, channel, credits, credits_reversed, status, created_at, credited_at")
      .eq("business_id", businessId)
      .in("status", ["PAID", "REFUNDED"]),
    db().from("message_credit_balances").select("channel, balance").eq("business_id", businessId),
  ]);
  if (purchases.error || balances.error) return null;

  const pool: Record<string, number> = {};
  for (const row of (balances.data ?? []) as { channel: string; balance: number }[]) {
    pool[row.channel] = Number(row.balance);
  }
  const byChannel = new Map<string, TopUpPurchaseInput[]>();
  for (const row of (purchases.data ?? []) as Record<string, unknown>[]) {
    const channel = String(row.channel);
    const list = byChannel.get(channel) ?? [];
    list.push({
      id: String(row.id),
      credits: Number(row.credits),
      reversed: Number(row.credits_reversed ?? 0),
      status: String(row.status),
      createdAt: String(row.created_at),
      creditedAt: (row.credited_at as string | null) ?? null,
    });
    byChannel.set(channel, list);
  }

  const result = new Map<string, PurchaseRefundability>();
  for (const [channel, list] of byChannel) {
    for (const [id, value] of attributeUnusedCredit(list, pool[channel] ?? 0)) result.set(id, value);
  }
  return result;
}

export async function listCreditPurchases(businessId: string, limit = 10): Promise<CreditPurchaseRow[]> {
  const [{ data, error }, refundability] = await Promise.all([
    db()
      .from("message_credit_purchases")
      .select("id, bundle_key, channel, credits, amount_minor, currency, status, created_at, credited_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit),
    refundabilityFor(businessId),
  ]);
  if (error) return [];

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const status = String(row.status);
    const fifo = refundability?.get(String(row.id));
    const refundState: RefundState =
      fifo?.state ?? (status === "REFUNDED" ? "refunded" : "not_credited");
    return {
      id: String(row.id),
      bundleKey: String(row.bundle_key),
      channel: row.channel as MessageCreditChannel,
      credits: Number(row.credits),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      status,
      createdAt: String(row.created_at),
      creditedAt: (row.credited_at as string | null) ?? null,
      // Unknown (read failed) is never shown as refundable.
      refundable: fifo?.refundable ?? false,
      refundState,
      unusedCredits: fifo?.unused ?? 0,
    };
  });
}

/** Credits a PAID purchase once. */
export async function creditMessagePurchase(purchaseId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("message_credit_purchases")
    .select("id, business_id, channel, credits, status, credited_at")
    .eq("id", purchaseId)
    .maybeSingle();
  if (error) throw new Error(`message credit purchase read failed: ${error.message}`);

  const purchase = data as {
    id: string;
    business_id: string;
    channel: MessageCreditChannel;
    credits: number;
    status: string;
    credited_at: string | null;
  } | null;
  if (!purchase || purchase.credited_at || purchase.status !== "PAID") return false;

  const credit = await db().rpc("credit_message_credits", {
    target_business_id: purchase.business_id,
    target_channel: purchase.channel,
    credit_amount: Number(purchase.credits),
    idem_key: `purchase:${purchase.id}`,
    source_purchase_id: purchase.id,
  });
  // Throws so Stripe's retry credits it; the ledger key makes the retry safe.
  if (credit.error) throw new Error(`credit_message_credits failed: ${credit.error.message}`);

  logWriteError(
    await db()
      .from("message_credit_purchases")
      .update({ credited_at: new Date().toISOString() })
      .eq("id", purchase.id)
      .is("credited_at", null),
    "message credits: mark credited",
    { businessId: purchase.business_id, purchaseId: purchase.id },
  );
  return true;
}

/** `checkout.session.completed` / `.expired` for a credit top-up. */
export async function applyMessageCreditCheckout(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind !== "message_credits") return;
  const purchaseId = session.metadata?.purchase_id;
  if (!purchaseId) return;

  if (event.type === "checkout.session.expired") {
    assertWrite(
      await db()
        .from("message_credit_purchases")
        .update({ status: "EXPIRED" })
        .eq("id", purchaseId)
        .eq("status", "PENDING"),
      "stripe webhook: expire credit purchase",
      { eventId: event.id, purchaseId },
    );
    return;
  }

  // An async payment method still clearing is not money yet.
  if (session.payment_status !== "paid") return;

  const paid = await db()
    .from("message_credit_purchases")
    .update({
      status: "PAID",
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    })
    .eq("id", purchaseId)
    .in("status", ["PENDING", "PAID"])
    .select("id, business_id, bundle_key, channel, credits")
    .maybeSingle();
  assertWrite(paid, "stripe webhook: mark credit purchase paid", { eventId: event.id, purchaseId });

  const purchase = paid.data as {
    id: string;
    business_id: string;
    bundle_key: string;
    channel: string;
    credits: number;
  } | null;
  if (!purchase) return;

  const credited = await creditMessagePurchase(purchase.id);
  // The top-up terms (non-refundable once any credit is used) accepted at
  // Stripe Checkout, stored with the purchase's session.
  await recordTopUpTermsAcceptance(session, purchase.business_id);
  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    actorType: "provider",
    action: "billing.credits_purchased",
    entityType: "message_credit_purchase",
    entityId: purchase.id,
    metadata: {
      bundleKey: purchase.bundle_key,
      channel: purchase.channel,
      credits: Number(purchase.credits),
      credited,
      stripe_event: event.type,
    },
  });
}

/**
 * `charge.refunded` for a credit top-up (the owner refunded it in Stripe).
 *
 * Ack-fast half only: marks the purchase REFUNDED and queues
 * `billing.refund_reverse`, which reverses the purchase's UNUSED credit. No
 * provider I/O. Safe to replay: the status move is conditional, the job is
 * keyed on the purchase and Stripe's cumulative refunded amount, and the RPC
 * keys its ledger row on the same pair.
 */
export async function applyMessageCreditRefund(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const purchaseId = await creditPurchaseForCharge(charge);
  if (!purchaseId) return;

  assertWrite(
    await db()
      .from("message_credit_purchases")
      .update({ status: "REFUNDED" })
      .eq("id", purchaseId)
      .eq("status", "PAID"),
    "stripe webhook: mark credit purchase refunded",
    { eventId: event.id, purchaseId },
  );

  // Re-read rather than trusting the update: a retry of an event whose first
  // attempt already moved the status must still queue the reversal.
  const read = await db()
    .from("message_credit_purchases")
    .select("id, business_id, status")
    .eq("id", purchaseId)
    .maybeSingle();
  if (read.error) throw new Error(`credit purchase read failed: ${read.error.message}`);
  const purchase = read.data as { id: string; business_id: string; status: string } | null;
  if (!purchase || purchase.status !== "REFUNDED") return;

  const amountRefundedMinor = Number(charge.amount_refunded ?? 0);
  await enqueue(
    "billing.refund_reverse",
    { kind: "message_credits", purchaseId: purchase.id, amountRefundedMinor },
    {
      businessId: purchase.business_id,
      idempotencyKey: `billing.refund_reverse:message_credits:${purchase.id}:${amountRefundedMinor}`,
    },
  );
  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    actorType: "provider",
    action: "billing.credits_refunded",
    entityType: "message_credit_purchase",
    entityId: purchase.id,
    metadata: { stripe_event: event.type, amountRefundedMinor, unusedCreditReversal: "queued" },
  });
}

/**
 * The purchase a refunded charge paid for: from the charge metadata copied off
 * the PaymentIntent, else by the PaymentIntent id recorded when it was paid.
 */
async function creditPurchaseForCharge(charge: Stripe.Charge): Promise<string | null> {
  if (charge.metadata?.kind === "message_credits" && charge.metadata.purchase_id) {
    return charge.metadata.purchase_id;
  }
  if (charge.metadata?.kind) return null; // Someone else's charge.
  const paymentIntent =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) return null;
  const { data } = await db()
    .from("message_credit_purchases")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntent)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The `billing.refund_reverse` job for a credit purchase: reverses only the
 * credit from it that is still unused (FIFO), never below zero, idempotent on
 * `refund:<purchase>:<cumulative amount refunded>`. Returns credits reversed.
 */
export async function reverseRefundedCreditPurchase(input: {
  purchaseId: string;
  amountRefundedMinor: number;
}): Promise<number> {
  const read = await db()
    .from("message_credit_purchases")
    .select("id, business_id, channel, status")
    .eq("id", input.purchaseId)
    .maybeSingle();
  if (read.error) throw new Error(`credit purchase read failed: ${read.error.message}`);
  const purchase = read.data as { id: string; business_id: string; channel: string; status: string } | null;
  // Re-checked now: only a purchase that is (still) refunded is reversed.
  if (!purchase || purchase.status !== "REFUNDED") return 0;

  const { data, error } = await db().rpc("reverse_message_credit_purchase", {
    target_purchase_id: purchase.id,
    amount_refunded_minor: Math.max(Math.floor(input.amountRefundedMinor), 0),
    idem_key: `refund:${purchase.id}:${Math.max(Math.floor(input.amountRefundedMinor), 0)}`,
  });
  if (error) throw new Error(`reverse_message_credit_purchase failed: ${error.message}`);
  const reversed = Number(data ?? 0);

  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    actorType: "system",
    action: "billing.credits_refunded",
    entityType: "message_credit_purchase",
    entityId: purchase.id,
    metadata: { phase: "unused_credit_reversed", channel: purchase.channel, creditsReversed: reversed, amountRefundedMinor: input.amountRefundedMinor },
  });
  return reversed;
}
