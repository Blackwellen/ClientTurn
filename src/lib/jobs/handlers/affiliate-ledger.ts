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
import { autoDispatchAllowed, payoutRunDecision } from "@/lib/affiliates/payout-rules";
import { getProgrammeSettings, untypedDb } from "@/lib/affiliates/programme-settings";
import { recalculateTiers } from "@/lib/affiliates/tiers";
import { checkPaidReferrals } from "@/lib/affiliates/fraud";
import { isSchemaMissing } from "@/lib/billing/stripe-events";

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
 * What this job deliberately does **not** do by default is send money, or
 * even approve a payout. It raises the payout as DRAFT ("pending approval")
 * and claims the commissions into it; an admin approves and sends it in
 * Admin -> Affiliates -> Payouts. Auto-approval and auto-sending are two
 * separate admin settings (0166), and sending also needs the deployment
 * switch AFFILIATE_AUTO_PAYOUT=true.
 *
 * It also recalculates partner tiers, runs the payment-side self-referral
 * check and purges identifiers past their retention (audit 17).
 */
export async function handleAffiliateLedger(): Promise<void> {
  const settings = await getProgrammeSettings();
  const approved = await approveDueCommissions();
  const expired = await expireStaleTrials();
  const flagged = await flagSuspectReferrals();
  // Payment-side self-referral checks (same Stripe customer or card). Stripe
  // is read here, in the job, never in the webhook (audit 17 §1).
  const paymentFlags = await checkPaidReferrals(listCardFingerprints);
  // Tiers: promotions daily, demotions on the monthly review (audit 17 §3).
  const tiers = await recalculateTiers();
  const payouts = await runPayoutBatch(settings.autoApprovePayouts);
  const purged = await purgeIdentifiers();

  // Sending needs BOTH the admin setting and AFFILIATE_AUTO_PAYOUT=true.
  // Otherwise payouts wait for a person to approve and send them in admin.
  const dispatched = autoDispatchAllowed({
    settingEnabled: settings.autoDispatchPayouts,
    envEnabled: autoDispatchEnabled(),
  })
    ? await dispatchApprovedPayouts()
    : null;

  // Surfaced in the job's own log line rather than swallowed, so an operator
  // can see whether a quiet night was "nothing due" or "nothing ran".
  console.info(
    `[affiliate.ledger] approved=${approved} trialsExpired=${expired} ` +
      `flagged=${flagged} paymentFlags=${paymentFlags} tiersChanged=${tiers.changed}/${tiers.evaluated} ` +
      `payoutsRaised=${payouts} identifiersPurged=${purged} ` +
      (dispatched
        ? `sent=${dispatched.sent} failed=${dispatched.failed} skipped=${dispatched.skipped}`
        : "dispatch=manual"),
  );
}

/** Card fingerprints on a Stripe customer, for the self-referral check. */
async function listCardFingerprints(customerId: string): Promise<string[]> {
  const { stripe } = await import("@/lib/billing/stripe");
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 20 });
  return methods.data.map((method) => method.card?.fingerprint).filter((value): value is string => Boolean(value));
}

/** GDPR minimisation: hashes after 120 days, click rows after 400 (0166). */
async function purgeIdentifiers(): Promise<number> {
  const { data, error } = await untypedDb().rpc("purge_affiliate_identifiers");
  if (error) {
    if (!isSchemaMissing(error)) console.error("[affiliate.ledger] purge failed", error.message);
    return 0;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { hashes_cleared?: number; clicks_deleted?: number } | null;
  return Number(row?.hashes_cleared ?? 0) + Number(row?.clicks_deleted ?? 0);
}

/**
 * Raises payouts for every partner who is genuinely ready.
 *
 * "Ready" is the full readiness assessment, not just a connected account:
 * Stripe must have payouts enabled, identity must be verified, tax must be
 * submitted, and the available balance must clear the threshold. A payout
 * raised without those either fails at Stripe or sits stuck.
 */
async function runPayoutBatch(autoApprove: boolean): Promise<number> {
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

    // Negative balances (clawbacks) and below-threshold balances wait; a
    // raised payout is DRAFT ("pending approval") unless auto-approval is on.
    const decision = payoutRunDecision({
      readiness: readiness.readiness,
      availableMinor: balances.availableMinor,
      minimumPayoutMinor: plan.minimumPayoutMinor,
      autoApprove,
    });
    if (decision.action !== "raise") continue;

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
      initialStatus: decision.initialStatus,
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
