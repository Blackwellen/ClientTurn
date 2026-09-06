"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleUserRound,
  Database,
  HelpCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { adminSignOut } from "@/lib/admin/actions";
import { cn } from "@/lib/cn";
import { ADMIN_NAV, isActiveAdminRoute, type NavItem } from "@/lib/admin/nav";
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
  const active = isActiveAdminRoute(pathname, item.href);
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

/** Collapsed hides this entirely, same as the customer app's workspace
 *  block — the reference shell doesn't shrink it to an icon. */
function EnvironmentCard({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return null;

  return (
    <div className="mx-3 mt-3 mb-3 rounded-xl border border-[var(--ct-shell-card-border)] bg-[var(--ct-shell-card-bg)] px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-[var(--ct-shell-icon-bg)]">
          <Database className="size-4.5 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Neither the environment name nor its health may ellipsise —
                together they are the answer to "which platform am I on, and
                is it up". Sentence case keeps the pill narrow enough that
                both fit the rail at its default width. */}
            <p className="shrink-0 text-[13px] font-semibold text-white">
              Live Platform
            </p>
            <span className="inline-flex shrink-0 items-center rounded-full bg-success-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-success-500">
              Healthy
            </span>
          </div>
          <p className="truncate text-[11px] text-[var(--ct-shell-text-muted)]">
            Production environment
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The footer rail. Every item here does something real: Help opens the
 * operator briefing, Profile is the account menu, Collapse narrows the rail.
 */
function FooterButton({
  icon: Icon,
  label,
  collapsed,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex items-center gap-3 rounded-[10px] text-[14px] font-medium",
        "text-[var(--ct-shell-text)] transition-colors duration-150",
        "hover:bg-[var(--ct-shell-hover)] hover:text-white",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
        collapsed ? "mx-auto size-12 justify-center" : "h-[46px] w-full px-3.5",
      )}
    >
      <Icon className="size-5 shrink-0 text-[var(--ct-shell-text-muted)]" />
      {!collapsed && <span className="truncate">{label}</span>}
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

function OperatorHelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Platform Admin briefing"
      description="What this area does, and the boundaries it operates within."
      size="md"
    >
      <div className="space-y-3 text-[13px] text-content-secondary">
        <p>
          <strong className="text-content">Overview</strong> is the operational
          and commercial snapshot. <strong className="text-content">Customers</strong>{" "}
          lists every workspace with usage and connection health, and opens the
          support drawer. <strong className="text-content">System</strong> holds
          Health, Events and Errors.
        </p>
        <p>
          Mutating actions &mdash; resending onboarding, running a health check,
          suspending a workspace, retrying an event, resolving an error &mdash;
          require a password step-up that lasts 30 minutes, and every one is
          written to the audit log against your operator account.
        </p>
        <p>
          Signing in as a customer is not available. Access tokens, API keys and
          webhook signing secrets are never read by any admin screen, and
          credential-shaped fields are redacted from event payloads before they
          leave the server.
        </p>
        <p>
          Stripe remains the source of truth for billing; the MRR figure on
          Overview is a local mirror.
        </p>
      </div>
    </Modal>
  );
}

export function AdminSidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
  operator,
}: {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  operator?: { name: string; email: string };
}) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = React.useState(false);
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
        style={{ height: 128, borderBottom: "1px solid var(--ct-shell-divider)" }}
      >
        {collapsed ? (
          <Link
            href="/admin"
            aria-label="ClientTurn Platform Admin home"
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
          <Link href="/admin" className="flex flex-col items-center gap-1">
            <Logo href={null} height={68} />
            <span className="text-[11px] font-medium tracking-wide text-[var(--ct-shell-text-muted)]">
              Platform Admin
            </span>
          </Link>
        )}
      </div>

      <EnvironmentCard collapsed={collapsed} />

      <nav
        aria-label="Admin"
        className={cn("flex-1 overflow-y-auto px-2.5", collapsed && "pt-3")}
      >
        <ul className="space-y-1.5">
          {ADMIN_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div
        className="shrink-0 space-y-1 px-2.5 py-3"
        style={{ borderTop: "1px solid var(--ct-shell-divider)" }}
      >
        <FooterButton
          icon={HelpCircle}
          label="Help"
          collapsed={collapsed}
          onClick={() => setHelpOpen(true)}
        />
        {operator ? (
          <DropdownMenu
            align="start"
            trigger={
              <button
                type="button"
                aria-label="Profile"
                className={cn(
                  "flex items-center gap-3 rounded-[10px] text-[14px] font-medium",
                  "text-[var(--ct-shell-text)] transition-colors duration-150",
                  "hover:bg-[var(--ct-shell-hover)] hover:text-white",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
                  collapsed ? "mx-auto size-12 justify-center" : "h-[46px] w-full px-3.5",
                )}
              >
                <CircleUserRound className="size-5 shrink-0 text-[var(--ct-shell-text-muted)]" />
                {!collapsed && <span className="truncate">Profile</span>}
              </button>
            }
          >
            <div className="px-3 pt-1.5 pb-2">
              <p className="truncate text-[13px] font-semibold text-content">
                {operator.name}
              </p>
              <p className="truncate text-[12px] text-content-muted">
                {operator.email}
              </p>
            </div>
            <DropdownSeparator />
            <DropdownItem
              icon={LogOut}
              destructive
              onSelect={async () => {
                const result = await adminSignOut();
                router.push(
                  result.ok && result.redirectTo
                    ? result.redirectTo
                    : "/admin/login",
                );
                router.refresh();
              }}
            >
              Sign out
            </DropdownItem>
          </DropdownMenu>
        ) : null}
      </div>

      {onToggleCollapse && (
        <div
          className="shrink-0 px-2.5 py-3"
          style={{ borderTop: "1px solid var(--ct-shell-divider)" }}
        >
          <div className={cn(collapsed && "flex justify-center")}>
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
        </div>
      )}
      <OperatorHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
