"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Overlay, useBodyScrollLock, useEscape } from "@/components/ui/drawer";
import { SidebarContent } from "./sidebar";
import { PRIMARY_NAV } from "@/lib/app/nav";
import { TopBar } from "./top-bar";
import { SupportBubble } from "@/components/support/support-bubble";
import { AccountPreferencesDialog } from "./account-preferences-dialog";
import type { NotificationRow } from "./notification-tray";

const COLLAPSE_KEY = "lr-sidebar-collapsed";
const COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function persistCollapsed(next: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable; preference will not persist across reloads.
  }
  try {
    document.cookie = `${COLLAPSE_KEY}=${next ? "1" : "0"}; path=/; max-age=${COLLAPSE_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // Cookies unavailable; the server will fall back to the default state.
  }
}

export function AppShell({
  initialCollapsed = false,
  businessName,
  planLabel,
  primaryNav: primaryNavPaths,
  integrationStatus,
  notifications,
  user,
  children,
}: {
  initialCollapsed?: boolean;
  businessName: string;
  planLabel: string;
  primaryNav: string[];
  integrationStatus: string;
  notifications: NotificationRow[];
  user: { name: string; email: string; avatarUrl?: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const primaryNav = PRIMARY_NAV.filter(item => primaryNavPaths.includes(item.href));
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [accountOpen, setAccountOpen] = React.useState(false);
  const openAccount = React.useCallback(() => setAccountOpen(true), []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the mobile nav on navigation is a deliberate response to the route changing.
    setMobileOpen(false);
  }, [pathname]);

  useBodyScrollLock(mobileOpen);
  useEscape(mobileOpen, () => setMobileOpen(false));

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }, []);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
        e.preventDefault();
        toggleCollapse();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapse]);

  const width = collapsed
    ? "var(--lr-sidebar-collapsed)"
    : "var(--lr-sidebar-width)";

  return (
    <div className="min-h-screen bg-bg">
      <aside
        aria-label="Sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--ct-shell-sidebar-border)] lg:block",
          "transition-[width] duration-[var(--lr-duration-base)] ease-[var(--lr-ease)] motion-reduce:transition-none",
        )}
        style={{ width }}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          businessName={businessName}
          planLabel={planLabel}
          primaryNav={primaryNav}
          onOpenAccount={openAccount}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <Overlay onClick={() => setMobileOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className={cn(
              "absolute inset-y-0 left-0 border-r border-[var(--ct-shell-sidebar-border)]",
              "animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]",
            )}
            style={{ width: "min(86vw, 320px)" }}
          >
            <div className="absolute right-2 top-3 z-10">
              <IconButton
                size="sm"
                label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="text-[var(--ct-shell-text-muted)] hover:bg-[var(--ct-shell-hover)] hover:text-white"
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <SidebarContent
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              businessName={businessName}
              planLabel={planLabel}
              primaryNav={primaryNav}
              onOpenAccount={openAccount}
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "lg:pl-[var(--lr-shell-pad)]",
          "transition-[padding-left] duration-[var(--lr-duration-base)] ease-[var(--lr-ease)] motion-reduce:transition-none",
        )}
        style={{ "--lr-shell-pad": width } as React.CSSProperties}
      >
        <TopBar
          onOpenNav={() => setMobileOpen(true)}
          integrationStatus={integrationStatus}
          notifications={notifications}
          user={user}
          businessName={businessName}
          planLabel={planLabel}
          onOpenAccount={openAccount}
        />
        <main className="w-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8">
          {children}
        </main>
      </div>

      {/* Mounted only while open so it always loads current values. */}
      <SupportBubble />
      {accountOpen && (
        <AccountPreferencesDialog open onClose={() => setAccountOpen(false)} />
      )}
    </div>
  );
}
