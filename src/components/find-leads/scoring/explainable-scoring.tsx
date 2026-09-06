"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Building2,
  ChevronRight,
  Database,
  ExternalLink,
  Globe,
  Lightbulb,
  Link2,
  MapPin,
  Star,
  Target,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  GRADE_BANDS,
  confidenceBand,
  confidenceLabel,
  confidenceTone,
  evidenceSources,
  factorCeiling,
  gradeHeadline,
  positiveFactors,
  scoreConcerns,
} from "@/lib/prospects/scoring-explain";
import { shortAgo } from "@/lib/prospects/activity";
import {
  locationLabel,
  prospectDisplayName,
  roleLabel,
  scoreFactorLabel,
  type ScoreFactor,
  type ScoreFactorKey,
} from "@/lib/prospects/types";
import type { ProspectScoringDetail } from "@/lib/prospects/queries";

/**
 * Explainable Prospect Scoring (V4 §14).
 *
 * The contract this page exists to keep: a customer can add the breakdown up
 * and get the headline number back. Every figure below is read from the stored
 * score and its factors — nothing is recomputed here, and nothing is generated.
 * A page that scored on render would show a number different from the one the
 * campaign gate actually used, which is worse than not explaining it at all.
 *
 * The model's role is upstream and bounded: it extracts features and writes
 * evidence. The arithmetic is `lib/prospects/scoring.ts`, deterministic and
 * versioned, and the version is on the page so a past decision can be read
 * against the policy that produced it.
 */

const FACTOR_ICONS: Record<ScoreFactorKey, React.ComponentType<{ className?: string }>> = {
  ICP_FIT: Target,
  ROLE_AUTHORITY: UserRound,
  GEOGRAPHY: MapPin,
  NEED: Lightbulb,
  INTENT: TrendingUp,
  DATA_QUALITY: Database,
};

export function ExplainableScoring({ detail }: { detail: ProspectScoringDetail }) {
  const { prospect, score } = detail;
  const name = prospectDisplayName(prospect);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/app/find-leads?view=prospects"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted underline-offset-4 transition-colors hover:text-content hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to Prospects
        </Link>

        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight text-content">
          Explainable Prospect Scoring
        </h1>
        <p className="mt-1 text-[14px] text-content-muted">
          See how prospect scores are calculated and what&rsquo;s driving the recommendation.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <IdentityCard detail={detail} name={name} />
        {score ? (
          <HeadlineCard grade={score.grade} />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-5 shadow-xs">
            <p className="text-[13px] text-content-muted">
              This prospect has not been scored yet.
            </p>
          </div>
        )}
      </div>

      {!score ? (
        <section className="rounded-xl border border-line bg-surface p-8 text-center shadow-xs">
          <p className="text-[14px] font-medium text-content">No score to explain yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-content-muted">
            Scoring runs once enrichment has gathered enough evidence. Until then this
            prospect is not eligible for automated outreach spend.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <ScoreBreakdown factors={score.factors} version={score.scoreVersion} />
            <GradeBandsCard current={score.grade} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <PositiveFactorsCard detail={detail} />
            <ConcernsCard detail={detail} />
            <EvidenceCard detail={detail} />
          </div>
        </>
      )}
    </div>
  );
}

function IdentityCard({
  detail,
  name,
}: {
  detail: ProspectScoringDetail;
  name: string;
}) {
  const { prospect, score } = detail;
  const company = prospect.company;
  const location = locationLabel(company?.location_json);

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <Avatar name={name} size="xl" />
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-semibold text-content">{name}</h2>
            <p className="mt-0.5 text-[13px] text-content-secondary">
              {prospect.role_title ?? roleLabel(prospect.role_classification)}
            </p>
            {company && (
              <p className="text-[13px] text-content-secondary">{company.name}</p>
            )}
          </div>
        </div>

        {score && (
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-xl text-[26px] font-semibold",
                gradeChipClass(score.grade),
              )}
            >
              {score.grade}
            </span>
            <div>
              <p className="text-[30px] font-semibold leading-none tabular-nums text-content">
                {Math.round(score.totalScore)}
                <span className="ml-1.5 text-[15px] font-normal text-content-muted">
                  / 100
                </span>
              </p>
              <div
                className="mt-2 h-1.5 w-[150px] overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-valuenow={Math.round(score.totalScore)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Total prospect score"
              >
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${Math.min(100, score.totalScore)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-subtle pt-3.5">
        {location && <MetaFact icon={MapPin} value={location} />}
        {company?.company_size && (
          <MetaFact icon={Users} value={`${company.company_size} employees`} />
        )}
        {company?.industry && <MetaFact icon={Building2} value={company.industry} />}
        {(company?.website_url || company?.domain) && (
          <div className="flex items-center gap-1.5">
            <Globe className="size-4 shrink-0 text-content-subtle" aria-hidden />
            <a
              href={company.website_url ?? `https://${company.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              {company.domain ?? "Website"}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        )}
      </dl>
    </section>
  );
}

function MetaFact({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-content-subtle" aria-hidden />
      <dd className="text-[12.5px] text-content-secondary">{value}</dd>
    </div>
  );
}

/** The headline sentence, built from the grade band so it can never describe a
 *  prospect more warmly than its score allows. */
function HeadlineCard({ grade }: { grade: "A+" | "A" | "B" | "C" | "D" }) {
  const headline = gradeHeadline(grade);
  const strong = grade === "A+" || grade === "A" || grade === "B";

  return (
    <section
      className={cn(
        "rounded-xl border p-5 shadow-xs",
        strong ? "border-success-100 bg-success-50/60" : "border-warning-100 bg-warning-50/60",
      )}
    >
      <div className="flex items-start gap-3">
        <Star
          className={cn(
            "mt-0.5 size-5 shrink-0",
            strong ? "text-success-600" : "text-warning-600",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-content">{headline.title}</h2>
          <p className="mt-1 text-[13px] text-content-secondary">{headline.description}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The six factors, each with its weight and what it actually earned.
 *
 * The bar shows the factor's raw 0-100 value; the number beside it is the same.
 * The weight is stated separately rather than folded into the bar, because a
 * customer comparing two prospects needs to see that geography scored 100 and
 * that geography is only worth 15 points.
 */
function ScoreBreakdown({
  factors,
  version,
}: {
  factors: ScoreFactor[];
  version: string;
}) {
  const [open, setOpen] = React.useState<ScoreFactorKey | null>(null);

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-content">Score breakdown</h2>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            The score is calculated using 6 key factors. Each factor is weighted and based
            on verified evidence.
          </p>
        </div>
        <Badge tone="neutral" dense title="The scoring policy version this score was produced under">
          {version}
        </Badge>
      </div>

      <ul className="mt-4 divide-y divide-line-subtle">
        {factors.map((factor) => {
          const Icon = FACTOR_ICONS[factor.factor] ?? Target;
          const expanded = open === factor.factor;
          const value = Math.round(factor.rawValue * 100);

          return (
            <li key={factor.factor}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : factor.factor)}
                className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent"
              >
                <span
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>

                <span className="w-[132px] shrink-0 truncate text-[13px] font-medium text-content">
                  {scoreFactorLabel(factor.factor)}
                </span>

                <span className="w-[80px] shrink-0 text-[12px] tabular-nums text-content-muted">
                  {Math.round(factor.weight * 100)}% weight
                </span>

                <span
                  className="hidden h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken sm:block"
                  role="progressbar"
                  aria-valuenow={value}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${scoreFactorLabel(factor.factor)} score`}
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      factor.direction === "POSITIVE"
                        ? "bg-accent-500"
                        : factor.direction === "NEUTRAL"
                          ? "bg-warning-500"
                          : "bg-danger-500",
                    )}
                    style={{ width: `${value}%` }}
                  />
                </span>

                <span className="w-[74px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-content">
                  {value}
                  <span className="font-normal text-content-muted"> / 100</span>
                </span>

                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-content-subtle transition-transform",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>

              {expanded && <FactorDetail factor={factor} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FactorDetail({ factor }: { factor: ScoreFactor }) {
  const band = confidenceBand(factor.confidence);

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-sunken/50 px-3.5 py-3">
      <p className="text-[12.5px] text-content-secondary">
        {factor.evidenceSummary ??
          "No evidence summary was recorded for this factor, so it contributed only what its raw value earned."}
      </p>

      <dl className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px]">
        <div className="flex items-center gap-1.5">
          <dt className="text-content-subtle">Contributed</dt>
          <dd className="font-semibold tabular-nums text-content">
            {factor.contribution.toFixed(1)} of {Math.round(factorCeiling(factor))} points
          </dd>
        </div>
        {factor.evidenceSource && (
          <div className="flex items-center gap-1.5">
            <dt className="text-content-subtle">Source</dt>
            <dd className="text-content-secondary">{factor.evidenceSource}</dd>
          </div>
        )}
        {factor.observedAt && (
          <div className="flex items-center gap-1.5">
            <dt className="text-content-subtle">Observed</dt>
            <dd className="text-content-secondary">{shortAgo(factor.observedAt)}</dd>
          </div>
        )}
        <Badge tone={confidenceTone(band)} dense>
          {confidenceLabel(band)}
        </Badge>
        {factor.evidenceUrl && (
          <a
            href={factor.evidenceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-content-accent underline-offset-4 hover:underline"
          >
            Source <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </dl>
    </div>
  );
}

function GradeBandsCard({ current }: { current: "A+" | "A" | "B" | "C" | "D" }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h2 className="text-[16px] font-semibold text-content">Grade bands</h2>
      <p className="mt-0.5 text-[12.5px] text-content-muted">
        Prospects are automatically graded based on their total score.
      </p>

      <ul className="mt-4 divide-y divide-line-subtle rounded-lg border border-line">
        {GRADE_BANDS.map((band) => {
          const active = band.grade === current;
          return (
            <li
              key={band.grade}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5",
                active && "bg-accent-50/60",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold",
                  gradeChipClass(band.grade),
                )}
              >
                {band.grade}
              </span>
              <span className="w-[68px] shrink-0 text-[12.5px] tabular-nums text-content-secondary">
                {band.min} – {band.max}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-content-muted">
                {band.meaning}
              </span>
              {active && (
                <Badge tone="accent" dense>
                  This prospect
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PositiveFactorsCard({ detail }: { detail: ProspectScoringDetail }) {
  const factors = detail.score ? positiveFactors(detail.score) : [];

  return (
    <ContributionCard
      icon={ArrowUp}
      tone="success"
      title="Top positive factors"
      description="These factors are contributing most to the score."
      empty="Nothing is contributing positively yet."
      items={factors.map((item) => ({
        key: item.factor,
        title: item.title,
        detail: item.detail,
        points: `+${item.points} points`,
      }))}
    />
  );
}

function ConcernsCard({ detail }: { detail: ProspectScoringDetail }) {
  const concerns = detail.score ? scoreConcerns(detail.score) : [];

  return (
    <ContributionCard
      icon={ArrowDown}
      tone="warning"
      title="Potential concerns"
      description="These factors are limiting the score."
      empty="Nothing material is holding this score back."
      items={concerns.map((item) => ({
        key: item.factor,
        title: item.title,
        detail: item.detail,
        points: `${item.points} points`,
      }))}
    />
  );
}

function ContributionCard({
  icon: Icon,
  tone,
  title,
  description,
  empty,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "warning";
  title: string;
  description: string;
  empty: string;
  items: { key: string; title: string; detail: string; points: string }[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
            tone === "success"
              ? "bg-success-50 text-success-600"
              : "bg-warning-50 text-warning-600",
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-content">{title}</h2>
          <p className="mt-0.5 text-[12px] text-content-muted">{description}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  tone === "success" ? "bg-success-500" : "bg-warning-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-content">{item.title}</p>
                <p className="mt-0.5 text-[11.5px] text-content-muted">{item.detail}</p>
              </div>
              <Badge tone={tone} dense className="shrink-0 tabular-nums">
                {item.points}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Evidence, grouped by source.
 *
 * Confidence is a band over the recorded per-fact confidence, never a figure a
 * model asserted about itself: §14.7 is explicit that an arbitrary "97%
 * confident" is not acceptable, so what is shown is derived from source
 * authority and match certainty at extraction time.
 */
function EvidenceCard({ detail }: { detail: ProspectScoringDetail }) {
  const sources = detail.score ? evidenceSources(detail.score) : [];

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex items-start gap-2.5">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
          aria-hidden
        >
          <Link2 className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-content">Evidence &amp; sources</h2>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Key evidence used in this score.
          </p>
        </div>
      </div>

      {sources.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">
          No evidence sources were recorded against this score.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sources.map((source) => (
            <li key={source.source} className="flex items-start gap-2.5">
              <span
                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-content-subtle"
                aria-hidden
              >
                <Globe className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-content">
                  {source.source}
                </p>
                <p className="truncate text-[11.5px] text-content-muted">
                  {source.facts.join(" · ")}
                </p>
                {source.observedAt && (
                  <p className="text-[11px] text-content-subtle">
                    {shortAgo(source.observedAt)}
                  </p>
                )}
              </div>
              <Badge tone={confidenceTone(source.band)} dense className="shrink-0">
                {confidenceLabel(source.band)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function gradeChipClass(grade: string): string {
  if (grade === "A+" || grade === "A") return "bg-success-50 text-success-700";
  if (grade === "B") return "bg-accent-50 text-content-accent";
  if (grade === "C") return "bg-warning-50 text-warning-700";
  return "bg-danger-50 text-danger-700";
}
