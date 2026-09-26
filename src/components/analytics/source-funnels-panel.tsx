import * as React from "react";
import { GitBranch } from "lucide-react";
import type { SourceFunnelResult } from "@/lib/analytics/source-funnels-query";
import {
  FAMILY_LABEL,
  type FunnelStageResult,
  type SourceFunnel,
} from "@/lib/analytics/source-funnels";
import { formatSampledRate } from "@/lib/analytics/revenue-surfaces";
import { formatDuration, formatMetric } from "@/lib/analytics/v4-metrics";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { AnalyticsCard } from "./cards";

/**
 * The Source funnels view (coverage tracker 8.16): one funnel per source, each
 * starting at that source's own entry point. Deliberately not the Dashboard's
 * single journey funnel — this answers "which source converts, and where does
 * each one leak".
 */
export function SourceFunnelsPanel({ result }: { result: SourceFunnelResult }) {
  if (result.status === "unavailable") {
    return <EmptyState icon={GitBranch} title="Not available" description={result.message} />;
  }
  if (result.funnels.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No sources in this period"
        description="Funnels appear as leads arrive, prospects are found or connection requests go out. Try a longer period."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-content-muted">
        Each source starts at its own first step, counted from when that step
        happened in the selected period. Step conversion is the share of those
        who reached the previous step and also reached this one. Rates with
        fewer than 30 in the denominator show it.
        {result.truncated && " Showing the most recent 5,000 records of each kind."}
      </p>
      {result.notes.map((note) => (
        <p key={note} className="text-[12.5px] text-warning-700">
          {note}
        </p>
      ))}
      <div className="grid gap-4 xl:grid-cols-2">
        {result.funnels.map((funnel) => (
          <FunnelTable key={funnel.key} funnel={funnel} />
        ))}
      </div>
    </div>
  );
}

function FunnelTable({ funnel }: { funnel: SourceFunnel }) {
  const won = funnel.stages.find((stage) => stage.key === "won");
  return (
    <AnalyticsCard
      icon={GitBranch}
      title={funnel.label}
      description={`${funnel.entries.toLocaleString("en-GB")} ${funnel.stages[0].label.toLowerCase()}`}
      action={
        <Badge tone="neutral" dense>
          {FAMILY_LABEL[funnel.family]}
        </Badge>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-content-subtle">
              <th className="py-1.5 pr-2 font-medium">Stage</th>
              <th className="py-1.5 pr-2 text-right font-medium">Reached</th>
              <th className="w-[22%] py-1.5 pr-2 font-medium">
                <span className="sr-only">Share of first step</span>
              </th>
              <th className="py-1.5 pr-2 text-right font-medium">From previous</th>
              <th className="py-1.5 text-right font-medium">Median time</th>
            </tr>
          </thead>
          <tbody>
            {funnel.stages.map((stage, index) => (
              <StageRow key={stage.key} stage={stage} first={index === 0} />
            ))}
          </tbody>
        </table>
      </div>
      {won && (won.count ?? 0) > 0 && funnel.closeTypes.length > 0 && (
        <p className="mt-3 border-t border-line pt-2.5 text-[12px] text-content-muted">
          <span className="font-medium text-content">Won by close type: </span>
          {funnel.closeTypes.map((type) => `${type.label} ${type.count}`).join(" · ")}
        </p>
      )}
    </AnalyticsCard>
  );
}

function StageRow({ stage, first }: { stage: FunnelStageResult; first: boolean }) {
  const share = first ? 1 : stage.shareOfEntry;
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="py-2 pr-2 align-top">
        <span className="text-content">{stage.label}</span>
        {stage.manual && (
          <Badge
            dense
            tone="info"
            className="ml-1.5"
            title="ClientTurn cannot observe this step. It counts what your team records: a booking marked as attended, or a deal closed as won."
          >
            recorded by your team
          </Badge>
        )}
      </td>
      <td className="lr-tabular py-2 pr-2 text-right align-top font-semibold text-content">
        {stage.tracked ? (stage.count ?? 0).toLocaleString("en-GB") : (
          <span className="font-normal text-content-subtle">not tracked</span>
        )}
      </td>
      <td className="py-2 pr-2 align-middle">
        {stage.tracked && share !== null && (
          <span className="block h-1.5 w-full rounded-full bg-surface-sunken" aria-hidden>
            <span
              className="block h-1.5 rounded-full bg-success-500"
              style={{ width: `${Math.max(share > 0 ? 2 : 0, Math.min(100, share * 100))}%` }}
            />
          </span>
        )}
      </td>
      <td className="lr-tabular py-2 pr-2 text-right align-top text-content-secondary">
        {first ? (
          "—"
        ) : stage.step ? (
          <span className="inline-flex items-center gap-1">
            {formatSampledRate(stage.step)}
            {stage.step.lowSample && (
              <Badge dense tone="warning" title={`Only ${stage.step.denominator} in the denominator`}>
                small sample
              </Badge>
            )}
          </span>
        ) : (
          formatMetric(null, "percent")
        )}
      </td>
      <td className="lr-tabular py-2 text-right align-top text-content-secondary">
        {first ? (
          "—"
        ) : !stage.timed ? (
          <span className="text-content-subtle" title="This step is recorded without a time.">
            not timed
          </span>
        ) : stage.medianSeconds === null ? (
          "—"
        ) : (
          <span title={`Median over ${stage.timedSample} ${stage.timedSample === 1 ? "record" : "records"}`}>
            {formatDuration(stage.medianSeconds)}
          </span>
        )}
      </td>
    </tr>
  );
}
