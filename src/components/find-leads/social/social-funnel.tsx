import * as React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { SocialFunnel } from "@/lib/outreach/social-funnel";

/**
 * Found → Contacted → Replied → Interested, with the drop between each.
 *
 * The conversion figure is the point. Four totals side by side let somebody
 * read "354 found" as good news; the same four with "0% contacted" between the
 * first two say what is actually happening, which is that nobody is working the
 * queue.
 *
 * A rate with a zero denominator renders as "—", never as 0%. They mean
 * different things: 0% is a measured failure, and "—" is the honest answer to a
 * question that cannot be asked yet.
 */
export function SocialFunnelPanel({
  funnel,
  days,
  className,
}: {
  funnel: SocialFunnel;
  days: 7 | 30;
  className?: string;
}) {
  const peak = Math.max(
    1,
    ...funnel.series.flatMap((point) => [
      point.leadsFound,
      point.invitesSent,
      point.messagesSent,
    ]),
  );

  return (
    <section className={cn("rounded-xl border border-line bg-surface p-5 shadow-xs", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-content">Performance</h3>
        <p className="text-[11.5px] text-content-muted">
          From leads found to interested replies · last {days} days
        </p>
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {funnel.stages.map((stage, index) => (
          <li key={stage.key} className="min-w-0 rounded-lg border border-line bg-surface-subtle p-3.5">
            <Tooltip content={stage.hint}>
              <p className="text-[11.5px] font-medium text-content-muted">{stage.label}</p>
            </Tooltip>
            <p className="mt-1 text-[24px] font-semibold leading-none tabular-nums text-content">
              {stage.value.toLocaleString("en-GB")}
            </p>
            {index > 0 && (
              <p
                className={cn(
                  "mt-1.5 text-[11.5px] tabular-nums",
                  stage.rate === null
                    ? "text-content-subtle"
                    : stage.rate === 0
                      ? "text-warning-700"
                      : "text-content-muted",
                )}
              >
                {stage.rate === null
                  ? "— of previous step"
                  : `${Math.round(stage.rate * 100)}% of ${funnel.stages[index - 1].label.toLowerCase()}`}
              </p>
            )}
          </li>
        ))}
      </ol>

      <Chart series={funnel.series} peak={peak} />
    </section>
  );
}

/**
 * A bar per day, split by action.
 *
 * Deliberately not a line chart. The series is counts of discrete actions on
 * discrete days, and a smoothed line between them implies values at times where
 * nothing happened -- it draws a curve through Saturday when nothing was sent
 * on Saturday.
 */
function Chart({ series, peak }: { series: SocialFunnel["series"]; peak: number }) {
  const legend = [
    { key: "leadsFound" as const, label: "Leads found", className: "bg-info-500" },
    { key: "invitesSent" as const, label: "Invitations", className: "bg-accent-500" },
    { key: "messagesSent" as const, label: "Messages", className: "bg-success-600" },
  ];

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-3">
        {legend.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5 text-[11.5px] text-content-muted">
            <span aria-hidden className={cn("size-2 rounded-full", entry.className)} />
            {entry.label}
          </span>
        ))}
      </div>

      <div className="mt-3 flex h-32 items-end gap-1" role="img" aria-label="Daily activity">
        {series.map((point) => (
          <div key={point.date} className="flex min-w-0 flex-1 flex-col justify-end gap-px">
            {legend.map((entry) => {
              const value = point[entry.key];
              if (value === 0) return null;
              return (
                <Tooltip
                  key={entry.key}
                  content={`${point.date}: ${value} ${entry.label.toLowerCase()}`}
                >
                  <span
                    className={cn("block w-full rounded-sm", entry.className)}
                    style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
                  />
                </Tooltip>
              );
            })}
            {/* A day with nothing on it still occupies its column, so the axis
                stays evenly spaced and a quiet day reads as quiet rather than
                as absent. */}
            <span className="block h-px w-full bg-line" />
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10.5px] text-content-subtle">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}
