"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
  User,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { Logo } from "@/components/ui/logo";
import { useScrollableRegion } from "@/components/ui/use-scrollable-region";
import {
  isActiveAffiliateRoute,
  navFor,
  type AffiliateNavItem,
} from "@/lib/affiliates/nav";

/**
 * The partner portal rail (V4 §33).
 *
 * Visually the same family as the customer app sidebar — same dark gradient,
 * same lime active state, same 48px rows — because a partner should recognise
 * ClientTurn. Structurally separate, because a partner has no workspace: there
 * is no workspace card, no workspace switcher and no plan prompt, and nothing
 * in this rail can lead to `/app`.
 */

function NavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: AffiliateNavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActiveAffiliateRoute(pathname, item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-[10px] text-[14px] font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
        collapsed
          ? "mx-auto size-[var(--ct-rail-row-h)] justify-center"
          : "h-[var(--ct-rail-row-h)] px-3.5",
        active
          ? "bg-[var(--ct-shell-active-bg)] text-[var(--ct-lime)]"
          : "text-[var(--ct-shell-text)] hover:bg-[var(--ct-shell-hover)] hover:text-white",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          active
            ? "text-[var(--ct-lime)]"
            : "text-[var(--ct-shell-text-muted)] group-hover:text-white",
        )}
        aria-hidden
      />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
    </Link>
  );

  // The active indicator sits on the full-width row rather than inside the
  // link, so it lands flush against the rail edge in both collapsed states.
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

/**
 * The resources promo card.
 *
 * Hidden entirely when collapsed rather than shrunk to an icon: a call to
 * action with no words is just a decoration taking up rail height.
 */
function ResourcesCard({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  if (collapsed) return null;

  return (
    <div
      className="mb-3 rounded-[14px] p-4"
      style={{
        background: "var(--ct-shell-card-bg)",
        border: "1px solid var(--ct-shell-card-border)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ct-lime)]">
          <Star className="size-4 text-[var(--ct-midnight)]" aria-hidden />
        </span>
        <p className="text-[13.5px] font-semibold leading-snug text-white">
          Grow your commissions
        </p>
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--ct-shell-text-muted)]">
        Access exclusive resources, tips and campaigns to boost your earnings.
      </p>
      <Link
        href="/affiliates/app/resources"
        onClick={onNavigate}
        className={cn(
          "mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px]",
          "bg-[var(--ct-lime)] text-[13px] font-semibold text-[var(--ct-midnight)]",
          "transition-colors duration-150 hover:bg-[#a6e238]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        )}
      >
        View resources
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/** Matches NavRow's styling exactly so a button does not read as a different kind of row. */
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
        collapsed
          ? "mx-auto size-[var(--ct-rail-row-h)] justify-center"
          : "h-[var(--ct-rail-row-h)] px-3.5",
      )}
    >
      <Icon
        className="size-5 shrink-0 text-[var(--ct-shell-text-muted)] group-hover:text-white"
        aria-hidden
      />
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

export function AffiliateSidebarContent({
  collapsed,
  status,
  onToggleCollapse,
  onNavigate,
  onOpenProfile,
}: {
  collapsed: boolean;
  status: string;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  onOpenProfile?: () => void;
}) {
  const items = navFor(status);
  // Only becomes a tab stop while the rail genuinely overflows.
  const { attach: attachNav, props: navProps } = useScrollableRegion("Affiliate navigation", { landmark: true });

  return (
    <div
      className="ct-rail flex h-full flex-col"
      style={{
        background:
          "linear-gradient(180deg, var(--ct-shell-sidebar-from) 0%, var(--ct-shell-sidebar-via) 52%, var(--ct-shell-sidebar-to) 100%)",
      }}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col justify-center px-5",
          collapsed && "items-center px-2",
        )}
        style={{
          height: "var(--ct-rail-header-h)",
          borderBottom: "1px solid var(--ct-shell-divider)",
        }}
      >
        {collapsed ? (
          <Link
            href="/affiliates/app"
            aria-label="Affiliate Portal home"
            className="flex size-12 items-center justify-center rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
          >
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--ct-lime)] text-[16px] font-bold text-[var(--ct-midnight)]">
              C
            </span>
          </Link>
        ) : (
          <>
            <Logo
              href="/affiliates/app"
              height={30}
              imgClassName="h-[min(30px,var(--ct-rail-logo-h))] w-auto"
            />
            <p className="mt-1 pl-[3px] text-[12px] font-medium text-[var(--ct-shell-text-muted)]">
              Affiliate Portal
            </p>
          </>
        )}
      </div>

      <nav
        aria-label="Affiliate portal"
        ref={attachNav}
        {...navProps}
        className="ct-scroll-rail min-h-0 flex-1 overflow-y-auto px-2.5 pt-[var(--ct-rail-nav-pt)]"
      >
        <ul className="flex flex-col gap-[var(--ct-rail-gap)]">
          {items.map((item) => (
            <li key={item.href}>
              <NavRow item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div
        className="shrink-0 px-2.5 py-[var(--ct-rail-foot-py)]"
        style={{ borderTop: "1px solid var(--ct-shell-divider)" }}
      >
        <div className="ct-rail-upsell">
          <ResourcesCard collapsed={collapsed} onNavigate={onNavigate} />
        </div>

        <ul className="flex flex-col gap-[var(--ct-rail-gap)]">
          <li>
            <NavRow
              item={{
                href: "/affiliates/app/help",
                label: "Help",
                icon: CircleHelp,
              }}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
          {onOpenProfile && (
            <li>
              <NavButton
                label="Profile"
                icon={User}
                collapsed={collapsed}
                onClick={() => {
                  onNavigate?.();
                  onOpenProfile();
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
                  aria-expanded={false}
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
                aria-expanded
                className="flex h-[var(--ct-rail-row-h)] w-full items-center gap-3 rounded-[10px] px-3.5 text-[14px] font-medium text-[var(--ct-shell-text)] transition-colors duration-150 hover:bg-[var(--ct-shell-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
              >
                <PanelLeftClose
                  className="size-5 shrink-0 text-[var(--ct-shell-text-muted)]"
                  aria-hidden
                />
                <span>Collapse</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
