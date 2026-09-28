import "server-only";
import * as React from "react";
import { Route } from "lucide-react";
import { Skeleton } from "@/components/ui/feedback";
import { getLeadJourney } from "@/lib/analytics/revenue-journey-query";
import {
  JOURNEY_CHANNEL_LABEL,
  JOURNEY_MODEL_LABEL,
  formatMinor,
  type JourneyEntry,
} from "@/lib/analytics/attribution";
import { formatInZone } from "@/lib/dates";

const REVENUE_LABEL = {
  CHECKOUT_PAYMENT: "Payment received",
  INVOICE_PAYMENT: "Invoice paid",
  WON_OPPORTUNITY: "Won (value entered, not yet paid)",
} as const;

const MAX_SHOWN = 8;

/**
 * The lead's revenue journey, compact (§41): every touch across ads, forms,
 * messages, calls, quotes and bookings, then the recorded revenue, and how
 * that revenue splits by channel under the position-based model. Revenue is
 * only ever a recorded payment or a won value a person entered; with none,
 * the card says so and shows the touches alone.
 *
 * Scoped to the workspace the page authenticated; optionally narrowed to one
 * opportunity.
 */
export async function RevenueJourneyCard({
  businessId,
  leadId,
  opportunityId,
}: {
  businessId: string;
  leadId: string;
  opportunityId?: string | null;
}) {
  const result = await getLeadJourney(businessId, { leadId, opportunityId });

  let body: React.ReactNode;
  if (result.status === "unavailable") {
    body = <Note>{result.message}</Note>;
  } else if (result.data.entries.length === 0) {
    body = <Note>No touches recorded for this lead yet.</Note>;
  } else {
    const { entries, credited, hasRevenue } = result.data;
    const shown = entries.length > MAX_SHOWN ? [entries[0], ...entries.slice(-(MAX_SHOWN - 1))] : entries;
    const hidden = entries.length - shown.length;
    body = (
      <>
        <ol className="relative space-y-2 px-5 py-3">
          {shown.map((entry, index) => (
            <React.Fragment key={entryKey(entry)}>
              {hidden > 0 && index === 1 && (
                <li className="pl-4 text-[11.5px] text-content-subtle">{hidden} more touches</li>
              )}
              <li className="relative pl-4">
                <span
                  aria-hidden
                  className={
                    entry.type === "revenue"
                      ? "absolute left-0 top-1.5 size-2 rounded-full bg-success-500"
                      : "absolute left-0 top-1.5 size-2 rounded-full bg-content-subtle"
                  }
                />
                <p className="truncate text-[12.5px] text-content">
                  {entry.type === "touch" ? (
                    <>
                      <span className="font-medium">{JOURNEY_CHANNEL_LABEL[entry.touch.channel]}</span>
                      <span className="text-content-muted"> · {entry.touch.label}</span>
                    </>
                  ) : (
                    <span className="font-medium text-success-700">
                      {REVENUE_LABEL[entry.revenue.kind]}: {formatMinor(entry.revenue.amountMinor, entry.revenue.currency)}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-content-subtle">{formatInZone(entry.at, { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            </React.Fragment>
          ))}
        </ol>
        {hasRevenue ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <p className="text-[11.5px] font-medium text-content-muted">{JOURNEY_MODEL_LABEL.position}</p>
            <ul className="mt-1 space-y-0.5 text-[12px]">
              {credited.position.map((c) => (
                <li key={`${c.channel}:${c.currency}`} className="flex justify-between gap-2">
                  <span className="text-content">{JOURNEY_CHANNEL_LABEL[c.channel]}</span>
                  <span className="tabular-nums text-content-muted">{formatMinor(c.amountMinor, c.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Note>No payment or won value recorded yet, so no revenue is credited.</Note>
        )}
      </>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface" aria-label="Revenue journey">
      <header className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
        <Route className="size-4 text-content-muted" aria-hidden />
        <h2 className="text-[13px] font-semibold text-content">Revenue journey</h2>
      </header>
      {body}
      {result.status === "ok" && result.missing.length > 0 && (
        <p className="px-5 pb-3 text-[11px] text-content-subtle">Not counted yet on this database: {result.missing.join(", ")}.</p>
      )}
    </section>
  );
}

function entryKey(entry: JourneyEntry): string {
  return entry.type === "touch" ? entry.touch.id : entry.revenue.id;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-3 text-[12.5px] text-content-muted" role="status">
      {children}
    </p>
  );
}

export function RevenueJourneySkeleton() {
  return <Skeleton className="h-32 w-full rounded-xl" />;
}
