"use client";

import * as React from "react";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  MIN_GROSS_MARGIN,
  SIMULATOR_PLANS,
  annualPriceFor,
  planInputFor,
  simulatePlan,
  type SimulatorPlan,
} from "@/lib/admin/economics-model";
import type { PlanCostInput } from "@/lib/billing/unit-costs";
import { gbp, percent } from "./format";

const PLAN_NAME: Record<SimulatorPlan, string> = { starter: "Starter", growth: "Growth", pro: "Pro" };

type Draft = {
  monthlyPrice: string;
  annual: boolean;
  leadLimit: string;
  smsSegmentAllowance: string;
  aiTokenAllowance: string;
  verifiedProspects: string;
};

function draftFor(plan: SimulatorPlan): Draft {
  const input = planInputFor(plan);
  return {
    monthlyPrice: String(input.monthlyPrice),
    annual: input.yearlyPrice !== null,
    leadLimit: String(input.leadLimit),
    smsSegmentAllowance: String(input.smsSegmentAllowance),
    aiTokenAllowance: String(input.aiTokenAllowance),
    verifiedProspects: String(input.verifiedProspects),
  };
}

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The pricing simulator. Read-only: it never changes a plan, and it has no
 * server action to call. It runs `planCost()` from `unit-costs.ts` -- the
 * function `tests/plan-margins.test.ts` asserts -- on an edited copy of a
 * plan's input, so with nothing edited it shows the tested figures exactly.
 */
export function PricingSimulator() {
  const [plan, setPlan] = React.useState<SimulatorPlan>("growth");
  const [draft, setDraft] = React.useState<Draft>(() => draftFor("growth"));

  const base = planInputFor(plan);
  const parsed = {
    monthlyPrice: toNumber(draft.monthlyPrice),
    leadLimit: toNumber(draft.leadLimit),
    smsSegmentAllowance: toNumber(draft.smsSegmentAllowance),
    aiTokenAllowance: toNumber(draft.aiTokenAllowance),
    verifiedProspects: toNumber(draft.verifiedProspects),
  };
  const invalid = Object.entries(parsed)
    .filter(([key, value]) => value === null || (key === "monthlyPrice" && value === 0))
    .map(([key]) => key);

  const input: PlanCostInput | null =
    invalid.length > 0
      ? null
      : {
          monthlyPrice: parsed.monthlyPrice as number,
          // Unchanged price: the plan's own annual price. Changed: the same
          // −15% rounding plans.ts applies.
          yearlyPrice: !draft.annual
            ? null
            : parsed.monthlyPrice === base.monthlyPrice
              ? base.yearlyPrice
              : annualPriceFor(parsed.monthlyPrice as number),
          leadLimit: parsed.leadLimit as number,
          smsSegmentAllowance: parsed.smsSegmentAllowance as number,
          whatsappMessageAllowance: base.whatsappMessageAllowance,
          aiTokenAllowance: parsed.aiTokenAllowance as number,
          verifiedProspects: parsed.verifiedProspects as number,
        };

  const result = input ? simulatePlan(input) : null;
  const edited = JSON.stringify(draft) !== JSON.stringify(draftFor(plan));

  const field = (key: keyof Omit<Draft, "annual">, label: string, hint: string, step = 1) => (
    <label className="block min-w-0">
      <span className="text-[12px] font-medium text-content-secondary">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        aria-invalid={invalid.includes(key)}
        className={cn(
          "mt-1 h-9 w-full rounded-lg border bg-surface px-3 text-[13px] tabular-nums text-content shadow-xs",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          invalid.includes(key) ? "border-danger-500" : "border-line",
        )}
      />
      <span className="mt-0.5 block text-[11px] text-content-subtle">{hint}</span>
    </label>
  );

  return (
    <div className="space-y-4 px-4 pb-4 sm:px-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[12px] font-medium text-content-secondary">Plan</span>
          <select
            value={plan}
            onChange={(event) => {
              const next = event.target.value as SimulatorPlan;
              setPlan(next);
              setDraft(draftFor(next));
            }}
            className="mt-1 h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-content shadow-xs"
          >
            {SIMULATOR_PLANS.map((key) => (
              <option key={key} value={key}>
                {PLAN_NAME[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex h-9 items-center gap-2 text-[12.5px] text-content-secondary">
          <input
            type="checkbox"
            checked={draft.annual}
            onChange={(event) => setDraft((current) => ({ ...current, annual: event.target.checked }))}
            className="size-4 rounded border-line"
          />
          Offer annual (−15%)
        </label>
        <button
          type="button"
          disabled={!edited}
          onClick={() => setDraft(draftFor(plan))}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium shadow-xs",
            "text-content-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset to {PLAN_NAME[plan]}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {field("monthlyPrice", "Price / month (£)", `Live: £${base.monthlyPrice}`)}
        {field("leadLimit", "Leads / month", `Live: ${base.leadLimit.toLocaleString("en-GB")}`)}
        {field("smsSegmentAllowance", "SMS segments", `Live: ${base.smsSegmentAllowance.toLocaleString("en-GB")}`)}
        {field("aiTokenAllowance", "AI tokens", `Live: ${base.aiTokenAllowance.toLocaleString("en-GB")}`, 100_000)}
        {field("verifiedProspects", "Verified prospects", `Live: ${base.verifiedProspects.toLocaleString("en-GB")}`)}
      </div>

      {!result ? (
        <p role="alert" className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-[12.5px] text-danger-700">
          Enter a price above £0 and a whole number (0 or more) for every allowance.
        </p>
      ) : (
        <>
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
              result.pass ? "border-success-100 bg-success-50" : "border-danger-100 bg-danger-50",
            )}
          >
            {result.pass ? (
              <CheckCircle2 className="size-5 shrink-0 text-success-600" aria-hidden />
            ) : (
              <XCircle className="size-5 shrink-0 text-danger-600" aria-hidden />
            )}
            <p className={cn("text-[13px] font-medium", result.pass ? "text-success-700" : "text-danger-700")}>
              {result.pass ? "Pass" : "Fail"}: the ≥{percent(MIN_GROSS_MARGIN, 0)} rule at maximum usage.
              <span className="ml-1 font-normal">
                Thinnest: {result.binding.interval} at {result.binding.usage} usage,{" "}
                {percent(result.binding.line.margin)}.
              </span>
            </p>
            {edited && (
              <Badge tone="info" dense>
                Edited · not saved anywhere
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    £ / month
                  </th>
                  {result.cells.map((cell) => (
                    <th key={`${cell.interval}-${cell.usage}`} scope="col" className="px-3 py-2 text-right font-medium">
                      {cell.interval} · {cell.usage}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle text-[12.5px] tabular-nums">
                {(
                  [
                    ["Revenue", "revenue"],
                    ["AI", "ai"],
                    ["SMS out", "smsOut"],
                    ["SMS in", "smsIn"],
                    ["Number", "number"],
                    ["WhatsApp", "whatsapp"],
                    ["Resend", "resend"],
                    ["Google Places", "places"],
                    ["Stripe", "stripe"],
                    ["Infrastructure (allocation)", "infrastructure"],
                    ["Total cost", "total"],
                    ["Gross profit", "grossProfit"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key} className={cn((key === "total" || key === "revenue") && "font-medium")}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-content-muted">
                      {label}
                    </th>
                    {result.cells.map((cell) => (
                      <td key={`${cell.interval}-${cell.usage}`} className="px-3 py-1.5 text-right text-content">
                        {gbp(cell.line[key], 2)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-content">
                    Margin
                  </th>
                  {result.cells.map((cell) => (
                    <td key={`${cell.interval}-${cell.usage}`} className="px-3 py-2 text-right">
                      <Badge tone={cell.pass ? "success" : "danger"} dense>
                        {percent(cell.line.margin)}
                      </Badge>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-content-subtle">
            Computed by <code>planCost()</code> in <code>unit-costs.ts</code>, the model{" "}
            <code>tests/plan-margins.test.ts</code> asserts (economics.md §1.1): max = every allowance used,
            typical = 50%. WhatsApp stays at the plan&apos;s included {base.whatsappMessageAllowance} (a paid add-on).
            Read-only: nothing here changes a plan or a price.
          </p>
        </>
      )}
    </div>
  );
}
