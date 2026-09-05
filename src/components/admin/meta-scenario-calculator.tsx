"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { FormField, Input, Select } from "@/components/ui/form";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/**
 * Internal what-if calculator (§57). Every number here is typed in by the
 * admin at run time — nothing is fetched or fabricated — so this is pure
 * arithmetic, not a projection presented as fact.
 */

const PLAN_CHOICES: Exclude<PlanId, "trial">[] = ["starter", "growth", "pro"];

function currency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function MetaScenarioCalculator() {
  const [monthlySpend, setMonthlySpend] = React.useState(2000);
  const [cpc, setCpc] = React.useState(1.5);
  const [landingConversion, setLandingConversion] = React.useState(20); // % of clicks -> trial
  const [trialToPaid, setTrialToPaid] = React.useState(25); // % of trials -> paid
  const [plan, setPlan] = React.useState<Exclude<PlanId, "trial">>("growth");
  const [estimatedMonthlyCogsPerCustomer, setEstimatedMonthlyCogsPerCustomer] =
    React.useState(15);

  const clicks = cpc > 0 ? monthlySpend / cpc : 0;
  const trials = clicks * (landingConversion / 100);
  const paidCustomers = trials * (trialToPaid / 100);
  const cac = paidCustomers > 0 ? monthlySpend / paidCustomers : null;
  const planPrice = PLANS[plan].monthlyPrice ?? 0;
  const mrrAdded = paidCustomers * planPrice;
  const monthlyContribution = planPrice - estimatedMonthlyCogsPerCustomer;
  const paybackMonths =
    cac !== null && monthlyContribution > 0 ? cac / monthlyContribution : null;

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Meta acquisition scenario"
          description="Every input below is typed in, not measured — treat the output as a what-if, never a guaranteed outcome."
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <FormField label="Monthly ad spend (£)" htmlFor="scenario-spend">
            <Input
              id="scenario-spend"
              type="number"
              min={0}
              value={monthlySpend}
              onChange={(event) => setMonthlySpend(Number(event.target.value) || 0)}
            />
          </FormField>
          <FormField label="Average CPC (£)" htmlFor="scenario-cpc">
            <Input
              id="scenario-cpc"
              type="number"
              min={0.01}
              step={0.01}
              value={cpc}
              onChange={(event) => setCpc(Number(event.target.value) || 0)}
            />
          </FormField>
          <FormField label="Landing → trial conversion (%)" htmlFor="scenario-landing">
            <Input
              id="scenario-landing"
              type="number"
              min={0}
              max={100}
              value={landingConversion}
              onChange={(event) => setLandingConversion(Number(event.target.value) || 0)}
            />
          </FormField>
          <FormField label="Trial → paid conversion (%)" htmlFor="scenario-trial">
            <Input
              id="scenario-trial"
              type="number"
              min={0}
              max={100}
              value={trialToPaid}
              onChange={(event) => setTrialToPaid(Number(event.target.value) || 0)}
            />
          </FormField>
          <FormField label="Plan mix" htmlFor="scenario-plan">
            <Select
              id="scenario-plan"
              value={plan}
              onChange={(event) => setPlan(event.target.value as Exclude<PlanId, "trial">)}
            >
              {PLAN_CHOICES.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name} ({currency(PLANS[id].monthlyPrice ?? 0)}/mo)
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Estimated COGS per customer/mo (£)" htmlFor="scenario-cogs">
            <Input
              id="scenario-cogs"
              type="number"
              min={0}
              value={estimatedMonthlyCogsPerCustomer}
              onChange={(event) =>
                setEstimatedMonthlyCogsPerCustomer(Number(event.target.value) || 0)
              }
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 border-line border-t pt-4">
          <ScenarioResult label="Clicks" value={Math.round(clicks).toLocaleString("en-GB")} />
          <ScenarioResult label="Trials" value={Math.round(trials).toLocaleString("en-GB")} />
          <ScenarioResult
            label="Paid customers"
            value={paidCustomers.toFixed(1)}
          />
          <ScenarioResult
            label="CAC"
            value={cac === null ? "—" : currency(cac)}
            warn={cac !== null && cac > 200}
          />
          <ScenarioResult label="MRR added" value={currency(mrrAdded)} />
          <ScenarioResult
            label="Monthly contribution / customer"
            value={currency(monthlyContribution)}
          />
          <ScenarioResult
            label="CAC payback"
            value={paybackMonths === null ? "—" : `${paybackMonths.toFixed(1)} months`}
            warn={paybackMonths !== null && paybackMonths > 12}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ScenarioResult({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-content-muted text-[12px]">{label}</p>
      <p className={`text-[15px] font-semibold ${warn ? "text-warning-600" : "text-content"}`}>
        {value}
      </p>
    </div>
  );
}
