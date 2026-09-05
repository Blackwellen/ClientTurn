"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Overlay, useBodyScrollLock, useEscape } from "@/components/ui/drawer";
import { AdminSidebarContent } from "./admin-sidebar";
import { AdminTopBar } from "./admin-top-bar";

const COLLAPSE_KEY = "ct-admin-sidebar-collapsed";
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

export function AdminShell({
  initialCollapsed = false,
  operator,
  children,
}: {
  initialCollapsed?: boolean;
  operator: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);

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

  const width = collapsed
    ? "var(--lr-sidebar-collapsed)"
    : "var(--lr-sidebar-width)";

  return (
    <div className="min-h-screen bg-bg">
      <aside
        aria-label="Admin sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--ct-shell-sidebar-border)] lg:block",
          "transition-[width] duration-[var(--lr-duration-base)] ease-[var(--lr-ease)] motion-reduce:transition-none",
        )}
        style={{ width }}
      >
        <AdminSidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <Overlay onClick={() => setMobileOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
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
            <AdminSidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
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
        <AdminTopBar onOpenNav={() => setMobileOpen(true)} operator={operator} />
        <main className="w-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
