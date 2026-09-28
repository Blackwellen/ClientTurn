import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { subscriptionIdOfInvoice } from "./dunning";
import { invoiceAmounts, isSchemaMissing, mrrMinorFromInvoice } from "./stripe-events";

/**
 * `invoice.paid` -> the real amounts (gap audit 15 §6, "admin MRR uses list
 * prices"). No Stripe I/O: only the payload the webhook verified.
 *
 *   * `billing_invoices`: one row per paid invoice (upsert on the invoice id,
 *     so a replay writes the same values), with amount paid, currency,
 *     discounts and tax. Admin revenue sums this.
 *   * `subscriptions.mrr_minor`: the monthly amount the customer is actually
 *     billed, net of discounts and before VAT, from each full-period
 *     subscription invoice (stripe-events.ts `mrrMinorFromInvoice`). Admin MRR
 *     reads this, falling back to list price only where it is still null.
 *
 * Throws on a failed write, so the webhook marks the event failed and
 * Stripe's retry records it.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function iso(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}

export async function recordPaidInvoice(invoice: Stripe.Invoice, eventId: string): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!invoice.id || !customerId) return;

  const { data: sub, error } = await db()
    .from("subscriptions")
    .select("business_id, billing_interval, stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`invoice ledger: subscription lookup failed: ${error.message}`);
  const row = sub as { business_id: string; billing_interval: string | null; stripe_subscription_id: string | null } | null;
  if (!row) return;

  const amounts = invoiceAmounts(invoice as unknown as Parameters<typeof invoiceAmounts>[0]);
  const subscriptionId = subscriptionIdOfInvoice(invoice);
  const paidAtUnix = (invoice as unknown as { status_transitions?: { paid_at?: number | null } }).status_transitions?.paid_at;

  const stored = await db()
    .from("billing_invoices")
    .upsert(
        {
          business_id: row.business_id,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: subscriptionId,
          billing_reason: invoice.billing_reason ?? null,
          currency: amounts.currency,
          subtotal_minor: amounts.subtotalMinor,
          discount_minor: amounts.discountMinor,
          tax_minor: amounts.taxMinor,
          total_excluding_tax_minor: amounts.totalExcludingTaxMinor,
          amount_paid_minor: amounts.amountPaidMinor,
          period_start: iso(invoice.period_start),
          period_end: iso(invoice.period_end),
          paid_at: iso(paidAtUnix) ?? new Date().toISOString(),
        },
        { onConflict: "stripe_invoice_id" },
      );
  // Shipped before migration 0165 is applied: skip, never fail the event.
  if (isSchemaMissing(stored.error)) {
    console.warn("[stripe webhook] billing_invoices missing (0165 not applied); invoice amounts not recorded", { invoice: invoice.id });
    return;
  }
  assertWrite(stored, "stripe webhook: record invoice amounts", { eventId, businessId: row.business_id, invoice: invoice.id });

  // Only an invoice for the workspace's own current subscription moves MRR.
  if (!subscriptionId || (row.stripe_subscription_id && row.stripe_subscription_id !== subscriptionId)) return;
  const mrr = mrrMinorFromInvoice({ billingReason: invoice.billing_reason, amounts, interval: row.billing_interval });
  if (mrr === null) return;

  logWriteError(
    await db()
      .from("subscriptions")
      .update({ mrr_minor: mrr, mrr_currency: amounts.currency, mrr_updated_at: new Date().toISOString() })
      .eq("business_id", row.business_id),
    "stripe webhook: record MRR",
    { eventId, businessId: row.business_id },
  );
}
