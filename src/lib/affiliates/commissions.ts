import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { commissionFor, holdClearsAt, type CommissionPlan } from "./types";
import { notifyAffiliate } from "./notifications";
import type { CommissionEntryType, ReversalReason } from "./programme";

/**
 * The commission ledger (V4 §35).
 *
 * Three rules hold absolutely, because between them they are the difference
 * between an affiliate programme and a way to give money away:
 *
 * 1. **Commission originates from a billing event, never from a page.**
 *    Nothing in `src/app` calls `accrueCommission`. The only caller is the
 *    Stripe webhook, after Stripe has told us money actually moved.
 *
 * 2. **Every write is idempotent.** `idempotency_key` is unique in the
 *    database, so a replayed webhook, a manual retry and a concurrent
 *    duplicate all collapse to one row. The insert is allowed to fail on
 *    conflict and that failure is the success case.
 *
 * 3. **History is never edited.** A reversal is a *new negative row* pointing
 *    at the entry it reverses, and the original keeps its amount forever.
 *    Anything else makes "what did we pay them in March" unanswerable.
 *
 * The arithmetic itself lives in `types.ts` (`commissionFor`) and is pure, so
 * the rate rules are tested without a database.
 */

/* ---------------------------------------------------------------- accrue -- */

export type AccrualInput = {
  /** The business whose invoice was paid. */
  businessId: string;
  /** Minor units actually collected, net of any discount. */
  amountPaidMinor: number;
  currency: string;
  /** Stripe invoice id — the natural idempotency anchor. */
  invoiceId: string;
  /** Which payment in the subscription's life this is, zero-indexed. */
  paymentIndex: number;
  /** ISO month for reporting, e.g. "2026-09-01". */
  periodMonth: string;
};

export type AccrualResult =
  | { status: "created"; commissionId: string; amountMinor: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

/**
 * Records the commission earned by one paid invoice.
 *
 * Returns a reason rather than throwing when nothing is owed: an unattributed
 * business, a suspended partner or a plan that has run out of recurring months
 * are all ordinary outcomes, not failures, and the webhook must acknowledge
 * them so Stripe stops retrying.
 */
export async function accrueCommission(
  input: AccrualInput,
): Promise<AccrualResult> {
  const db = createAdminClient();

  if (input.amountPaidMinor <= 0) {
    return { status: "skipped", reason: "zero_amount" };
  }

  // The referral is the bridge. No referral means this customer was never
  // attributed to anyone, which is the common case and not an error.
  const { data: referral } = await db
    .from("affiliate_referrals")
    .select(
      `id, affiliate_id, source_link_id, paid_state, flagged_reason, renewal_count,
       affiliates ( id, status, commission_plan_id )`,
    )
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!referral) return { status: "skipped", reason: "not_attributed" };

  const affiliate = referral.affiliates as unknown as {
    id: string;
    status: string;
    commission_plan_id: string | null;
  } | null;

  // A suspended or closed partner accrues nothing. Checked at accrual time
  // rather than at payout time so the ledger never contains money we have
  // already decided not to pay.
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return { status: "skipped", reason: "affiliate_not_active" };
  }

  // A referral flagged for review (self-referral, duplicate entity) does not
  // silently accrue. An operator clears the flag or the commission is never
  // created — we do not create it and hope someone notices.
  if (referral.flagged_reason) {
    return { status: "skipped", reason: "flagged_for_review" };
  }

  const plan = await loadPlan(affiliate.commission_plan_id);
  if (!plan) return { status: "skipped", reason: "no_plan" };

  const amountMinor = commissionFor(plan, input.amountPaidMinor, input.paymentIndex);
  if (amountMinor <= 0) {
    // Past the recurring window. Recorded as skipped rather than as a £0 row,
    // so the ledger does not fill with entries that mean nothing.
    return { status: "skipped", reason: "outside_commission_window" };
  }

  const entryType: CommissionEntryType =
    input.paymentIndex === 0 ? "NEW_CUSTOMER" : "RENEWAL";

  const earnedAt = new Date();
  const availableAt = holdClearsAt(plan, earnedAt);

  const { data: created, error } = await db
    .from("affiliate_commissions")
    .insert({
      affiliate_id: affiliate.id,
      referral_id: referral.id,
      business_id: input.businessId,
      commission_plan_id: plan.id,
      status: "PENDING",
      entry_type: entryType,
      base_amount_minor: input.amountPaidMinor,
      commission_amount_minor: amountMinor,
      currency: plan.currency,
      period_month: input.periodMonth,
      stripe_invoice_id: input.invoiceId,
      // Scoped by invoice *and* purpose, so a later reversal of the same
      // invoice gets its own key rather than colliding with the accrual.
      idempotency_key: `accrual:${input.invoiceId}`,
      available_at: availableAt.toISOString(),
      metadata: { payment_index: input.paymentIndex },
    })
    .select("id")
    .maybeSingle();

  // 23505 is the unique violation on `idempotency_key`. That is the guard
  // doing its job on a replayed event, not a problem to report.
  if (error?.code === "23505") return { status: "duplicate" };
  if (error || !created) {
    throw new Error(`Commission accrual failed: ${error?.message ?? "unknown"}`);
  }

  await advanceReferralToPaid(referral.id, entryType, input.amountPaidMinor);

  await recordAudit({
    businessId: input.businessId,
    actorType: "provider",
    action: "affiliate.commission_created",
    entityType: "affiliate_commission",
    entityId: created.id,
    metadata: {
      affiliateId: affiliate.id,
      entryType,
      amountMinor,
      invoiceId: input.invoiceId,
    },
  });

  await notifyAffiliate(affiliate.id, "commission_updates", {
    kind: "commission.pending",
    title: "New commission earned",
    body: `A referred customer paid, and ${formatMinor(amountMinor, plan.currency)} is now pending.`,
    href: "/affiliates/app/payouts",
  });

  return { status: "created", commissionId: created.id, amountMinor };
}

/**
 * Moves a referral forward when it starts paying.
 *
 * Only ever moves forward: a renewal on a referral already marked PAID must
 * not reset its `paid_at`, which is what the funnel counts a paid customer by.
 */
async function advanceReferralToPaid(
  referralId: string,
  entryType: CommissionEntryType,
  revenueMinor: number,
) {
  const db = createAdminClient();

  const { data: current } = await db
    .from("affiliate_referrals")
    .select("paid_at, lifetime_revenue_minor, renewal_count")
    .eq("id", referralId)
    .maybeSingle();

  if (!current) return;

  const now = new Date().toISOString();
  const isRenewal = entryType === "RENEWAL";

  await db
    .from("affiliate_referrals")
    .update({
      status: "PAID",
      paid_state: "PAID",
      trial_state: "CONVERTED",
      paid_at: current.paid_at ?? now,
      renewed_at: isRenewal ? now : null,
      renewal_count: (current.renewal_count ?? 0) + (isRenewal ? 1 : 0),
      lifetime_revenue_minor:
        Number(current.lifetime_revenue_minor ?? 0) + revenueMinor,
    })
    .eq("id", referralId);
}

/* --------------------------------------------------------------- reverse -- */

export type ReversalResult =
  | { status: "reversed"; reversedMinor: number; entries: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

/**
 * Takes back commission on a refund, chargeback or policy decision.
 *
 * Two shapes of reversal, and the difference matters:
 *
 * - An entry that has **not** been paid out is flipped to REVERSED. The money
 *   never left, so there is nothing to claw back and the balance simply drops.
 * - An entry that **has** been paid is left untouched and a matching negative
 *   ADJUSTMENT row is written instead. Editing a paid entry would falsify a
 *   payout statement the affiliate has already received.
 */
export async function reverseCommission(input: {
  invoiceId: string;
  reason: ReversalReason;
  /** Partial refunds reverse proportionally; omit for a full reversal. */
  refundedMinor?: number;
}): Promise<ReversalResult> {
  const db = createAdminClient();

  const { data: entries } = await db
    .from("affiliate_commissions")
    .select(
      "id, affiliate_id, referral_id, business_id, commission_amount_minor, base_amount_minor, currency, status, commission_plan_id",
    )
    .eq("stripe_invoice_id", input.invoiceId)
    .in("status", ["PENDING", "APPROVED", "PAYABLE", "PAID"]);

  if (!entries || entries.length === 0) {
    return { status: "skipped", reason: "no_commission" };
  }

  let reversedMinor = 0;
  let touched = 0;

  for (const entry of entries) {
    // Proportional for a partial refund, so a £30 refund on a £100 invoice
    // takes back 30% of the commission rather than all of it.
    const share =
      input.refundedMinor === undefined || entry.base_amount_minor <= 0
        ? 1
        : Math.min(input.refundedMinor / entry.base_amount_minor, 1);

    const amount = Math.round(entry.commission_amount_minor * share);
    if (amount <= 0) continue;

    if (entry.status === "PAID") {
      // Already paid: write a negative adjustment against future earnings.
      const { error } = await db.from("affiliate_commissions").insert({
        affiliate_id: entry.affiliate_id,
        referral_id: entry.referral_id,
        business_id: entry.business_id,
        commission_plan_id: entry.commission_plan_id,
        status: "APPROVED",
        entry_type: "ADJUSTMENT",
        base_amount_minor: 0,
        commission_amount_minor: -amount,
        currency: entry.currency,
        reversal_of_id: entry.id,
        reversal_reason: input.reason,
        idempotency_key: `reversal:${input.invoiceId}:${entry.id}`,
        available_at: new Date().toISOString(),
      });

      if (error?.code === "23505") continue;
      if (error) throw new Error(`Reversal failed: ${error.message}`);
    } else {
      // Not yet paid: flip it. `.in(...)` on the status re-checks that it is
      // still unpaid at the moment of the write, so a payout run that claimed
      // it a millisecond earlier wins and we fall through to no-op.
      const { data: updated } = await db
        .from("affiliate_commissions")
        .update({
          status: "REVERSED",
          reversal_reason: input.reason,
          reversed_at: new Date().toISOString(),
        })
        .eq("id", entry.id)
        .in("status", ["PENDING", "APPROVED", "PAYABLE"])
        .select("id")
        .maybeSingle();

      if (!updated) continue;
    }

    reversedMinor += amount;
    touched += 1;

    await recordAudit({
      businessId: entry.business_id,
      actorType: "provider",
      action: "affiliate.commission_reversed",
      entityType: "affiliate_commission",
      entityId: entry.id,
      metadata: { reason: input.reason, amountMinor: amount, alreadyPaid: entry.status === "PAID" },
    });

    await notifyAffiliate(entry.affiliate_id, "commission_updates", {
      kind: "commission.reversed",
      title: "A commission was reversed",
      body: `${formatMinor(amount, entry.currency)} was taken back after a ${input.reason === "CHARGEBACK" ? "chargeback" : "refund"}.`,
      href: "/affiliates/app/payouts",
    });
  }

  if (touched === 0) return { status: "duplicate" };

  await markReferralRefunded(input.invoiceId, input.reason);

  return { status: "reversed", reversedMinor, entries: touched };
}

async function markReferralRefunded(invoiceId: string, reason: ReversalReason) {
  const db = createAdminClient();

  const { data: entry } = await db
    .from("affiliate_commissions")
    .select("referral_id")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();

  if (!entry?.referral_id) return;

  await db
    .from("affiliate_referrals")
    .update({
      status: "REFUNDED",
      paid_state: reason === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED",
    })
    .eq("id", entry.referral_id);
}

/* --------------------------------------------------------------- approve -- */

/**
 * Approves every PENDING commission that has cleared its hold period.
 *
 * Delegates to `approve_due_commissions()`, which does the whole set in one
 * statement with `for update skip locked`. Running it twice in a minute
 * approves nothing the second time, so the job can be retried freely.
 */
export async function approveDueCommissions(): Promise<number> {
  const { data, error } = await createAdminClient().rpc("approve_due_commissions");
  if (error) throw new Error(`Commission approval failed: ${error.message}`);
  return Number(data ?? 0);
}

/* ------------------------------------------------------------ adjustment -- */

/**
 * An operator-initiated correction.
 *
 * Exposed for the admin surface only. It writes a new ADJUSTMENT row — there
 * is deliberately no code path anywhere that edits an existing entry's amount.
 */
export async function recordAdjustment(input: {
  affiliateId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<{ ok: boolean; id?: string }> {
  const { data, error } = await createAdminClient()
    .from("affiliate_commissions")
    .insert({
      affiliate_id: input.affiliateId,
      status: "APPROVED",
      entry_type: "ADJUSTMENT",
      base_amount_minor: 0,
      commission_amount_minor: input.amountMinor,
      currency: input.currency,
      reversal_reason: input.reason,
      idempotency_key: input.idempotencyKey,
      available_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return { ok: true };
  if (error || !data) return { ok: false };

  await recordAudit({
    businessId: null,
    actorUserId: input.actorUserId,
    actorType: "user",
    action: "affiliate.commission_adjusted",
    entityType: "affiliate_commission",
    entityId: data.id,
    metadata: { amountMinor: input.amountMinor, reason: input.reason },
  });

  return { ok: true, id: data.id };
}

/* ---------------------------------------------------------------- shared -- */

async function loadPlan(planId: string | null): Promise<CommissionPlan | null> {
  const db = createAdminClient();

  const query = db
    .from("affiliate_commission_plans")
    .select(
      `id, name, commission_type, percent, flat_amount_minor, currency,
       recurring_months, attribution_window_days, cookie_window_days,
       hold_days, minimum_payout_minor`,
    );

  // Falls back to the programme default when an affiliate has no plan
  // attached, rather than silently paying nothing.
  const { data } = planId
    ? await query.eq("id", planId).maybeSingle()
    : await query.eq("is_default", true).eq("active", true).maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    commissionType: data.commission_type as CommissionPlan["commissionType"],
    percent: data.percent,
    flatAmountMinor: data.flat_amount_minor,
    currency: data.currency,
    recurringMonths: data.recurring_months,
    attributionWindowDays: data.attribution_window_days,
    cookieWindowDays: data.cookie_window_days,
    holdDays: data.hold_days,
    minimumPayoutMinor: data.minimum_payout_minor,
  };
}

function formatMinor(value: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    value / 100,
  );
}
