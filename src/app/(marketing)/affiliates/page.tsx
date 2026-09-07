import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { getAffiliateAccount, getPublicPolicy } from "@/lib/affiliates/portal";
import { AffiliateLanding } from "@/components/affiliates/public/affiliate-landing";
import "./affiliates.css";

export const metadata: Metadata = {
  title: "Affiliate Programme | ClientTurn",
  description:
    "Earn commission introducing UK home-service businesses to ClientTurn. Free to join, simple tracking, real commission.",
};

export const dynamic = "force-dynamic";

/**
 * The public affiliate programme page (V4 §29).
 *
 * Lives in the `(marketing)` route group so it inherits the public shell —
 * the same header, footer, cookie banner and `--pub-*` canvas as every other
 * public page. It previously mounted its own header and footer from outside
 * the group, which is why it drifted away from the rest of the site.
 *
 * The CTA resolves against who is actually looking at it, because "Become an
 * Affiliate" means four different things depending on the visitor:
 *
 * - **Signed out** → sign up, then apply.
 * - **Signed in, no affiliate account** → straight to the application.
 * - **Approved or active** → they belong in the portal, not on the sales page
 *   for a programme they already joined, so they are redirected.
 * - **Pending, suspended or rejected** → the portal shows them their status,
 *   which is a better answer than a page inviting them to apply again.
 */
export default async function AffiliateProgrammePage() {
  const [user, affiliate, policy] = await Promise.all([
    getUser(),
    getAffiliateAccount(),
    getPublicPolicy(),
  ]);

  if (affiliate && (affiliate.status === "ACTIVE" || affiliate.status === "APPROVED")) {
    redirect("/affiliates/app");
  }

  // Pending, suspended or rejected: the portal renders the status panel.
  if (affiliate) redirect("/affiliates/app");

  // Signed in: straight to the application wizard. Signed out: the partner
  // sign-up door, which hands off to the wizard once the account exists.
  const ctaHref = user ? "/affiliates/onboarding" : "/affiliates/signup";

  return (
    <div className="afp">
      <AffiliateLanding
        policy={policy}
        ctaHref={ctaHref}
        ctaLabel="Become an Affiliate"
        signedIn={Boolean(user)}
      />
    </div>
  );
}
