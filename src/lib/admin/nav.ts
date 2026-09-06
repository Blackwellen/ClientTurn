import type * as React from "react";
import {
  Building2,
  Coins,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  ServerCog,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * Only routes that actually exist under /admin/(ops) belong here. Billing and
 * a dedicated admin Settings page are not built yet — add them once their
 * routes ship rather than linking to a 404.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: Building2 },
  { href: "/admin/economics", label: "Usage & Margins", icon: Coins },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/affiliates", label: "Affiliates", icon: Handshake },
  { href: "/admin/system", label: "System", icon: ServerCog },
];

export function isActiveAdminRoute(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TITLES: [string, string][] = [
  ["/admin/customers", "Customers"],
  ["/admin/economics", "Usage & Margins"],
  ["/admin/support", "Support"],
  ["/admin/affiliates", "Affiliates"],
  ["/admin/system", "System"],
];

export function titleForAdminPath(pathname: string) {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Overview";
}
