/**
 * A refunded voice minute pack: how many seconds come back off the balance.
 * Pure. The same owner policy and FIFO rule as every other top-up
 * (billing/refundability.ts): a refund reverses ONLY the pack's minutes that
 * are still unused, attributing the remaining pack pool newest-first, and
 * never takes the balance below zero or below what has been used. Minutes
 * held by a call in progress count as used.
 *
 * Packs have no purchases table: the ledger's PACK_PURCHASE row is the
 * purchase (stripe_ref = the PaymentIntent) and PACK_REFUND rows are earlier
 * reversals of it.
 */

import { attributeUnusedCredit, refundReversalAmount, type TopUpPurchaseInput } from "../billing/refundability.ts";

export type PackLedgerRow = {
  kind: "PACK_PURCHASE" | "PACK_REFUND";
  stripeRef: string | null;
  packDeltaSec: number;
  createdAt: string;
};

export function voicePackRefund(input: {
  ledger: readonly PackLedgerRow[];
  /** The refunded PaymentIntent. */
  refundedRef: string;
  amountMinor: number;
  /** Stripe's cumulative `charge.amount_refunded`. */
  amountRefundedMinor: number;
  /** The pack pool left now (voice_minute_balances.pack_remaining_sec). */
  packRemainingSec: number;
}): { reverseSec: number; idempotencyKey: string } | null {
  const purchases: TopUpPurchaseInput[] = [];
  const reversed = new Map<string, number>();
  for (const row of input.ledger) {
    if (row.kind === "PACK_REFUND" && row.stripeRef) {
      reversed.set(row.stripeRef, (reversed.get(row.stripeRef) ?? 0) + Math.max(0, -row.packDeltaSec));
    }
  }
  for (const row of input.ledger) {
    if (row.kind !== "PACK_PURCHASE" || !row.stripeRef) continue;
    purchases.push({
      id: row.stripeRef,
      credits: Math.max(0, row.packDeltaSec),
      status: row.stripeRef === input.refundedRef ? "REFUNDED" : "PAID",
      createdAt: row.createdAt,
      creditedAt: row.createdAt,
      reversed: reversed.get(row.stripeRef) ?? 0,
    });
  }
  const pack = purchases.find((p) => p.id === input.refundedRef);
  if (!pack) return null;
  const attribution = attributeUnusedCredit(purchases, input.packRemainingSec).get(pack.id);
  const reverseSec = refundReversalAmount({
    credits: pack.credits,
    amountMinor: input.amountMinor,
    amountRefundedMinor: input.amountRefundedMinor,
    unused: attribution?.unused ?? 0,
    alreadyReversed: pack.reversed ?? 0,
    pool: input.packRemainingSec,
  });
  return { reverseSec, idempotencyKey: `voice:pack-refund:${input.refundedRef}:${input.amountRefundedMinor}` };
}
