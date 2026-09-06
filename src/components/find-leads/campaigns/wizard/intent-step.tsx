"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Check,
  ClipboardList,
  Clock,
  Gauge,
  Lightbulb,
  Target,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import {
  GRADES,
  INTENT_AGE_OPTIONS,
  formatCount,
  gradeBandLabel,
  type CampaignDraft,
  type FieldErrors,
  type Grade,
} from "@/lib/outreach/campaign-draft";
import { eligibilityRules } from "@/lib/outreach/campaign-eligibility";
import type {
  AudienceEstimate,
  CampaignWizardOptions,
  IntentCategoryInsight,
} from "@/lib/outreach/campaigns/audience";
import { RadioRow, RailCard, SectionCard, TickList } from "./pieces";
import { TokenSelect } from "./token-select";

const TIPS = [
  "Use 2–4 focused intent categories",
  "Set a realistic review threshold",
  "Combine intent with location and role filters",
  "Monitor and refine based on performance",
] as const;

/** The distribution ring's colours, strongest grade first. */
const GRADE_COLOURS: Record<Grade, string> = {
  "A+": "var(--lr-success-700)",
  A: "var(--lr-success-500)",
  B: "var(--lr-warning-500)",
  C: "var(--lr-warning-600)",
  D: "var(--lr-danger-500)",
};

/**
 * Step 3 — Intent & Score.
 *
 * The eligibility list is rendered from `eligibilityRules`, the same pure
 * function the audience builder and the dispatcher evaluate. It is not a
 * prettier description of a rule implemented elsewhere — if the preview and the
 * runtime ever disagreed, one of them would be lying, and this is the module
 * that stops that being possible.
 */
export function IntentStep({
  draft,
  errors,
  options,
  estimate,
  insights,
  loading,
  onChange,
}: {
  draft: CampaignDraft;
  errors: FieldErrors;
  options: CampaignWizardOptions;
  estimate: AudienceEstimate | null;
  insights: IntentCategoryInsight[];
  loading: boolean;
  onChange: (update: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const { intentScore } = draft;

  const setIntent = (patch: Partial<CampaignDraft["intentScore"]>) =>
    onChange((current) => ({
      ...current,
      intentScore: { ...current.intentScore, ...patch },
    }));

  const nameById = new Map(options.intentCategories.map((row) => [row.id, row.name]));
  const idByName = new Map(options.intentCategories.map((row) => [row.name, row.id]));
  const selectedNames = intentScore.intentCategoryIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => Boolean(name));

  const rules = eligibilityRules(draft);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
      <SectionCard
        icon={Target}
        title="Intent signals and scoring"
        description="Use intent signals and scoring rules to prioritise the most relevant prospects."
        bodyClassName="grid gap-4 lg:grid-cols-2"
      >
        {/* ------------------------------------------------ minimum grade */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600"
            >
              <BarChart3 className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">Minimum grade</h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Only include prospects with this grade or above.
              </p>
            </div>
          </div>

          <div
            className="mt-3.5 grid grid-cols-5 gap-1.5"
            role="radiogroup"
            aria-label="Minimum grade"
          >
            {GRADES.map((grade) => {
              const active = intentScore.minimumGrade === grade;
              return (
                <button
                  key={grade}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setIntent({ minimumGrade: grade })}
                  title={`Score ${gradeBandLabel(grade)}`}
                  className={cn(
                    "h-9 rounded-md border text-[13px] font-semibold transition-colors",
                    active
                      ? "border-success-600 bg-success-50 text-success-700 ring-1 ring-inset ring-success-600"
                      : "border-line-strong bg-surface text-content-secondary hover:bg-surface-hover",
                  )}
                >
                  {grade}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[12px] text-content-muted">
            This helps focus your campaign on high-quality prospects.
          </p>
          {errors.minimumGrade && (
            <p className="mt-1.5 text-[12px] text-danger-600">{errors.minimumGrade}</p>
          )}
        </div>

        {/* --------------------------------------------- intent categories */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600"
            >
              <Target className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">Intent categories</h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Select the intent categories to look for.
              </p>
            </div>
          </div>

          <div className="mt-3.5">
            {options.intentCategories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line bg-surface-sunken/50 px-3.5 py-3 text-[12.5px] text-content-muted">
                No active intent categories.{" "}
                <Link
                  href="/app/find-leads?view=intent"
                  className="font-medium text-content-accent underline-offset-4 hover:underline"
                >
                  Manage intent
                </Link>
              </div>
            ) : (
              <TokenSelect
                id="intent-categories"
                label="intent categories"
                values={selectedNames}
                options={options.intentCategories.map((row) => row.name)}
                max={12}
                placeholder="Add intent categories"
                emptyHint="No categories selected"
                onChange={(names) =>
                  setIntent({
                    intentCategoryIds: names
                      .map((name) => idByName.get(name))
                      .filter((id): id is string => Boolean(id)),
                  })
                }
              />
            )}
            {errors.intentCategoryIds && (
              <p className="mt-1.5 text-[12px] text-danger-600">{errors.intentCategoryIds}</p>
            )}
          </div>
        </div>

        {/* -------------------------------------------- intent requirement */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600"
            >
              <Zap className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">Intent requirement</h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Choose whether prospects must have intent signals.
              </p>
            </div>
          </div>

          <div className="mt-3.5 space-y-3">
            <RadioRow
              name="intent-required"
              value="required"
              checked={intentScore.intentRequired}
              onChange={() => setIntent({ intentRequired: true })}
              title="Intent required"
              description="Only include prospects with at least one matching intent signal."
            />
            <RadioRow
              name="intent-required"
              value="optional"
              checked={!intentScore.intentRequired}
              onChange={() => setIntent({ intentRequired: false })}
              title="Intent optional"
              description="Include prospects with or without intent signals (intent will boost score)."
            />
          </div>
        </div>

        {/* ------------------------------------------------ intent max age */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600"
            >
              <Clock className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">Maximum intent age</h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Only consider intent signals detected within this timeframe.
              </p>
            </div>
          </div>

          <div className="mt-3.5">
            <Select
              aria-label="Maximum intent age"
              value={String(intentScore.maxIntentAgeDays)}
              onChange={(event) =>
                setIntent({ maxIntentAgeDays: Number(event.target.value) })
              }
            >
              {INTENT_AGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-[12px] text-content-muted">
              Older intent signals will not contribute to scoring or targeting. Where a
              category expires sooner, its own rule wins.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------ review threshold */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600"
            >
              <TriangleAlert className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">Review threshold</h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Send prospects below this score to manual review instead of outreach.
              </p>
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              aria-label="Review threshold"
              aria-invalid={Boolean(errors.reviewThreshold)}
              value={intentScore.reviewThreshold}
              onChange={(event) =>
                setIntent({
                  reviewThreshold: Math.max(
                    0,
                    Math.min(100, Number(event.target.value) || 0),
                  ),
                })
              }
              className="max-w-40"
            />
            <span className="text-[13px] text-content-muted">/ 100</span>
          </div>
          <p className="mt-2 text-[12px] text-content-muted">
            Prospects scoring below this threshold will be marked for review.
          </p>
          {errors.reviewThreshold && (
            <p className="mt-1.5 text-[12px] text-danger-600">{errors.reviewThreshold}</p>
          )}
        </div>

        {/* ---------------------------------------------- eligibility rules */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600"
            >
              <ClipboardList className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-content">
                Eligibility rule preview
              </h3>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Preview how prospects will be included in this campaign.
              </p>
            </div>
          </div>

          <ul className="mt-3.5 space-y-2 rounded-lg bg-success-50/60 px-3.5 py-3">
            {rules.map((rule) => (
              <li
                key={rule.key}
                className="flex gap-2 text-[12.5px] leading-snug text-content-secondary"
              >
                <span
                  aria-hidden
                  className="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded-full bg-success-500 text-white"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
                <span>{rule.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>

      <aside className="space-y-4">
        <RailCard
          icon={Lightbulb}
          title="Intent category insights"
          description="Selected categories and their recent activity."
          tone="warning"
        >
          {loading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : insights.length === 0 ? (
            <p className="text-[12.5px] text-content-muted">
              Select intent categories to see how active they have been.
            </p>
          ) : (
            <ul className="space-y-3">
              {insights.map((insight, index) => {
                const max = Math.max(...insights.map((row) => row.recentSignals), 1);
                const width = Math.max(6, Math.round((insight.recentSignals / max) * 100));
                const bar = ["bg-success-500", "bg-info-500", "bg-purple-500"][index % 3];

                return (
                  <li key={insight.id} className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-content-secondary">
                      {insight.name}
                    </span>
                    <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                      <span
                        className={cn("block h-full rounded-full", bar)}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-[12px] font-medium tabular-nums text-content">
                      {insight.recentSignals}
                    </span>
                    <span
                      className={cn(
                        "w-11 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums",
                        // No prior window means the trend is unknown, not flat.
                        insight.trend === null
                          ? "bg-surface-sunken text-content-muted"
                          : insight.trend >= 0
                            ? "bg-success-50 text-success-700"
                            : "bg-danger-50 text-danger-700",
                      )}
                    >
                      {insight.trend === null
                        ? "—"
                        : `${insight.trend >= 0 ? "+" : ""}${Math.round(insight.trend * 100)}%`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </RailCard>

        <RailCard
          icon={Gauge}
          title="Scoring preview"
          description="Estimated prospect distribution based on your criteria."
        >
          {loading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : estimate?.available && estimate.existing > 0 ? (
            <div className="flex items-center gap-4">
              <GradeRing
                total={estimate.existing}
                distribution={estimate.gradeDistribution}
              />
              <ul className="min-w-0 flex-1 space-y-1.5">
                {estimate.gradeDistribution.map((row) => (
                  <li key={row.grade} className="flex items-center gap-2 text-[12px]">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: GRADE_COLOURS[row.grade] }}
                    />
                    <span className="w-6 shrink-0 font-medium text-content">{row.grade}</span>
                    <span className="shrink-0 text-[11px] text-content-subtle">
                      ({gradeBandLabel(row.grade)})
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-content-muted">
                      {row.percent}%
                    </span>
                    <span className="w-10 shrink-0 text-right font-medium tabular-nums text-content">
                      {formatCount(row.count)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[12.5px] text-content-muted">
              No scored prospects match this audience yet, so there is no distribution to
              show.
            </p>
          )}
        </RailCard>

        <RailCard icon={BookOpen} title="Tips for better results" tone="warning">
          <TickList items={TIPS} />
        </RailCard>
      </aside>
    </div>
  );
}

/** The donut. Pure SVG — no chart library for six numbers. */
function GradeRing({
  total,
  distribution,
}: {
  total: number;
  distribution: { grade: Grade; count: number; percent: number }[];
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;

  // Each arc's offset is derived from the segments before it rather than
  // accumulated in a mutable variable: nothing about rendering should depend
  // on how many times React happens to run the component.
  const arcs = distribution.map((row, index) => {
    const before = distribution
      .slice(0, index)
      .reduce((total, previous) => total + previous.percent, 0);

    return {
      ...row,
      length: (row.percent / 100) * circumference,
      offset: (before / 100) * circumference,
    };
  });

  return (
    <div className="relative size-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="size-full -rotate-90" role="img" aria-hidden>
        <circle
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          stroke="var(--lr-neutral-100)"
          strokeWidth="14"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.grade}
            cx="46"
            cy="46"
            r={radius}
            fill="none"
            stroke={GRADE_COLOURS[arc.grade]}
            strokeWidth="14"
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-bold leading-none tabular-nums text-content">
          {formatCount(total)}
        </span>
        <span className="mt-0.5 text-[9.5px] leading-none text-content-muted">
          Total prospects
        </span>
      </div>
      {/* The chart is decorative; this is the number a screen reader gets. */}
      <p className="sr-only">
        {formatCount(total)} prospects.{" "}
        {distribution
          .map((row) => `Grade ${row.grade}: ${row.percent}%, ${row.count} prospects`)
          .join(". ")}
      </p>
    </div>
  );
}
