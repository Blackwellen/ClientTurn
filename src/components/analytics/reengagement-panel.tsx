import * as React from "react";
import { Repeat } from "lucide-react";
import type { ReengagementPerformance } from "@/lib/analytics/reengagement-query";
import { formatGbp } from "@/lib/dates";
import { formatCredits, tokensToCredits } from "@/lib/billing/tokens";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/feedback";
import { AnalyticsCard } from "./cards";

const TITLE = "Re-engagement performance";
const DESCRIPTION =
  "What each automated loop produced in this period. Ranked by sales and meetings, not replies.";

/** Loading state, shown while the section's own query runs (Suspense fallback). */
export function ReengagementPanelSkeleton() {
  return (
    <AnalyticsCard icon={Repeat} title={TITLE} description={DESCRIPTION}>
      <SkeletonTable rows={4} />
    </AnalyticsCard>
  );
}

function pct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 1000) / 10}%`;
}

/**
 * Analytics -> Re-engagement performance. One row per loop: leads reached,
 * meetings, sales (with value), opt-outs and complaints, and cost (SMS
 * segments, AI credits), with reply rate last and muted: it is context, not
 * the score.
 */
export function ReengagementPanel({ result }: { result: ReengagementPerformance }) {
  if (result.status === "unavailable") {
    return (
      <AnalyticsCard icon={Repeat} title={TITLE} description={DESCRIPTION}>
        <ErrorState title="Not available" description={result.message} className="py-8" />
      </AnalyticsCard>
    );
  }
  if (result.loops.length === 0) {
    return (
      <AnalyticsCard icon={Repeat} title={TITLE} description={DESCRIPTION}>
        <EmptyState
          icon={Repeat}
          title="No automated messages in this period"
          description="Once follow-up sequences, reactivation campaigns or re-engagement check-ins send, their meetings, sales and usage appear here. Try a longer period."
          className="py-8"
        />
      </AnalyticsCard>
    );
  }

  return (
    <AnalyticsCard icon={Repeat} title={TITLE} description={DESCRIPTION}>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12.5px]">
          <thead className="text-content-muted">
            <tr>
              <th className="px-1 py-2 font-medium">Loop</th>
              <th className="px-1 py-2 text-right font-medium">Leads reached</th>
              <th className="px-1 py-2 text-right font-medium">Meetings</th>
              <th className="px-1 py-2 text-right font-medium">Sales won</th>
              <th className="px-1 py-2 text-right font-medium">Opt-outs / complaints</th>
              <th className="px-1 py-2 text-right font-medium">SMS segments</th>
              <th className="px-1 py-2 text-right font-medium">AI credits</th>
              <th className="px-1 py-2 text-right font-medium text-content-subtle">Reply rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {result.loops.map((loop) => (
              <tr key={loop.loop}>
                <td className="px-1 py-2 font-medium text-content">{loop.label}</td>
                <td className="px-1 py-2 text-right tabular-nums">{loop.leadsReached.toLocaleString("en-GB")}</td>
                <td className="px-1 py-2 text-right tabular-nums">{loop.meetings.toLocaleString("en-GB")}</td>
                <td className="px-1 py-2 text-right tabular-nums">
                  {loop.sales.toLocaleString("en-GB")}
                  {loop.salesValue > 0 && <span className="text-content-muted"> · {formatGbp(loop.salesValue)}</span>}
                </td>
                <td className="px-1 py-2 text-right tabular-nums">
                  {loop.optOuts.toLocaleString("en-GB")} / {loop.complaints.toLocaleString("en-GB")}
                </td>
                <td className="px-1 py-2 text-right tabular-nums">{loop.smsSegments.toLocaleString("en-GB")}</td>
                <td className="px-1 py-2 text-right tabular-nums">{formatCredits(tokensToCredits(loop.tokens))}</td>
                <td className="px-1 py-2 text-right tabular-nums text-content-subtle">{pct(loop.replyRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.45] text-content-subtle">
        An outcome counts for the most recent automated message the lead got within {result.attributionDays} days before it.
        Replies to a lead who wrote in, and your own messages, are not counted as touches.
        {result.truncated ? " Only the first 5,000 automated messages in the period are included; choose a shorter period for a complete count." : ""}
      </p>
    </AnalyticsCard>
  );
}

/** The section as an async server component, so it streams behind its own skeleton. */
export async function ReengagementSection({ load }: { load: () => Promise<ReengagementPerformance> }) {
  return <ReengagementPanel result={await load()} />;
}
