import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveDueCommissions } from "@/lib/affiliates/commissions";
import { expireStaleTrials, flagSuspectReferrals } from "@/lib/affiliates/lifecycle";
import {
  assessReadiness,
  createPayout,
  getBalances,
  syncReadiness,
} from "@/lib/affiliates/payouts";
import {
  autoDispatchEnabled,
  dispatchApprovedPayouts,
} from "@/lib/affiliates/dispatch";

/**
 * The affiliate ledger tick (V4 §35).
 *
 * Runs the four things that have to happen on a clock rather than in response
 * to a request:
 *
 * 1. Approve commissions that have cleared their refund hold.
 * 2. Expire trials that quietly ended without converting.
 * 3. Flag referrals that look like self-referrals, before they accrue.
 * 4. Raise payouts for partners who are ready and over the threshold.
 *
 * Every step is idempotent, so a retried job is harmless: approval only ever
 * reads PENDING rows, payout creation is keyed by period, and commission
 * claiming is guarded by `payout_id is null` inside a single statement.
 *
 * What this job deliberately does **not** do is send money. It creates the
 * payout record and claims the commissions into it; the actual Connect
 * transfer is a separate, explicitly-invoked step. An automated job that moves
 * real money on a timer is not something to enable by default.
 */
export async function handleAffiliateLedger(): Promise<void> {
  const approved = await approveDueCommissions();
  const expired = await expireStaleTrials();
  const flagged = await flagSuspectReferrals();
  const payouts = await runPayoutBatch();

  // Sending is opt-in. Without AFFILIATE_AUTO_PAYOUT=true the payouts sit
  // APPROVED for a person to release from the admin surface — a platform that
  // starts wiring money on a cron the day it deploys is one misconfigured plan
  // away from an incident.
  const dispatched = autoDispatchEnabled()
    ? await dispatchApprovedPayouts()
    : null;

  // Surfaced in the job's own log line rather than swallowed, so an operator
  // can see whether a quiet night was "nothing due" or "nothing ran".
  console.info(
    `[affiliate.ledger] approved=${approved} trialsExpired=${expired} ` +
      `flagged=${flagged} payoutsRaised=${payouts} ` +
      (dispatched
        ? `sent=${dispatched.sent} failed=${dispatched.failed} skipped=${dispatched.skipped}`
        : "dispatch=manual"),
  );
}

/**
 * Raises payouts for every partner who is genuinely ready.
 *
 * "Ready" is the full readiness assessment, not just a connected account:
 * Stripe must have payouts enabled, identity must be verified, tax must be
 * submitted, and the available balance must clear the threshold. A payout
 * raised without those either fails at Stripe or sits stuck.
 */
async function runPayoutBatch(): Promise<number> {
  const db = createAdminClient();

  const { data: affiliates } = await db
    .from("affiliates")
    .select(
      `id, status, stripe_connect_status, stripe_payouts_enabled,
       stripe_details_submitted, identity_status, tax_status,
       commission_plan_id`,
    )
    .eq("status", "ACTIVE")
    .limit(500);

  if (!affiliates || affiliates.length === 0) return 0;

  const now = new Date();
  // The month that just ended — a run on the 1st pays for the previous month.
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const periodStart = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1),
  );

  let created = 0;

  for (const affiliate of affiliates) {
    const balances = await getBalances(affiliate.id);
    const plan = await minimumFor(affiliate.commission_plan_id);

    const readiness = assessReadiness({
      status: affiliate.status,
      connectState: affiliate.stripe_connect_status,
      payoutsEnabled: affiliate.stripe_payouts_enabled,
      detailsSubmitted: affiliate.stripe_details_submitted,
      identityStatus: affiliate.identity_status,
      taxStatus: affiliate.tax_status,
      availableMinor: balances.availableMinor,
      minimumPayoutMinor: plan.minimumPayoutMinor,
    });

    await syncReadiness(affiliate.id, readiness.readiness);

    if (readiness.readiness !== "READY") continue;
    if (balances.availableMinor < plan.minimumPayoutMinor) continue;

    const result = await createPayout({
      affiliateId: affiliate.id,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      minimumPayoutMinor: plan.minimumPayoutMinor,
      method: "Stripe Connect",
      currency: plan.currency,
      // Keyed by affiliate and period, so re-running the job in the same month
      // finds the payout already exists rather than raising a second one.
      idempotencyKey: `payout:${affiliate.id}:${periodEnd.toISOString().slice(0, 7)}`,
    });

    if (result.status === "created") created += 1;
  }

  return created;
}

async function minimumFor(
  planId: string | null,
): Promise<{ minimumPayoutMinor: number; currency: string }> {
  const db = createAdminClient();
  const query = db
    .from("affiliate_commission_plans")
    .select("minimum_payout_minor, currency");

  const { data } = planId
    ? await query.eq("id", planId).maybeSingle()
    : await query.eq("is_default", true).eq("active", true).maybeSingle();

  return {
    minimumPayoutMinor: data?.minimum_payout_minor ?? 10000,
    currency: data?.currency ?? "GBP",
  };
}
