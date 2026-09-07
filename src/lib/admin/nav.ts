import type * as React from "react";
import {
  Building2,
  Coins,
  CreditCard,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  ServerCog,
  Settings,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * The eight primary Platform Admin destinations, in the order the approved
 * shell shows them. Nothing else is a top-level admin domain: Jobs and
 * Compliance are views inside System, and the billing/economics split is
 * deliberate — Billing is the subscription and invoice ledger, Usage & Margins
 * is the cost-and-contribution view over the same customers.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: Building2 },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/affiliates", label: "Affiliates", icon: Handshake },
  { href: "/admin/system", label: "System", icon: ServerCog },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/economics", label: "Usage & Margins", icon: Coins },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function isActiveAdminRoute(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TITLES: [string, string][] = [
  ["/admin/customers", "Customers"],
  ["/admin/support", "Support"],
  ["/admin/affiliates", "Affiliates"],
  ["/admin/system", "System"],
  ["/admin/billing", "Billing"],
  ["/admin/economics", "Usage & Margins"],
  ["/admin/settings", "Platform Settings"],
];

export function titleForAdminPath(pathname: string) {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Overview";
}

/**
 * The search field names what the operator can reach from where they are
 * standing. The index it queries is the same everywhere — this is a prompt,
 * not a filter — so the wording never promises a scope search cannot deliver.
 */
const SEARCH_PLACEHOLDERS: [string, string][] = [
  ["/admin/customers", "Search customers, domains, owners…"],
  ["/admin/support", "Search customers, tickets, jobs, settings…"],
  ["/admin/affiliates", "Search affiliates, referrals, payouts, resources…"],
  ["/admin/system", "Search system, providers, jobs, errors…"],
  ["/admin/billing", "Search customers, invoices, subscriptions…"],
  ["/admin/economics", "Search customers, providers, plans, metrics…"],
  ["/admin/settings", "Search settings, providers, models, policies…"],
];

export function searchPlaceholderForAdminPath(pathname: string) {
  for (const [prefix, placeholder] of SEARCH_PLACEHOLDERS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return placeholder;
    }
  }
  return "Search customers, leads, jobs, settings…";
}
