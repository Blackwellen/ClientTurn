import * as React from "react";
import { AlertCircle, Lock, PlugZap, RefreshCw } from "lucide-react";
import { friendlyErrorMessage } from "@/lib/errors/friendly";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // max-w-full: a fixed-width bar (w-80) must never widen a 320px page.
        "relative max-w-full overflow-hidden rounded-md bg-surface-sunken",
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

/**
 * A page or panel that failed to load. Calm on purpose: a warning-toned icon,
 * a plain sentence, a retry, and a reference for support. Never render the
 * raw error here; pass it through `friendlyErrorMessage` or write the copy.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  reference,
  secondaryAction,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** Shown as "Reference ABC123" so a support ticket can find the log line. */
  reference?: string | null;
  /** A second way out, such as a link back to the section. */
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14",
        className,
      )}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-warning-50 border border-warning-100">
        <AlertCircle className="size-5 text-warning-600" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold text-content">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-[13px] text-content-muted">
          {description}
        </p>
      )}
      {(onRetry || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden />
              Try again
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
      {reference && (
        <p className="mt-4 text-[11.5px] text-content-subtle">
          Reference <span className="font-mono select-all">{reference}</span>
        </p>
      )}
    </div>
  );
}

/**
 * An action that did not work, shown inline beside the form or button that
 * triggered it. The message goes through `friendlyErrorMessage`, so a stray
 * database or network string becomes a plain sentence while hand-written
 * action errors pass through unchanged. Amber, not red: the customer can
 * usually just try again. Field-level validation stays on `FormField`.
 */
export function FormError({
  message,
  fallback,
  onRetry,
  className,
}: {
  message: unknown;
  fallback?: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (message === null || message === undefined || message === "" || message === false) return null;
  const text = friendlyErrorMessage(message, fallback);
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-content-secondary",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning-600" aria-hidden />
      <p className="min-w-0 flex-1 break-words">{text}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** The page needs a connection that is not set up yet. */
export function IntegrationRequiredState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface-sunken px-4 py-3.5", className)}>
      <div className="flex items-start gap-3">
        <PlugZap className="size-4 text-content-muted mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-content">{title}</p>
          <p className="mt-0.5 text-[13px] text-content-secondary">{description}</p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** The signed-in member's role cannot see or change this. */
export function PermissionDeniedState({
  title = "You do not have access to this",
  description,
  action,
  className,
}: {
  title?: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Lock}
      title={title}
      description={description}
      action={action}
      className={className}
    />
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
