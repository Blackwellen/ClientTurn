import { getAffiliateAccount, listReferralPage } from "@/lib/affiliates/portal";
import { formatMinor } from "@/lib/affiliates/types";
import {
  PAID_STATE_LABEL,
  TRIAL_STATE_LABEL,
  type PaidState,
  type TrialState,
} from "@/lib/affiliates/programme";

/**
 * The referral export.
 *
 * Carries exactly what the table carries and nothing more. In particular there
 * is no customer name, email, workspace id or plan price column — an export is
 * the classic place where a privacy boundary quietly stops applying, so the
 * columns here are enumerated explicitly rather than spread from a row.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const affiliate = await getAffiliateAccount();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return new Response("Not found.", { status: 404 });
  }

  const page = await listReferralPage(affiliate.id, { pageSize: 50, page: 1 });
  const currency = affiliate.policy.currency;

  const header = [
    "Referral",
    "Source",
    "Signup date",
    "Trial status",
    "Plan",
    "Paid state",
    "Commission state",
    "Attribution expires",
    "Commission",
  ];

  const lines = [header.map(escape).join(",")];

  for (const row of page.rows) {
    lines.push(
      [
        row.label,
        row.sourceLabel ?? "Direct",
        row.signupAt?.slice(0, 10) ?? "",
        TRIAL_STATE_LABEL[row.trialState as TrialState] ?? row.trialState,
        row.planKey ?? "",
        PAID_STATE_LABEL[row.paidState as PaidState] ?? row.paidState,
        row.commissionState ?? "",
        row.attributionExpiresAt?.slice(0, 10) ?? "",
        formatMinor(row.commissionMinor, currency),
      ]
        .map(escape)
        .join(","),
    );
  }

  return new Response(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clientturn-referrals.csv"`,
      "cache-control": "no-store",
    },
  });
}

/** Quotes a field, and defuses anything a spreadsheet would treat as a formula. */
function escape(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
