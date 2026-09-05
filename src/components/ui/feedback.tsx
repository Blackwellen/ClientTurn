import * as React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-sunken",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:bg-gradient-to-r after:from-transparent after:via-black/[0.04] after:to-transparent",
        "after:animate-[lr-shimmer_1.6s_infinite]",
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-px">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <Skeleton className="h-3.5 flex-1 max-w-[180px]" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3.5 w-16 ml-auto" />
        </div>
      ))}
    </div>
  );
}

/** Empty states always offer the next action — never a dead end. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14",
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-surface-sunken border border-line">
          <Icon className="size-5 text-content-muted" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-content">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] text-content-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14",
        className,
      )}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-danger-50 border border-danger-100">
        <AlertCircle className="size-5 text-danger-600" />
      </div>
      <h3 className="text-[15px] font-semibold text-content">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-[13px] text-content-muted">
          {description}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Shown when a plan limit blocks the action, with the upgrade path visible. */
export function PlanLimitState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-4 text-warning-600 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-warning-700">{title}</p>
          <p className="mt-0.5 text-[13px] text-content-secondary">
            {description}
          </p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
