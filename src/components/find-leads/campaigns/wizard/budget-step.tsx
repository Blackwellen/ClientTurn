"use client";

import * as React from "react";
import Link from "next/link";
import { Calculator, CircleDollarSign, Gauge, Info, TriangleAlert } from "lucide-react";
import { Input, Switch } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  formatCount,
  formatMoneyMinor,
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
  "Provider costs are estimates and may vary by data provider",
  "You'll be notified before any limits are reached",
  "Auto overage and optimisation are disabled by default",
] as const;

/**
 * Step 5 — Budget & Limits.
 *
 * Every ceiling on this screen came from the server. The inputs are requests,
 * clamped on the way in and re-checked at launch, so a hand-edited value can
 * never buy more than the plan allows. The two switches at the bottom are the
 * only ones in the wizard that can cost money, and both are off.
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
  const summary = summariseCampaignBudget(draft, context.costPerProspectMinor);

  const setBudget = (patch: Partial<CampaignDraft["budget"]>) =>
    onChange((current) => ({ ...current, budget: { ...current.budget, ...patch } }));

  const number = (value: string, max: number) =>
    Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
      <SectionCard
        icon={CircleDollarSign}
        title="Budget and limits"
        description="Set how many prospects to reach, your budget and safety limits. These controls help you stay within your plan and protect deliverability."
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
          label="Provider cost ceiling"
          description="Maximum spend on data enrichment and external providers for this campaign."
          error={errors.providerCostCeilingMinor}
          footnote={`Based on your plan limits. Estimated cost: ~${formatMoneyMinor(context.costPerProspectMinor)} per prospect.`}
          control={
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-content-muted">
                  £
                </span>
                <Input
                  id="provider-ceiling"
                  type="number"
                  min={0}
                  step={1}
                  aria-label="Provider cost ceiling in pounds"
                  aria-invalid={Boolean(errors.providerCostCeilingMinor)}
                  value={Math.round(budget.providerCostCeilingMinor / 100)}
                  onChange={(event) =>
                    setBudget({
                      providerCostCeilingMinor:
                        number(event.target.value, 100000) * 100,
                    })
                  }
                  className="w-32 pl-6 text-right tabular-nums"
                />
              </div>
              <span className="shrink-0 text-[13px] tabular-nums text-content-muted">
                / {formatMoneyMinor(ceilings.providerCeilingMinor)}
              </span>
            </div>
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

        <ToggleRow
          label="Auto overage"
          description="Allow this campaign to continue if limits are reached."
          checked={budget.autoOverage}
          disabled={!ceilings.overageAvailable}
          onChange={(autoOverage) => setBudget({ autoOverage })}
          error={errors.autoOverage}
          note={
            ceilings.overageAvailable ? (
              <NoteBox icon={TriangleAlert} tone="warning">
                Off by default. Turn on to allow automatic overage charges when limits are
                reached.
              </NoteBox>
            ) : (
              <NoteBox icon={TriangleAlert} tone="warning">
                Additional usage is switched off for this account, so this cannot be enabled
                here.{" "}
                <Link
                  href="/app/settings?view=billing"
                  className="font-medium underline underline-offset-2"
                >
                  Billing &amp; Usage
                </Link>
              </NoteBox>
            )
          }
        />

        <ToggleRow
          label="Auto optimize"
          description="Allow the system to automatically optimise send times, variant selection and prospect ordering."
          checked={budget.autoOptimize}
          onChange={(autoOptimize) => setBudget({ autoOptimize })}
          note={
            <NoteBox icon={Info} tone="info">
              Off by default for budget-affecting behaviour. If enabled, optimisation will
              remain within your set limits — it can never raise spend, enable overage or
              weaken contact rules.
            </NoteBox>
          }
        />
      </SectionCard>

      <aside className="space-y-4">
        <RailCard
          icon={Calculator}
          title="Budget summary"
          description="Estimated usage for this campaign."
          tone="info"
        >
          <dl className="space-y-0">
            <SummaryRow
              label="Prospects to source"
              value={formatCount(summary.prospectsToSource)}
            />
            <SummaryRow
              label="Estimated provider cost"
              value={
                <span>
                  {formatMoneyMinor(summary.providerCostMinor)}
                  <span className="block text-[11px] font-normal text-content-muted">
                    (~{formatMoneyMinor(summary.costPerProspectMinor)} per prospect)
                  </span>
                </span>
              }
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
                    (from tenant allowance)
                  </span>
                </span>
              }
            />
          </dl>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-success-50 px-3 py-2.5">
            <span className="text-[12.5px] font-medium text-content">
              Total estimated cost
            </span>
            <span className="text-[14px] font-bold tabular-nums text-success-700">
              {formatMoneyMinor(summary.totalCostMinor)}
            </span>
          </div>
        </RailCard>

        <RailCard icon={Gauge} title="Plan usage">
          <div className="space-y-3">
            {context.meters.map((meter) => (
              <Meter
                key={meter.key}
                label={meter.label}
                used={meter.used}
                limit={meter.limit}
                format={meter.money ? formatMoneyMinor : formatCount}
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
        {error && <p className="mt-1.5 text-[12px] text-danger-600">{error}</p>}
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
