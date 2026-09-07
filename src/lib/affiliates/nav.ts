/**
 * Affiliate portal navigation (V4 §33).
 *
 * A partner is neither a customer nor an operator, so the portal gets its own
 * shell rather than borrowing the app sidebar: nothing in here should ever be
 * one mis-click away from a workspace's leads.
 *
 * Seven destinations, fixed. Settings is a single destination with sections
 * inside it rather than six sidebar entries — a rail that grows a row per
 * settings page stops being navigation and becomes a table of contents.
 *
 * Pure — the shell is a client component.
 */

import {
  BarChart3,
  CreditCard,
  FileText,
  Home,
  Link2,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AffiliateNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only once the partner is approved and earning. */
  requiresActive?: boolean;
};

export const AFFILIATE_NAV: AffiliateNavItem[] = [
  { href: "/affiliates/app", label: "Home", icon: Home },
  { href: "/affiliates/app/links", label: "Links", icon: Link2, requiresActive: true },
  {
    href: "/affiliates/app/referrals",
    label: "Referrals",
    icon: Users,
    requiresActive: true,
  },
  {
    href: "/affiliates/app/resources",
    label: "Resources Hub",
    icon: FileText,
    requiresActive: true,
  },
  {
    href: "/affiliates/app/performance",
    label: "Performance",
    icon: BarChart3,
    requiresActive: true,
  },
  {
    href: "/affiliates/app/payouts",
    label: "Payouts",
    icon: CreditCard,
    requiresActive: true,
  },
  { href: "/affiliates/app/settings", label: "Settings", icon: Settings },
];

export function isActiveAffiliateRoute(pathname: string, href: string): boolean {
  if (href === "/affiliates/app") return pathname === "/affiliates/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The destinations a partner in this state may use.
 *
 * An applicant sees Home and Settings only: there is nothing to link to and no
 * money to show until they are approved, and rendering empty tables reads as
 * failure rather than as "not yet".
 */
export function navFor(status: string): AffiliateNavItem[] {
  if (status === "ACTIVE") return AFFILIATE_NAV;
  return AFFILIATE_NAV.filter((item) => !item.requiresActive);
}

/** The page title, for the mobile top bar where the rail is hidden. */
export function titleForAffiliatePath(pathname: string): string {
  const match = [...AFFILIATE_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isActiveAffiliateRoute(pathname, item.href));
  return match?.label ?? "Affiliate Portal";
}

/* -------------------------------------------------------- settings nav --- */

export const AFFILIATE_SETTINGS_SECTIONS = [
  { key: "account", label: "Account", caption: "Profile & details" },
  { key: "payments", label: "Payments", caption: "Payouts & Stripe" },
  { key: "identity", label: "Identity", caption: "Verify your identity" },
  { key: "tax", label: "Tax Information", caption: "Tax forms & compliance" },
  { key: "notifications", label: "Notifications", caption: "Email & updates" },
  { key: "preferences", label: "Preferences", caption: "Tracking & defaults" },
] as const;

export type AffiliateSettingsSection =
  (typeof AFFILIATE_SETTINGS_SECTIONS)[number]["key"];

export function parseSettingsSection(
  value: string | null | undefined,
): AffiliateSettingsSection {
  const known = AFFILIATE_SETTINGS_SECTIONS.map((section) => section.key);
  return (known as readonly string[]).includes(value ?? "")
    ? (value as AffiliateSettingsSection)
    : "account";
}
