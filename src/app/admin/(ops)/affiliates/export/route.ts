import { getPlatformOperator } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";

/**
 * Admin -> Affiliates export (affiliate audit 17 §6): partners, the
 * commission ledger or payouts, as CSV for bookkeeping and review.
 *
 * Platform admins only (an unknown caller gets a 404, like every /admin
 * surface), audited, and never includes bank, tax-identifier or Stripe
 * account details: those are not stored here in the first place.
 */
export const dynamic = "force-dynamic";

const KINDS = ["affiliates", "commissions", "payouts"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: Request) {
  const operator = await getPlatformOperator();
  if (!operator) return new Response("Not found.", { status: 404 });

  const kind = new URL(request.url).searchParams.get("kind") as Kind | null;
  if (!kind || !KINDS.includes(kind)) return new Response("Unknown export.", { status: 400 });

  const db = createAdminClient();
  let header: string[] = [];
  let rows: (string | number | null)[][] = [];

  if (kind === "affiliates") {
    const { data } = await db
      .from("affiliates")
      .select("id, code, display_name, company_name, contact_email, country, status, tier, payout_readiness, tax_status, created_at, approved_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    header = ["id", "code", "name", "company", "email", "country", "status", "tier", "payout_readiness", "tax_status", "joined", "approved"];
    rows = (data ?? []).map((row) => [
      row.id, row.code, row.display_name, row.company_name, row.contact_email, row.country, row.status,
      row.tier, row.payout_readiness, row.tax_status, row.created_at, row.approved_at,
    ]);
  } else if (kind === "commissions") {
    const { data } = await db
      .from("affiliate_commissions")
      .select("id, affiliate_id, referral_id, entry_type, status, base_amount_minor, commission_amount_minor, currency, period_month, stripe_invoice_id, reversal_of_id, reversal_reason, payout_id, available_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20000);
    header = ["id", "affiliate_id", "referral_id", "entry_type", "status", "base_minor", "commission_minor", "currency", "period", "stripe_invoice", "reversal_of", "reason", "payout_id", "available_at", "created_at"];
    rows = (data ?? []).map((row) => [
      row.id, row.affiliate_id, row.referral_id, row.entry_type, row.status, row.base_amount_minor,
      row.commission_amount_minor, row.currency, row.period_month, row.stripe_invoice_id, row.reversal_of_id,
      row.reversal_reason, row.payout_id, row.available_at, row.created_at,
    ]);
  } else {
    const { data } = await db
      .from("affiliate_payouts")
      .select("id, affiliate_id, status, amount_minor, currency, commission_count, method, external_reference, processor_payout_id, period_start, period_end, approved_at, paid_at, failure_code, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    header = ["id", "affiliate_id", "status", "amount_minor", "currency", "commissions", "method", "external_reference", "transfer_id", "period_start", "period_end", "approved_at", "paid_at", "failure_code", "created_at"];
    rows = (data ?? []).map((row) => [
      row.id, row.affiliate_id, row.status, row.amount_minor, row.currency, row.commission_count, row.method,
      row.external_reference, row.processor_payout_id, row.period_start, row.period_end, row.approved_at,
      row.paid_at, row.failure_code, row.created_at,
    ]);
  }

  await recordAudit({
    businessId: null,
    actorUserId: operator.id,
    actorType: "platform_admin",
    action: "affiliate.exported",
    entityType: "affiliate_export",
    metadata: { kind, rows: rows.length },
  });

  const csv = [header, ...rows].map((line) => line.map((cell) => csvCell(cell)).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clientturn-affiliate-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
