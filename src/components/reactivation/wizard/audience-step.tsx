"use client";

import * as React from "react";
import {
  ArrowRight,
  BarChart3,
  Ban,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  MessageSquare,
  Plus,
  PieChart,
  Target,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/feedback";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import {
  type AudienceFilter,
  type AudiencePreview,
} from "@/lib/campaigns/types";
import {
  audienceChecklist,
  BREAKDOWN_DIMENSIONS,
  leadStatusLabel,
  suppressionRuleCards,
  type BreakdownDimension,
} from "@/lib/campaigns/reactivation-audience";
import type { WizardState } from "./state";
import { CsvImportPanel } from "./csv-import";
import {
  BigFigure,
  CheckItem,
  IconTile,
  RailCard,
  ShareBar,
  StepSection,
  SummaryRow,
  SummaryTable,
  formatCount,
} from "./pieces";

/** The windows a reactivation campaign is actually ever set to. */
const LEAD_AGE_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
] as const;

export type FilterOptions = {
  services: { id: string; name: string }[];
  sources: { id: string; label: string }[];
};

/* ------------------------------------------------------- source cards --- */

function SourceCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        selected
          ? "border-success-500 bg-success-50/60"
          : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="audience-source"
          id={id}
          checked={selected}
          onChange={onSelect}
          className="accent-[var(--lr-success-500)] mt-1 size-4 shrink-0 cursor-pointer"
        />
        <IconTile icon={Icon} tone={selected ? "success" : "info"} />
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className="text-content block text-[14px] font-semibold">
            {title}
          </span>
          <span className="text-content-muted mt-0.5 block text-[12px]">
            {description}
          </span>
        </label>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------ filter fields --- */

function FilterField({
  icon: Icon,
  label,
  htmlFor,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-line bg-surface flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
      <IconTile icon={Icon} tone="info" className="size-8 rounded-md" />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="text-content-muted block text-[11px] font-medium"
        >
          {label}
        </label>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function FilterToggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="border-line bg-surface flex items-center gap-2.5 rounded-lg border px-3 py-2.5">
      <IconTile icon={Icon} tone="info" className="size-8 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="text-content text-[12px] font-medium">{label}</p>
        <p className="text-content-muted mt-0.5 text-[11px]">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        label={label}
        className={checked ? "bg-success-500" : undefined}
      />
    </div>
  );
}

const BARE_FIELD =
  "h-7 border-0 bg-transparent px-0 shadow-none focus:ring-0 focus:border-0 text-[13px] font-medium";

/* ------------------------------------------------------------- step 1 --- */

export function AudienceStep({
  state,
  patch,
  patchFilters,
  options,
  preview,
  loading,
  error,
  fieldErrors,
  onCsvBusyChange,
}: {
  state: WizardState;
  patch: (patch: Partial<WizardState>) => void;
  patchFilters: (patch: Partial<AudienceFilter>) => void;
  options: FilterOptions;
  preview: AudiencePreview | null;
  loading: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onCsvBusyChange: (busy: boolean) => void;
}) {
  const [showMoreFilters, setShowMoreFilters] = React.useState(
    Boolean(
      state.audienceFilters.createdAfter ||
        state.audienceFilters.createdBefore ||
        state.audienceFilters.markedLost,
    ),
  );
  const [dimension, setDimension] =
    React.useState<BreakdownDimension>("service");

  const filters = state.audienceFilters;
  const eligible = preview?.eligible ?? 0;
  const cooldownDays = filters.lastContactedBeforeDays;

  const serviceName =
    options.services.find((service) => service.id === filters.serviceId)?.name ??
    null;
  const sourceName =
    options.sources.find((source) => source.id === filters.sourceId)?.label ??
    null;

  const checklist = audienceChecklist(state.audienceSource, {
    olderThanDays: filters.olderThanDays,
    statuses: filters.statuses,
    serviceName,
    sourceName,
    noReply: filters.noReply,
    markedLost: filters.markedLost,
    notBooked: filters.notBooked,
  });

  const breakdown = preview?.breakdowns[dimension] ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_392px]">
      {/* ------------------------------------------------------- main --- */}
      <div className="bg-surface border-line divide-line-subtle divide-y rounded-xl border shadow-xs">
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            <IconTile icon={Users} tone="info" />
            <div>
              <h2 className="text-content text-[17px] font-semibold">
                Step 1 — Audience
              </h2>
              <p className="text-content-muted mt-0.5 text-[13px]">
                Choose who you want to reach with this reactivation campaign.
              </p>
            </div>
          </div>
        </div>

        {/* campaign name */}
        <div className="px-5 py-4">
          <label
            htmlFor="campaign-name"
            className="text-content block text-[13px] font-medium"
          >
            Campaign name
          </label>
          <Input
            id="campaign-name"
            className="mt-1.5"
            value={state.campaignName}
            maxLength={80}
            placeholder="Autumn Roof Check"
            aria-invalid={Boolean(fieldErrors.campaignName)}
            aria-describedby={
              fieldErrors.campaignName ? "campaign-name-error" : undefined
            }
            onChange={(event) => patch({ campaignName: event.target.value })}
          />
          {fieldErrors.campaignName ? (
            <p id="campaign-name-error" className="text-danger-600 mt-1 text-[12px]">
              {fieldErrors.campaignName}
            </p>
          ) : (
            <p className="text-content-muted mt-1 text-[12px]">
              Only your team sees this. It names the campaign on the
              reactivation list.
            </p>
          )}
        </div>

        {/* description — the line that appears on the card and in the list */}
        <div className="px-5 py-4">
          <label
            htmlFor="campaign-description"
            className="text-content block text-[13px] font-medium"
          >
            Description
            <span className="text-content-subtle ml-1.5 font-normal">
              optional
            </span>
          </label>
          <Textarea
            id="campaign-description"
            className="mt-1.5"
            rows={2}
            value={state.description}
            maxLength={280}
            placeholder="Re-engage past quote requests with a seasonal roof check offer."
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={
              fieldErrors.description
                ? "campaign-description-error"
                : "campaign-description-hint"
            }
            onChange={(event) => patch({ description: event.target.value })}
          />
          {fieldErrors.description ? (
            <p
              id="campaign-description-error"
              className="text-danger-600 mt-1 text-[12px]"
            >
              {fieldErrors.description}
            </p>
          ) : (
            <p
              id="campaign-description-hint"
              className="text-content-muted mt-1 text-[12px]"
            >
              One line on what this campaign is for. Shown on the campaign
              card.
            </p>
          )}
        </div>

        {/* audience name + tags */}
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-audience-label"
              className="text-content block text-[13px] font-medium"
            >
              Audience name
              <span className="text-content-subtle ml-1.5 font-normal">
                optional
              </span>
            </label>
            <Input
              id="campaign-audience-label"
              className="mt-1.5"
              value={state.audienceLabel}
              maxLength={160}
              placeholder="Past quote requests"
              aria-invalid={Boolean(fieldErrors.audienceLabel)}
              onChange={(event) => patch({ audienceLabel: event.target.value })}
            />
            <p className="text-content-muted mt-1 text-[12px]">
              {fieldErrors.audienceLabel ??
                "The label only — who is contacted comes from the rules below."}
            </p>
          </div>

          <div>
            <label
              htmlFor="campaign-tags"
              className="text-content block text-[13px] font-medium"
            >
              Tags
              <span className="text-content-subtle ml-1.5 font-normal">
                optional
              </span>
            </label>
            <Input
              id="campaign-tags"
              className="mt-1.5"
              value={state.tags}
              placeholder="Seasonal, Roofing"
              aria-invalid={Boolean(fieldErrors.tags)}
              onChange={(event) => patch({ tags: event.target.value })}
            />
            <p className="text-content-muted mt-1 text-[12px]">
              {fieldErrors.tags ?? "Comma separated, up to eight."}
            </p>
          </div>
        </div>

        {/* audience source */}
        <div className="px-5 py-4">
          <StepSection
            icon={Target}
            title="Audience source"
            description="Choose where to get your audience from."
          >
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">Audience source</legend>
              <SourceCard
                selected={state.audienceSource === "existing"}
                onSelect={() => patch({ audienceSource: "existing" })}
                icon={Users}
                title="Existing ClientTurn leads"
                description="Use leads from your ClientTurn account and apply filters to find the right audience."
              />
              <SourceCard
                selected={state.audienceSource === "csv"}
                onSelect={() => patch({ audienceSource: "csv" })}
                icon={FileSpreadsheet}
                title="Import from CSV"
                description="Upload a CSV file with your contacts to create a custom audience."
              >
                {/* Shown whether or not the card is selected: the design puts
                    the drop target in the card itself, and dropping a file is
                    what selects the source. */}
                <CsvImportPanel
                  upload={state.csvUpload}
                  onUploaded={(result) => {
                    // Importing a file is itself the choice of source, so the
                    // card selects rather than making the user click twice.
                    patch({ audienceSource: "csv", csvUpload: result });
                    patchFilters({ sourceId: result.sourceId, olderThanDays: 1 });
                  }}
                  onRemoved={() => {
                    patch({ csvUpload: null });
                    patchFilters({ sourceId: undefined });
                  }}
                  onBusyChange={onCsvBusyChange}
                />
              </SourceCard>
            </fieldset>
            {fieldErrors.csv && (
              <p role="alert" className="text-danger-600 text-[12px]">
                {fieldErrors.csv}
              </p>
            )}
            {state.audienceSource === "existing" && (
              <p className="text-content-muted text-[12px]">
                Not sure? Start with your existing ClientTurn leads — you can
                always import a custom list later.
              </p>
            )}
          </StepSection>
        </div>

        {/* filters */}
        <div className="px-5 py-4">
          <StepSection
            icon={BarChart3}
            title={
              state.audienceSource === "csv"
                ? "Imported list filters"
                : "Audience filters"
            }
            description="Narrow down your audience with filters. Only leads that match all selected criteria will be included."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <FilterField icon={Clock} label="Older than" htmlFor="filter-older">
                {/* A short list of sensible windows rather than a free number:
                    the answer is always "a few months", and a typed 4000 only
                    ever produced an empty audience. A value already saved
                    outside the list is still offered so it is never silently
                    changed. */}
                <Select
                  id="filter-older"
                  value={String(filters.olderThanDays)}
                  aria-invalid={Boolean(fieldErrors.olderThanDays)}
                  aria-describedby={
                    fieldErrors.olderThanDays ? "filter-older-error" : undefined
                  }
                  onChange={(event) =>
                    patchFilters({ olderThanDays: Number(event.target.value) })
                  }
                  className={BARE_FIELD}
                >
                  {LEAD_AGE_OPTIONS.some(
                    (option) => option.value === filters.olderThanDays,
                  ) ? null : (
                    <option value={filters.olderThanDays}>
                      {filters.olderThanDays} days
                    </option>
                  )}
                  {LEAD_AGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FilterField>

              <FilterField
                icon={BarChart3}
                label="Lead status"
                htmlFor="filter-status"
              >
                <Select
                  id="filter-status"
                  className={BARE_FIELD}
                  value={filters.statuses[0] ?? ""}
                  onChange={(event) =>
                    patchFilters({
                      statuses: event.target.value
                        ? [event.target.value as (typeof LEAD_STATUSES)[number]]
                        : [],
                    })
                  }
                >
                  <option value="">Not booked</option>
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {leadStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </FilterField>

              <FilterField icon={Wrench} label="Service" htmlFor="filter-service">
                <Select
                  id="filter-service"
                  className={BARE_FIELD}
                  value={filters.serviceId ?? ""}
                  onChange={(event) =>
                    patchFilters({ serviceId: event.target.value || undefined })
                  }
                >
                  <option value="">All services</option>
                  {options.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </Select>
              </FilterField>

              <FilterField icon={Target} label="Lead source" htmlFor="filter-source">
                <Select
                  id="filter-source"
                  className={BARE_FIELD}
                  value={filters.sourceId ?? ""}
                  disabled={state.audienceSource === "csv"}
                  onChange={(event) =>
                    patchFilters({ sourceId: event.target.value || undefined })
                  }
                >
                  <option value="">All sources</option>
                  {state.csvUpload && (
                    <option value={state.csvUpload.sourceId}>
                      {state.csvUpload.label}
                    </option>
                  )}
                  {options.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </Select>
              </FilterField>

              <FilterToggle
                icon={MessageSquare}
                label="Has no reply"
                description="No replies to any previous messages"
                checked={filters.noReply}
                onChange={(value) => patchFilters({ noReply: value })}
              />

              <FilterToggle
                icon={XCircle}
                label="Marked as lost"
                description="Previously marked as lost"
                checked={filters.markedLost}
                onChange={(value) => patchFilters({ markedLost: value })}
              />

              {showMoreFilters && (
                <>
                  <FilterToggle
                    icon={CheckCircle2}
                    label="Not booked"
                    description="Exclude anyone who ever booked"
                    checked={filters.notBooked}
                    onChange={(value) => patchFilters({ notBooked: value })}
                  />

                  <FilterField
                    icon={Clock}
                    label="Cooldown (not contacted in)"
                    htmlFor="filter-cooldown"
                  >
                    <Select
                      id="filter-cooldown"
                      className={BARE_FIELD}
                      value={String(cooldownDays)}
                      onChange={(event) =>
                        patchFilters({
                          lastContactedBeforeDays: Number(event.target.value),
                        })
                      }
                    >
                      {[7, 14, 30, 60, 90, 180, 365].map((days) => (
                        <option key={days} value={days}>
                          {days} days
                        </option>
                      ))}
                    </Select>
                  </FilterField>

                  <FilterField
                    icon={Clock}
                    label="Received after"
                    htmlFor="filter-after"
                  >
                    <Input
                      id="filter-after"
                      type="date"
                      className={BARE_FIELD}
                      value={filters.createdAfter ?? ""}
                      max={filters.createdBefore}
                      onChange={(event) =>
                        patchFilters({
                          createdAfter: event.target.value || undefined,
                        })
                      }
                    />
                  </FilterField>
                </>
              )}
            </div>

            {fieldErrors.olderThanDays && (
              <p id="filter-older-error" className="text-danger-600 text-[12px]">
                {fieldErrors.olderThanDays}
              </p>
            )}

            {!showMoreFilters && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowMoreFilters(true)}
              >
                <Plus className="size-3.5" aria-hidden />
                Add another filter
              </Button>
            )}
          </StepSection>
        </div>

        {/* suppression */}
        <div className="px-5 py-4">
          <StepSection
            icon={Ban}
            tone="danger"
            title="Automatic exclusions (suppression rules)"
            description="The following contacts will be automatically excluded from your campaign."
          >
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {suppressionRuleCards(cooldownDays).map((rule) => (
                <CheckItem key={rule.reason} label={rule.label} />
              ))}
            </ul>
          </StepSection>
        </div>

        {/* eligibility strip */}
        <div className="px-5 py-4">
          {error ? (
            <div
              role="alert"
              className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-3.5 py-3 text-[13px]"
            >
              {error}
            </div>
          ) : loading ? (
            <Skeleton className="h-14 w-full rounded-lg" />
          ) : (
            <div
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3",
                eligible > 0
                  ? "border-success-100 bg-success-50"
                  : "border-danger-100 bg-danger-50",
              )}
            >
              <IconTile
                icon={eligible > 0 ? Users : XCircle}
                tone={eligible > 0 ? "success" : "danger"}
              />
              <div className="min-w-0 flex-1">
                {eligible > 0 ? (
                  <>
                    <p className="text-content text-[14px]">
                      <strong className="lr-tabular font-semibold">
                        {formatCount(eligible)}
                      </strong>{" "}
                      estimated eligible contacts
                    </p>
                    <p className="text-content-muted mt-0.5 text-[12px]">
                      Based on your filters and suppression rules. This is an
                      estimate and may change — the audience is recalculated
                      when you launch.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-danger-700 text-[14px] font-medium">
                      No eligible contacts match this audience.
                    </p>
                    <p className="text-content-muted mt-0.5 text-[12px]">
                      Widen the filters — try a shorter age, a different status,
                      or turn off &ldquo;has no reply&rdquo;.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
          {preview?.cappedAt && (
            <p className="text-warning-700 mt-2 text-[12px]">
              A single campaign is capped at {formatCount(preview.cappedAt)}{" "}
              contacts. The newest matching leads are used.
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- rail --- */}
      <div className="space-y-4">
        <RailCard
          icon={BarChart3}
          title="Audience estimate"
          description="Based on your current filters and suppression rules."
        >
          {loading || !preview ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : (
            <>
              <BigFigure
                value={formatCount(preview.eligible)}
                caption="estimated eligible leads"
                tone={preview.eligible > 0 ? "success" : "danger"}
              />
              <div className="mt-3">
                <SummaryTable>
                  <SummaryRow
                    label="Total ClientTurn leads"
                    value={formatCount(preview.totalLeads)}
                  />
                  <SummaryRow
                    label="After filters"
                    value={formatCount(preview.matched)}
                  />
                  <SummaryRow
                    label="Automatically suppressed"
                    value={formatCount(preview.suppressedTotal)}
                  />
                  <SummaryRow
                    label="Estimated eligible"
                    value={formatCount(preview.eligible)}
                    emphasis
                  />
                </SummaryTable>
              </div>
            </>
          )}
        </RailCard>

        <RailCard
          icon={PieChart}
          title="Audience breakdown"
          description="Estimated eligible leads by key fields."
        >
          <div
            role="tablist"
            aria-label="Breakdown dimension"
            className="border-line bg-surface-sunken grid grid-cols-4 gap-1 rounded-lg border p-1"
          >
            {BREAKDOWN_DIMENSIONS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={dimension === entry.key}
                onClick={() => setDimension(entry.key)}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
                  dimension === entry.key
                    ? "bg-surface text-content border-success-500 border shadow-xs"
                    : "text-content-muted hover:text-content",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {loading || !preview ? (
            <Skeleton className="mt-3 h-28 w-full rounded-lg" />
          ) : breakdown.length === 0 ? (
            <p className="text-content-muted mt-3 text-[12px]">
              Nothing to break down yet — no leads match these filters.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {breakdown.map((entry) => (
                <li key={entry.key} className="flex items-center gap-2.5">
                  <span className="text-content-secondary w-28 shrink-0 truncate text-[12px]">
                    {entry.label}
                  </span>
                  <ShareBar share={entry.share} />
                  <span className="lr-tabular text-content w-10 shrink-0 text-right text-[12px] font-medium">
                    {formatCount(entry.count)}
                  </span>
                  <span className="lr-tabular text-content-muted w-8 shrink-0 text-right text-[12px]">
                    {entry.share}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        <RailCard
          icon={CheckCircle2}
          tone={eligible > 0 ? "success" : "neutral"}
          title={eligible > 0 ? "Ready to continue?" : "Not ready yet"}
          description={
            eligible > 0
              ? "You're all set to move to the next step."
              : "Adjust your filters until at least one contact is eligible."
          }
        >
          <ul className="space-y-2">
            {checklist.map((item) => (
              <CheckItem key={item} label={item} done={eligible > 0} />
            ))}
          </ul>
          {eligible > 0 && (
            <p className="text-content-muted mt-3 flex items-center gap-1.5 text-[12px]">
              Next: write your message
              <ArrowRight className="size-3" aria-hidden />
            </p>
          )}
        </RailCard>
      </div>
    </div>
  );
}
