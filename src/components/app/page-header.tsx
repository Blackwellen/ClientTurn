import * as React from "react";
import { cn } from "@/lib/cn";

/** The primary action always sits top-right. */
export function PageHeader({
  title,
  description,
  action,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[19px] font-semibold leading-tight text-content">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[13px] text-content-muted">{description}</p>
        )}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

const SECTION_ICON_TONES = {
  accent: "bg-accent-50 text-content-accent",
  danger: "bg-danger-50 text-danger-600",
  warning: "bg-warning-50 text-warning-600",
  success: "bg-success-50 text-success-600",
  info: "bg-info-50 text-info-700",
  purple: "bg-purple-50 text-purple-700",
  neutral: "bg-surface-sunken text-content-muted",
} as const;

export function SectionHeader({
  title,
  description,
  action,
  icon: Icon,
  tone = "accent",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Optional icon chip rendered before the title, for stronger section identity. */
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof SECTION_ICON_TONES;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              SECTION_ICON_TONES[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-content">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[13px] text-content-muted">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
