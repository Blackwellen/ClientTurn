import * as React from "react";

/**
 * Thirty days of clicks as bars.
 *
 * Hand-drawn with divs rather than a charting library: it is one series of 30
 * integers, and pulling a chart dependency into the partner portal for this
 * would cost more than the feature is worth.
 */
export function ClickSparkline({
  series,
}: {
  series: { date: string; count: number }[];
}) {
  const peak = Math.max(1, ...series.map((point) => point.count));
  const total = series.reduce((sum, point) => sum + point.count, 0);

  if (total === 0 || series.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-content-muted">
        No clicks in the last 30 days.
      </p>
    );
  }

  return (
    <div>
      <div
        className="flex h-24 items-end gap-[3px]"
        role="img"
        aria-label={`${total} clicks over the last 30 days`}
      >
        {series.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${point.count}`}
            className="min-w-0 flex-1 rounded-sm bg-accent-200"
            style={{
              // A day with clicks never renders as nothing: a 0px bar and a
              // one-click bar would otherwise be indistinguishable.
              height: `${point.count === 0 ? 2 : Math.max(6, (point.count / peak) * 96)}px`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-content-subtle">
        <span>
          {new Date(series[0].date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </span>
        <span>{total.toLocaleString("en-GB")} clicks</span>
        <span>Today</span>
      </div>
    </div>
  );
}
