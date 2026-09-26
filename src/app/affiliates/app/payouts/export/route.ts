import { getAffiliateAccount, listPortalPayouts } from "@/lib/affiliates/portal";
import { csvCell } from "@/lib/csv";
import { formatMinor } from "@/lib/affiliates/types";
import { PAYOUT_STATUS_LABEL } from "@/lib/affiliates/types";

/** Every payout this partner has had, as CSV for their bookkeeping. */
export const dynamic = "force-dynamic";

export async function GET() {
  const affiliate = await getAffiliateAccount();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return new Response("Not found.", { status: 404 });
  }

  const payouts = await listPortalPayouts(affiliate.id, 500);

  const lines = [
    ["Payout ID", "Period", "Amount", "Status", "Method", "Date"]
      .map(csvCell)
      .join(","),
  ];

  for (const payout of payouts) {
    lines.push(
      [
        payout.reference,
        payout.periodLabel,
        formatMinor(payout.amountMinor, payout.currency),
        PAYOUT_STATUS_LABEL[payout.status],
        payout.method ?? "",
        (payout.paidAt ?? payout.scheduledAt ?? payout.createdAt).slice(0, 10),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return new Response(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clientturn-payouts.csv"`,
      "cache-control": "no-store",
    },
  });
}
