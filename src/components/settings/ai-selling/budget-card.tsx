"use client";

import * as React from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import {
  BUDGET_SCOPE_COPY,
  EDITABLE_BUDGET_SCOPES,
  budgetProblems,
  formatMinor,
  minorToPounds,
  parseBudgetForm,
  type EditableBudgetScope,
} from "@/lib/settings/ai-selling";
import { saveBudgetsAction } from "@/lib/settings/ai-selling-actions";
import type { BudgetView } from "@/lib/settings/ai-selling-queries";
import { useSettingsSave } from "./use-settings-save";

/** Month-to-date spend from `ai_usage.get`, or why it is not shown. */
export type SpendSnapshot =
  | { state: "ok"; spentGbp: number; ceilingGbp: number | null; ceilingSource: string | null }
  | { state: "error" }
  | { state: "hidden" };

const SOURCE_LABEL: Record<string, string> = {
  workspace: "your workspace ceiling",
  plan: "your plan's ceiling",
  emergency: "the platform's hard stop",
};

function gbp(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

/**
 * AI budget: the workspace's own ceilings, written as workspace rows in
 * `ai_budgets` through `ai_budget.update`. The plan and platform defaults are
 * shown read-only beside each, because they apply whatever is set here. A
 * blank field means "use the default".
 */
export function BudgetCard({
  view,
  spend,
  canManage,
}: {
  view: BudgetView;
  spend: SpendSnapshot;
  canManage: boolean;
}) {
  const initial = React.useMemo(
    () =>
      Object.fromEntries(view.rows.map((row) => [row.scope, minorToPounds(row.workspaceMinor)])) as Record<
        EditableBudgetScope,
        string
      >,
    [view.rows],
  );
  const [form, setForm] = React.useState(initial);
  const { save, saving, fieldErrors, setFieldErrors } = useSettingsSave();
  const dirty = EDITABLE_BUDGET_SCOPES.some((scope) => form[scope] !== initial[scope]);

  const defaults = Object.fromEntries(view.rows.map((row) => [row.scope, row.platformMinor]));

  async function onSave() {
    const parsed = parseBudgetForm(form);
    if (!parsed.ok) {
      setFieldErrors(parsed.errors as Record<string, string>);
      return;
    }
    const problems = budgetProblems(parsed.values, defaults);
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems as Record<string, string>);
      return;
    }
    await save(() => saveBudgetsAction(form));
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Wallet}
          title="AI budget"
          description="Limits on what AI may cost. When a limit is reached the AI step is skipped or handed to a person; nothing is sent that would not have been."
        />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line px-3 py-2.5">
            <p className="text-[11.5px] text-content-muted">Spent this month</p>
            {spend.state === "ok" ? (
              <>
                <p className="text-[18px] font-semibold tabular-nums text-content">{gbp(spend.spentGbp)}</p>
                <p className="text-[11.5px] text-content-subtle">
                  {spend.ceilingGbp !== null
                    ? `of ${gbp(spend.ceilingGbp)}, ${SOURCE_LABEL[spend.ceilingSource ?? ""] ?? "the binding ceiling"}`
                    : "No monthly ceiling applies."}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[12.5px] text-content-muted">
                {spend.state === "hidden"
                  ? "Spend is visible to members and above."
                  : "Spend could not be read right now."}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <p className="text-[11.5px] text-content-muted">Plan ceiling ({view.plan.key})</p>
            <p className="text-[18px] font-semibold tabular-nums text-content">{formatMinor(view.plan.minor)}</p>
            <p className="text-[11.5px] text-content-subtle">Set by your plan. Always applies.</p>
          </div>
          <div className="rounded-lg border border-line px-3 py-2.5">
            <p className="text-[11.5px] text-content-muted">Platform hard stop</p>
            <p className="text-[18px] font-semibold tabular-nums text-content">{formatMinor(view.emergencyMinor)}</p>
            <p className="text-[11.5px] text-content-subtle">A safety limit on every workspace.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {view.rows.map((row) => (
            <FormField
              key={row.scope}
              label={BUDGET_SCOPE_COPY[row.scope].label}
              htmlFor={`budget-${row.scope}`}
              error={fieldErrors[row.scope]}
              hint={`${BUDGET_SCOPE_COPY[row.scope].description} Default: ${formatMinor(row.platformMinor)}.`}
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-content-muted">
                  £
                </span>
                <Input
                  id={`budget-${row.scope}`}
                  inputMode="decimal"
                  placeholder={row.platformMinor === null ? "No limit" : minorToPounds(row.platformMinor)}
                  className="pl-7"
                  disabled={!canManage}
                  value={form[row.scope]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({ ...current, [row.scope]: value }));
                  }}
                />
              </div>
            </FormField>
          ))}
        </div>
        <p className="text-[12px] text-content-subtle">
          Leave a field blank to use the default. Per-lead limits can be tightened below the platform default but not
          raised above it.
        </p>
        <p className="text-[12px] text-content-subtle">
          These limits are in pounds; your plan&apos;s AI allowance, counted in tokens, is a separate meter in{" "}
          <Link
            href="/app/settings?section=billing"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Billing &amp; Usage
          </Link>
          , and AI stops at whichever limit is reached first.
        </p>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={() => setForm(initial)}>
            Reset
          </Button>
          <Button size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
            Save limits
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
