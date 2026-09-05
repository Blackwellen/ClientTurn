import * as React from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { HealthIssue } from "@/lib/app/health";

/**
 * Only genuinely actionable problems reach this banner. If there is nothing to
 * fix it renders nothing at all.
 */
export function HealthBanner({ issues }: { issues: HealthIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const error = issue.severity === "error";
        const Icon = error ? AlertCircle : AlertTriangle;
        return (
          <div
            key={issue.id}
            role={error ? "alert" : "status"}
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
              error
                ? "border-danger-100 bg-danger-50"
                : "border-warning-100 bg-warning-50",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                error ? "text-danger-600" : "text-warning-600",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[13px] font-semibold",
                  error ? "text-danger-700" : "text-warning-700",
                )}
              >
                {issue.title}
              </p>
              <p className="mt-0.5 text-[13px] text-content-secondary">
                {issue.description}
              </p>
            </div>
            <Link
              href={issue.actionHref}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-[13px] font-medium",
                "bg-surface hover:bg-surface-hover transition-colors duration-[var(--lr-duration-fast)]",
                error ? "border-danger-100 text-danger-700" : "border-warning-100 text-warning-700",
              )}
            >
              {issue.actionLabel}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
