/**
 * Is a top-up purchase still refundable, and how much of it is unused?
 *
 * Owner policy: top-up credit (SMS credit bundles, WhatsApp token packs and AI token
 * packs) is non-refundable once usage begins. A purchase can be refunded only
 * while none of its credit has been used. Refunds themselves are issued by the
 * owner in Stripe; when one arrives (`charge.refunded`), only the credit from
 * that purchase that is still unused is reversed, never taking a balance below
 * zero (the `billing.refund_reverse` job and the migration 0142 RPCs).
 *
 * PURE: no I/O, no `server-only`, so the tests and the client can import it.
 *
 * ## Attribution rule: FIFO
 *
 * Credit is pooled -- a balance is one number per channel (messages) or one
 * purchased pool (AI tokens) -- so which purchase a spent credit "came from"
 * is a rule, not a fact. The rule is FIFO: the OLDEST purchase is consumed
 * first. Equivalently, whatever is left in the pool belongs to the NEWEST
 * purchases. So the remaining pool is handed out newest-first, each purchase
 * taking up to its own (net) credit, and whatever a purchase does not receive
 * has been used.
 *
 * Only credit consumption counts. The plan's included allowance is always used
 * before any credit (limits.ts for messages; the carry-over formula in
 * token-service.ts for AI tokens), so the pool passed in here must be the
 * remaining *purchased* credit, never allowance.
 *
 * "Net" credit is a purchase's credit minus anything already reversed on an
 * earlier refund of it. Order is by `creditedAt` (when the credit entered the
 * pool), then `createdAt`, then `id`, matching the SQL in migration 0142.
 *
 * Known limit: credit a support adjustment added to a balance is not a
 * purchase, so it is treated like the newest credit and can make purchases
 * look less used than they are. Adjustments are rare and deliberate.
 */

export type TopUpPurchaseInput = {
  id: string;
  /** Credits (messages) or tokens (AI) the purchase granted. */
  credits: number;
  /** PENDING | PAID | FAILED | EXPIRED | REFUNDED */
  status: string;
  createdAt: string;
  /** When the credit entered the pool. Null = never credited. */
  creditedAt: string | null;
  /** Credit already reversed by an earlier refund of this purchase. */
  reversed?: number;
};

export type RefundState = "refundable" | "in_use" | "refunded" | "not_credited";

export type PurchaseRefundability = {
  id: string;
  state: RefundState;
  /** True only when no credit from the purchase has been used. */
  refundable: boolean;
  /** Credit from this purchase still unused (FIFO). */
  unused: number;
  /** Credit from this purchase already used (FIFO). */
  used: number;
};

export const REFUND_STATE_LABEL: Record<RefundState, string> = {
  refundable: "Refundable",
  in_use: "Non-refundable (credit in use)",
  refunded: "Refunded",
  not_credited: "Not credited",
};

/** The notice shown next to every Buy button for top-up credit. */
export const TOP_UP_REFUND_NOTICE = "Non-refundable once any credit is used.";

/** Purchases whose credit entered the pool (and so can have been used). */
function inPool(purchase: TopUpPurchaseInput): boolean {
  return (
    purchase.creditedAt !== null &&
    (purchase.status === "PAID" || purchase.status === "REFUNDED")
  );
}

function netCredit(purchase: TopUpPurchaseInput): number {
  return Math.max(Math.floor(purchase.credits) - Math.floor(purchase.reversed ?? 0), 0);
}

/** Newest first: creditedAt desc, then createdAt desc, then id desc. */
function newestFirst(a: TopUpPurchaseInput, b: TopUpPurchaseInput): number {
  const byCredited = Date.parse(b.creditedAt ?? "") - Date.parse(a.creditedAt ?? "");
  if (byCredited) return byCredited;
  const byCreated = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byCreated) return byCreated;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * FIFO attribution of the remaining purchased pool to purchases.
 *
 * Pass EVERY purchase for the pool (one message channel, or all AI token
 * purchases), not a display page of them: the newest ones take the pool first.
 */
export function attributeUnusedCredit(
  purchases: TopUpPurchaseInput[],
  remainingPool: number,
): Map<string, PurchaseRefundability> {
  const result = new Map<string, PurchaseRefundability>();
  let left = Math.max(Math.floor(remainingPool), 0);

  for (const purchase of [...purchases].filter(inPool).sort(newestFirst)) {
    const net = netCredit(purchase);
    const unused = Math.min(net, left);
    left -= unused;
    const used = net - unused;

    if (purchase.status === "REFUNDED") {
      result.set(purchase.id, { id: purchase.id, state: "refunded", refundable: false, unused, used });
      continue;
    }
    const untouched = used === 0 && Math.floor(purchase.reversed ?? 0) === 0;
    result.set(purchase.id, {
      id: purchase.id,
      state: untouched ? "refundable" : "in_use",
      refundable: untouched,
      unused,
      used,
    });
  }

  for (const purchase of purchases) {
    if (result.has(purchase.id)) continue;
    // Paid but not yet credited (the webhook is in flight): nothing used yet.
    const paid = purchase.status === "PAID";
    result.set(purchase.id, {
      id: purchase.id,
      state: purchase.status === "REFUNDED" ? "refunded" : "not_credited",
      refundable: paid,
      unused: 0,
      used: 0,
    });
  }

  return result;
}

/**
 * How much credit a `charge.refunded` event reverses now.
 *
 *   entitled  -- credit proportional to the cumulative amount refunded
 *                (a full refund = all of the purchase's credit), rounded down
 *   ceiling   -- only credit that was never used: what has already been
 *                reversed plus what is unused now
 *   result    -- the part of that not already reversed, never more than the
 *                current pool, so a balance never goes below zero
 *
 * `amountRefundedMinor` is Stripe's cumulative `charge.amount_refunded`, so a
 * replayed event, or a later event for the same total, reverses nothing more
 * (idempotent), and a second partial refund reverses only the difference.
 */
export function refundReversalAmount(input: {
  credits: number;
  amountMinor: number;
  amountRefundedMinor: number;
  /** Unused credit of this purchase now (FIFO). */
  unused: number;
  alreadyReversed: number;
  /** Current remaining purchased pool. */
  pool: number;
}): number {
  const credits = Math.max(Math.floor(input.credits), 0);
  const refunded = Math.max(Math.min(input.amountRefundedMinor, input.amountMinor), 0);
  const entitled =
    input.amountMinor > 0 ? Math.floor((credits * refunded) / input.amountMinor) : credits;
  const already = Math.max(Math.floor(input.alreadyReversed), 0);
  const ceiling = already + Math.max(Math.floor(input.unused), 0);
  const target = Math.min(entitled, ceiling);
  return Math.max(Math.min(target - already, Math.max(Math.floor(input.pool), 0)), 0);
}

/**
 * The AI purchased pool still unspent in the current period. Included tokens
 * are spent first, so purchased tokens only start going once the included
 * grant is gone. Tokens held by in-flight calls count as in use.
 */
export function aiPurchasedRemaining(balance: {
  includedTokens: number;
  purchasedTokens: number;
  usedTokens: number;
  reservedTokens: number;
}): number {
  const left =
    balance.includedTokens + balance.purchasedTokens - balance.usedTokens - balance.reservedTokens;
  return Math.max(Math.min(left, balance.purchasedTokens), 0);
}
