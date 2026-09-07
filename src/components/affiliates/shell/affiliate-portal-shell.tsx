"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import {
  Overlay,
  useBodyScrollLock,
  useEscape,
  useFocusTrap,
} from "@/components/ui/drawer";
import { SkipLink, MainRegion } from "@/components/ui/skip-link";
import { AffiliateSidebarContent } from "./affiliate-sidebar";
import { AffiliateTopBar } from "./affiliate-top-bar";
import type { SearchEntry } from "./affiliate-search";
import type { AffiliateNotification } from "@/lib/affiliates/notifications";
import type {
  AffiliateAccountState,
  ConnectState,
  PayoutReadiness,
} from "@/lib/affiliates/programme";

const COLLAPSE_KEY = "ct-affiliate-sidebar-collapsed";
const COLLAPSE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function persistCollapsed(next: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable; the preference simply will not survive a reload.
  }
  try {
    document.cookie = `${COLLAPSE_KEY}=${next ? "1" : "0"}; path=/; max-age=${COLLAPSE_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // Cookies unavailable; the server falls back to the expanded default.
  }
}

/**
 * The partner portal shell (V4 §33).
 *
 * Structurally the same as the customer `AppShell` — fixed rail, sticky top
 * bar, mobile drawer — deliberately, so the two products feel like one family
 * and so the responsive behaviour is already proven. What it does not share is
 * any of the customer chrome: no workspace card, no plan prompt, no support
 * bubble wired to a workspace, and no route in the rail that leads to `/app`.
 */
export function AffiliatePortalShell({
  initialCollapsed = false,
  status,
  connectState,
  payoutReadiness,
  reference,
  user,
  notifications,
  searchIndex,
  children,
}: {
  initialCollapsed?: boolean;
  status: AffiliateAccountState;
  connectState: ConnectState;
  payoutReadiness: PayoutReadiness;
  reference: string;
  user: { name: string; email: string };
  notifications: AffiliateNotification[];
  searchIndex: SearchEntry[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the mobile nav on navigation is a deliberate response to the route changing.
    setMobileOpen(false);
  }, [pathname]);

  // The panel declares `aria-modal`, so Tab must not be able to leave it —
  // without the trap the ARIA promised a modality the drawer did not have.
  const mobileNavRef = React.useRef<HTMLDivElement | null>(null);

  useBodyScrollLock(mobileOpen);
  useEscape(mobileOpen, () => setMobileOpen(false));
  useFocusTrap(mobileNavRef, mobileOpen);

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }, []);

  const width = collapsed
    ? "var(--lr-sidebar-collapsed)"
    : "var(--lr-sidebar-width)";

  // Mirrored onto the root so content-anchored drawers — which portal to the
  // body and therefore sit outside this subtree — still resolve the offset.
  React.useEffect(() => {
    document.documentElement.style.setProperty("--lr-shell-pad", width);
  }, [width]);

  const openProfile = React.useCallback(() => {
    router.push("/affiliates/app/settings?section=account");
  }, [router]);

  return (
    <div className="min-h-screen bg-bg">
      <SkipLink />
      <aside
        aria-label="Affiliate portal sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--ct-shell-sidebar-border)] lg:block",
          "transition-[width] duration-[var(--lr-duration-base)] ease-[var(--lr-ease)] motion-reduce:transition-none",
        )}
        style={{ width }}
      >
        <AffiliateSidebarContent
          collapsed={collapsed}
          status={status}
          onToggleCollapse={toggleCollapse}
          onOpenProfile={openProfile}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <Overlay onClick={() => setMobileOpen(false)} />
          <div
            ref={mobileNavRef}
            role="dialog"
            aria-modal="true"
            aria-label="Affiliate navigation"
            className="absolute inset-y-0 left-0 border-r border-[var(--ct-shell-sidebar-border)] animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]"
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
            <AffiliateSidebarContent
              collapsed={false}
              status={status}
              onNavigate={() => setMobileOpen(false)}
              onOpenProfile={openProfile}
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
        <AffiliateTopBar
          onOpenNav={() => setMobileOpen(true)}
          status={status}
          connectState={connectState}
          payoutReadiness={payoutReadiness}
          notifications={notifications}
          user={user}
          reference={reference}
          searchIndex={searchIndex}
        />
        <MainRegion className="w-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8">
          {children}
        </MainRegion>
      </div>
    </div>
  );
}
