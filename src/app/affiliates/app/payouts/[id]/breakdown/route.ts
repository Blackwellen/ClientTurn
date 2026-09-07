import { NextResponse } from "next/server";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import { getPayoutBreakdown } from "@/lib/affiliates/payouts";

/**
 * What one payout was made of.
 *
 * The affiliate is resolved from the session and the payout is looked up
 * scoped to them, so the id in the URL cannot reach another partner's payout —
 * `getPayoutBreakdown` returns null rather than data when they do not match.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const affiliate = await getAffiliateAccount();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await context.params;
  const breakdown = await getPayoutBreakdown(affiliate.id, id);

  // Deliberately a 404 rather than a 403: a partner has no business learning
  // whether another partner's payout id exists.
  if (!breakdown) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json(breakdown, {
    headers: { "cache-control": "no-store" },
  });
}
