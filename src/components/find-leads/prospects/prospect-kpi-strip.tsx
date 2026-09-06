import * as React from "react";
import { BarChart3, Mail, Send, Target, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProspectKpi } from "@/lib/prospects/queries";

/**
 * The five counters above the Prospects inbox (V4 §12.2).
 *
 * Outcomes and capacity, never cost — the same rule the Discover strip follows.
 * A trend is rendered only when the loader supplied one: "Ready for outreach"
 * is a state with no entry timestamp, so it has no honest previous-period
 * figure and shows nothing rather than a fabricated percentage.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  found: Users,
  verified: Mail,
  ready: Target,
  campaigns: Send,
  converted: BarChart3,
};

export function ProspectKpiStrip({
  kpis,
  className,
}: {
  kpis: ProspectKpi[];
  className?: string;
}) {
  if (kpis.length === 0) return null;

  return (
    <div
      className={cn(
        // Five across on a wide screen as the reference shows; two on a tablet;
        // one on a phone, where five columns would shrink the numbers past
        // legibility.
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5",
        className,
      )}
    >
      {kpis.map((kpi) => {
        const Icon = ICONS[kpi.key] ?? Users;
        return (
          <div
            key={kpi.key}
            className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
                aria-hidden
              >
                <Icon className="size-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-content-secondary">
                  {kpi.label}
                </p>
                <p className="mt-0.5 text-[24px] font-semibold leading-tight tabular-nums text-content">
                  {kpi.value.toLocaleString("en-GB")}
                </p>
              </div>
            </div>

            {kpi.trend !== null && (
              <p
                className={cn(
                  "mt-2 flex items-center gap-1 text-[11.5px]",
                  kpi.trend >= 0 ? "text-success-700" : "text-danger-600",
                )}
              >
                <TrendingUp
                  className={cn("size-3.5 shrink-0", kpi.trend < 0 && "rotate-180")}
                  aria-hidden
                />
                <span className="font-semibold tabular-nums">
                  {kpi.trend >= 0 ? "+" : ""}
                  {Math.round(kpi.trend * 100)}%
                </span>
                <span className="text-content-muted">vs. previous 30 days</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
