"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { Calculator, Gauge, Info, SlidersHorizontal } from "lucide-react";
import { Input, Switch } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  formatCount,
  type CampaignDraft,
  type FieldErrors,
} from "@/lib/outreach/campaign-draft";
import {
  summariseCampaignBudget,
  type CampaignBudgetContext,
} from "@/lib/outreach/campaign-budget";
import { Meter, NoteBox, RailCard, SectionCard, SummaryRow, TickList } from "./pieces";

const THINGS_TO_KNOW = [
  "Limits help protect deliverability and your sender reputation",
  "Sourcing and messages count against your plan allowances",
  "You'll be notified before any limits are reached",
  "There is no overage: at a limit the campaign stops until the next period",
  "Optimisation is off by default",
] as const;

/**
 * Step 5 — Budget & Limits.
 *
 * Every ceiling on this screen came from the server. The inputs are requests,
 * clamped on the way in and re-checked at launch, so a hand-edited value can
 * never buy more than the plan allows. There is no overage (owner decision,
 * 2026-09-27): at a limit the campaign stops, so no switch here can let it
 * run past one. The draft's `autoOverage` field stays false and is not shown.
 *
 * No money on this screen (owner decision, 2026-09-30): ClientTurn's serving
 * costs — provider cost ceilings, cost per prospect, provider spend — are
 * admin-only. The customer sets counts against their own allowances; the
 * provider ceiling is applied server-side at launch.
 */
export function BudgetStep({
  draft,
  errors,
  context,
  onChange,
}: {
  draft: CampaignDraft;
  errors: FieldErrors;
  context: CampaignBudgetContext;
  onChange: (update: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const { budget } = draft;
  const { ceilings } = context;
  const summary = summariseCampaignBudget(draft);

  const setBudget = (patch: Partial<CampaignDraft["budget"]>) =>
    onChange((current) => ({ ...current, budget: { ...current.budget, ...patch } }));

  const number = (value: string, max: number) =>
    Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
      <SectionCard
        icon={SlidersHorizontal}
        title="Budget and limits"
        description="Set how many prospects to reach and your safety limits. These controls help you stay within your plan and protect deliverability."
        bodyClassName="divide-y divide-line-subtle"
      >
        <LimitRow
          label="Prospects per month/run"
          help="Total number of prospects to include in this campaign. Bounded by your sourcing entitlement."
          description="Total number of prospects to include in this campaign. Bounded by your sourcing entitlement."
          error={errors.prospectsPerRun}
          footnote={`You have ${formatCount(ceilings.prospectsRemaining)} prospects remaining this month.`}
          control={
            <NumberWithCeiling
              id="prospects-per-run"
              value={budget.prospectsPerRun}
              ceiling={ceilings.prospectsLimit}
              invalid={Boolean(errors.prospectsPerRun)}
              onChange={(value) => setBudget({ prospectsPerRun: number(value, 100000) })}
            />
          }
        />

        <LimitRow
          label="Daily contacts"
          description="Maximum number of outreach contacts per day. Limited by your mailbox health and system caps."
          error={errors.dailyContacts}
          footnote="Recommended: 20–100 per day."
          control={
            <NumberWithCeiling
              id="daily-contacts"
              value={budget.dailyContacts}
              ceiling={ceilings.dailyContactMax}
              invalid={Boolean(errors.dailyContacts)}
              onChange={(value) => setBudget({ dailyContacts: number(value, 2000) })}
            />
          }
        />

        <LimitRow
          label="Monthly contacts"
          description="Total outreach contacts for this campaign per month."
          error={errors.monthlyContacts}
          footnote={`You have ${formatCount(ceilings.monthlyContactsRemaining)} contacts remaining this month.`}
          control={
            <NumberWithCeiling
              id="monthly-contacts"
              value={budget.monthlyContacts}
              ceiling={ceilings.monthlyContactsLimit}
              invalid={Boolean(errors.monthlyContacts)}
              onChange={(value) => setBudget({ monthlyContacts: number(value, 200000) })}
            />
          }
        />

        <LimitRow
          label="Communication allowance"
          description="Reserve messaging allowance from your tenant plan for this campaign."
          error={errors.communicationAllowance}
          footnote={`You have ${formatCount(ceilings.communicationRemaining)} messages remaining this month.`}
          control={
            <NumberWithCeiling
              id="communication-allowance"
              value={budget.communicationAllowance}
              ceiling={ceilings.communicationLimit}
              invalid={Boolean(errors.communicationAllowance)}
              onChange={(value) => setBudget({ communicationAllowance: number(value, 1000000) })}
            />
          }
        />

        <div className="py-4">
          <NoteBox icon={Info} tone="info">
            There is no overage. When a limit is reached, this campaign stops until the
            next period, or until you upgrade your plan.
          </NoteBox>
        </div>

        <ToggleRow
          label="Auto optimize"
          description="Allow the system to automatically optimise send times, variant selection and prospect ordering."
          checked={budget.autoOptimize}
          onChange={(autoOptimize) => setBudget({ autoOptimize })}
          note={
            <NoteBox icon={Info} tone="info">
              Off by default for budget-affecting behaviour. If enabled, optimisation will
              remain within your set limits. It can never raise spend, go past a limit or
              weaken contact rules.
            </NoteBox>
          }
        />
      </SectionCard>

      <aside className="space-y-4">
        <RailCard
          icon={Calculator}
          title="Budget summary"
          description="Estimated allowance usage for this campaign."
          tone="info"
        >
          <dl className="space-y-0">
            <SummaryRow
              label="Prospects to source"
              value={formatCount(summary.prospectsToSource)}
            />
            <SummaryRow
              label="Outreach contacts"
              value={formatCount(summary.outreachContacts)}
            />
            <SummaryRow
              label="Estimated email credits"
              value={
                <span>
                  {formatCount(summary.emailCredits)}
                  <span className="block text-[11px] font-normal text-content-muted">
                    (from your plan allowance)
                  </span>
                </span>
              }
            />
          </dl>
          <p className="mt-2 rounded-lg bg-success-50 px-3 py-2.5 text-[12px] leading-snug text-content-secondary">
            These figures count against your plan allowances shown below.
          </p>
        </RailCard>

        <RailCard icon={Gauge} title="Plan usage">
          <div className="space-y-3">
            {context.meters.map((meter) => (
              <Meter
                key={meter.key}
                label={meter.label}
                used={meter.used}
                limit={meter.limit}
                format={formatCount}
              />
            ))}
          </div>
        </RailCard>

        <RailCard icon={Info} title="Things to know" tone="info">
          <TickList items={THINGS_TO_KNOW} />
        </RailCard>
      </aside>
    </div>
  );
}

function LimitRow({
  label,
  description,
  help,
  control,
  footnote,
  error,
}: {
  label: string;
  description: string;
  help?: string;
  control: React.ReactNode;
  footnote?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0 lg:max-w-[26rem]">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-semibold text-content">{label}</p>
          {help && (
            <Tooltip content={help}>
              <Info className="size-3.5 text-content-subtle" aria-hidden />
            </Tooltip>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-content-muted">{description}</p>
      </div>
      <div className="shrink-0 lg:text-right">
        {control}
        {error ? (
          <p className="mt-1.5 text-[12px] text-danger-600 lg:text-right">{error}</p>
        ) : footnote ? (
          <p className="mt-1.5 text-[12px] text-content-muted lg:text-right">{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}

function NumberWithCeiling({
  id,
  value,
  ceiling,
  invalid,
  onChange,
}: {
  id: string;
  value: number;
  ceiling: number;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        aria-invalid={invalid}
        aria-describedby={`${id}-ceiling`}
        onChange={(event) => onChange(event.target.value)}
        className="w-32 text-right tabular-nums"
      />
      <span id={`${id}-ceiling`} className="shrink-0 text-[13px] tabular-nums text-content-muted">
        / {formatCount(ceiling)}
      </span>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  note,
  error,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  note: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 last:pb-0 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0 lg:max-w-[26rem]">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-semibold text-content">{label}</p>
          <Info className="size-3.5 text-content-subtle" aria-hidden />
        </div>
        <p className="mt-1 text-[12px] leading-snug text-content-muted">{description}</p>
        <FormError message={error} className="mt-1.5" />
      </div>
      <div className={cn("flex shrink-0 items-start gap-3", "lg:max-w-[22rem]")}>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          label={label}
          tone="success"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">{note}</div>
      </div>
    </div>
  );
}
