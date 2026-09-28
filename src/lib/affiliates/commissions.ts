import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { holdClearsAt, type CommissionPlan } from "./types";
import { notifyAffiliate } from "./notifications";
import type { CommissionEntryType } from "./programme";
import {
  commissionBaseMinor,
  commissionForPayment,
  isCommissionableInvoice,
  planReaccrual,
  planReversalWrite,
  refundReversalMinor,
  writeOffAmountMinor,
  type DisputeReversalRecord,
  type LedgerStatus,
} from "./ledger-rules";
import { effectivePlan } from "./tier-rules";
import { loadTiers, untypedDb } from "./programme-settings";

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
 * The arithmetic lives in `ledger-rules.ts` (base net of VAT, the one-off
 * first-payment rule, refund/dispute proportions, re-accrual) and
 * `tier-rules.ts` (tier rates), both pure and tested without a database.
 */

/* ---------------------------------------------------------------- accrue -- */

export type AccrualInput = {
  /** The business whose invoice was paid. */
  businessId: string;
  /**
   * The commission base: what the customer actually paid **excluding VAT**,
   * after discounts and credit (`ledger-rules.ts` `commissionBaseMinor`).
   */
  amountPaidMinor: number;
  /** What the customer paid including VAT: the scale refunds are measured on. */
  grossPaidMinor?: number;
  currency: string;
  /** Stripe invoice id — the natural idempotency anchor. */
  invoiceId: string;
  /**
   * Retained for callers; the ledger counts the referral's own accruals, so an
   * invoice skipped while a referral was held does not shift the count.
   */
  paymentIndex?: number;
  /** ISO month for reporting, e.g. "2026-09-01". */
  periodMonth: string;
  /** When the invoice was paid. */
  paidAt?: string;
};

export type AccrualResult =
  | { status: "created"; commissionId: string; amountMinor: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

/**
 * Records the commission earned by one paid invoice.
 *
 * Returns a reason rather than throwing when nothing is owed: an unattributed
 * business, a suspended partner or a payment that is not the customer's first
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
      `id, affiliate_id, source_link_id, paid_state, paid_at, status, flagged_reason, renewal_count,
       affiliates ( id, status, commission_plan_id, tier )`,
    )
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!referral) return { status: "skipped", reason: "not_attributed" };

  const affiliate = referral.affiliates as unknown as {
    id: string;
    status: string;
    commission_plan_id: string | null;
    tier: string | null;
  } | null;

  // A suspended or closed partner accrues nothing. Checked at accrual time
  // rather than at payout time so the ledger never contains money we have
  // already decided not to pay.
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return { status: "skipped", reason: "affiliate_not_active" };
  }

  // A referral held or rejected for review (self-referral, shared device,
  // duplicate entity) does not silently accrue. If an admin clears it,
  // `reaccrueReferral` replays the paid invoices from `billing_invoices`.
  if (referral.flagged_reason || referral.status === "REJECTED") {
    return { status: "skipped", reason: "flagged_for_review" };
  }

  const basePlan = await loadPlan(affiliate.commission_plan_id);
  if (!basePlan) return { status: "skipped", reason: "no_plan" };

  // The ledger is single-currency. A payment in another currency is not
  // converted at a guessed rate; it is left for an operator.
  if (input.currency.toUpperCase() !== basePlan.currency.toUpperCase()) {
    return { status: "skipped", reason: "currency_mismatch" };
  }

  // The partner tier's terms, never worse than the plan (tier-rules.ts).
  const tiers = await loadTiers();
  const tier = tiers.find((row) => row.key === affiliate.tier) ?? null;
  const plan = effectivePlan(basePlan, tier);

  const { count: priorAccruals } = await db
    .from("affiliate_commissions")
    .select("id", { count: "exact", head: true })
    .eq("referral_id", referral.id)
    .in("entry_type", ["NEW_CUSTOMER", "RENEWAL"])
    .neq("stripe_invoice_id", input.invoiceId);
  const paymentIndex = priorAccruals ?? 0;

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  // One-off: the full first payment (an annual plan's full annual invoice,
  // not a twelfth of it) at the tier's rate; nothing after it.
  const amountMinor = commissionForPayment(plan, input.amountPaidMinor, { paymentIndex });
  if (amountMinor <= 0) {
    // One-off commission: only the referral's first paid subscription invoice
    // earns. A renewal, a later invoice or an add-on is skipped rather than
    // written as a £0 row, so the ledger does not fill with meaningless rows.
    return {
      status: "skipped",
      reason: paymentIndex > 0 ? "not_first_payment" : "zero_commission",
    };
  }

  // Only ever the first payment (paymentIndex 0) reaches here.
  const entryType: CommissionEntryType = "NEW_CUSTOMER";

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
      metadata: {
        payment_index: paymentIndex,
        gross_paid_minor: input.grossPaidMinor ?? input.amountPaidMinor,
        tier: tier?.key ?? null,
        rate_percent: plan.percent,
      },
    })
    .select("id")
    .maybeSingle();

  // 23505 is the unique violation on `idempotency_key`. That is the guard
  // doing its job on a replayed event, not a problem to report.
  if (error?.code === "23505") return { status: "duplicate" };
  if (error || !created) {
    throw new Error(`Commission accrual failed: ${error?.message ?? "unknown"}`);
  }

  await advanceReferralToPaid(referral.id, entryType, input.amountPaidMinor, paidAt.toISOString());

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
  paidAt: string,
) {
  const db = createAdminClient();

  const { data: current } = await db
    .from("affiliate_referrals")
    .select("paid_at, lifetime_revenue_minor, renewal_count")
    .eq("id", referralId)
    .maybeSingle();

  if (!current) return;

  const isRenewal = entryType === "RENEWAL";

  await db
    .from("affiliate_referrals")
    .update({
      status: "PAID",
      paid_state: "PAID",
      trial_state: "CONVERTED",
      paid_at: current.paid_at ?? paidAt,
      renewed_at: isRenewal ? paidAt : null,
      renewal_count: (current.renewal_count ?? 0) + (isRenewal ? 1 : 0),
      lifetime_revenue_minor:
        Number(current.lifetime_revenue_minor ?? 0) + revenueMinor,
    })
    .eq("id", referralId);
}

/**
 * Replays a referral's paid invoices after an admin clears a review hold.
 *
 * Reads `billing_invoices` (0165: the real amounts Stripe reported) in paid
 * order. Every accrual is keyed on its invoice id, so invoices that did accrue
 * before the hold are duplicates here and nothing is paid twice.
 */
export async function reaccrueReferral(businessId: string): Promise<number> {
  const { data, error } = await untypedDb()
    .from("billing_invoices")
    .select("stripe_invoice_id, billing_reason, currency, total_excluding_tax_minor, amount_paid_minor, tax_minor, period_start, paid_at")
    .eq("business_id", businessId)
    .order("paid_at", { ascending: true })
    .limit(240);
  if (error || !data) return 0;

  let created = 0;
  for (const row of data as Record<string, unknown>[]) {
    if (!isCommissionableInvoice(row.billing_reason as string | null)) continue;
    const excl = Number(row.total_excluding_tax_minor ?? 0);
    const paid = Number(row.amount_paid_minor ?? 0);
    const tax = Number(row.tax_minor ?? 0);
    const base = commissionBaseMinor({ amountPaidMinor: paid, totalMinor: excl + tax, totalExcludingTaxMinor: excl });
    const period = row.period_start ? new Date(String(row.period_start)) : new Date(String(row.paid_at));
    const result = await accrueCommission({
      businessId,
      amountPaidMinor: base,
      grossPaidMinor: paid,
      currency: String(row.currency ?? "gbp").toUpperCase(),
      invoiceId: String(row.stripe_invoice_id),
      periodMonth: `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}-01`,
      paidAt: String(row.paid_at),
    });
    if (result.status === "created") created += 1;
  }
  return created;
}

/* --------------------------------------------------------------- reverse -- */

export type ReversalResult =
  | { status: "reversed"; reversedMinor: number; entries: number }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

type AccrualRow = {
  id: string;
  affiliate_id: string;
  referral_id: string | null;
  business_id: string | null;
  commission_plan_id: string | null;
  commission_amount_minor: number;
  base_amount_minor: number;
  currency: string;
  status: LedgerStatus;
  payout_id: string | null;
  available_at: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Takes back commission on a refund or a dispute (audit 17 §2).
 *
 * - `cumulativeMinor` is cumulative: a refund passes Stripe's
 *   `amount_refunded` (all refunds so far), a dispute its disputed amount.
 *   What this invoice has already had reversed (net of re-accruals) is
 *   subtracted, so a replay or a second partial refund never double-counts.
 * - An unpaid accrual reversed in full is flipped to REVERSED; anything else
 *   is a new negative REVERSAL row (`ledger-rules.ts` `planReversalWrite`).
 *   A paid accrual is never edited: its reversal nets against future payouts.
 * - `sourceRef` ('refund:<charge>' / 'dispute:<id>') is stored on every row
 *   it writes, which is what a won dispute re-accrues from.
 */
export async function reverseInvoiceCommission(input: {
  invoiceId: string;
  reason: "REFUND" | "CHARGEBACK";
  sourceRef: string;
  /** Cumulative refunded, or the disputed amount, VAT included. */
  cumulativeMinor: number;
  /** The charge's gross amount, when known; else the accrual's recorded gross. */
  grossPaidMinor?: number | null;
}): Promise<ReversalResult> {
  const db = createAdminClient();

  const { data: accruals } = await db
    .from("affiliate_commissions")
    .select(
      "id, affiliate_id, referral_id, business_id, commission_plan_id, commission_amount_minor, base_amount_minor, currency, status, payout_id, available_at, metadata",
    )
    .eq("stripe_invoice_id", input.invoiceId)
    .in("entry_type", ["NEW_CUSTOMER", "RENEWAL"]);

  if (!accruals || accruals.length === 0) {
    return { status: "skipped", reason: "no_commission" };
  }

  let reversedMinor = 0;
  let touched = 0;
  const now = new Date();

  for (const accrual of accruals as unknown as AccrualRow[]) {
    const already = await netReversedMinor(accrual);
    const gross =
      input.grossPaidMinor ??
      Number((accrual.metadata ?? {}).gross_paid_minor ?? accrual.base_amount_minor);
    const amount = refundReversalMinor({
      commissionMinor: accrual.commission_amount_minor,
      grossPaidMinor: gross,
      cumulativeRefundedMinor: input.cumulativeMinor,
      alreadyReversedMinor: already,
    });
    const write = planReversalWrite({
      accrual: {
        status: accrual.status,
        commissionMinor: accrual.commission_amount_minor,
        availableAt: accrual.available_at,
        payoutId: accrual.payout_id,
      },
      amountMinor: amount,
      alreadyReversedMinor: already,
      now,
    });
    if (!write) continue;

    if (write.kind === "flip") {
      // Re-checked at the write: a payout run that claimed it a moment ago
      // wins, and this falls through to nothing.
      const { data: updated } = await db
        .from("affiliate_commissions")
        .update({
          status: "REVERSED",
          reversal_reason: input.reason,
          reversed_at: now.toISOString(),
          metadata: { ...(accrual.metadata ?? {}), reversed_by: input.sourceRef } as never,
        })
        .eq("id", accrual.id)
        .in("status", ["PENDING", "APPROVED"])
        .is("payout_id", null)
        .select("id")
        .maybeSingle();
      if (!updated) continue;
    } else {
      const { error } = await db.from("affiliate_commissions").insert({
        affiliate_id: accrual.affiliate_id,
        referral_id: accrual.referral_id,
        business_id: accrual.business_id,
        commission_plan_id: accrual.commission_plan_id,
        status: write.status,
        entry_type: "REVERSAL",
        base_amount_minor: 0,
        commission_amount_minor: -write.amountMinor,
        currency: accrual.currency,
        reversal_of_id: accrual.id,
        reversal_reason: input.reason,
        // Keyed on the cumulative figure: a replay collides, a new partial
        // refund (a larger cumulative amount) does not.
        idempotency_key: `reversal:${input.sourceRef}:${input.cumulativeMinor}:${accrual.id}`,
        available_at: write.availableAt ?? now.toISOString(),
        metadata: { source_ref: input.sourceRef, cumulative_minor: input.cumulativeMinor } as never,
      });
      if (error?.code === "23505") continue;
      if (error) throw new Error(`Reversal failed: ${error.message}`);
    }

    reversedMinor += amount;
    touched += 1;

    await recordAudit({
      businessId: accrual.business_id,
      actorType: "provider",
      action: "affiliate.commission_reversed",
      entityType: "affiliate_commission",
      entityId: accrual.id,
      metadata: { reason: input.reason, amountMinor: amount, source: input.sourceRef, write: write.kind },
    });

    await notifyAffiliate(accrual.affiliate_id, "commission_updates", {
      kind: "commission.reversed",
      title: "A commission was reversed",
      body: `${formatMinor(amount, accrual.currency)} was taken back after a ${input.reason === "CHARGEBACK" ? "chargeback" : "refund"}.`,
      href: "/affiliates/app/payouts",
    });

    // Only a full reversal changes the referral's headline state; a partial
    // refund leaves a paying customer paying.
    if (already + amount >= accrual.commission_amount_minor && accrual.referral_id) {
      await db
        .from("affiliate_referrals")
        .update({
          status: "REFUNDED",
          paid_state: input.reason === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED",
        })
        .eq("id", accrual.referral_id);
    }
  }

  if (touched === 0) return { status: "duplicate" };
  return { status: "reversed", reversedMinor, entries: touched };
}

/** What has been taken back from one accrual so far, net of re-accruals. */
async function netReversedMinor(accrual: AccrualRow): Promise<number> {
  const flipped = accrual.status === "REVERSED" ? accrual.commission_amount_minor : 0;
  const { data } = await createAdminClient()
    .from("affiliate_commissions")
    .select("commission_amount_minor")
    .eq("reversal_of_id", accrual.id);
  let net = flipped;
  // Negative REVERSAL/ADJUSTMENT rows took money back; REACCRUAL rows gave it back.
  for (const row of data ?? []) net -= Number(row.commission_amount_minor);
  return Math.max(0, net);
}

/**
 * A dispute closed in our favour re-accrues exactly what that dispute took
 * (the gap `docs/BILLING.md` recorded). Keyed on the dispute and each
 * reversal record, so a replayed close event re-accrues nothing twice.
 */
export async function reaccrueDisputedCommission(input: { disputeId: string }): Promise<number> {
  const db = createAdminClient();
  const ref = `dispute:${input.disputeId}`;
  const now = new Date();

  type Row = {
    id: string;
    affiliate_id: string;
    referral_id: string | null;
    business_id: string | null;
    commission_plan_id: string | null;
    commission_amount_minor: number;
    currency: string;
    status: LedgerStatus;
    available_at: string | null;
    reversal_of_id?: string | null;
  };

  const [flippedRes, negativeRes] = await Promise.all([
    db
      .from("affiliate_commissions")
      .select("id, affiliate_id, referral_id, business_id, commission_plan_id, commission_amount_minor, currency, status, available_at")
      .eq("status", "REVERSED")
      .eq("metadata->>reversed_by", ref),
    db
      .from("affiliate_commissions")
      .select("id, affiliate_id, referral_id, business_id, commission_plan_id, commission_amount_minor, currency, status, available_at, reversal_of_id")
      .eq("entry_type", "REVERSAL")
      .eq("metadata->>source_ref", ref),
  ]);

  const flipped = (flippedRes.data ?? []) as unknown as Row[];
  const negatives = (negativeRes.data ?? []) as unknown as Row[];
  const byId = new Map<string, { row: Row; accrualId: string }>();
  const records: DisputeReversalRecord[] = [];
  for (const row of flipped) {
    byId.set(row.id, { row, accrualId: row.id });
    records.push({ id: row.id, kind: "flipped", amountMinor: row.commission_amount_minor, status: "REVERSED", availableAt: row.available_at });
  }
  for (const row of negatives) {
    byId.set(row.id, { row, accrualId: row.reversal_of_id ?? row.id });
    records.push({ id: row.id, kind: "negative", amountMinor: Math.abs(row.commission_amount_minor), status: row.status, availableAt: row.available_at });
  }

  let created = 0;
  for (const plan of planReaccrual(records, now)) {
    const source = byId.get(plan.sourceId);
    if (!source) continue;
    const { row, accrualId } = source;

    // A referral rejected for fraud since the dispute opened stays reversed.
    if (row.referral_id) {
      const { data: referral } = await db
        .from("affiliate_referrals")
        .select("flagged_reason")
        .eq("id", row.referral_id)
        .maybeSingle();
      if (referral?.flagged_reason) continue;
    }

    const insert = {
      affiliate_id: row.affiliate_id,
      referral_id: row.referral_id,
      business_id: row.business_id,
      commission_plan_id: row.commission_plan_id,
      status: plan.status,
      entry_type: "REACCRUAL",
      base_amount_minor: 0,
      commission_amount_minor: plan.amountMinor,
      currency: row.currency,
      reversal_of_id: accrualId,
      reversal_reason: "DISPUTE_WON",
      idempotency_key: `reaccrual:${ref}:${plan.sourceId}`,
      available_at: plan.availableAt,
      metadata: { source_ref: `dispute_won:${input.disputeId}` },
    };
    let { error } = await db.from("affiliate_commissions").insert(insert as never);
    // Before migration 0166 the REACCRUAL entry type is not allowed: the same
    // money is recorded as an ADJUSTMENT, still keyed on the dispute.
    if (error?.code === "23514") {
      ({ error } = await db.from("affiliate_commissions").insert({ ...insert, entry_type: "ADJUSTMENT" } as never));
    }
    if (error?.code === "23505") continue;
    if (error) throw new Error(`Re-accrual failed: ${error.message}`);
    created += 1;

    await recordAudit({
      businessId: row.business_id,
      actorType: "provider",
      action: "affiliate.commission_reaccrued",
      entityType: "affiliate_commission",
      entityId: accrualId,
      metadata: { dispute: input.disputeId, amountMinor: plan.amountMinor },
    });
    await notifyAffiliate(row.affiliate_id, "commission_updates", {
      kind: "commission.reaccrued",
      title: "Commission restored",
      body: `${formatMinor(plan.amountMinor, row.currency)} was restored after a chargeback was resolved in our favour.`,
      href: "/affiliates/app/payouts",
    });

    if (row.referral_id) {
      await db
        .from("affiliate_referrals")
        .update({ status: "PAID", paid_state: "PAID" })
        .eq("id", row.referral_id)
        .in("paid_state", ["CHARGEBACK", "REFUNDED"]);
    }
  }
  return created;
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
       attribution_window_days, cookie_window_days,
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

/* ------------------------------------------------------------- write-off -- */

/**
 * Ends a partnership (owner decision 2026-09-28).
 *
 * A negative available balance at the end (clawbacks on commission already
 * paid that future commission never recovered) is **written off, not
 * invoiced**. The ledger records it as one WRITE_OFF entry equal to the
 * deficit, so the partner's balance nets to zero and "why is this account at
 * zero" stays answerable. Keyed on the affiliate, so a repeated close writes
 * nothing twice. Before migration 0169 adds the WRITE_OFF entry type, the
 * same entry is written as an ADJUSTMENT marked `write_off`.
 */
export async function closePartnership(input: {
  affiliateId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ ok: boolean; writtenOffMinor: number; error?: string }> {
  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("id, status, commission_plan_id")
    .eq("id", input.affiliateId)
    .maybeSingle();
  if (!affiliate) return { ok: false, writtenOffMinor: 0, error: "not_found" };

  const { data: balances, error: balanceError } = await db.rpc("affiliate_balances", {
    p_affiliate_id: input.affiliateId,
  });
  if (balanceError) return { ok: false, writtenOffMinor: 0, error: "balance_unavailable" };
  const available = Number((balances as { available_minor?: number }[] | null)?.[0]?.available_minor ?? 0);
  const amount = writeOffAmountMinor(available);

  if (amount > 0) {
    const plan = await loadPlan(affiliate.commission_plan_id);
    const row = {
      affiliate_id: input.affiliateId,
      status: "APPROVED",
      base_amount_minor: 0,
      commission_amount_minor: amount,
      currency: plan?.currency ?? "GBP",
      reversal_reason: "WRITE_OFF",
      idempotency_key: `writeoff:${input.affiliateId}`,
      available_at: new Date().toISOString(),
      metadata: { kind: "write_off", deficit_minor: available, reason: input.reason },
    };
    let write = await untypedDb().from("affiliate_commissions").insert({ ...row, entry_type: "WRITE_OFF" });
    // 23514: 0169 not applied yet, so WRITE_OFF is not an allowed entry type.
    if (write.error?.code === "23514") {
      write = await untypedDb().from("affiliate_commissions").insert({ ...row, entry_type: "ADJUSTMENT" });
    }
    if (write.error && write.error.code !== "23505") {
      return { ok: false, writtenOffMinor: 0, error: "write_off_failed" };
    }

    await recordAudit({
      businessId: null,
      actorUserId: input.actorUserId,
      actorType: "platform_admin",
      action: "affiliate.commission_written_off",
      entityType: "affiliate",
      entityId: input.affiliateId,
      metadata: { amountMinor: amount, deficitMinor: available },
    });
  }

  const { error } = await untypedDb()
    .from("affiliates")
    .update({ status: "CLOSED", status_reason: input.reason, closed_at: new Date().toISOString() })
    .eq("id", input.affiliateId);
  if (error) return { ok: false, writtenOffMinor: amount, error: "close_failed" };

  return { ok: true, writtenOffMinor: amount };
}
