import type * as React from "react";
import {
  BarChart3,
  Bot,
  Inbox,
  CircleHelp,
  LayoutDashboard,
  Radar,
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
  /** Hidden from the rail until the workspace's plan includes the capability.
   *  The route itself still enforces the entitlement server-side. */
  requires?: "sourcing" | "analytics";
};

/**
 * The order is fixed by the product bible. Nothing else belongs in here.
 *
 * V4 adds exactly two destinations — Find Leads and Analytics — and keeps the
 * rest of the shell unchanged. Status and Support are deliberately absent:
 * they are hidden utilities reached from the connection pill and Help, not
 * sidebar destinations (V4 §1.4, §112).
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/agents", label: "Agents", icon: Bot },
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/leads", label: "Leads", icon: Users },
  { href: "/app/find-leads", label: "Find Leads", icon: Radar, requires: "sourcing" },
  { href: "/app/follow-up", label: "Follow-Up", icon: Workflow },
  { href: "/app/reactivation", label: "Reactivation", icon: Repeat },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3, requires: "analytics" },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

/**
 * The rail a given workspace actually sees.
 *
 * A capability the plan does not include is hidden rather than shown disabled:
 * an empty Find Leads that only ever says "upgrade" is sidebar bloat, and the
 * upgrade path already lives in Settings → Billing & Usage. Hiding is a
 * courtesy — `assertEntitlement` on the route is the enforcement.
 */
export function primaryNavFor(capabilities: {
  sourcing: boolean;
  analytics: boolean;
}): NavItem[] {
  return PRIMARY_NAV.filter((item) => {
    if (!item.requires) return true;
    return capabilities[item.requires];
  });
}

/** Profile is deliberately absent: account preferences are a dialog, not a
 *  page, so the sidebar renders it as a button rather than a link. */
export const SECONDARY_NAV: NavItem[] = [
  { href: "/app/help", label: "Help", icon: CircleHelp },
];

export const PROFILE_NAV_ICON = User;

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TITLES: [string, string][] = [
  ["/app/agents", "Agents"],
  ["/app/inbox", "Inbox"],
  ["/app/leads", "Leads"],
  ["/app/find-leads", "Find Leads"],
  ["/app/follow-up", "Follow-Up"],
  ["/app/reactivation", "Reactivation"],
  ["/app/analytics", "Analytics"],
  ["/app/settings", "Settings"],
  ["/app/support", "Support"],
  ["/app/status", "Status"],
  ["/app/help", "Help"],
];

export function titleForPath(pathname: string) {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Dashboard";
}
