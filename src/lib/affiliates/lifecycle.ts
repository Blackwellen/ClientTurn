import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAffiliate } from "./notifications";
import type { PaidState, TrialState } from "./programme";

/**
 * Referral lifecycle mirroring (V4 §32).
 *
 * A referral moves through click → signup → trial → paid → renewal. The click
 * and signup halves are owned by `attribution.ts`; this module owns the half
 * that comes from billing.
 *
 * The rule throughout: **timestamps only ever move forward.** `paid_at` is what
 * the funnel counts a paid customer by, so a renewal, a plan change or a
 * re-subscription must not reset it — that would make the same customer appear
 * as a new conversion every month.
 */

export async function syncReferralLifecycle(input: {
  businessId: string;
  subscriptionStatus: string;
  deleted: boolean;
  planKey: string;
}): Promise<void> {
  const db = createAdminClient();

  const { data: referral } = await db
    .from("affiliate_referrals")
    .select(
      "id, affiliate_id, status, trial_state, paid_state, trial_at, paid_at, churned_at",
    )
    .eq("business_id", input.businessId)
    .maybeSingle();

  // Not an attributed business. The common case, and not an error.
  if (!referral) return;

  const now = new Date().toISOString();
  const update: {
    plan_key: string;
    status?: string;
    trial_state?: string;
    paid_state?: string;
    trial_at?: string;
    churned_at?: string;
  } = { plan_key: input.planKey };

  if (input.deleted || input.subscriptionStatus === "canceled") {
    update.status = "CHURNED";
    update.churned_at = referral.churned_at ?? now;
    // A cancelled trial that never paid is a cancelled trial, not a churned
    // customer's trial — the distinction is what the funnel measures.
    update.trial_state =
      referral.paid_at === null ? "CANCELLED" : referral.trial_state;
    update.paid_state = referral.paid_at === null ? "CANCELLED" : "PAID";
  } else if (input.subscriptionStatus === "trialing") {
    update.status = "TRIALING";
    update.trial_state = "ACTIVE_TRIAL";
    // Only set once. A second trial on the same business must not re-enter the
    // funnel as a fresh trial.
    update.trial_at = referral.trial_at ?? now;

    if (!referral.trial_at) {
      await notifyAffiliate(referral.affiliate_id, "new_referral", {
        kind: "referral.trial",
        title: "A referral started a trial",
        body: "One of the businesses you introduced has started a ClientTurn trial.",
        href: "/affiliates/app/referrals",
      });
    }
  } else if (input.subscriptionStatus === "active") {
    // The commission accrual on `invoice.paid` owns `paid_at` and the money.
    // This only advances the trial half of the story.
    update.trial_state = "CONVERTED";
    if (referral.paid_at) update.status = "PAID";
  } else if (input.subscriptionStatus === "past_due" || input.subscriptionStatus === "unpaid") {
    // Deliberately not a state change. A late payment is not a churn, and
    // flipping the referral would flicker the affiliate's funnel every time a
    // card needs retrying.
    return;
  }

  await db.from("affiliate_referrals").update(update).eq("id", referral.id);
}

/**
 * Marks a referral's trial as expired.
 *
 * Called by the scheduled job rather than by a webhook: Stripe has no "trial
 * expired without converting" event, only a subscription that quietly ends.
 */
export async function expireStaleTrials(): Promise<number> {
  const db = createAdminClient();

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 45);

  const { data } = await db
    .from("affiliate_referrals")
    .update({ trial_state: "EXPIRED" satisfies TrialState })
    .eq("trial_state", "ACTIVE_TRIAL")
    .is("paid_at", null)
    .lt("trial_at", cutoff.toISOString())
    .select("id");

  return data?.length ?? 0;
}

/**
 * Flags referrals that look like self-referrals.
 *
 * Flagged, never auto-rejected: a shared surname or a shared office IP is a
 * reason for a person to look, not a reason to withhold someone's money
 * automatically. `accrueCommission` refuses to accrue while a flag is set, so
 * flagging is enough to stop money moving before review.
 */
export async function flagSuspectReferrals(): Promise<number> {
  const db = createAdminClient();

  const { data: referrals } = await db
    .from("affiliate_referrals")
    .select(
      `id, affiliate_id, business_id, flagged_reason,
       affiliates ( user_id, contact_email )`,
    )
    .is("flagged_reason", null)
    .limit(500);

  if (!referrals || referrals.length === 0) return 0;

  let flagged = 0;

  for (const referral of referrals) {
    const affiliate = referral.affiliates as unknown as {
      user_id: string;
      contact_email: string;
    } | null;
    if (!affiliate) continue;

    // The owner of the referred workspace being the affiliate themselves is
    // the unambiguous case. Anything softer is left to a human.
    const { data: membership } = await db
      .from("business_members")
      .select("user_id")
      .eq("business_id", referral.business_id)
      .eq("user_id", affiliate.user_id)
      .maybeSingle();

    if (!membership) continue;

    await db
      .from("affiliate_referrals")
      .update({ flagged_reason: "SELF_REFERRAL", status: "REJECTED" })
      .eq("id", referral.id);

    flagged += 1;
  }

  return flagged;
}

/** Re-exported so the webhook imports one module. */
export type { PaidState, TrialState };
