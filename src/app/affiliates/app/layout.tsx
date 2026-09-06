import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { getAffiliateAccount, listPromoCodes } from "@/lib/affiliates/portal";
import { listNotifications } from "@/lib/affiliates/notifications";
import { getLinkMetrics } from "@/lib/affiliates/analytics";
import { AffiliatePortalShell } from "@/components/affiliates/shell/affiliate-portal-shell";
import type { SearchEntry } from "@/components/affiliates/shell/affiliate-search";

/**
 * Guards the whole partner portal (V4 §33).
 *
 * Three distinct outcomes, because they are genuinely different situations:
 *
 * - **Signed out** → the partner login, with a return path. Not the customer
 *   login: a partner may have no workspace to sign in to there at all.
 * - **Signed in, no affiliate account** → the programme page. They are not
 *   forbidden from anything; they simply have not joined, and an error about
 *   permissions would be answering a question they never asked.
 * - **Has an account** → the portal, with the rail filtered to what their
 *   status actually permits.
 *
 * Everything the shell needs is loaded here rather than per-page so the chrome
 * does not flicker between navigations.
 */
export default async function AffiliateAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/affiliates/login?redirect=/affiliates/app");

  const affiliate = await getAffiliateAccount();
  if (!affiliate) redirect("/affiliates");

  const [notifications, searchIndex, cookieStore] = await Promise.all([
    listNotifications(affiliate.id, 12),
    buildSearchIndex(affiliate.id, affiliate.status),
    cookies(),
  ]);

  const collapsed =
    cookieStore.get("ct-affiliate-sidebar-collapsed")?.value === "1";

  return (
    <AffiliatePortalShell
      initialCollapsed={collapsed}
      status={affiliate.status}
      connectState={affiliate.connectState}
      payoutReadiness={affiliate.payoutReadiness}
      reference={affiliate.reference}
      user={{ name: affiliate.displayName, email: affiliate.contactEmail }}
      notifications={notifications}
      searchIndex={searchIndex}
    >
      {children}
    </AffiliatePortalShell>
  );
}

/**
 * The portal search index.
 *
 * Built from the partner's own links and promo codes plus the portal's own
 * destinations. Referral rows are deliberately absent: a referral has no
 * customer-identifying label to search on by design, so indexing them would
 * add rows that can only ever match their own generated title.
 */
async function buildSearchIndex(
  affiliateId: string,
  status: string,
): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = [
    { label: "Home", caption: "Dashboard overview", href: "/affiliates/app", group: "Page" },
    { label: "Links", caption: "Referral links and promo codes", href: "/affiliates/app/links", group: "Page" },
    { label: "Referrals", caption: "Your referred accounts", href: "/affiliates/app/referrals", group: "Page" },
    { label: "Resources Hub", caption: "Brand and campaign assets", href: "/affiliates/app/resources", group: "Page" },
    { label: "Performance", caption: "Clicks, conversions and commission", href: "/affiliates/app/performance", group: "Page" },
    { label: "Payouts", caption: "Balances, payouts and tax", href: "/affiliates/app/payouts", group: "Page" },
    { label: "Settings", caption: "Account, payments and preferences", href: "/affiliates/app/settings", group: "Page" },
  ];

  if (status !== "ACTIVE") return entries;

  const [links, promo] = await Promise.all([
    getLinkMetrics(affiliateId, "90d"),
    listPromoCodes(affiliateId),
  ]);

  for (const link of links) {
    entries.push({
      label: link.label,
      caption: `${link.clicks.toLocaleString("en-GB")} clicks · ${link.destinationPath}`,
      href: "/affiliates/app/links",
      group: "Link",
    });
  }

  for (const code of promo.codes) {
    entries.push({
      label: code.code,
      caption: code.offer,
      href: "/affiliates/app/links",
      group: "Promo",
    });
  }

  return entries;
}
