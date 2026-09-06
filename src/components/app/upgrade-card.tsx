"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Crown, LifeBuoy, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { PLANS, nextPlanFor, type UpgradeTarget } from "@/lib/billing/plans";

/**
 * The card at the foot of the sidebar.
 *
 * It is an upsell everywhere except the top of the ladder: it names the tier
 * directly above the workspace's own, so the promise is one billing can keep
 * and a repricing cannot leave a stale claim in the rail. On Enterprise there
 * is nothing left to sell, so the same slot becomes the route to the dedicated
 * support contact that plan actually includes.
 *
 * Hidden entirely for a member who cannot open Billing, since sending someone
 * to a page they are refused is a dead end.
 */

type Pitch = {
  title: string;
  body: string;
  cta: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** The support contact for a workspace with no tier left to buy. */
const ACCOUNT_MANAGER: Pitch = {
  title: "Your account manager",
  // Echoes the Enterprise plan's own feature list rather than promising more.
  body: "Dedicated support contact, onboarding help and custom limits.",
  cta: "Get in touch",
  href: "/app/help",
  icon: LifeBuoy,
};

/**
 * The three lines of copy, derived from the target plan rather than written
 * per tier, so a repricing or a rename cannot leave stale claims in the rail.
 */
function pitchFor(target: UpgradeTarget): Pitch {
  const definition = PLANS[target];

  if (target === "enterprise") {
    return {
      title: "Scale beyond Pro",
      body: "Higher volumes, custom terms and a named contact.",
      cta: "Talk to sales",
      href: "/contact-sales",
      icon: Crown,
    };
  }

  return {
    title: `Upgrade to ${definition.name}`,
    body: `${definition.leadLimit.toLocaleString("en-GB")} leads a month, more allowance and advanced features.`,
    cta: "View plans",
    href: "/app/settings?section=billing",
    icon: Crown,
  };
}

export function UpgradeCard({
  plan,
  canManageBilling,
  collapsed,
  onNavigate,
}: {
  /** The workspace's current plan key, from entitlements. */
  plan: string;
  /** Billing is owner-only, so a member is never sent to a page they cannot open. */
  canManageBilling: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  if (!canManageBilling) return null;

  const target = nextPlanFor(plan);
  const pitch = target ? pitchFor(target) : ACCOUNT_MANAGER;
  const Icon = pitch.icon;

  if (collapsed) {
    return (
      <div className="mb-2 flex justify-center">
        <Tooltip content={pitch.title} placement="right">
          <Link
            href={pitch.href}
            onClick={onNavigate}
            aria-label={pitch.title}
            className={cn(
              "flex size-12 items-center justify-center rounded-[10px]",
              "bg-[var(--ct-shell-active-bg)] text-[var(--ct-lime)]",
              "transition-colors duration-150 hover:bg-[rgba(183,243,74,0.18)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
            )}
          >
            <Icon className="size-5 shrink-0" />
          </Link>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-3 rounded-[12px] p-3",
        "border border-[var(--ct-shell-divider)] bg-[var(--ct-shell-card-bg)]",
      )}
    >
      {/* Icon and title share a row. Stacking them cost a whole line of
          height in a rail that is already the tightest column on the page,
          and separating the mark from the words it belongs to read as two
          unrelated things rather than one heading. */}
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(183,243,74,0.14)]"
        >
          <Icon className="size-4 text-[var(--ct-lime)]" />
        </span>
        <p className="text-[13.5px] font-semibold leading-tight text-white">
          {pitch.title}
        </p>
      </div>

      <p className="mt-2 text-[12px] leading-[1.45] text-[var(--ct-shell-text-muted)]">
        {pitch.body}
      </p>

      <Link
        href={pitch.href}
        onClick={onNavigate}
        className={cn(
          "mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px]",
          "bg-[var(--ct-lime)] text-[12.5px] font-semibold text-[#0B1020]",
          "transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]",
        )}
      >
        {target ? (
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        )}
        {pitch.cta}
      </Link>
    </div>
  );
}
