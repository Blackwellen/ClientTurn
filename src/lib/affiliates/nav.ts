/**
 * Affiliate portal navigation (V4 §33).
 *
 * A partner is neither a customer nor an operator, so the portal gets its own
 * shell rather than borrowing the app sidebar: nothing in here should ever be
 * one mis-click away from a workspace's leads.
 *
 * Pure — the shell is a client component.
 */

export type AffiliateNavItem = {
  href: string;
  label: string;
  /** Shown only once the partner is approved. */
  requiresActive?: boolean;
};

export const AFFILIATE_NAV: AffiliateNavItem[] = [
  { href: "/affiliates/app", label: "Overview" },
  { href: "/affiliates/app/links", label: "Links", requiresActive: true },
  { href: "/affiliates/app/referrals", label: "Referrals", requiresActive: true },
  { href: "/affiliates/app/commissions", label: "Commissions", requiresActive: true },
  { href: "/affiliates/app/payouts", label: "Payouts", requiresActive: true },
  { href: "/affiliates/app/resources", label: "Resources", requiresActive: true },
  { href: "/affiliates/app/profile", label: "Profile" },
];

export function isActiveAffiliateRoute(pathname: string, href: string): boolean {
  if (href === "/affiliates/app") return pathname === "/affiliates/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The destinations a partner in this state may use.
 *
 * An applicant sees Overview and Profile only: there is nothing to link to and
 * no money to show until they are approved, and rendering empty tables reads as
 * failure rather than as "not yet".
 */
export function navFor(status: string): AffiliateNavItem[] {
  if (status === "ACTIVE") return AFFILIATE_NAV;
  return AFFILIATE_NAV.filter((item) => !item.requiresActive);
}
