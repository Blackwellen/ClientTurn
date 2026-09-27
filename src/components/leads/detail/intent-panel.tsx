import * as React from "react";
import { Gauge, Quote, TriangleAlert } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { formatDateTime, formatRelative } from "@/lib/dates";
import {
  INTENT_COMPONENT_COPY,
  INTENT_SCORE_COMPONENTS,
  INTENT_STATE_COPY,
  SIGNAL_SOURCE_COPY,
  signalTypeLabel,
  type AssessmentView,
} from "@/lib/qualification-intelligence/explain";
import { INTENT_COMPONENT_CAPS, type IntentEvidenceItem } from "@/lib/qualification-intelligence/types";
import type { SignalView } from "@/lib/qualification-intelligence/store-reads";
import { IntentOverrideDialog } from "./qualification-override-dialogs";

/**
 * The Qualification tab's Intent section (§B.17): the state and score, the five
 * capped components, the evidence with its source and age, the latest
 * signals, any contradicting evidence, and when the assessment decays.
 *
 * Contradictions are shown, never summed: a pricing-page visit next to "not
 * interested" leaves the lead NEGATIVE with the visit listed here.
 */

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function EvidenceLine({
  item,
  signal,
  contradicting,
}: {
  item: IntentEvidenceItem;
  signal: SignalView | undefined;
  contradicting?: boolean;
}) {
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-content">{signalTypeLabel(item.signal_type)}</span>
        <Badge dense tone={contradicting ? "danger" : item.polarity === "NEGATIVE" ? "danger" : "neutral"}>
          {contradicting ? "Overruled" : item.polarity === "NEGATIVE" ? "Negative" : `${percent(item.decayed_strength)} strength now`}
        </Badge>
      </div>
      <p className="mt-0.5 text-[12.5px] text-content-secondary">{item.reason}</p>
      {signal?.excerpt && (
        <p className="mt-1 flex gap-1.5 text-[12px] italic text-content-muted">
          <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0">{signal.excerpt}</span>
        </p>
      )}
      <p className="mt-1 text-[11.5px] text-content-subtle">
        {signal ? `${SIGNAL_SOURCE_COPY[signal.source] ?? signal.source} · ` : ""}
        <time dateTime={item.observed_at} title={formatDateTime(item.observed_at)}>
          {formatRelative(item.observed_at)}
        </time>
      </p>
    </li>
  );
}

export function IntentPanel({
  leadId,
  assessment,
  signals,
  canWrite,
  engineOff,
}: {
  leadId: string;
  assessment: AssessmentView | null;
  signals: SignalView[];
  canWrite: boolean;
  /** Only known to owners and admins; null when not visible. */
  engineOff: boolean | null;
}) {
  const bySignal = new Map(signals.map((s) => [s.id, s]));

  if (!assessment) {
    return (
      <section aria-labelledby="intent-title" className="rounded-xl border border-line bg-surface shadow-xs">
        <header className="flex items-center justify-between gap-2 border-b border-line-subtle px-5 py-3.5">
          <h2 id="intent-title" className="text-[14px] font-semibold text-content">
            Buying intent
          </h2>
          {canWrite && <IntentOverrideDialog leadId={leadId} current={null} />}
        </header>
        <EmptyState
          icon={Gauge}
          title="Not assessed yet"
          description={
            engineOff
              ? "The qualification engine is off for this workspace, so no intent is assessed. An owner or admin can switch it on in Settings, AI & selling."
              : "Intent is assessed when the lead arrives, replies or books. Re-run qualification to assess it now."
          }
        />
        {signals.length > 0 && <SignalList signals={signals} />}
      </section>
    );
  }

  const copy = INTENT_STATE_COPY[assessment.intentState];

  return (
    <section aria-labelledby="intent-title" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="intent-title" className="text-[15px] font-semibold text-content">
              Buying intent
            </h2>
            <StatusBadge kind="intent_state" value={assessment.intentState} />
            {assessment.manualOverride === "INTENT" && (
              <Badge dense tone="purple">
                Set by a person
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[13px] text-content-muted">{copy.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="flex items-baseline gap-1">
            <span className="text-[22px] font-bold leading-none tabular-nums text-content">{assessment.intentScore}</span>
            <span className="text-[12px] text-content-subtle">/ 100</span>
          </p>
          {canWrite && <IntentOverrideDialog leadId={leadId} current={assessment.intentState} />}
        </div>
      </header>

      <ul className="grid gap-px bg-line-subtle sm:grid-cols-5" aria-label="Intent score by component">
        {INTENT_SCORE_COMPONENTS.map((component) => {
          const points = Math.round(assessment.categories[component]);
          const cap = INTENT_COMPONENT_CAPS[component];
          return (
            <li key={component} className="min-w-0 bg-surface px-4 py-3" title={INTENT_COMPONENT_COPY[component].description}>
              <p className="line-clamp-2 text-[12px] leading-snug font-medium text-content-secondary">{INTENT_COMPONENT_COPY[component].label}</p>
              <p className="mt-0.5 text-[12.5px] tabular-nums text-content-muted">
                <span className="font-semibold text-content">{points}</span> / {cap}
              </p>
              <Progress className="mt-1.5" value={points} max={cap} label={`${INTENT_COMPONENT_COPY[component].label} points`} />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line-subtle px-5 py-2.5 text-[12px] text-content-muted">
        <span>{percent(assessment.confidence)} confidence</span>
        {assessment.validUntil ? (
          <span>
            Valid until{" "}
            <time dateTime={assessment.validUntil} className="text-content-secondary">
              {formatDateTime(assessment.validUntil)}
            </time>
            , then it is re-assessed as signals decay
          </span>
        ) : (
          <span>Nothing in it decays</span>
        )}
        <span>
          Assessed{" "}
          <time dateTime={assessment.createdAt} title={formatDateTime(assessment.createdAt)}>
            {formatRelative(assessment.createdAt)}
          </time>
        </span>
      </div>

      {assessment.contradictions.length > 0 && (
        <div className="border-t border-line-subtle">
          <p className="flex items-center gap-1.5 bg-danger-50 px-5 py-2 text-[12.5px] font-medium text-danger-700">
            <TriangleAlert className="size-3.5" aria-hidden />
            Contradicting evidence: overruled, never added to the score
          </p>
          <ul className="divide-y divide-line-subtle">
            {assessment.contradictions.map((item) => (
              <EvidenceLine key={`c-${item.signal_id}`} item={item} signal={bySignal.get(item.signal_id)} contradicting />
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line-subtle">
        <p className="px-5 pt-3 text-[12px] font-semibold uppercase tracking-wide text-content-subtle">
          Evidence <span className="font-normal normal-case tracking-normal">({assessment.evidence.length})</span>
        </p>
        {assessment.evidence.length === 0 ? (
          <p className="px-5 pb-4 pt-1 text-[12.5px] text-content-muted">No live evidence of intent yet.</p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {assessment.evidence.map((item) => (
              <EvidenceLine key={item.signal_id} item={item} signal={bySignal.get(item.signal_id)} />
            ))}
          </ul>
        )}
      </div>

      {signals.length > 0 && <SignalList signals={signals} />}
    </section>
  );
}

function SignalList({ signals }: { signals: SignalView[] }) {
  return (
    <details className="group border-t border-line-subtle">
      <summary className="cursor-pointer list-none px-5 py-3 text-[12.5px] font-medium text-content-accent hover:underline">
        Latest signals ({signals.length})
      </summary>
      <ul className="divide-y divide-line-subtle border-t border-line-subtle">
        {signals.map((signal) => (
          <li key={signal.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5">
            <div className="min-w-0">
              <p className="text-[12.5px] text-content">
                {signalTypeLabel(signal.type)}
                {signal.retracted && <span className="text-content-subtle"> · withdrawn</span>}
              </p>
              <p className="text-[12px] text-content-muted">{signal.reason}</p>
              <p className="text-[11.5px] text-content-subtle">
                {SIGNAL_SOURCE_COPY[signal.source] ?? signal.source} · {formatRelative(signal.observedAt)}
                {signal.resumeAt && ` · resume ${formatDateTime(signal.resumeAt)}`}
                {!signal.resumeAt && signal.expiresAt && ` · expires ${formatDateTime(signal.expiresAt)}`}
              </p>
            </div>
            <Badge dense tone={signal.polarity === "NEGATIVE" ? "danger" : signal.polarity === "POSITIVE" ? "success" : "neutral"}>
              {signal.polarity === "NEGATIVE" ? "Negative" : signal.polarity === "POSITIVE" ? "Positive" : "Neutral"}
            </Badge>
          </li>
        ))}
      </ul>
    </details>
  );
}
