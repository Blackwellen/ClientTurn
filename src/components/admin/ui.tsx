import * as React from "react";
import Link from "next/link";
import { ArrowRight, Building2, Cog, CreditCard, Puzzle, Webhook } from "lucide-react";
import { brandMarkSrc } from "@/lib/integrations/brand-marks";
import { ADMIN_PROVIDER_ALIAS } from "@/lib/admin/provider-marks";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatNumber, formatUsagePercent } from "@/lib/admin/format";
import {
  CONNECTION_HEALTH_LABEL,
  CONNECTION_HEALTH_TONE,
  ERROR_SEVERITY_LABEL,
  ERROR_SEVERITY_TONE,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  PROVIDER_STATUS_LABEL,
  PROVIDER_STATUS_TONE,
  QUEUE_STATUS_LABEL,
  QUEUE_STATUS_TONE,
  type ErrorSeverity,
  type EventStatus,
  type IntegrationHealth,
  type ProviderStatus,
  type QueueHealthStatus,
  type UsageCell,
} from "@/lib/admin/types";

/**
 * Shared presentation for the Platform Administration area. Every status
 * mapping used by an admin table lives here and nowhere else, so a status can
 * never render two different colours on two different screens.
 */

const TILE_TONES = {
  accent: "bg-accent-50 text-content-accent",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-600",
  info: "bg-info-50 text-info-700",
  neutral: "bg-surface-sunken text-content-muted",
} as const;

export type TileTone = keyof typeof TILE_TONES;

export function IconTile({
  icon: Icon,
  tone = "accent",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[9px]",
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** The card shell every Overview and System panel uses. */
export function Panel({
  icon,
  tone,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-xs",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={icon} tone={tone} />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-content">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn("min-w-0 flex-1", contentClassName)}>{children}</div>
    </section>
  );
}

/** "View all →" link used in every panel header. */
export function PanelLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3",
        "text-[12.5px] font-medium text-content-secondary shadow-xs",
        "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover hover:text-content",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
      )}
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/* --------------------------------------------------------------- badges --- */

export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  return (
    <Badge tone={PROVIDER_STATUS_TONE[status]} dot>
      {PROVIDER_STATUS_LABEL[status]}
    </Badge>
  );
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge tone={EVENT_STATUS_TONE[status]} dot>
      {EVENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: ErrorSeverity }) {
  return (
    <Badge tone={ERROR_SEVERITY_TONE[severity]} dot>
      {ERROR_SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function QueueStatusBadge({ status }: { status: QueueHealthStatus }) {
  return (
    <Badge tone={QUEUE_STATUS_TONE[status]} dot>
      {QUEUE_STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Plan tone ladder: neutral trial, then a rising accent through the paid
 * tiers, so an operator can read the mix of a page at a glance. Any plan the
 * catalogue adds later falls back to neutral rather than mis-colouring.
 */
const PLAN_TONE = {
  trial: "info",
  starter: "neutral",
  growth: "accent",
  pro: "purple",
  enterprise: "success",
} as const;

export function PlanBadge({ plan, label }: { plan: string; label: string }) {
  const tone = PLAN_TONE[plan as keyof typeof PLAN_TONE] ?? "neutral";
  return (
    <Badge tone={tone} className="px-2">
      {label}
    </Badge>
  );
}

export function ConnectionHealthBadge({
  health,
}: {
  health: IntegrationHealth;
}) {
  return (
    <Badge tone={CONNECTION_HEALTH_TONE[health]} dot>
      {CONNECTION_HEALTH_LABEL[health]}
    </Badge>
  );
}

/* ----------------------------------------------------------- provider mark */

/** Platform-internal sources, which have no brand mark to show. */
const INTERNAL_MARK: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  stripe: CreditCard,
  billing: CreditCard,
  job: Cog,
  webhook: Webhook,
};

/**
 * The provider mark used in dense admin tables. Reuses the shared brand-mark
 * assets in `public/brands/` (see `src/lib/integrations/brand-marks.ts`) so
 * there is exactly one place a provider's mark is defined.
 */
export function ProviderMark({ provider }: { provider: string }) {
  const mapped = ADMIN_PROVIDER_ALIAS[provider];
  const src = mapped ? brandMarkSrc(mapped) : null;

  if (src) {
    return (
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-line bg-surface"
      >
        {/* Static, already-optimised SVGs: next/image would add a pipeline
            without shrinking them. The row names the provider in text. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          aria-hidden
          width={13}
          height={13}
          loading="lazy"
          decoding="async"
          className="size-[13px] object-contain"
        />
      </span>
    );
  }

  const Fallback = INTERNAL_MARK[provider] ?? Puzzle;
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-line bg-surface-sunken text-content-muted"
    >
      <Fallback className="size-3" />
    </span>
  );
}

/* ----------------------------------------------------------------- cells --- */


export function BusinessCell({
  name,
  domain,
  className,
}: {
  name: string;
  domain: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-sunken text-content-muted"
      >
        <Building2 className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-content">
          {name}
        </span>
        {domain && (
          <span className="block truncate text-[11.5px] text-content-subtle">
            {domain}
          </span>
        )}
      </span>
    </div>
  );
}

export function InitialAvatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        "bg-accent-50 text-[11px] font-semibold text-content-accent",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * used / limit, the percentage, and a thin bar. An unmetered plan says so
 * rather than drawing a bar against an invented ceiling.
 */
export function UsageCellView({
  usage,
  label,
}: {
  usage: UsageCell;
  label: string;
}) {
  if (usage.limit === null) {
    return (
      <div className="min-w-[104px]">
        <p className="lr-tabular text-[12.5px] text-content">
          {formatNumber(usage.used)}
        </p>
        <p className="text-[11.5px] text-content-subtle">Unlimited</p>
      </div>
    );
  }

  const ratio = usage.ratio ?? 0;
  const tone = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : "success";

  return (
    <div className="min-w-[96px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="lr-tabular text-[12.5px] whitespace-nowrap text-content">
          {formatNumber(usage.used)} / {formatNumber(usage.limit)}
        </span>
        <span className="lr-tabular text-[11.5px] text-content-muted">
          {formatUsagePercent(usage.ratio)}
        </span>
      </div>
      <Progress
        className="mt-1.5 h-1"
        value={usage.used}
        max={usage.limit}
        tone={tone}
        label={`${label}: ${formatNumber(usage.used)} of ${formatNumber(usage.limit)}`}
      />
    </div>
  );
}

/** Consistent "nothing here" body inside a panel. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-[13px] text-content-muted">
      {children}
    </p>
  );
}
