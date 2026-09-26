import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import type { MessageCreditChannel } from "./plans";

/**
 * SMS and WhatsApp top-up credits (8.9).
 *
 * Same shape as AI token top-ups and deliberately the same guarantees: a
 * checkout only *proposes* a purchase (PENDING); the Stripe webhook is the only
 * thing that marks one PAID and credits it, idempotently three times over
 * (inbox, `credited_at`, the ledger key). Credits are spent after the plan's
 * monthly allowance and before any overage (limits.ts), never expire, and are
 * not clawed back on refund -- support adjusts a balance deliberately if that
 * is ever genuinely wanted.
 */

// The 0129 tables and RPCs post-date the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

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
 * Spends up to `quantity` credits for a sent message. Returns how many were
 * spent. Idempotent on the message, so a retried meter never spends twice.
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
};

export async function listCreditPurchases(businessId: string, limit = 10): Promise<CreditPurchaseRow[]> {
  const { data, error } = await db()
    .from("message_credit_purchases")
    .select("id, bundle_key, channel, credits, amount_minor, currency, status, created_at, credited_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    bundleKey: String(row.bundle_key),
    channel: row.channel as MessageCreditChannel,
    credits: Number(row.credits),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    status: String(row.status),
    createdAt: String(row.created_at),
    creditedAt: (row.credited_at as string | null) ?? null,
  }));
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

/** A refunded top-up is marked REFUNDED; credits already granted stay. */
export async function applyMessageCreditRefund(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  if (charge.metadata?.kind !== "message_credits") return;
  const purchaseId = charge.metadata?.purchase_id;
  if (!purchaseId) return;

  const refunded = await db()
    .from("message_credit_purchases")
    .update({ status: "REFUNDED" })
    .eq("id", purchaseId)
    .eq("status", "PAID")
    .select("id, business_id")
    .maybeSingle();
  assertWrite(refunded, "stripe webhook: mark credit purchase refunded", { eventId: event.id, purchaseId });

  const purchase = refunded.data as { id: string; business_id: string } | null;
  if (!purchase) return;
  await recordAudit({
    businessId: purchase.business_id,
    actorUserId: null,
    actorType: "provider",
    action: "billing.credits_refunded",
    entityType: "message_credit_purchase",
    entityId: purchase.id,
    metadata: { stripe_event: event.type, creditsClawedBack: false },
  });
}
