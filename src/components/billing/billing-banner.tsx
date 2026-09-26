import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BillingNotice } from "@/lib/billing/limits-service";

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
}: {
  notice: BillingNotice;
  canManageBilling: boolean;
}) {
  const tone = TONE[notice.tone];
  const Icon = tone.icon;
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      className={cn("mx-4 mt-3 rounded-lg border px-4 py-3 sm:mx-6", tone.box)}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-semibold", tone.title)}>{notice.title}</p>
          <p className="mt-0.5 text-[13px] text-content-secondary">
            {notice.body}
            {!canManageBilling && notice.action ? " The workspace owner can resolve this in Billing." : ""}
          </p>
        </div>
        {canManageBilling && notice.action ? (
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
    </div>
  );
}
