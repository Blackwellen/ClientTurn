"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/cn";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { isActiveAffiliateRoute, navFor } from "@/lib/affiliates/nav";
import {
  AFFILIATE_STATUS_LABEL,
  AFFILIATE_STATUS_TONE,
  type AffiliateStatus,
} from "@/lib/affiliates/types";

/**
 * The partner portal chrome.
 *
 * It wears the public site's chrome — the same header, the same footer, the
 * same dark `.ct-marketing` palette — because a partner arrives here from
 * clientturn.com and a portal that suddenly turns light with a different top
 * bar reads as a different product rather than a signed-in area of this one.
 *
 * What it deliberately does NOT wear is the customer app shell. A partner is
 * a platform-level actor with no workspace, so the product's own navigation
 * would offer them destinations they have no access to. The partner's own nav
 * sits under the header instead, which keeps the two roles distinct without
 * making the portal look like somewhere else entirely.
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
    // `ct-marketing` carries the dark token set the rest of the public site
    // uses. Without it these surfaces resolve to the light app palette.
    <div className="ct-marketing flex min-h-dvh w-full flex-col">
      <a
        href="#partner-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <MarketingHeader />

      {/* Who you are, and what your account is allowed to do. Sits between the
          site header and the portal nav because it is context for the nav
          rather than part of the site's own chrome. */}
      <div className="border-b border-line bg-surface/40">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="truncate text-[13px] font-medium text-content">
              {displayName}
            </p>
            <span className="hidden h-4 w-px bg-line sm:block" />
            <p className="truncate text-[11.5px] text-content-subtle">
              Referral code {code}
            </p>
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
      </div>

      <nav
        aria-label="Partner portal"
        className="border-b border-line"
      >
        <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
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
        </div>
      </nav>

      <main
        id="partner-main"
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6"
      >
        {children}
      </main>

      {/* The payout note lives above the site footer rather than replacing it,
          so a partner still gets the legal and contact links everyone else
          has. */}
      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11.5px] text-content-subtle sm:px-6">
          <p>
            Commission is confirmed after the refund hold period and paid in the
            next payout run.
          </p>
          <Link
            href="/affiliates/app/profile"
            className="underline-offset-4 hover:underline"
          >
            Programme terms
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
