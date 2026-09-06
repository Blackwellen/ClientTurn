import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "./stripe";
import type { InvoicesResult } from "./types";

// Shapes and the status mapping live in the sibling `types.ts` so a client
// component can read them without importing this server-only module.
export * from "./types";

/**
 * Recent invoices, read from Stripe rather than from a local ledger — Stripe
 * is the source of truth for billing. The customer id comes from the
 * workspace's own subscription row, never from the browser, so one workspace
 * can never read another's invoices.
 */
export async function listRecentInvoices(
  businessId: string,
  limit = 5,
): Promise<InvoicesResult> {
  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .maybeSingle();

  const customerId = subscription?.stripe_customer_id ?? null;
  if (!customerId) return { ok: true, invoices: [], portalAvailable: false };

  try {
    const response = await stripe.invoices.list({
      customer: customerId,
      limit: Math.min(Math.max(limit, 1), 24),
    });

    return {
      ok: true,
      portalAvailable: true,
      invoices: response.data.map((invoice) => ({
        id: invoice.id ?? "",
        number: invoice.number ?? null,
        created: new Date(invoice.created * 1000).toISOString(),
        amountDue: (invoice.amount_paid || invoice.amount_due) / 100,
        currency: (invoice.currency ?? "gbp").toUpperCase(),
        status: invoice.status ?? "draft",
        hostedUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
      })),
    };
  } catch {
    return {
      ok: false,
      error:
        "Invoices could not be loaded from Stripe just now. Your billing is unaffected — try again shortly.",
    };
  }
}

