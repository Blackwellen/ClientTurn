"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Compass, Menu, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, TOUCH_TARGET } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { INTEGRATION_HEALTH } from "@/components/ui/badge";
import { titleForPath } from "@/lib/app/nav";
import { sectionTourForPath } from "@/lib/tour/model";
import { requestSectionTour } from "@/lib/tour/events";
import { CommandPalette } from "./command-palette";
import {
  NotificationTray,
  type NotificationRow,
} from "./notification-tray";
import { ProfilePopover } from "./profile-popover";

const HEALTH_DOT: Record<string, string> = {
  HEALTHY: "bg-success-500",
  DEGRADED: "bg-warning-500",
  ACTION_REQUIRED: "bg-danger-500",
  DISCONNECTED: "bg-content-subtle",
  TESTING: "bg-info-500",
};

export function TopBar({
  onOpenNav,
  integrationStatus,
  notifications,
  user,
  businessName,
  planLabel,
  onOpenAccount,
  onToggleCopilot,
  copilotOpen,
}: {
  onOpenNav: () => void;
  integrationStatus: string;
  notifications: NotificationRow[];
  user: { name: string; email: string; avatarUrl?: string | null };
  businessName: string;
  planLabel: string;
  onOpenAccount: () => void;
  onToggleCopilot: () => void;
  copilotOpen: boolean;
}) {
  const pathname = usePathname();
  const [trayOpen, setTrayOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const unread = notifications.filter((row) => !row.read_at).length;
  // Every primary page has a short tour of its own (Phase 8.29); the button
  // only appears on a page that has one.
  const pageTour = sectionTourForPath(pathname);
  const health = INTEGRATION_HEALTH[
    integrationStatus as keyof typeof INTEGRATION_HEALTH
  ] ?? { label: integrationStatus };

  // Cmd/Ctrl+K opens the command palette from anywhere in the app shell.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:px-6"
      style={{ height: "var(--lr-topbar-height)" }}
    >
      <IconButton
        size="sm"
        label="Open navigation"
        className="shrink-0 lg:hidden"
        data-tour="open-nav"
        onClick={onOpenNav}
      >
        <Menu className="size-4" />
      </IconButton>

      {/* Page title only appears on mobile, where the sidebar is hidden;
          desktop relies on each page's own in-body heading. It takes the
          space that is left and truncates: a non-shrinking title pushed the
          account menu off a 320px screen (UI sweep 16). */}
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-content lg:hidden">
        {titleForPath(pathname)}
      </h1>

      <div className="hidden min-w-0 flex-1 lg:flex lg:max-w-[690px]">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-[11px] border border-line-strong bg-surface px-3.5",
            "text-[14px] text-content-subtle shadow-xs transition-colors duration-[var(--lr-duration-fast)]",
            "hover:border-line-strong hover:bg-surface-hover hover:text-content-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lr-ring)]",
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search leads, bookings, campaigns…</span>
          <kbd className="ml-auto hidden shrink-0 items-center rounded-[6px] bg-surface-sunken px-1.5 py-1 text-[11px] font-medium text-content-subtle lg:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2.5">
        <IconButton
          size="sm"
          label="Search"
          className="lg:hidden"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="size-4" />
        </IconButton>

        <Tooltip content={`Integrations: ${health.label}`}>
          <Link
            href="/app/settings?section=connections"
            className={cn(
              "hidden sm:inline-flex items-center gap-2 rounded-full border border-line",
              "h-9 px-3 text-[12px] font-semibold text-content",
              "hover:bg-surface-hover transition-colors duration-[var(--lr-duration-fast)]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                HEALTH_DOT[integrationStatus] ?? HEALTH_DOT.DISCONNECTED,
              )}
            />
            {health.label}
          </Link>
        </Tooltip>

        {pageTour && (
          <Tooltip content={`A short tour of ${pageTour.label}`}>
            <button
              type="button"
              onClick={() => requestSectionTour(pageTour.section)}
              aria-label={`Tour this page: ${pageTour.label}`}
              className={cn(
                // Phones reach the same tour from Help; the header has no
                // room for it below 640px.
                "hidden h-9 items-center gap-1.5 rounded-full border border-line px-3 sm:inline-flex",
                "text-[12px] font-semibold text-content transition-colors duration-[var(--lr-duration-fast)]",
                "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
              )}
            >
              <Compass className="size-4 shrink-0" aria-hidden />
              <span className="hidden xl:inline">Tour this page</span>
            </button>
          </Tooltip>
        )}

        {/* Copilot sits beside the notification bell rather than in a menu:
            it is a destination people reach for constantly, and a shortcut
            buried two clicks deep is one nobody uses. */}
        <button
          type="button"
          onClick={onToggleCopilot}
          data-tour="copilot-button"
          aria-expanded={copilotOpen}
          aria-controls="clientturn-copilot"
          aria-label="Copilot"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-2.5 sm:px-3",
            TOUCH_TARGET,
            "text-[12px] font-semibold transition-colors duration-[var(--lr-duration-fast)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            copilotOpen
              ? "border-accent-500 bg-accent-50 text-content-accent"
              : "border-line text-content hover:bg-surface-hover",
          )}
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Copilot</span>
        </button>

        <div className="relative">
          <IconButton
            size="sm"
            label={
              unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
            }
            onClick={() => setTrayOpen(true)}
          >
            <Bell className="size-4" />
          </IconButton>
          {unread > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-0.5 top-0.5 size-2 rounded-full bg-success-500 ring-2 ring-[var(--lr-surface)]"
            />
          )}
        </div>

        <ProfilePopover
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
          businessName={businessName}
          planLabel={planLabel}
          onOpenAccount={onOpenAccount}
        />
      </div>

      <NotificationTray
        open={trayOpen}
        onClose={() => setTrayOpen(false)}
        notifications={notifications}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
