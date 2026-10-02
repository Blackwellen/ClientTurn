"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import {
  BUDGET_SCOPE_COPY,
  EDITABLE_BUDGET_SCOPES,
  budgetProblems,
  creditLimitToField,
  formatCreditLimit,
  parseBudgetForm,
  type EditableBudgetScope,
} from "@/lib/settings/ai-selling";
import {
  formatCredits,
  TOKEN_STATE_LABEL,
  TOKEN_STATE_TONE,
  TOKEN_WARN_PERCENT,
  TOKEN_CRITICAL_PERCENT,
  type CreditSummary,
} from "@/lib/billing/tokens";
import { saveBudgetsAction } from "@/lib/settings/ai-selling-actions";
import type { BudgetView } from "@/lib/settings/ai-selling-queries";
import { formatInZone } from "@/lib/dates";
import { useSettingsSave } from "./use-settings-save";

/** The allowance as AI credits, or null when it could not be read. */
export type CreditSnapshot = (CreditSummary & { periodEnd: string }) | null;

/**
 * AI credits (owner decision, 2026-09-30): AI usage is shown in ClientTurn's
 * own unit only, never money or model tokens. The top half is the allowance
 * (used of included, top-up balance, % and warnings); the bottom half is the
 * workspace's own limits, set in credits and enforced in credits
 * (`lib/ai/credit-limits.ts`). Platform £ ceilings are admin-only.
 */
export function BudgetCard({
  view,
  credits,
  canManage,
}: {
  view: BudgetView;
  credits: CreditSnapshot;
  canManage: boolean;
}) {
  const initial = React.useMemo(
    () =>
      Object.fromEntries(view.rows.map((row) => [row.scope, creditLimitToField(row.workspaceCredits)])) as Record<
        EditableBudgetScope,
        string
      >,
    [view.rows],
  );
  const [form, setForm] = React.useState(initial);
  const { save, saving, fieldErrors, setFieldErrors } = useSettingsSave();
  const dirty = EDITABLE_BUDGET_SCOPES.some((scope) => form[scope] !== initial[scope]);

  const defaults = Object.fromEntries(view.rows.map((row) => [row.scope, row.platformCredits]));

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
          icon={Sparkles}
          title="AI credits"
          description="What the assistant has used this period, and your own limits on it. When a limit is reached the AI step is skipped or handed to a person; your rules keep running."
          action={
            credits ? (
              <Badge tone={TOKEN_STATE_TONE[credits.state] as never}>{TOKEN_STATE_LABEL[credits.state]}</Badge>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {credits ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-line px-3 py-2.5">
                <p className="text-[11.5px] text-content-muted">Used this period</p>
                <p className="text-[18px] font-semibold tabular-nums text-content">
                  {formatCredits(credits.usedCredits)}
                  <span className="text-[13px] font-medium text-content-muted">
                    {" "}
                    of {formatCredits(credits.grantedCredits)}
                  </span>
                </p>
                <p className="text-[11.5px] text-content-subtle">{credits.percentUsed}% used</p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2.5">
                <p className="text-[11.5px] text-content-muted">Included in your plan</p>
                <p className="text-[18px] font-semibold tabular-nums text-content">
                  {formatCredits(credits.includedCredits)}
                </p>
                <p className="text-[11.5px] text-content-subtle">
                  Renews {formatInZone(credits.periodEnd, { day: "numeric", month: "short" })}
                </p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2.5">
                <p className="text-[11.5px] text-content-muted">Top-up balance</p>
                <p className="text-[18px] font-semibold tabular-nums text-content">
                  {formatCredits(credits.topUpBalanceCredits)}
                </p>
                <p className="text-[11.5px] text-content-subtle">Bought credits carry over.</p>
              </div>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={credits.percentUsed}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="AI credits used"
            >
              <div
                className={
                  credits.state === "EXHAUSTED" || credits.state === "CRITICAL"
                    ? "h-full rounded-full bg-danger-500"
                    : credits.state === "APPROACHING"
                      ? "h-full rounded-full bg-warning-500"
                      : "h-full rounded-full bg-accent-500"
                }
                style={{ width: `${credits.percentUsed}%` }}
              />
            </div>
            {credits.state !== "HEALTHY" && (
              <p
                className={
                  credits.state === "APPROACHING"
                    ? "rounded-lg border border-warning-300 bg-warning-50/60 px-3 py-2 text-[12.5px] text-content"
                    : "rounded-lg border border-danger-300 bg-danger-50/60 px-3 py-2 text-[12.5px] text-content"
                }
              >
                {credits.state === "EXHAUSTED"
                  ? "AI credits are used up. The assistant has paused; your follow-up and qualification rules keep running. Top up to switch it back on."
                  : `Over ${credits.state === "CRITICAL" ? TOKEN_CRITICAL_PERCENT : TOKEN_WARN_PERCENT}% of this period's AI credits are used. Top up to avoid the assistant pausing before your renewal.`}{" "}
                <Link
                  href="/app/settings?section=billing#ai-tokens"
                  className="font-medium text-content-accent underline-offset-4 hover:underline"
                >
                  Buy AI credits
                </Link>
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-content-muted">AI credits could not be read right now.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {view.rows.map((row) => (
            <FormField
              key={row.scope}
              label={BUDGET_SCOPE_COPY[row.scope].label}
              htmlFor={`budget-${row.scope}`}
              error={fieldErrors[row.scope]}
              hint={`${BUDGET_SCOPE_COPY[row.scope].description} Default: ${formatCreditLimit(row.platformCredits)}.`}
            >
              <div className="relative">
                <Input
                  id={`budget-${row.scope}`}
                  inputMode="numeric"
                  placeholder={row.platformCredits === null ? "No limit" : creditLimitToField(row.platformCredits)}
                  className="pr-16"
                  disabled={!canManage}
                  value={form[row.scope]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({ ...current, [row.scope]: value }));
                  }}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-content-muted">
                  credits
                </span>
              </div>
            </FormField>
          ))}
        </div>
        <p className="text-[12px] text-content-subtle">
          Leave a field blank to use the default. Per-lead limits can be tightened below the default but not raised
          above it. Your plan&apos;s allowance and top-ups are in{" "}
          <Link
            href="/app/settings?section=billing#ai-tokens"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Billing &amp; Usage
          </Link>
          ; AI stops at whichever limit is reached first.
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
