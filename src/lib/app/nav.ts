import type * as React from "react";
import {
  CircleHelp,
  LayoutDashboard,
  Repeat,
  Settings,
  User,
  Users,
  Workflow,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** The order is fixed by the product bible. Nothing else belongs in here. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/leads", label: "Leads", icon: Users },
  { href: "/app/follow-up", label: "Follow-Up", icon: Workflow },
  { href: "/app/reactivation", label: "Reactivation", icon: Repeat },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/app/help", label: "Help", icon: CircleHelp },
  { href: "/app/profile", label: "Profile", icon: User },
];

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TITLES: [string, string][] = [
  ["/app/leads", "Leads"],
  ["/app/follow-up", "Follow-Up"],
  ["/app/reactivation", "Reactivation"],
  ["/app/settings", "Settings"],
  ["/app/help", "Help"],
  ["/app/profile", "Profile"],
];

export function titleForPath(pathname: string) {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Dashboard";
}
