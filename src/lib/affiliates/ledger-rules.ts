import type { CommissionPlan } from "./types.ts";

/**
 * The commission ledger's arithmetic (affiliate audit 17, §2).
 *
 * Pure: no `server-only`, no Supabase, no Stripe. `commissions.ts` and
 * `reversals.ts` do the reads and writes around these; the tests pin the
 * money rules here without a database.
 *
 * The chain it covers: a paid invoice accrues on its real amount (net of VAT,
 * discounts and customer credit), a refund reverses in proportion to what was
 * actually refunded (cumulative, never double-counted), a dispute reverses
 * what was disputed, and a WON dispute re-accrues exactly what that dispute
 * took back — the gap `docs/BILLING.md` recorded.
 */

/* ------------------------------------------------------------ accrual -- */

/** Only subscription money earns commission. Top-ups and one-off invoices do not. */
export const COMMISSIONABLE_BILLING_REASONS: ReadonlySet<string> = new Set([
  "subscription_create",
  "subscription_cycle",
  "subscription_update",
  "subscription_threshold",
]);

export function isCommissionableInvoice(billingReason: string | null | undefined): boolean {
  return billingReason ? COMMISSIONABLE_BILLING_REASONS.has(billingReason) : false;
}

/**
 * What a paid invoice is worth to the commission calculation: the money the
 * customer actually paid, **excluding VAT**, after discounts and coupons.
 *
 * `amount_paid` includes VAT and excludes any credit balance the customer
 * spent. `total_excluding_tax` excludes VAT and is already after discounts.
 * Where credit covered part of the invoice, the VAT-exclusive total is scaled
 * down by the share actually paid in money — commission is on cash received,
 * not on credit we granted.
 */
export function commissionBaseMinor(amounts: {
  amountPaidMinor: number;
  totalMinor: number;
  totalExcludingTaxMinor: number;
}): number {
  const paid = Math.max(0, Math.round(amounts.amountPaidMinor));
  const total = Math.max(0, Math.round(amounts.totalMinor));
  const excl = Math.max(0, Math.round(amounts.totalExcludingTaxMinor));
  if (paid <= 0 || total <= 0) return 0;
  if (paid >= total) return Math.min(excl, paid);
  return Math.min(Math.round((paid * excl) / total), paid);
}

/** Whole calendar months between two instants (floor), never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  const adjust = to.getUTCDate() < from.getUTCDate() ? 1 : 0;
  return Math.max(0, months - adjust);
}

/**
 * The commission a payment earns. **One-off** (owner decision 2026-09-28).
 *
 * A referred customer earns their partner exactly one commission: on the
 * FIRST paid subscription invoice (`paymentIndex === 0`, counted from the
 * referral's own accruals, so an invoice skipped while a referral was held
 * cannot shift it). Renewals, later invoices, add-ons and top-ups earn
 * nothing; top-ups and one-off invoices are already excluded by
 * `isCommissionableInvoice`.
 *
 * The basis is the **full** first payment, VAT-exclusive and after discounts
 * (`commissionBaseMinor`): the rate times a monthly plan's first monthly
 * invoice, and the rate times an annual plan's full first annual invoice. It
 * is not divided by twelve.
 *
 * Every plan type is read as one-off. A plan row still marked
 * `RECURRING_PERCENT` (before migration 0169 rewrites it) earns on the first
 * payment only, like `FIRST_PAYMENT_PERCENT`.
 *
 * `monthsSinceFirstPayment` is accepted for callers and no longer read.
 */
export function commissionForPayment(
  plan: Pick<CommissionPlan, "commissionType" | "percent" | "flatAmountMinor">,
  baseMinor: number,
  position: { paymentIndex: number; monthsSinceFirstPayment?: number },
): number {
  if (baseMinor <= 0) return 0;
  if (position.paymentIndex > 0) return 0;
  switch (plan.commissionType) {
    case "FLAT_AMOUNT":
      return Math.min(Math.max(plan.flatAmountMinor ?? 0, 0), baseMinor);
    case "FIRST_PAYMENT_PERCENT":
    case "RECURRING_PERCENT":
      return percentOf(baseMinor, plan.percent);
    default:
      return 0;
  }
}

function percentOf(base: number, percent: number | null): number {
  if (!percent || percent <= 0) return 0;
  return Math.min(Math.round((base * percent) / 100), base);
}

/* ---------------------------------------------------------- reversals -- */

export type LedgerStatus = "PENDING" | "APPROVED" | "PAYABLE" | "PAID" | "REVERSED";

/**
 * How much of one accrual a refund should take back **now**.
 *
 * Stripe's `charge.amount_refunded` is cumulative: a second £10 refund arrives
 * as £20. The target is the commission's proportional share of everything
 * refunded so far; what was already reversed for this invoice is subtracted,
 * so replays and successive partial refunds never double-count.
 */
export function refundReversalMinor(input: {
  commissionMinor: number;
  /** What the customer paid on the invoice, VAT included (the refund's scale). */
  grossPaidMinor: number;
  cumulativeRefundedMinor: number;
  alreadyReversedMinor: number;
}): number {
  const commission = Math.max(0, input.commissionMinor);
  if (commission === 0) return 0;
  const gross = Math.max(0, input.grossPaidMinor);
  const share = gross > 0 ? Math.min(1, Math.max(0, input.cumulativeRefundedMinor) / gross) : 1;
  const target = Math.min(commission, Math.round(commission * share));
  return Math.max(0, target - Math.max(0, input.alreadyReversedMinor));
}

/** The same for a dispute, which reverses in proportion to the disputed amount. */
export function disputeReversalMinor(input: {
  commissionMinor: number;
  grossPaidMinor: number;
  disputedMinor: number;
  alreadyReversedMinor: number;
}): number {
  return refundReversalMinor({
    commissionMinor: input.commissionMinor,
    grossPaidMinor: input.grossPaidMinor,
    cumulativeRefundedMinor: input.disputedMinor,
    alreadyReversedMinor: input.alreadyReversedMinor,
  });
}

export type ReversalWrite =
  /** The whole unpaid accrual is taken back: flip it to REVERSED. */
  | { kind: "flip" }
  /**
   * A new negative row. `status` mirrors the accrual while it is still in its
   * hold, so the two approve together and net inside the same bucket; once
   * the accrual is approved or paid, the negative row is APPROVED and nets
   * against the next payout (a clawback).
   */
  | { kind: "negative"; amountMinor: number; status: "PENDING" | "APPROVED"; availableAt: string | null };

/** How one reversal of `amountMinor` is written against an accrual. */
export function planReversalWrite(input: {
  accrual: { status: LedgerStatus; commissionMinor: number; availableAt: string | null; payoutId: string | null };
  amountMinor: number;
  alreadyReversedMinor: number;
  now: Date;
}): ReversalWrite | null {
  if (input.amountMinor <= 0) return null;
  const { accrual } = input;
  if (accrual.status === "REVERSED") return null;
  const unpaid = (accrual.status === "PENDING" || accrual.status === "APPROVED") && !accrual.payoutId;
  if (unpaid && input.alreadyReversedMinor === 0 && input.amountMinor >= accrual.commissionMinor) {
    return { kind: "flip" };
  }
  if (accrual.status === "PENDING") {
    return { kind: "negative", amountMinor: input.amountMinor, status: "PENDING", availableAt: accrual.availableAt };
  }
  return { kind: "negative", amountMinor: input.amountMinor, status: "APPROVED", availableAt: input.now.toISOString() };
}

/* ---------------------------------------------------------- re-accrual -- */

export type DisputeReversalRecord = {
  /** The row the dispute wrote or flipped. */
  id: string;
  kind: "flipped" | "negative";
  /** Positive: how much this record took away. */
  amountMinor: number;
  /** For a negative row, its own status; for a flipped accrual, REVERSED. */
  status: LedgerStatus;
  availableAt: string | null;
};

export type ReaccrualRow = {
  sourceId: string;
  amountMinor: number;
  status: "PENDING" | "APPROVED";
  availableAt: string;
};

/**
 * A dispute closed in our favour: give back exactly what that dispute took.
 *
 * One positive REACCRUAL row per reversal record, keyed on the dispute and the
 * record, so a replayed `charge.dispute.closed` re-accrues nothing twice. A
 * row whose original money was still inside its hold goes back in PENDING at
 * the same availability date; anything already past its hold is APPROVED.
 */
export function planReaccrual(records: readonly DisputeReversalRecord[], now: Date): ReaccrualRow[] {
  const rows: ReaccrualRow[] = [];
  for (const record of records) {
    if (record.amountMinor <= 0) continue;
    const available = record.availableAt ? new Date(record.availableAt) : now;
    const stillHeld = available.getTime() > now.getTime();
    rows.push({
      sourceId: record.id,
      amountMinor: record.amountMinor,
      status: stillHeld ? "PENDING" : "APPROVED",
      availableAt: (stillHeld ? available : now).toISOString(),
    });
  }
  return rows;
}

/* ------------------------------------------------------------ balance -- */

/**
 * What an affiliate is told about a negative available balance.
 *
 * A clawback on money already paid can push the balance below zero. Nothing
 * is taken from the partner directly: the deficit is recovered from future
 * commission, and no payout is raised until the balance is positive and over
 * the threshold again. If the partnership ends while the balance is still
 * negative, the deficit is **written off**, never invoiced (owner decision
 * 2026-09-28): `writeOffAmountMinor` sizes the WRITE_OFF ledger entry.
 */
export function negativeBalanceNotice(availableMinor: number, format: (minor: number) => string): string | null {
  if (availableMinor >= 0) return null;
  return `Your balance is ${format(availableMinor)} after a refund or chargeback on commission already paid. It is recovered from future commission, and no payout is raised until it is back above the minimum. If the partnership ends before it is recovered, the deficit is written off: we never invoice you for it.`;
}

/**
 * The write-off that closes a partnership with a negative available balance:
 * a positive entry equal to the deficit, so the balance nets to zero. Zero
 * when the balance is not negative (nothing to write off).
 */
export function writeOffAmountMinor(availableMinor: number): number {
  return availableMinor < 0 ? Math.round(-availableMinor) : 0;
}
