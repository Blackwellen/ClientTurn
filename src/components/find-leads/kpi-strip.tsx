import * as React from "react";
import {
  BarChart3,
  CheckCircle2,
  Mail,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { FindLeadsKpi } from "@/lib/find-leads/types";

/**
 * The acquisition KPI strip.
 *
 * Capacity and outcomes, never cost. "Searches this month 124 / 500" is the
 * customer's own allowance in the customer's own units; what those searches
 * cost to serve is admin-only (V4 §114). Nothing in this component can render
 * a provider figure, because none is passed to it.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  searches: TrendingUp,
  prospects: CheckCircle2,
  verified: CheckCircle2,
  outreach: Mail,
  converted: BarChart3,
};

const TONE_ICON: Record<FindLeadsKpi["tone"], string> = {
  neutral: "text-content-subtle",
  success: "text-success-600",
  warning: "text-warning-600",
  danger: "text-danger-600",
};

export function FindLeadsKpiStrip({
  kpis,
  className,
}: {
  kpis: FindLeadsKpi[];
  className?: string;
}) {
  if (kpis.length === 0) return null;

  return (
    <div
      className={cn(
        "grid gap-3",
        // Four across on a wide screen, matching the reference; two on a
        // tablet; a single column on a phone, where a four-up strip would
        // shrink the numbers past legibility.
        "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {kpis.slice(0, 4).map((kpi) => {
        const Icon = ICONS[kpi.key] ?? Users;
        return (
          <div
            key={kpi.key}
            className="rounded-xl border border-line bg-surface px-4 py-3 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[22px] font-semibold leading-tight tabular-nums text-content">
                  {kpi.value}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-content-muted">
                  {kpi.label}
                </div>
              </div>
              <Icon className={cn("size-4 shrink-0", TONE_ICON[kpi.tone])} aria-hidden />
            </div>
            {kpi.detail && (
              <div className="mt-1.5 text-[12px] font-medium tabular-nums text-content-secondary">
                {kpi.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
