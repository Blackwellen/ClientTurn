"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/cn";
import { isActiveAffiliateRoute, navFor } from "@/lib/affiliates/nav";
import {
  AFFILIATE_STATUS_LABEL,
  AFFILIATE_STATUS_TONE,
  type AffiliateStatus,
} from "@/lib/affiliates/types";

/**
 * The partner portal chrome (V4 §33).
 *
 * Deliberately not the customer app shell. A partner is a platform-level actor
 * with no workspace, and giving them furniture that looks like the product
 * would invite them to expect access they do not have.
 */
export function AffiliateShell({
  status,
  displayName,
  code,
  children,
}: {
  status: AffiliateStatus;
  displayName: string;
  code: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items = navFor(status);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* Logo renders its own anchor, so it must not be wrapped in one. */}
            <Logo href="/affiliates/app" height={24} className="shrink-0" />
            <span className="hidden h-5 w-px bg-line sm:block" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-content">
                {displayName}
              </p>
              <p className="truncate text-[11.5px] text-content-subtle">
                Referral code {code}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge tone={AFFILIATE_STATUS_TONE[status]} dense>
              {AFFILIATE_STATUS_LABEL[status]}
            </Badge>
            {/* Signing out returns to the partner login, not the customer one:
                a partner may have no workspace and no account to sign in to
                there. */}
            <button
              type="button"
              onClick={() => {
                void signOut("/affiliates/login");
              }}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-content-muted underline-offset-4 hover:text-content hover:underline"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </div>
        </div>

        <nav
          aria-label="Partner portal"
          className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6"
        >
          {items.map((item) => {
            const active = isActiveAffiliateRoute(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "border-accent-500 text-content-accent"
                    : "border-transparent text-content-muted hover:border-line-strong hover:text-content",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11.5px] text-content-subtle sm:px-6">
          <p>
            Commission is confirmed after the refund hold period and paid in the
            next payout run.
          </p>
          <Link href="/affiliates/app/profile" className="underline-offset-4 hover:underline">
            Programme terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
