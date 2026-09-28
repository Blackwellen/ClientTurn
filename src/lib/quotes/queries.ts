import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/billing/capabilities";
import { parseAuthority } from "@/lib/commercial/authority";
import { createDownloadUrl } from "@/lib/storage/r2";
import { toPublicItem } from "@/lib/catalogue/rows";
import type { Catalogue } from "@/lib/catalogue/types";
import { loadQuoteSettings, loadWorkspaceCatalogue } from "./store";
import type { QuoteSettings } from "./settings";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { invoicePayUrl } from "@/lib/invoicing/pay-link";

/**
 * Reads for Settings -> Quotes & invoices and the lead page's Quotes card.
 * The page has already authenticated the viewer as a member of the
 * workspace; every read here is scoped to that workspace. Cost figures are
 * stripped unless the viewer may see margin (owner/admin).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type CapabilityView = { allowed: boolean; message: string | null; unlockingPlan: string | null };

export async function quoteCapabilities(businessId: string) {
  const pick = async (capability: Parameters<typeof can>[1]): Promise<CapabilityView> => {
    const decision = await can(businessId, capability);
    return { allowed: decision.allowed, message: decision.message, unlockingPlan: decision.unlockingPlan };
  };
  const [builder, esign, approvals, invoicing, directClose] = await Promise.all([
    pick("quote_builder_enabled"),
    pick("esign_enabled"),
    pick("quote_approval_enabled"),
    pick("invoicing_enabled"),
    pick("direct_close_enabled"),
  ]);
  return { builder, esign, approvals, invoicing, directClose };
}

export type QuoteSettingsView = {
  settings: QuoteSettings;
  catalogue: Catalogue;
  checkoutLinks: { id: string; label: string; priceText: string }[];
  business: { name: string; logoUrl: string | null };
  capabilities: Awaited<ReturnType<typeof quoteCapabilities>>;
};

export async function loadQuoteSettingsView(businessId: string, internal: boolean): Promise<QuoteSettingsView> {
  const settings = await loadQuoteSettings(businessId);
  const [catalogue, authorityRow, businessRow, capabilities] = await Promise.all([
    loadWorkspaceCatalogue(businessId, settings.currency),
    db().from("commercial_authority").select("*").eq("business_id", businessId).maybeSingle(),
    db().from("businesses").select("name, logo_key").eq("id", businessId).maybeSingle(),
    quoteCapabilities(businessId),
  ]);
  const authority = parseAuthority(authorityRow.data);
  const business = businessRow.data as { name: string; logo_key: string | null } | null;
  let logoUrl: string | null = null;
  if (business?.logo_key) {
    try {
      logoUrl = await createDownloadUrl(business.logo_key, 600);
    } catch {
      logoUrl = null;
    }
  }
  return {
    settings,
    catalogue: internal ? catalogue : { ...catalogue, items: catalogue.items.map(toPublicItem) },
    checkoutLinks: authority.approved_checkout_links.map((link) => ({ id: link.id, label: link.label, priceText: link.price_text })),
    business: { name: business?.name ?? "", logoUrl },
    capabilities,
  };
}

/** The checkout link each catalogue item points at (the payment step after acceptance). */
export async function catalogueCheckoutLinks(businessId: string): Promise<Record<string, string | null>> {
  const { data } = await db().from("catalogue_items").select("key, checkout_link_id").eq("business_id", businessId);
  return Object.fromEntries(((data ?? []) as { key: string; checkout_link_id: string | null }[]).map((row) => [row.key, row.checkout_link_id]));
}

export type LeadOpportunityOption = { id: string; name: string; outcome: string };

export async function leadOpportunities(businessId: string, leadId: string): Promise<LeadOpportunityOption[]> {
  const { data } = await db()
    .from("opportunities")
    .select("id, name, outcome")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return (data ?? []) as LeadOpportunityOption[];
}

export type LeadInvoiceView = {
  id: string;
  quoteId: string | null;
  kind: string;
  status: string;
  number: string | null;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  dueDate: string | null;
  /** 0173: the link pasted on this invoice (PER_INVOICE mode). */
  payLinkUrl: string | null;
  /** 0173: the tracked link the customer is sent, or null (no pay button). */
  payUrl: string | null;
};

export async function leadInvoices(businessId: string, opportunityIds: string[]): Promise<LeadInvoiceView[]> {
  if (opportunityIds.length === 0) return [];
  const { data } = await db()
    .from("invoices")
    .select("id, quote_id, kind, status, number, total_minor, paid_minor, currency, due_date")
    .eq("business_id", businessId)
    .in("opportunity_id", opportunityIds)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Record<string, unknown>[];
  // 0173 pay fields, read apart so a database behind the code still lists invoices.
  const [settings, payRead] = await Promise.all([
    loadQuoteSettings(businessId),
    rows.length > 0
      ? db().from("invoices").select("id, pay_token, pay_link_url").eq("business_id", businessId).in("id", rows.map((row) => String(row.id)))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (payRead.error && !isSchemaLag(payRead.error)) console.error("[lead invoices] pay fields not read", { code: payRead.error.code });
  const pay = new Map(
    ((payRead.error ? [] : (payRead.data ?? [])) as { id: string; pay_token: string | null; pay_link_url: string | null }[]).map((row) => [
      row.id,
      { payToken: row.pay_token, payLinkUrl: row.pay_link_url },
    ]),
  );
  return rows.map((row) => ({
    id: String(row.id),
    quoteId: (row.quote_id as string | null) ?? null,
    kind: String(row.kind),
    status: String(row.status),
    number: (row.number as string | null) ?? null,
    totalMinor: Number(row.total_minor),
    paidMinor: Number(row.paid_minor),
    currency: String(row.currency),
    dueDate: (row.due_date as string | null) ?? null,
    payLinkUrl: null as string | null,
    payUrl: null as string | null,
  })).map((invoice) => {
    const fields = pay.get(invoice.id);
    if (!fields) return invoice;
    return {
      ...invoice,
      payLinkUrl: fields.payLinkUrl,
      payUrl: invoicePayUrl({ mode: settings.invoicePayMode, workspaceLinkUrl: settings.invoicePayLinkUrl }, { status: invoice.status, ...fields }),
    };
  });
}
