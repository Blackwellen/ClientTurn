import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { notifyAffiliate } from "./notifications";
import type { PayoutReadiness } from "./programme";

/**
 * Payout balances and runs (V4 §35).
 *
 * The single authority on how much an affiliate is owed. Nothing in the
 * browser computes a balance, and no payout amount is ever accepted from a
 * caller — `createPayout` asks the database what is claimable and the payout
 * is worth exactly that.
 *
 * The safety property that matters most here is that money is claimed
 * *atomically*. `claim_commissions_for_payout` attaches every available
 * commission to a payout in one statement guarded by `payout_id is null`, so
 * two concurrent runs cannot put the same commission into two payouts. The
 * amount it returns is the amount the payout is set to; there is no window in
 * which the payout's total and its constituent entries disagree.
 */

/* -------------------------------------------------------------- balances -- */

export type AffiliateBalances = {
  /** Attributed but still inside the refund hold. */
  pendingMinor: number;
  /** Cleared the hold and confirmed. */
  approvedMinor: number;
  /** Approved, unclaimed and past its availability date — payable now. */
  availableMinor: number;
  paidMinor: number;
  reversedMinor: number;
  lifetimeMinor: number;
  availableCount: number;
};

const ZERO: AffiliateBalances = {
  pendingMinor: 0,
  approvedMinor: 0,
  availableMinor: 0,
  paidMinor: 0,
  reversedMinor: 0,
  lifetimeMinor: 0,
  availableCount: 0,
};

/**
 * The affiliate's money, from the ledger.
 *
 * Takes an id the caller resolved from the session. Never call this with a
 * value that came from a request.
 */
export async function getBalances(affiliateId: string): Promise<AffiliateBalances> {
  const { data, error } = await createAdminClient().rpc("affiliate_balances", {
    p_affiliate_id: affiliateId,
  });

  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return ZERO;

  return {
    pendingMinor: Number(row.pending_minor ?? 0),
    approvedMinor: Number(row.approved_minor ?? 0),
    availableMinor: Number(row.available_minor ?? 0),
    paidMinor: Number(row.paid_minor ?? 0),
    reversedMinor: Number(row.reversed_minor ?? 0),
    lifetimeMinor: Number(row.lifetime_minor ?? 0),
    availableCount: Number(row.available_count ?? 0),
  };
}

/* ------------------------------------------------------------- readiness -- */

// The rules themselves are pure and live in `payout-rules.ts` so they can be
// asserted without a database. Re-exported here so callers reach one module.
export {
  assessReadiness,
  nextPayoutDate,
  type PayoutReadinessReport,
  type ReadinessCheck,
} from "./payout-rules";

/** Persists the assessed readiness so admin lists can filter on it. */
export async function syncReadiness(
  affiliateId: string,
  readiness: PayoutReadiness,
): Promise<void> {
  await createAdminClient()
    .from("affiliates")
    .update({ payout_readiness: readiness })
    .eq("id", affiliateId);
}

/* --------------------------------------------------------------- payouts -- */

export type CreatePayoutResult =
  | { status: "created"; payoutId: string; amountMinor: number; count: number }
  | { status: "skipped"; reason: string };

/**
 * Raises a payout for everything currently claimable.
 *
 * The caller supplies no amount. The sequence is: create an empty DRAFT
 * payout, atomically claim commissions into it, then set the payout's value to
 * what was actually claimed. If nothing was claimable the draft is deleted, so
 * an empty payout never appears in an affiliate's history.
 *
 * `idempotencyKey` makes a re-run of the same period a no-op rather than a
 * second payout — the unique index rejects the insert and we report skipped.
 */
export async function createPayout(input: {
  affiliateId: string;
  periodStart: string;
  periodEnd: string;
  minimumPayoutMinor: number;
  method: string;
  idempotencyKey: string;
  currency?: string;
}): Promise<CreatePayoutResult> {
  const db = createAdminClient();

  const balances = await getBalances(input.affiliateId);
  if (balances.availableMinor < input.minimumPayoutMinor) {
    return { status: "skipped", reason: "below_threshold" };
  }

  const { data: payout, error } = await db
    .from("affiliate_payouts")
    .insert({
      affiliate_id: input.affiliateId,
      status: "DRAFT",
      amount_minor: 0,
      gross_amount_minor: 0,
      currency: input.currency ?? "GBP",
      commission_count: 0,
      method: input.method,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      idempotency_key: input.idempotencyKey,
      scheduled_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return { status: "skipped", reason: "already_exists" };
  if (error || !payout) {
    throw new Error(`Payout creation failed: ${error?.message ?? "unknown"}`);
  }

  const { data: claimed, error: claimError } = await db.rpc(
    "claim_commissions_for_payout",
    { p_affiliate_id: input.affiliateId, p_payout_id: payout.id },
  );

  const claimRow = Array.isArray(claimed) ? claimed[0] : claimed;
  const amountMinor = Number(claimRow?.claimed_minor ?? 0);
  const count = Number(claimRow?.claimed_count ?? 0);

  if (claimError || count === 0 || amountMinor <= 0) {
    // Nothing was claimable after all — another run beat us to it. Remove the
    // empty draft rather than leaving a £0 payout in the history.
    await db.from("affiliate_payouts").delete().eq("id", payout.id);
    return { status: "skipped", reason: "nothing_claimable" };
  }

  await db
    .from("affiliate_payouts")
    .update({
      status: "APPROVED",
      amount_minor: amountMinor,
      gross_amount_minor: amountMinor,
      commission_count: count,
      approved_at: new Date().toISOString(),
    })
    .eq("id", payout.id);

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "affiliate.payout_scheduled",
    entityType: "affiliate_payout",
    entityId: payout.id,
    metadata: { affiliateId: input.affiliateId, amountMinor, count },
  });

  await notifyAffiliate(input.affiliateId, "payout_updates", {
    kind: "payout.scheduled",
    title: "Payout scheduled",
    body: `A payout of ${formatMinor(amountMinor)} has been scheduled.`,
    href: "/affiliates/app/payouts",
  });

  return { status: "created", payoutId: payout.id, amountMinor, count };
}

/** Marks a payout paid and settles the commissions it carried. */
export async function markPayoutPaid(input: {
  payoutId: string;
  processorPayoutId?: string;
}): Promise<boolean> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  // Guarded on the current status, so a duplicate settlement webhook cannot
  // re-run the ledger write below.
  const { data: payout } = await db
    .from("affiliate_payouts")
    .update({
      status: "PAID",
      paid_at: now,
      processed_at: now,
      processor_payout_id: input.processorPayoutId ?? null,
    })
    .eq("id", input.payoutId)
    .in("status", ["APPROVED", "PROCESSING"])
    .select("id, affiliate_id, amount_minor")
    .maybeSingle();

  if (!payout) return false;

  await db
    .from("affiliate_commissions")
    .update({ status: "PAID", paid_at: now })
    .eq("payout_id", payout.id)
    .eq("status", "PAYABLE");

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "affiliate.payout_processed",
    entityType: "affiliate_payout",
    entityId: payout.id,
    metadata: { amountMinor: payout.amount_minor },
  });

  await notifyAffiliate(payout.affiliate_id, "payout_updates", {
    kind: "payout.paid",
    title: "Payout sent",
    body: `${formatMinor(payout.amount_minor)} is on its way to your account.`,
    href: "/affiliates/app/payouts",
  });

  return true;
}

/**
 * Marks a payout failed and releases its commissions.
 *
 * Releasing is the important half. A failed payout must not strand the money:
 * the entries go back to APPROVED with no payout attached, so the next run
 * picks them up and the affiliate's balance is never quietly lost.
 */
export async function markPayoutFailed(input: {
  payoutId: string;
  failureCode: string;
  reason: string;
}): Promise<boolean> {
  const db = createAdminClient();

  const { data: payout } = await db
    .from("affiliate_payouts")
    .update({
      status: "FAILED",
      failure_code: input.failureCode,
      failure_reason: input.reason,
      processed_at: new Date().toISOString(),
    })
    .eq("id", input.payoutId)
    .in("status", ["APPROVED", "PROCESSING"])
    .select("id, affiliate_id, amount_minor")
    .maybeSingle();

  if (!payout) return false;

  await db
    .from("affiliate_commissions")
    .update({ status: "APPROVED", payout_id: null })
    .eq("payout_id", payout.id)
    .eq("status", "PAYABLE");

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "affiliate.payout_failed",
    entityType: "affiliate_payout",
    entityId: payout.id,
    metadata: { failureCode: input.failureCode, amountMinor: payout.amount_minor },
  });

  await notifyAffiliate(payout.affiliate_id, "payout_updates", {
    kind: "payout.failed",
    title: "Payout could not be sent",
    body: "Your balance is safe and will be included in the next run once this is resolved.",
    href: "/affiliates/app/settings?section=payments",
  });

  return true;
}

/* ---------------------------------------------------------- payout detail -- */

export type PayoutBreakdown = {
  newCustomerMinor: number;
  renewalMinor: number;
  adjustmentMinor: number;
  reversalMinor: number;
  totalMinor: number;
  referrals: number;
  paidCustomers: number;
  averageRate: number | null;
};

/**
 * What a payout was actually made of.
 *
 * Read from the commission entries attached to the payout, never recomputed
 * from current state: a statement for March must still say what March said,
 * even after later reversals.
 */
export async function getPayoutBreakdown(
  affiliateId: string,
  payoutId: string,
): Promise<PayoutBreakdown | null> {
  const db = createAdminClient();

  // Scoped by affiliate as well as payout id — the id came from a URL.
  const { data: payout } = await db
    .from("affiliate_payouts")
    .select("id")
    .eq("id", payoutId)
    .eq("affiliate_id", affiliateId)
    .maybeSingle();

  if (!payout) return null;

  const { data: entries } = await db
    .from("affiliate_commissions")
    .select("entry_type, commission_amount_minor, base_amount_minor, referral_id")
    .eq("payout_id", payoutId)
    .eq("affiliate_id", affiliateId);

  const rows = entries ?? [];

  let newCustomer = 0;
  let renewal = 0;
  let adjustment = 0;
  let reversal = 0;
  let base = 0;
  let commission = 0;
  const referrals = new Set<string>();

  for (const row of rows) {
    const amount = Number(row.commission_amount_minor);
    commission += amount;
    base += Number(row.base_amount_minor);
    if (row.referral_id) referrals.add(row.referral_id);

    if (row.entry_type === "NEW_CUSTOMER") newCustomer += amount;
    else if (row.entry_type === "RENEWAL") renewal += amount;
    else if (row.entry_type === "REVERSAL") reversal += amount;
    else adjustment += amount;
  }

  return {
    newCustomerMinor: newCustomer,
    renewalMinor: renewal,
    adjustmentMinor: adjustment,
    reversalMinor: reversal,
    totalMinor: commission,
    referrals: referrals.size,
    paidCustomers: rows.filter((row) => row.entry_type === "NEW_CUSTOMER").length,
    averageRate: base > 0 ? commission / base : null,
  };
}

function formatMinor(value: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    value / 100,
  );
}
