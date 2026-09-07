import { NextResponse } from "next/server";
import { getAffiliateAccount } from "@/lib/affiliates/portal";
import {
  createOnboardingLink,
  ensureConnectAccount,
} from "@/lib/affiliates/stripe-connect";
import { siteOrigin } from "@/lib/affiliates/origin";

/**
 * Stripe's `refresh_url`.
 *
 * Hit when an account link expired before it was used. Stripe account links are
 * single-use and short-lived, so the only sane response is to mint a fresh one
 * and send the partner straight back — showing them an error for a link that
 * timed out while they were reading it would be our problem presented as theirs.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const origin = await siteOrigin();
  const settings = new URL("/affiliates/app/settings?section=payments", origin);

  const affiliate = await getAffiliateAccount();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    return NextResponse.redirect(settings, 302);
  }

  try {
    const { accountId } = await ensureConnectAccount({
      affiliateId: affiliate.id,
      email: affiliate.contactEmail,
      country: affiliate.country,
      businessName: affiliate.companyName,
    });

    const url = await createOnboardingLink({ accountId, origin });
    return NextResponse.redirect(url, 302);
  } catch {
    // Stripe unreachable: back to settings, where the page shows the stored
    // state and offers the button again.
    return NextResponse.redirect(settings, 302);
  }
}
