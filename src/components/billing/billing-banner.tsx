import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BillingNotice } from "@/lib/billing/limits-service";
import { UpgradeNowButton } from "./upgrade-now-button";

const TONE = {
  info: { box: "border-info-100 bg-info-50", title: "text-info-700", icon: Info, iconClass: "text-info-600" },
  warning: {
    box: "border-warning-100 bg-warning-50",
    title: "text-warning-700",
    icon: AlertTriangle,
    iconClass: "text-warning-600",
  },
  danger: {
    box: "border-danger-100 bg-danger-50",
    title: "text-danger-700",
    icon: AlertCircle,
    iconClass: "text-danger-600",
  },
} as const;

/**
 * The single billing banner above every app page: failed payment, read-only,
 * trial about to convert, or a messaging limit at 80% / 100%. Only the owner
 * can act on billing, so everyone else sees the state without the button.
 */
export function BillingBanner({
  notice,
  canManageBilling,
  className,
}: {
  notice: BillingNotice;
  canManageBilling: boolean;
  /** Replaces the page margins when the banner sits in the notice stack. */
  className?: string;
}) {
  const tone = TONE[notice.tone];
  const Icon = tone.icon;
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3", className ?? "mx-4 mt-3 sm:mx-6", tone.box)}
    >
      {/* Text and actions stack below sm: side by side at 390px the
          full-width "Upgrade now" button squeezed the text into a one-word
          column (surface QA 2026-09-30). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[13px] font-semibold", tone.title)}>{notice.title}</p>
            <p className="mt-0.5 text-[13px] text-content-secondary">
              {notice.body}
              {!canManageBilling && notice.action ? " The workspace owner can resolve this in Billing." : ""}
            </p>
          </div>
        </div>
        {canManageBilling && (notice.upgradeNow || notice.action) ? (
          <div className="flex flex-wrap items-center gap-2 pl-7 sm:shrink-0 sm:pl-0">
            {notice.upgradeNow ? (
              // A trial notice: end the trial today on the card already on file
              // (billing.end_trial_now), with a confirmation that states the charge.
              <UpgradeNowButton label="Upgrade now: start your plan today" className="shrink-0" />
            ) : null}
            {notice.action ? (
              // A plain link: "Update card" is a route handler that redirects to
              // Stripe, which client-side navigation cannot follow.
              <a
                href={notice.action.href}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-content hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
              >
                {notice.action.label}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
