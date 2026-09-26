import { getAffiliateAccount, listPortalPayouts } from "@/lib/affiliates/portal";
import { csvCell } from "@/lib/csv";
import { getPayoutBreakdown } from "@/lib/affiliates/payouts";
import { formatMinor } from "@/lib/affiliates/types";

/**
 * A payout statement, as CSV.
 *
 * CSV rather than a generated PDF because a statement's job is to go into
 * someone's bookkeeping, and every accounting tool reads CSV. There is no PDF
 * renderer in this project and adding one for this would be a large dependency
 * for a worse outcome.
 *
 * Figures come from the ledger entries attached to the payout, so a statement
 * re-downloaded a year later still says what it said on the day.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return new Response("Not found.", { status: 404 });
  }

  const { id } = await context.params;
  const [breakdown, payouts] = await Promise.all([
    getPayoutBreakdown(affiliate.id, id),
    listPortalPayouts(affiliate.id, 200),
  ]);

  const payout = payouts.find((row) => row.id === id);
  if (!breakdown || !payout) return new Response("Not found.", { status: 404 });

  const currency = payout.currency;
  const rows: [string, string][] = [
    ["Statement for", affiliate.displayName],
    ["Affiliate reference", affiliate.reference],
    ["Payout reference", payout.reference],
    ["Period", payout.periodLabel],
    ["Status", payout.status],
    ["Method", payout.method ?? ""],
    ["Paid date", payout.paidAt ? payout.paidAt.slice(0, 10) : ""],
    ["", ""],
    ["Referrals", String(breakdown.referrals)],
    ["Paid customers", String(breakdown.paidCustomers)],
    ["New customer commission", formatMinor(breakdown.newCustomerMinor, currency)],
    ["Renewal commission", formatMinor(breakdown.renewalMinor, currency)],
    ["Adjustments", formatMinor(breakdown.adjustmentMinor, currency)],
    ["Reversals", formatMinor(breakdown.reversalMinor, currency)],
    ["Total payout", formatMinor(payout.amountMinor, currency)],
  ];

  const csv = rows.map(([label, value]) => `${csvCell(label)},${csvCell(value)}`).join("\r\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${payout.reference}-statement.csv"`,
      "cache-control": "no-store",
    },
  });
}
