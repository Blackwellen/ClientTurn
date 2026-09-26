/**
 * One retry of one failed invoice, against a Stripe client passed in.
 *
 * Free of `server-only`, the service-role client and the env module, so the
 * daily job and the Stripe test-mode harness run exactly this code. The caller
 * owns the bookkeeping (claiming today's attempt, counting attempts, notices);
 * this owns the Stripe conversation and nothing else.
 *
 * Retry-safe in two ways: the invoice is re-read before any charge (it may
 * have been paid through the portal an hour ago, or voided), and the charge
 * carries a Stripe idempotency key per invoice per UTC day, so a job retried
 * after a timeout cannot charge the card twice in a day.
 */

export type InvoiceLike = {
  id?: string | null;
  status?: string | null;
  amount_remaining?: number | null;
};

export type StripeInvoicesLike = {
  invoices: {
    retrieve(id: string): Promise<InvoiceLike>;
    pay(
      id: string,
      params?: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<InvoiceLike>;
  };
};

export type ChargeOutcome =
  | { outcome: "paid"; alreadyPaid: boolean }
  | { outcome: "closed"; invoiceStatus: string }
  | { outcome: "failed"; error: string; declineCode: string | null };

export function dunningIdempotencyKey(invoiceId: string, day: string): string {
  return `clientturn-dunning:${invoiceId}:${day}`;
}

export async function attemptInvoiceCharge(
  stripe: StripeInvoicesLike,
  invoiceId: string,
  day: string,
): Promise<ChargeOutcome> {
  const current = await stripe.invoices.retrieve(invoiceId);

  if (current.status === "paid") return { outcome: "paid", alreadyPaid: true };
  // Voided, uncollectible or (impossibly) draft: nothing left to collect.
  if (current.status !== "open") {
    return { outcome: "closed", invoiceStatus: current.status ?? "unknown" };
  }

  try {
    const paid = await stripe.invoices.pay(
      invoiceId,
      {},
      { idempotencyKey: dunningIdempotencyKey(invoiceId, day) },
    );
    if (paid.status === "paid") return { outcome: "paid", alreadyPaid: false };
    return {
      outcome: "failed",
      error: `Invoice is ${paid.status ?? "unknown"} after payment attempt.`,
      declineCode: null,
    };
  } catch (error) {
    const details = error as { message?: string; decline_code?: string; raw?: { decline_code?: string } };
    return {
      outcome: "failed",
      error: (details.message ?? String(error)).slice(0, 500),
      declineCode: details.decline_code ?? details.raw?.decline_code ?? null,
    };
  }
}
