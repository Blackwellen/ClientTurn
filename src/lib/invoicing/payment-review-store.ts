import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  canApplyToInvoice,
  countByKind,
  isOpenReview,
  RESOLUTIONS_FOR_KIND,
  reviewKind,
  type DismissResolution,
  type ReviewKind,
  type ReviewPaymentRow,
} from "./payment-review";

/**
 * Reads for the invoice-payment review queue (Settings -> Quotes & invoices)
 * and its support-side counts. Service role, server-only; every query is
 * scoped to the one workspace it was asked about. 0173 / 0175 post-date the
 * generated types, so everything goes through one untyped seam.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const REVIEW_FIELDS =
  "id, business_id, provider, provider_order_id, email, amount_minor, currency, status, match_kind, lead_id, invoice_id, review_reason, review_resolved_at, applied_at, paid_at";

export type ReviewRowFull = ReviewPaymentRow & {
  id: string;
  business_id: string;
  provider: string;
  provider_order_id: string;
  email: string | null;
  currency: string;
  lead_id: string | null;
  paid_at: string;
};

export type PaymentReviewItem = {
  id: string;
  kind: ReviewKind;
  provider: string;
  orderId: string;
  email: string | null;
  amountMinor: number;
  currency: string;
  paidAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  leadId: string | null;
  leadName: string | null;
  canApply: boolean;
  resolutions: DismissResolution[];
};

export type OpenInvoiceOption = {
  id: string;
  number: string;
  currency: string;
  dueMinor: number;
};

export type PaymentReviewQueue = {
  items: PaymentReviewItem[];
  openInvoices: OpenInvoiceOption[];
};

export type ReviewLoad<T> = { state: "ok"; data: T } | { state: "not_installed" } | { state: "error" };

/** Open review rows for a workspace (bounded). Throws on anything but schema lag. */
async function openRows(businessId: string, limit: number): Promise<ReviewRowFull[] | null> {
  const { data, error } = await db()
    .from("checkout_payments")
    .select(REVIEW_FIELDS)
    .eq("business_id", businessId)
    .is("review_resolved_at", null)
    .or("review_reason.not.is.null,status.in.(REVIEW,UNMATCHED)")
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isSchemaLag(error)) return null;
    throw new Error(`payment review: read failed: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => ({ ...(row as ReviewRowFull), amount_minor: Number(row.amount_minor ?? 0) }))
    .filter(isOpenReview);
}

/** The queue with everything the card needs. Never throws. */
export async function loadPaymentReviewQueue(businessId: string): Promise<ReviewLoad<PaymentReviewQueue>> {
  try {
    const rows = await openRows(businessId, 100);
    if (rows === null) return { state: "not_installed" };

    const invoiceIds = [...new Set(rows.map((row) => row.invoice_id).filter((id): id is string => Boolean(id)))];
    const leadIds = [...new Set(rows.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
    const [linked, leads, open] = await Promise.all([
      invoiceIds.length
        ? db().from("invoices").select("id, number").eq("business_id", businessId).in("id", invoiceIds)
        : Promise.resolve({ data: [], error: null }),
      leadIds.length
        ? db().from("leads").select("id, first_name, last_name, email, anonymised_at").eq("business_id", businessId).in("id", leadIds)
        : Promise.resolve({ data: [], error: null }),
      db()
        .from("invoices")
        .select("id, number, currency, total_minor, paid_minor, status")
        .eq("business_id", businessId)
        .in("status", ["OPEN", "PARTIALLY_PAID"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const error = linked.error ?? leads.error ?? open.error;
    if (error) return isSchemaLag(error) ? { state: "not_installed" } : { state: "error" };

    const numberById = new Map(((linked.data ?? []) as { id: string; number: string | null }[]).map((row) => [row.id, row.number]));
    const nameById = new Map(
      ((leads.data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null; anonymised_at: string | null }[])
        .filter((row) => !row.anonymised_at)
        .map((row) => [row.id, [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unnamed lead"]),
    );

    return {
      state: "ok",
      data: {
        items: rows.map((row) => {
          const kind = reviewKind(row);
          return {
            id: row.id,
            kind,
            provider: row.provider,
            orderId: row.provider_order_id,
            email: row.email,
            amountMinor: row.amount_minor,
            currency: row.currency,
            paidAt: row.paid_at,
            invoiceId: row.invoice_id,
            invoiceNumber: row.invoice_id ? (numberById.get(row.invoice_id) ?? null) : null,
            leadId: row.lead_id,
            leadName: row.lead_id ? (nameById.get(row.lead_id) ?? null) : null,
            canApply: canApplyToInvoice(row),
            resolutions: [...RESOLUTIONS_FOR_KIND[kind]],
          };
        }),
        openInvoices: ((open.data ?? []) as { id: string; number: string | null; currency: string; total_minor: number; paid_minor: number }[])
          .filter((row) => row.number)
          .map((row) => ({
            id: row.id,
            number: row.number as string,
            currency: row.currency,
            dueMinor: Math.max(0, Number(row.total_minor) - Number(row.paid_minor)),
          }))
          .filter((row) => row.dueMinor > 0),
      },
    };
  } catch (error) {
    console.error("[payment review] queue read failed", { businessId, message: error instanceof Error ? error.message : String(error) });
    return { state: "error" };
  }
}

/** Open review counts by kind, for the admin support view. Never throws. */
export async function countOpenPaymentReviews(
  businessId: string,
): Promise<ReviewLoad<{ total: number; byKind: Partial<Record<ReviewKind, number>> }>> {
  try {
    const rows = await openRows(businessId, 500);
    if (rows === null) return { state: "not_installed" };
    return { state: "ok", data: countByKind(rows) };
  } catch {
    return { state: "error" };
  }
}

/** One payment, scoped to the workspace, for the operations. */
export async function loadReviewPayment(businessId: string, paymentId: string): Promise<ReviewRowFull | null> {
  const { data, error } = await db()
    .from("checkout_payments")
    .select(REVIEW_FIELDS)
    .eq("business_id", businessId)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { ...(row as ReviewRowFull), amount_minor: Number(row.amount_minor ?? 0) };
}

export { db as reviewDb };
