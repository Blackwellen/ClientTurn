"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { AffiliateProfilePopover } from "./affiliate-profile-popover";
import { AffiliateNotificationTray } from "./affiliate-notification-tray";
import { AffiliateSearch } from "./affiliate-search";
import { titleForAffiliatePath } from "@/lib/affiliates/nav";
import {
  ACCOUNT_STATE_LABEL,
  CONNECT_STATE_LABEL,
  type AffiliateAccountState,
  type ConnectState,
  type PayoutReadiness,
} from "@/lib/affiliates/programme";
import type { AffiliateNotification } from "@/lib/affiliates/notifications";

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-success-500",
  APPLIED: "bg-warning-500",
  PENDING_REVIEW: "bg-warning-500",
  APPROVED: "bg-info-500",
  SUSPENDED: "bg-danger-500",
  REJECTED: "bg-content-subtle",
  CLOSED: "bg-content-subtle",
};

/**
 * The portal top bar (V4 §33).
 *
 * Carries a global search over the partner's own links, referrals and
 * resources, an account status chip, notifications and the profile menu.
 *
 * Deliberately no workspace selector. A partner has no workspace, and offering
 * a control that implies otherwise would be a promise the portal cannot keep.
 *
 * The status chip shows the *account* state, with the Stripe connection state
 * shown instead when payouts are not yet set up — that is the thing a partner
 * in that position needs to act on, and it is what the reference design shows
 * as "Not connected".
 */
export function AffiliateTopBar({
  onOpenNav,
  status,
  connectState,
  payoutReadiness,
  notifications,
  user,
  reference,
  searchIndex,
}: {
  onOpenNav: () => void;
  status: AffiliateAccountState;
  connectState: ConnectState;
  payoutReadiness: PayoutReadiness;
  notifications: AffiliateNotification[];
  user: { name: string; email: string };
  reference: string;
  searchIndex: { label: string; caption: string; href: string; group: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [trayOpen, setTrayOpen] = React.useState(false);
  const unread = notifications.filter((row) => !row.readAt).length;

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // An unconnected partner is shown what to fix; everyone else sees their
  // account state.
  const showConnect = connectState === "NOT_CONNECTED" && status === "ACTIVE";
  const chipLabel = showConnect
    ? CONNECT_STATE_LABEL[connectState]
    : `Affiliate account ${ACCOUNT_STATE_LABEL[status].toLowerCase()}`;
  const chipDot = showConnect ? "bg-content-subtle" : (STATUS_DOT[status] ?? "bg-content-subtle");

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

      <h1 className="min-w-0 shrink-0 truncate text-[15px] font-semibold text-content lg:hidden">
        {titleForAffiliatePath(pathname)}
      </h1>

      <div className="hidden min-w-0 flex-1 lg:flex lg:max-w-[690px]">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-[11px] border border-line-strong bg-surface px-3.5",
            "text-[14px] text-content-subtle shadow-xs transition-colors duration-[var(--lr-duration-fast)]",
            "hover:bg-surface-hover hover:text-content-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lr-ring)]",
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Search links, referrals, resources…</span>
          <kbd className="ml-auto hidden shrink-0 items-center rounded-[6px] bg-surface-sunken px-1.5 py-1 text-[11px] font-medium text-content-subtle lg:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
        <IconButton
          size="sm"
          label="Search"
          className="lg:hidden"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-4" />
        </IconButton>

        <button
          type="button"
          onClick={() =>
            router.push(
              showConnect
                ? "/affiliates/app/settings?section=payments"
                : "/affiliates/app/settings?section=account",
            )
          }
          className={cn(
            "hidden items-center gap-2 rounded-full border border-line px-3 sm:inline-flex",
            "h-9 text-[12px] font-semibold text-content",
            "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
          )}
        >
          <span className={cn("size-2 shrink-0 rounded-full", chipDot)} aria-hidden />
          {chipLabel}
        </button>

        <div className="relative">
          <IconButton
            size="sm"
            label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            aria-expanded={trayOpen}
            onClick={() => setTrayOpen((open) => !open)}
          >
            <Bell className="size-4" />
            {unread > 0 && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-2 rounded-full bg-success-500 ring-2 ring-surface"
              />
            )}
          </IconButton>
          {trayOpen && (
            <AffiliateNotificationTray
              notifications={notifications}
              onClose={() => setTrayOpen(false)}
            />
          )}
        </div>

        <AffiliateProfilePopover
          name={user.name}
          email={user.email}
          reference={reference}
          status={status}
          payoutReadiness={payoutReadiness}
        />
      </div>

      <AffiliateSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        entries={searchIndex}
      />
    </header>
  );
}
