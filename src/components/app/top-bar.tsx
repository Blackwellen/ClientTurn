"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { INTEGRATION_HEALTH } from "@/components/ui/badge";
import { titleForPath } from "@/lib/app/nav";
import { CommandPalette } from "./command-palette";
import {
  NotificationTray,
  type NotificationRow,
} from "./notification-tray";
import { ProfileMenu } from "./profile-menu";

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
}: {
  onOpenNav: () => void;
  integrationStatus: string;
  notifications: NotificationRow[];
  user: { name: string; email: string; avatarUrl?: string | null };
}) {
  const pathname = usePathname();
  const [trayOpen, setTrayOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const unread = notifications.filter((row) => !row.read_at).length;
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
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:px-6"
      style={{ height: "var(--lr-topbar-height)" }}
    >
      <IconButton
        size="sm"
        label="Open navigation"
        className="lg:hidden"
        onClick={onOpenNav}
      >
        <Menu className="size-4" />
      </IconButton>

      {/* Page title only appears on mobile, where the sidebar is hidden;
          desktop relies on each page's own in-body heading. */}
      <h1 className="min-w-0 shrink-0 truncate text-[15px] font-semibold text-content lg:hidden">
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
          <kbd className="ml-auto hidden shrink-0 items-center rounded-[5px] border border-line px-1.5 py-0.5 text-[11px] font-medium text-content-subtle lg:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
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
            href="/app/settings/connections"
            className={cn(
              "hidden sm:inline-flex items-center gap-2 rounded-full border border-line",
              "h-9 px-3 text-[12px] font-medium text-content-secondary",
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
              className="lr-tabular pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </div>

        <ProfileMenu
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
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
