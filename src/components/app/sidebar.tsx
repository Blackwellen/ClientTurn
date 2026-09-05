"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isActiveRoute, type NavItem } from "@/lib/app/nav";
import { Tooltip } from "@/components/ui/tooltip";
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
        collapsed ? "mx-auto size-12 justify-center" : "h-[46px] px-3.5",
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

function WorkspaceCard({
  collapsed,
  businessName,
  planLabel,
}: {
  collapsed: boolean;
  businessName: string;
  planLabel: string;
}) {
  if (collapsed) {
    return (
      <div className="flex justify-center pb-3">
        <div className="flex size-10 items-center justify-center rounded-[10px] border border-[var(--ct-shell-card-border)] bg-[var(--ct-shell-card-bg)]">
          <Building2 className="size-4.5 text-[var(--ct-lime)]" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-[var(--ct-shell-card-border)] bg-[var(--ct-shell-card-bg)] px-3.5 py-3 transition-colors duration-150 hover:bg-[var(--ct-shell-card-hover)]">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--ct-shell-card-border)] bg-[var(--ct-lime)]/10">
        <Building2 className="size-4 text-[var(--ct-lime)]" aria-hidden />
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

export function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
  businessName,
  planLabel,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  businessName: string;
  planLabel: string;
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
        className={cn("flex shrink-0 items-center", collapsed ? "justify-center px-2" : "px-5")}
        style={{ height: 76 }}
      >
        {collapsed ? (
          <Link
            href="/app"
            aria-label="ClientTurn home"
            className="flex size-12 items-center justify-center rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
          >
            {/* Favicon.png already bakes in its own rounded-square corners and
                transparent margin — clipping it again with a CSS radius fights
                that padding and looks jagged at this size, so it renders bare. */}
            <Image
              src="/Favicon.png"
              alt=""
              width={44}
              height={44}
              className="size-11 shrink-0"
              priority
            />
          </Link>
        ) : (
          <Logo href="/app" height={30} />
        )}
      </div>

      <WorkspaceCard collapsed={collapsed} businessName={businessName} planLabel={planLabel} />

      <nav
        aria-label="Main"
        className={cn("flex-1 overflow-y-auto", collapsed ? "px-2.5" : "px-2.5")}
      >
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
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
        <ul className="space-y-1">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
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
                className="flex h-[46px] w-full items-center gap-3 rounded-[10px] px-3.5 text-[14px] font-medium text-[var(--ct-shell-text)] transition-colors duration-150 hover:bg-[var(--ct-shell-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
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
