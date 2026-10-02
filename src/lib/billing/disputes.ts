import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import { supabaseMinuteStore } from "@/lib/voice/minutes";
import { voicePackRefund } from "@/lib/voice/pack-refund";
import { tokensToCredits } from "@/lib/billing/tokens";
import { stripe } from "./stripe";
import { ensureTokenBalance } from "./token-service";
import {
  disputeClawbackAmount,
  disputeNotice,
  disputeOutcome,
  disputeRestoreKey,
  disputeReversalKey,
  isSchemaMissing,
  type DisputeOutcome,
} from "./stripe-events";

/**
 * Chargebacks (gap audit 15 top-10 #7b). Before this, a dispute reversed only
 * affiliate commission: the tokens, minutes or credit bought with the
 * disputed payment stayed spendable.
 *
 *   charge.dispute.created  -> `recordDisputeOpened`: one `billing_disputes`
 *                              row (unique on the dispute id), then the
 *                              clawback is QUEUED (`billing.refund_reverse`,
 *                              kind "dispute"), never done on the request.
 *   the job                 -> `reverseDisputedPurchase`: takes back only the
 *                              purchase's still-UNUSED units, FIFO, never below
 *                              zero -- the same rule and the same RPCs as a
 *                              refund (refundability.ts, 0142), keyed on
 *                              `dispute:<id>`, so it happens once.
 *   charge.dispute.closed   -> `recordDisputeClosed`: WON gives back exactly
 *                              what was taken (`dispute_won:<id>`, 0165 RPCs);
 *                              LOST keeps it removed. The owner is told either
 *                              way.
 *
 * A dispute on a subscription payment claws back nothing (there is no pack
 * behind it); affiliate commission is reversed by the webhook as before and
 * the owner is told.
 */

type PurchaseKind = "ai_tokens" | "message_credits" | "voice_pack" | "subscription" | "unknown";

type DisputeRow = {
  id: string;
  business_id: string;
  stripe_dispute_id: string;
  payment_intent_id: string | null;
  purchase_kind: PurchaseKind;
  purchase_id: string | null;
  amount_minor: number;
  status: "OPEN" | "WON" | "LOST";
  reversed_units: number;
  restored_units: number;
};

const COLUMNS =
  "id, business_id, stripe_dispute_id, payment_intent_id, purchase_kind, purchase_id, amount_minor, status, reversed_units, restored_units";

// billing_disputes (0165) post-dates the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

const KIND_LABEL: Record<PurchaseKind, { kind: string; unit: string }> = {
  ai_tokens: { kind: "AI credit pack", unit: "AI credits" },
  message_credits: { kind: "top-up", unit: "credits" },
  voice_pack: { kind: "voice minute pack", unit: "voice minutes" },
  subscription: { kind: "subscription payment", unit: "units" },
  unknown: { kind: "payment", unit: "units" },
};

/** Seconds are stored for voice, model tokens for AI; the owner reads minutes and AI credits. */
function displayUnits(kind: PurchaseKind, units: number): number {
  if (kind === "ai_tokens") return Math.floor(tokensToCredits(units));
  return kind === "voice_pack" ? Math.floor(units / 60) : units;
}

type Located = { kind: PurchaseKind; businessId: string; purchaseId: string | null; chargeAmountMinor: number | null };

/**
 * What the disputed payment bought, from our own records keyed on the
 * PaymentIntent. Only when none matches is the charge read back from Stripe,
 * to find the customer of a disputed subscription payment.
 */
async function locate(dispute: Stripe.Dispute): Promise<Located | null> {
  const pi = idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent);
  const client = db();
  if (pi) {
    const token = await client
      .from("ai_token_purchases")
      .select("id, business_id, amount_minor")
      .eq("stripe_payment_intent_id", pi)
      .maybeSingle();
    if (token.error) throw new Error(`dispute: token purchase lookup: ${token.error.message}`);
    if (token.data) {
      const row = token.data as { id: string; business_id: string; amount_minor: number | null };
      return { kind: "ai_tokens", businessId: row.business_id, purchaseId: row.id, chargeAmountMinor: row.amount_minor };
    }
    const credit = await client
      .from("message_credit_purchases")
      .select("id, business_id, amount_minor")
      .eq("stripe_payment_intent_id", pi)
      .maybeSingle();
    if (credit.error) throw new Error(`dispute: credit purchase lookup: ${credit.error.message}`);
    if (credit.data) {
      const row = credit.data as { id: string; business_id: string; amount_minor: number | null };
      return { kind: "message_credits", businessId: row.business_id, purchaseId: row.id, chargeAmountMinor: row.amount_minor };
    }
    const pack = await client
      .from("voice_minute_ledger")
      .select("business_id")
      .eq("kind", "PACK_PURCHASE")
      .eq("stripe_ref", pi)
      .limit(1)
      .maybeSingle();
    if (pack.error) throw new Error(`dispute: voice pack lookup: ${pack.error.message}`);
    if (pack.data) {
      return { kind: "voice_pack", businessId: (pack.data as { business_id: string }).business_id, purchaseId: null, chargeAmountMinor: null };
    }
  }

  // Not a top-up: most likely a subscription payment. The charge names the
  // customer; the mirror names the workspace.
  const chargeId = idOf(dispute.charge);
  if (!chargeId) return null;
  let customerId: string | null = null;
  let amount: number | null = null;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    customerId = idOf(charge.customer);
    amount = charge.amount ?? null;
  } catch {
    return null;
  }
  if (!customerId) return null;
  const sub = await client.from("subscriptions").select("business_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (sub.error) throw new Error(`dispute: subscription lookup: ${sub.error.message}`);
  const businessId = (sub.data as { business_id: string } | null)?.business_id;
  return businessId ? { kind: "subscription", businessId, purchaseId: null, chargeAmountMinor: amount } : null;
}

/** `charge.dispute.created`: record it once, queue the clawback, tell the owner. */
export async function recordDisputeOpened(dispute: Stripe.Dispute, eventId: string): Promise<void> {
  const located = await locate(dispute);
  if (!located) return;

  const insert = await db()
    .from("billing_disputes")
    .upsert(
      {
        business_id: located.businessId,
        stripe_dispute_id: dispute.id,
        stripe_charge_id: idOf(dispute.charge),
        payment_intent_id: idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent),
        purchase_kind: located.kind,
        purchase_id: located.purchaseId,
        amount_minor: disputeClawbackAmount({ disputedMinor: dispute.amount, chargeAmountMinor: located.chargeAmountMinor }),
        currency: dispute.currency ?? null,
        reason: dispute.reason ?? null,
        stripe_status: dispute.status ?? null,
      },
      { onConflict: "stripe_dispute_id", ignoreDuplicates: true },
    );
  // Shipped before migration 0165 is applied: the affiliate reversal above
  // still ran; the clawback waits for the table rather than failing the event.
  if (isSchemaMissing(insert.error)) {
    console.warn("[stripe webhook] billing_disputes missing (0165 not applied); dispute not recorded", { dispute: dispute.id });
    return;
  }
  assertWrite(insert, "stripe webhook: record dispute", { eventId, businessId: located.businessId });

  if (located.kind === "ai_tokens" || located.kind === "message_credits" || located.kind === "voice_pack") {
    await enqueue(
      "billing.refund_reverse",
      { kind: "dispute", disputeId: dispute.id, action: "reverse" },
      { businessId: located.businessId, idempotencyKey: `billing.refund_reverse:dispute:${dispute.id}:reverse` },
    );
  } else {
    // Nothing to claw back on a subscription payment; the owner still hears.
    const copy = disputeNotice({ outcome: "open", kindLabel: KIND_LABEL[located.kind].kind, reversedUnits: 0, unitLabel: "units" });
    await queueNotification({
      businessId: located.businessId,
      type: "billing",
      severity: copy.severity === "info" ? "info" : copy.severity,
      title: copy.title,
      body: copy.body,
      linkUrl: "/app/settings?section=billing",
      dedupeKey: `dispute:${dispute.id}:open`,
    });
  }

  await recordAudit({
    businessId: located.businessId,
    actorType: "provider",
    action: "billing.dispute_opened",
    entityType: "billing_dispute",
    metadata: { dispute: dispute.id, kind: located.kind, amountMinor: dispute.amount, reason: dispute.reason ?? null, eventId },
  });
}

/** `charge.dispute.closed`: WON restores, LOST keeps the clawback. */
export async function recordDisputeClosed(dispute: Stripe.Dispute, eventId: string): Promise<void> {
  const outcome = disputeOutcome(dispute.status);
  if (outcome === "open") return;
  const status = outcome === "won" ? "WON" : "LOST";

  const updated = await db()
    .from("billing_disputes")
    .update({ status, stripe_status: dispute.status ?? null, closed_at: new Date().toISOString() })
    .eq("stripe_dispute_id", dispute.id)
    .select(COLUMNS)
    .maybeSingle();
  if (isSchemaMissing(updated.error)) return;
  assertWrite(updated, "stripe webhook: close dispute", { eventId, dispute: dispute.id });
  const row = updated.data as DisputeRow | null;
  // Opened before this code shipped (no row): nothing was clawed back, so
  // there is nothing to restore.
  if (!row) return;

  if (outcome === "won" && row.purchase_kind !== "subscription" && row.purchase_kind !== "unknown") {
    await enqueue(
      "billing.refund_reverse",
      { kind: "dispute", disputeId: dispute.id, action: "restore" },
      { businessId: row.business_id, idempotencyKey: `billing.refund_reverse:dispute:${dispute.id}:restore` },
    );
  } else {
    await notifyDispute(row, outcome, row.reversed_units);
  }

  await recordAudit({
    businessId: row.business_id,
    actorType: "provider",
    action: "billing.dispute_closed",
    entityType: "billing_dispute",
    entityId: row.id,
    metadata: { dispute: dispute.id, outcome, stripe_status: dispute.status ?? null, eventId },
  });
}

async function notifyDispute(row: DisputeRow, outcome: DisputeOutcome, units: number): Promise<void> {
  const label = KIND_LABEL[row.purchase_kind];
  const copy = disputeNotice({
    outcome,
    kindLabel: label.kind,
    reversedUnits: displayUnits(row.purchase_kind, units),
    unitLabel: label.unit,
  });
  await queueNotification({
    businessId: row.business_id,
    type: "billing",
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    linkUrl: "/app/settings?section=billing",
    dedupeKey: `dispute:${row.stripe_dispute_id}:${outcome}`,
  });
}

async function readDispute(disputeId: string): Promise<DisputeRow | null> {
  const { data, error } = await db().from("billing_disputes").select(COLUMNS).eq("stripe_dispute_id", disputeId).maybeSingle();
  if (error) throw new Error(`dispute read: ${error.message}`);
  return (data as DisputeRow | null) ?? null;
}

/** Units a ledger row keyed `key` moved (absolute), or null when there is none yet. */
async function ledgerUnits(row: DisputeRow, key: string): Promise<number | null> {
  const client = db();
  if (row.purchase_kind === "ai_tokens") {
    const { data, error } = await client
      .from("ai_token_ledger")
      .select("delta_tokens")
      .eq("business_id", row.business_id)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(`dispute ledger read: ${error.message}`);
    return data ? Math.abs(Number((data as { delta_tokens: number }).delta_tokens)) : null;
  }
  if (row.purchase_kind === "message_credits") {
    const { data, error } = await client
      .from("message_credit_ledger")
      .select("delta")
      .eq("business_id", row.business_id)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(`dispute ledger read: ${error.message}`);
    return data ? Math.abs(Number((data as { delta: number }).delta)) : null;
  }
  const { data, error } = await client
    .from("voice_minute_ledger")
    .select("pack_delta_sec")
    .eq("business_id", row.business_id)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw new Error(`dispute ledger read: ${error.message}`);
  return data ? Math.abs(Number((data as { pack_delta_sec: number }).pack_delta_sec)) : null;
}

/**
 * The `billing.refund_reverse` job, kind "dispute". Retry-safe: it re-reads
 * the dispute row (a dispute already closed as WON before the clawback ran is
 * not clawed back at all), and every ledger write is keyed, so a retried job
 * moves nothing twice. The units moved are read back from the ledger, so a
 * crash between the RPC and the bookkeeping still records the right figure.
 */
export async function runDisputeJob(input: { disputeId: string; action: "reverse" | "restore" }): Promise<number> {
  const row = await readDispute(input.disputeId);
  if (!row) return 0;
  if (input.action === "reverse") return reverseDisputedPurchase(row);
  return restoreDisputedPurchase(row);
}

async function reverseDisputedPurchase(row: DisputeRow): Promise<number> {
  // Closed as won before the job ran: the money stayed, so take nothing.
  if (row.status === "WON") return 0;
  const key = disputeReversalKey(row.stripe_dispute_id);
  let units = await ledgerUnits(row, key);

  if (units === null) {
    if (row.purchase_kind === "ai_tokens" && row.purchase_id) {
      const balance = await ensureTokenBalance(row.business_id);
      const { error } = await db().rpc("reverse_ai_token_purchase", {
        target_purchase_id: row.purchase_id,
        target_period_start: balance.periodStart,
        amount_refunded_minor: row.amount_minor,
        idem_key: key,
      });
      if (error) throw new Error(`reverse_ai_token_purchase (dispute) failed: ${error.message}`);
    } else if (row.purchase_kind === "message_credits" && row.purchase_id) {
      const { error } = await db().rpc("reverse_message_credit_purchase", {
        target_purchase_id: row.purchase_id,
        amount_refunded_minor: row.amount_minor,
        idem_key: key,
      });
      if (error) throw new Error(`reverse_message_credit_purchase (dispute) failed: ${error.message}`);
    } else if (row.purchase_kind === "voice_pack" && row.payment_intent_id) {
      await reverseVoicePack(row, key);
    }
    units = (await ledgerUnits(row, key)) ?? 0;
  }

  assertWrite(
    await db().from("billing_disputes").update({ reversed_units: units }).eq("id", row.id),
    "dispute: record clawback",
    { businessId: row.business_id, dispute: row.stripe_dispute_id },
  );
  await notifyDispute(row, "open", units);
  return units;
}

async function restoreDisputedPurchase(row: DisputeRow): Promise<number> {
  if (row.status !== "WON") return 0;
  const key = disputeRestoreKey(row.stripe_dispute_id);
  // What was actually taken, from the ledger (the row can lag a crash).
  const reversed = (await ledgerUnits(row, disputeReversalKey(row.stripe_dispute_id))) ?? row.reversed_units;
  let restored = await ledgerUnits(row, key);

  if (restored === null && reversed > 0) {
    if (row.purchase_kind === "ai_tokens" && row.purchase_id) {
      const balance = await ensureTokenBalance(row.business_id);
      const { error } = await db().rpc("restore_disputed_ai_tokens", {
        target_purchase_id: row.purchase_id,
        target_period_start: balance.periodStart,
        tokens: reversed,
        idem_key: key,
      });
      if (error) throw new Error(`restore_disputed_ai_tokens failed: ${error.message}`);
    } else if (row.purchase_kind === "message_credits" && row.purchase_id) {
      const { error } = await db().rpc("restore_disputed_message_credits", {
        target_purchase_id: row.purchase_id,
        units: reversed,
        idem_key: key,
      });
      if (error) throw new Error(`restore_disputed_message_credits failed: ${error.message}`);
    } else if (row.purchase_kind === "voice_pack" && row.payment_intent_id) {
      await restoreVoicePack(row, key, reversed);
    }
    restored = await ledgerUnits(row, key);
  }

  const units = Math.min(restored ?? 0, reversed);
  assertWrite(
    await db().from("billing_disputes").update({ reversed_units: reversed, restored_units: units }).eq("id", row.id),
    "dispute: record restore",
    { businessId: row.business_id, dispute: row.stripe_dispute_id },
  );
  await notifyDispute(row, "won", units);
  return units;
}

/** Voice packs: the pack-refund FIFO rule, written under the dispute's own key. */
async function reverseVoicePack(row: DisputeRow, key: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await supabaseMinuteStore.load(row.business_id, null);
    const { data, error } = await db()
      .from("voice_minute_ledger")
      .select("kind, stripe_ref, pack_delta_sec, created_at")
      .eq("business_id", row.business_id)
      .in("kind", ["PACK_PURCHASE", "PACK_REFUND"]);
    if (error) throw new Error(`dispute voice ledger: ${error.message}`);
    const ledger = ((data ?? []) as { kind: "PACK_PURCHASE" | "PACK_REFUND"; stripe_ref: string | null; pack_delta_sec: number; created_at: string }[]).map(
      (r) => ({ kind: r.kind, stripeRef: r.stripe_ref, packDeltaSec: r.pack_delta_sec, createdAt: r.created_at }),
    );
    const purchase = ledger.find((r) => r.kind === "PACK_PURCHASE" && r.stripeRef === row.payment_intent_id);
    // The pack's price is not on the ledger; a dispute of the whole payment
    // is "everything unused", which amountRefunded == amount expresses.
    const plan = voicePackRefund({
      ledger,
      refundedRef: row.payment_intent_id as string,
      amountMinor: 1,
      amountRefundedMinor: 1,
      packRemainingSec: snap.balance.packRemainingSec,
    });
    if (!purchase || !plan || plan.reverseSec <= 0) return;
    const result = await supabaseMinuteStore.apply({
      businessId: row.business_id,
      expected: { includedSec: snap.balance.includedRemainingSec, packSec: snap.balance.packRemainingSec },
      delta: { includedSec: 0, packSec: -plan.reverseSec },
      ledger: {
        kind: "PACK_REFUND",
        voiceCallId: null,
        route: null,
        idempotencyKey: key,
        reason: "Disputed pack: unused minutes held back",
        stripeRef: row.payment_intent_id,
      },
    });
    if (result === "APPLIED" || result === "REPLAY") return;
  }
  throw new Error("dispute voice clawback: balance contended; retry");
}

async function restoreVoicePack(row: DisputeRow, key: string, seconds: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await supabaseMinuteStore.load(row.business_id, null);
    const result = await supabaseMinuteStore.apply({
      businessId: row.business_id,
      expected: { includedSec: snap.balance.includedRemainingSec, packSec: snap.balance.packRemainingSec },
      delta: { includedSec: 0, packSec: seconds },
      ledger: {
        kind: "ADJUSTMENT",
        voiceCallId: null,
        route: null,
        idempotencyKey: key,
        reason: "Dispute won: held-back minutes returned",
        stripeRef: row.payment_intent_id,
      },
    });
    if (result === "APPLIED" || result === "REPLAY") return;
  }
  throw new Error("dispute voice restore: balance contended; retry");
}
