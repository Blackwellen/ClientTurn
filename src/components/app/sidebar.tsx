"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PROFILE_NAV_ICON,
  SECONDARY_NAV,
  isActiveRoute,
  type NavItem,
} from "@/lib/app/nav";
import { Tooltip } from "@/components/ui/tooltip";
import { UpgradeCard } from "./upgrade-card";
import { Logo } from "@/components/ui/logo";

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActiveRoute(pathname, item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-[10px] text-[14px] font-medium",
        "transition-colors duration-150",
        collapsed ? "mx-auto size-12 justify-center" : "h-[48px] px-3.5",
        active
          ? "bg-[var(--ct-shell-active-bg)] text-[var(--ct-lime)]"
          : "text-[var(--ct-shell-text)] hover:bg-[var(--ct-shell-hover)] hover:text-white",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          active ? "text-[var(--ct-lime)]" : "text-[var(--ct-shell-text-muted)] group-hover:text-white",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && <span className="sr-only">{item.label}</span>}
    </Link>
  );

  // The indicator sits on the full-width row rather than inside the (often
  // centered/padded) link itself, so it always lands flush against the rail
  // edge regardless of collapsed state.
  return (
    <div className="relative">
      {active && (
        <span
          aria-hidden
          className="absolute -left-2.5 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-[var(--ct-lime)]"
        />
      )}
      {collapsed ? (
        <Tooltip content={item.label} placement="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </div>
  );
}

/** The reference shell has no card chrome here — just the mark and the
 *  name floating on the rail — and hides the whole block when collapsed
 *  rather than shrinking it to an icon. */
function WorkspaceCard({
  collapsed,
  businessName,
  planLabel,
}: {
  collapsed: boolean;
  businessName: string;
  planLabel: string;
}) {
  if (collapsed) return null;

  return (
    <div
      className="flex items-center gap-3 px-5 py-4"
      style={{ borderBottom: "1px solid var(--ct-shell-divider)" }}
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ct-shell-icon-bg)]">
        <Building2 className="size-5 text-white" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">
          {businessName}
        </p>
        <p className="truncate text-[11px] text-[var(--ct-shell-text-muted)]">{planLabel}</p>
      </div>
    </div>
  );
}

/** Matches NavLink's row styling exactly so Profile does not read as a
 *  different kind of control just because it opens a dialog. */
function NavButton({
  label,
  icon: Icon,
  collapsed,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-[10px] text-[14px] font-medium",
        "text-[var(--ct-shell-text)] transition-colors duration-150",
        "hover:bg-[var(--ct-shell-hover)] hover:text-white",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
        collapsed ? "mx-auto size-12 justify-center" : "h-[48px] px-3.5",
      )}
    >
      <Icon className="size-5 shrink-0 text-[var(--ct-shell-text-muted)] group-hover:text-white" />
      {collapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </button>
  );

  return collapsed ? (
    <Tooltip content={label} placement="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
  businessName,
  planLabel,
  plan,
  canManageBilling,
  primaryNav,
  onOpenAccount,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  businessName: string;
  planLabel: string;
  /** The workspace's plan key, for the upgrade prompt. */
  plan: string;
  canManageBilling: boolean;
  /** Resolved by the layout from the workspace's plan, so a destination the
   *  plan does not include never appears in the rail. */
  primaryNav: NavItem[];
  onOpenAccount?: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col"
      style={{
        background:
          "linear-gradient(180deg, var(--ct-shell-sidebar-from) 0%, var(--ct-shell-sidebar-via) 52%, var(--ct-shell-sidebar-to) 100%)",
      }}
    >
      <div
        className="flex shrink-0 items-center justify-center px-2"
        style={{ height: 116, borderBottom: "1px solid var(--ct-shell-divider)" }}
      >
        {collapsed ? (
          <Link
            href="/app"
            aria-label="ClientTurn home"
            className="flex size-14 items-center justify-center rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
          >
            {/* Favicon.png already bakes in its own rounded-square corners and
                transparent margin — clipping it again with a CSS radius fights
                that padding and looks jagged at this size, so it renders bare. */}
            <Image
              src="/Favicon.png"
              alt=""
              width={48}
              height={48}
              className="size-12 shrink-0"
              priority
            />
          </Link>
        ) : (
          <Logo href="/app" height={68} />
        )}
      </div>

      <WorkspaceCard collapsed={collapsed} businessName={businessName} planLabel={planLabel} />

      <nav
        aria-label="Main"
        className="scrollbar-none flex-1 overflow-y-auto px-2.5 pt-3"
      >
        <ul className="space-y-1.5">
          {primaryNav.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div
        className="shrink-0 px-2.5 py-3"
        style={{ borderTop: "1px solid var(--ct-shell-divider)" }}
      >
        <UpgradeCard
          plan={plan}
          canManageBilling={canManageBilling}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />

        <ul className="space-y-1.5">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
          {onOpenAccount && (
            <li>
              <NavButton
                label="Profile"
                icon={PROFILE_NAV_ICON}
                collapsed={collapsed}
                onClick={() => {
                  onNavigate?.();
                  onOpenAccount();
                }}
              />
            </li>
          )}
        </ul>

        {onToggleCollapse && (
          <div className={cn("mt-1", collapsed && "flex justify-center")}>
            {collapsed ? (
              <Tooltip content="Expand sidebar" placement="right">
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="Expand sidebar"
                  aria-expanded={!collapsed}
                  className="flex size-12 items-center justify-center rounded-[10px] text-[var(--ct-shell-text-muted)] transition-colors duration-150 hover:bg-[var(--ct-shell-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
                >
                  <PanelLeftOpen className="size-5 shrink-0" />
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                aria-expanded={!collapsed}
                className="flex h-[48px] w-full items-center gap-3 rounded-[10px] px-3.5 text-[14px] font-medium text-[var(--ct-shell-text)] transition-colors duration-150 hover:bg-[var(--ct-shell-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
              >
                <PanelLeftClose className="size-5 shrink-0 text-[var(--ct-shell-text-muted)]" />
                <span>Collapse</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
