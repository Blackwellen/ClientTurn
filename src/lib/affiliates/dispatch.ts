import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { markPayoutFailed, markPayoutPaid } from "./payouts";
import { sendConnectTransfer } from "./stripe-connect";

/**
 * Sending an affiliate payout (V4 §35).
 *
 * Split out from `payouts.ts` because raising a payout and *sending* one are
 * different acts with different risk. Raising is arithmetic over a ledger and
 * is safe to run on a timer. Sending moves real money out of the platform, and
 * this module is the only thing in the codebase that does it.
 *
 * Three guards, in order:
 *
 * 1. **The payout must be APPROVED.** A draft, a failed payout or one already
 *    paid is refused. The status is re-read here rather than trusted from the
 *    caller, so a stale admin page cannot re-send.
 * 2. **Readiness is re-checked at send time.** An affiliate suspended between
 *    the payout being raised and the run executing must not be paid.
 * 3. **Stripe's idempotency key is our payout id.** A retry after a timeout
 *    returns the original transfer rather than making a second one.
 *
 * Automatic dispatch is off unless `AFFILIATE_AUTO_PAYOUT` is explicitly set to
 * `true`. A platform that starts wiring money on a cron the day it deploys is
 * one misconfigured plan away from an incident, so the default is that a person
 * presses the button.
 */

export function autoDispatchEnabled(): boolean {
  return process.env.AFFILIATE_AUTO_PAYOUT === "true";
}

export type DispatchResult =
  | { status: "sent"; transferId: string; amountMinor: number }
  | { status: "failed"; reason: string; code: string }
  | { status: "skipped"; reason: string };

/**
 * Sends one payout to its affiliate's connected account.
 *
 * On success the payout and its commissions are settled together by
 * `markPayoutPaid`. On failure `markPayoutFailed` releases the commissions
 * back to APPROVED so the balance is never stranded — a failed transfer must
 * cost the affiliate nothing but time.
 */
export async function dispatchPayout(payoutId: string): Promise<DispatchResult> {
  const db = createAdminClient();

  const { data: payout } = await db
    .from("affiliate_payouts")
    .select("id, affiliate_id, status, amount_minor, currency, period_start, period_end")
    .eq("id", payoutId)
    .maybeSingle();

  if (!payout) return { status: "skipped", reason: "not_found" };

  // Re-read rather than trusted: an admin page open for ten minutes may be
  // looking at a payout someone else has already sent.
  if (payout.status !== "APPROVED") {
    return { status: "skipped", reason: `not_approved:${payout.status}` };
  }
  if (payout.amount_minor <= 0) {
    return { status: "skipped", reason: "zero_amount" };
  }

  const { data: affiliate } = await db
    .from("affiliates")
    .select(
      "id, status, stripe_connect_account_id, stripe_payouts_enabled, identity_status, tax_status",
    )
    .eq("id", payout.affiliate_id)
    .maybeSingle();

  if (!affiliate) return { status: "skipped", reason: "affiliate_missing" };

  // Readiness at the moment of sending, not at the moment of raising. An
  // account suspended in between must not be paid.
  if (affiliate.status !== "ACTIVE") {
    return { status: "skipped", reason: "affiliate_not_active" };
  }
  if (!affiliate.stripe_connect_account_id || !affiliate.stripe_payouts_enabled) {
    return { status: "skipped", reason: "payouts_not_enabled" };
  }
  if (affiliate.identity_status !== "VERIFIED") {
    return { status: "skipped", reason: "identity_not_verified" };
  }
  if (affiliate.tax_status === "NOT_PROVIDED" || affiliate.tax_status === "INVALID") {
    return { status: "skipped", reason: "tax_not_provided" };
  }

  // Marked PROCESSING first, guarded on APPROVED. Two concurrent dispatches
  // race here and exactly one wins; the loser sees a non-APPROVED row and
  // stops before touching Stripe.
  const { data: claimed } = await db
    .from("affiliate_payouts")
    .update({ status: "PROCESSING" })
    .eq("id", payout.id)
    .eq("status", "APPROVED")
    .select("id")
    .maybeSingle();

  if (!claimed) return { status: "skipped", reason: "already_processing" };

  const transfer = await sendConnectTransfer({
    accountId: affiliate.stripe_connect_account_id,
    amountMinor: payout.amount_minor,
    currency: payout.currency,
    payoutId: payout.id,
    description: `ClientTurn affiliate commission ${payout.period_start ?? ""}`.trim(),
  });

  if (!transfer.ok) {
    await markPayoutFailed({
      payoutId: payout.id,
      failureCode: transfer.code,
      reason: transfer.error,
    });
    return { status: "failed", reason: transfer.error, code: transfer.code };
  }

  await markPayoutPaid({
    payoutId: payout.id,
    processorPayoutId: transfer.transferId,
  });

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "affiliate.payout_processed",
    entityType: "affiliate_payout",
    entityId: payout.id,
    metadata: {
      amountMinor: payout.amount_minor,
      transferId: transfer.transferId,
      automatic: autoDispatchEnabled(),
    },
  });

  return {
    status: "sent",
    transferId: transfer.transferId,
    amountMinor: payout.amount_minor,
  };
}

/**
 * Sends every approved payout.
 *
 * Called by the daily job only when `AFFILIATE_AUTO_PAYOUT=true`. Sequential
 * rather than parallel: these are money transfers, and a burst of concurrent
 * Stripe calls buys nothing but a rate limit and a harder incident to read.
 */
export async function dispatchApprovedPayouts(limit = 100): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const db = createAdminClient();

  const { data: payouts } = await db
    .from("affiliate_payouts")
    .select("id")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: true })
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const payout of payouts ?? []) {
    const result = await dispatchPayout(payout.id);
    if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }

  return { sent, failed, skipped };
}

/**
 * Puts a failed payout back in the queue.
 *
 * The commissions were already released to APPROVED when it failed, so this
 * only moves the payout row itself back — it does not re-claim anything, and a
 * re-raised payout picks the balance up on the next run. Kept explicit so a
 * retry is always somebody's decision.
 */
export async function retryFailedPayout(payoutId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("affiliate_payouts")
    .update({
      status: "APPROVED",
      failure_code: null,
      failure_reason: null,
    })
    .eq("id", payoutId)
    .eq("status", "FAILED")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}
