import * as React from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { Panel } from "@/components/affiliates/portal-ui";
import { formatMinor } from "@/lib/affiliates/types";
import type { TierSnapshot } from "@/lib/affiliates/tiers";
import { formatInZone } from "@/lib/dates";

/**
 * The partner's tier and the plan mix of their active referred customers
 * (affiliate audit 17 §3, §5). Anonymised: counts and money by plan, never a
 * customer. Server-rendered from `getTierSnapshot`.
 */
export function TierProgressPanel({
  snapshot,
  currency,
  planPercent,
  negativeNotice,
}: {
  snapshot: TierSnapshot;
  currency: string;
  planPercent: number | null;
  negativeNotice: string | null;
}) {
  const { progress, metrics } = snapshot;
  const current = progress.current;
  const rate = current.commissionPercent !== null && planPercent !== null
    ? Math.max(current.commissionPercent, planPercent)
    : planPercent;

  return (
    <Panel
      icon={Layers}
      title="Tier and referred revenue"
      description="Your tier sets the rate of your one-off commission. It moves up with paid referred customers in the last 12 months."
      action={
        <Link href="/affiliates/terms" className="text-[12.5px] font-medium text-content-accent hover:underline">
          Programme terms
        </Link>
      }
    >
      <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="text-[20px] font-semibold text-content">{current.name}</p>
            {snapshot.locked && <span className="text-[11.5px] text-content-muted">(set by the programme team)</span>}
          </div>
          <p className="text-[12.5px] text-content-muted">
            {rate !== null ? `${rate}% one-off commission` : "Your plan's one-off commission"} on each new referred
            customer&apos;s first payment, including the full amount of an annual plan. Renewals do not earn commission.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="rounded-[9px] bg-surface-sunken/60 px-3 py-2">
              <dt className="text-content-muted">Paid customers (12 months)</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-content">{metrics.activeCustomers}</dd>
            </div>
            <div className="rounded-[9px] bg-surface-sunken/60 px-3 py-2">
              <dt className="text-content-muted">MRR referred</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-content">{formatMinor(metrics.referredMrrMinor, currency)}</dd>
            </div>
          </dl>
          {progress.next ? (
            <div>
              <div
                role="progressbar"
                aria-label={`Progress to ${progress.next.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
                className="h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div className="h-full rounded-full bg-accent-500" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] text-content-muted">
                {progress.next.name}:{" "}
                {progress.customersToGo !== null
                  ? `${progress.customersToGo} more paid referred customer${progress.customersToGo === 1 ? "" : "s"} in the last 12 months`
                  : "no further customers needed"}
                {progress.next.commissionPercent !== null ? ` for ${progress.next.commissionPercent}%` : ""}. Tiers are checked daily; a lower tier only applies at the monthly review.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-content-muted">You are on the top tier.</p>
          )}
          {negativeNotice && (
            <p className="rounded-[9px] bg-warning-50 px-3 py-2 text-[12px] text-warning-700">{negativeNotice}</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-content-subtle">Customers by plan</p>
          {snapshot.sales.length === 0 ? (
            <p className="text-[12.5px] text-content-muted">No paying referred customers yet. They appear here, by plan, once they pay.</p>
          ) : (
            <ul className="divide-y divide-line-subtle rounded-[10px] border border-line-subtle">
              {snapshot.sales.map((row) => (
                <li key={row.planKey} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="font-medium text-content">{row.label}</span>
                  <span className="tabular-nums text-content-secondary">
                    {row.customers} · {formatMinor(row.mrrMinor, currency)}/mo
                  </span>
                </li>
              ))}
            </ul>
          )}
          {snapshot.history.length > 0 && (
            <p className="mt-2 text-[11.5px] text-content-muted">
              Last change: {snapshot.history[0].fromTier ?? "—"} → {snapshot.history[0].toTier} on{" "}
              {formatInZone(snapshot.history[0].createdAt, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
