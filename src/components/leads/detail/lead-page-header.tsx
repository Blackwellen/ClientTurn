import * as React from "react";
import {
  Building2,
  CircleDashed,
  Gauge,
  Mail,
  Phone,
  Sparkles,
  Target,
  UserCircle2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { STAGE_LABEL, type OpportunityStage } from "@/lib/opportunities/stages";
import { leadDisplayName } from "@/lib/leads/types";
import { formatEvidenceValue } from "@/lib/scoring/evidence-display";
import { formatPhoneDisplay } from "@/lib/phone-display";
import type { LeadPageHeader as HeaderData } from "@/lib/leads/detail-queries";

/**
 * The lead page's summary surfaces, server-rendered:
 *
 *   - `LeadPageHeader` — identity on the page background, the same pattern as
 *     the Find Leads campaign detail (title, status badges, one meta line).
 *   - `LeadKeyFacts` — owner, deal stage, score and qualification in one
 *     divided strip, so the four things a person asks first are above the fold
 *     at every width.
 *   - `LeadScoreBreakdown` — why the score is what it is: one bar per
 *     dimension with score/max, the evidence behind it and what is missing.
 *
 * Nothing here is estimated for display. An unscored lead says it is
 * unscored, a lead with no opportunity says so, and a tag shows the rule's
 * own reason on hover or focus.
 */

function tagLabel(tag: string): string {
  const text = tag.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function money(value: number | null, currency: string) {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/* ----------------------------------------------------------- identity */

export function LeadPageHeader({ header }: { header: HeaderData }) {
  const { lead, archetype, tags } = header;
  const name = leadDisplayName(lead);

  return (
    <header className="flex min-w-0 items-start gap-4" aria-label="Lead">
      <Avatar name={name} size="xl" className="hidden shrink-0 sm:inline-flex" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="min-w-0 break-words text-[24px] font-bold leading-tight tracking-[-0.02em] text-content sm:text-[26px]">
            {name}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge kind="lead" value={lead.status} />
            {lead.archived_at && <Badge tone="neutral">Archived</Badge>}
            {lead.opted_out && <Badge tone="danger">Opted out</Badge>}
            {lead.human_takeover && <Badge tone="warning">With a person</Badge>}
          </div>
        </div>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-content-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Building2 className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
            <span className="truncate">
              {lead.company_name ?? "No company recorded"}
              {archetype && <span className="text-content-subtle"> · {archetype.name}</span>}
            </span>
          </span>
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex min-w-0 items-center gap-1.5 text-content-accent underline-offset-4 hover:underline"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-content hover:underline"
            >
              <Phone className="size-3.5 text-content-subtle" aria-hidden />
              {formatPhoneDisplay(lead.phone)}
            </a>
          )}
          <span>Added {formatRelative(lead.created_at)}</span>
        </p>

        {tags.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Tags">
            {tags.map((tag) => (
              <li key={tag.tag}>
                <Tooltip content={`${tag.reason} (set ${formatRelative(tag.setAt)})`}>
                  <Badge tone="neutral" tabIndex={0} className="cursor-help">
                    {tagLabel(tag.tag)}
                  </Badge>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------- key facts */

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 bg-surface px-4 py-3.5 sm:px-5">
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-content-subtle"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-content-subtle">
          {label}
        </dt>
        <dd className="mt-1 min-w-0 text-[13.5px] font-medium text-content">{children}</dd>
      </div>
    </div>
  );
}

export function LeadKeyFacts({ header }: { header: HeaderData }) {
  const { lead, score, opportunity, owner } = header;
  const value = opportunity ? money(opportunity.value, opportunity.currency) : null;

  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line-subtle shadow-xs sm:grid-cols-2 xl:grid-cols-4">
      <Fact icon={UserCircle2} label="Owner">
        {owner?.name ?? <span className="font-normal text-content-muted">Unassigned</span>}
      </Fact>
      <Fact icon={Target} label="Deal">
        {opportunity ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{STAGE_LABEL[opportunity.stage as OpportunityStage] ?? opportunity.stage}</span>
            <StatusBadge kind="opportunity_outcome" value={opportunity.outcome} dense />
            {value && <span className="font-normal tabular-nums text-content-muted">{value}</span>}
          </span>
        ) : (
          <span className="font-normal text-content-muted">Opens when the lead qualifies</span>
        )}
      </Fact>
      <Fact icon={Gauge} label="Score">
        {score ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge kind="lead_grade" value={score.grade} dense />
            {/* "59 / 100" stays on one line; only the confidence may wrap (8.7). */}
            <span className="whitespace-nowrap tabular-nums">
              {Math.round(score.total)}
              <span className="font-normal text-content-muted"> / 100</span>
            </span>
            <span className="font-normal tabular-nums text-content-muted">
              · {Math.round(score.confidence * 100)}% confidence
            </span>
          </span>
        ) : (
          <StatusBadge kind="lead_grade" value="UNSCORED" dense />
        )}
      </Fact>
      <Fact icon={CircleDashed} label="Qualification">
        <StatusBadge kind="qualification" value={lead.qualification_state} dense />
      </Fact>
    </dl>
  );
}

/* ----------------------------------------------------- score breakdown */

function DimensionBar({ score, max }: { score: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  // Green = healthy, amber = partial, neutral when there is nothing yet.
  const tone =
    ratio >= 0.66 ? "bg-success-500" : ratio >= 0.33 ? "bg-warning-500" : ratio > 0 ? "bg-danger-500" : "";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(score)}
    >
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function LeadScoreBreakdown({ header }: { header: HeaderData }) {
  const { score, opportunity } = header;

  return (
    <section
      aria-labelledby="lead-score-title"
      className="rounded-xl border border-line bg-surface shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id="lead-score-title" className="text-[15px] font-semibold text-content">
            Why this score
          </h2>
          <p className="mt-0.5 text-[13px] text-content-muted">
            {score ? score.why : "This lead has not been scored yet. It is scored as soon as there is something to go on."}
          </p>
        </div>
        {score && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge kind="lead_grade" value={score.grade} />
            <span className="text-[22px] font-bold leading-none tabular-nums text-content">
              {Math.round(score.total)}
            </span>
            <span className="text-[12px] text-content-subtle">/ 100</span>
          </div>
        )}
      </div>

      {opportunity?.outcomeReason && opportunity.outcome !== "OPEN" && (
        <p className="border-b border-line-subtle bg-surface-sunken/40 px-5 py-2.5 text-[12.5px] text-content-secondary">
          <span className="font-medium text-content">
            Reason {opportunity.outcome === "WON" ? "won" : "lost"}:
          </span>{" "}
          {opportunity.outcomeReason}
        </p>
      )}

      {score && (
        <>
          <ul className="grid gap-px bg-line-subtle sm:grid-cols-2">
            {score.dimensions.map((dimension) => (
              <li key={dimension.dimension} className="min-w-0 bg-surface px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-semibold text-content">{dimension.label}</p>
                  <p className="shrink-0 text-[12.5px] tabular-nums text-content-muted">
                    <span className="font-semibold text-content">{Math.round(dimension.score)}</span>
                    {" / "}
                    {Math.round(dimension.max)}
                  </p>
                </div>
                <div className="mt-2">
                  <DimensionBar score={dimension.score} max={dimension.max} />
                </div>
                {dimension.evidence.length > 0 ? (
                  <ul className="mt-2.5 space-y-1 text-[12.5px] text-content-secondary">
                    {dimension.evidence.map((item, index) => (
                      <li key={`${item.label}-${index}`} className="flex min-w-0 gap-2">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-content-subtle" />
                        <span className="min-w-0">
                          {item.label}
                          {item.value && item.value !== "true" ? (
                            <span className="text-content">: {formatEvidenceValue(item.label, item.value)}</span>
                          ) : null}
                          <span className="text-content-subtle"> · {evidenceSource(item.source)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-[12.5px] text-content-muted">No evidence yet.</p>
                )}
                {dimension.missing.length > 0 && (
                  <p className="mt-2 text-[12px] text-warning-700">
                    Missing: {dimension.missing.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-5 py-3 text-[12px] text-content-muted">
            {score.missing.length > 0 ? (
              <p className="inline-flex min-w-0 items-start gap-1.5">
                <Sparkles className="mt-px size-3.5 shrink-0 text-content-subtle" aria-hidden />
                <span>
                  <span className="font-medium text-content-secondary">Worth finding out: </span>
                  {score.missing.map((item) => item.label).join(", ")}
                </span>
              </p>
            ) : (
              <span />
            )}
            <p className="shrink-0">Scored {formatDateTime(score.scoredAt)}</p>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Score evidence names where each fact came from. Column paths such as
 * "lead.estimated_value" and verdict codes such as "QUALIFIED" read as
 * internals on the lead page (8.7), so both are put into words here.
 */
function evidenceSource(source: string): string {
  if (source.startsWith("lead.")) return "the lead record";
  return source.replace(/[._]/g, " ");
}


