"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Play, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  GRADES,
  checkPlanReadiness,
  formatMinor,
  planProblemSentence,
  type SearchPlan,
} from "@/lib/find-leads/plan";
import { startSourcingRunAction } from "@/lib/find-leads/actions";

/**
 * Sourcing controls, and the one button in the product that authorises
 * provider spend.
 *
 * The rule the whole panel serves (V4 §10.12): nothing here spends anything.
 * Every control below adjusts a plan that is inert until "Start sourcing run"
 * is pressed, and that is stated on the panel rather than left to be inferred.
 *
 * The Start button's disabled state is a courtesy. The server re-runs plan
 * readiness, entitlement and budget on every call, so a customer who edits the
 * DOM gets a refusal, not a run.
 */

export function SourcingControls({
  sessionId,
  plan,
  onChange,
  budget,
  canManage,
  saving,
}: {
  sessionId: string;
  plan: SearchPlan;
  onChange: (plan: SearchPlan) => void;
  budget: {
    maxTarget: number;
    maxProviderCostMinor: number;
    allowed: boolean;
    reason: string;
  };
  canManage: boolean;
  saving: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [starting, startTransition] = React.useTransition();

  const readiness = checkPlanReadiness(plan);
  const blocked = !readiness.ready || !budget.allowed || !canManage || saving;

  const start = () => {
    startTransition(async () => {
      const result = await startSourcingRunAction(sessionId);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      router.push(`/app/find-leads/runs/${result.data.runId}`);
    });
  };

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Settings2 className="size-3.5" />
          </span>
          <h2 className="text-[14.5px] font-semibold text-content">Sourcing controls</h2>
        </div>
        <Tooltip content="Sourcing uses paid data providers. Your plan sets how much a run may use.">
          <span className="inline-flex items-center gap-1 text-[11.5px] text-content-muted">
            <Info className="size-3.5" aria-hidden />
            Provider costs apply
          </span>
        </Tooltip>
      </header>

      <div className="grid gap-x-4 gap-y-3 border-t border-line-subtle px-4 py-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label htmlFor="target-verified">Target verified prospects</Label>
            <Input
              id="target-verified"
              type="number"
              min={1}
              max={Math.max(1, budget.maxTarget)}
              disabled={!canManage}
              value={plan.targetVerifiedProspects}
              onChange={(event) =>
                onChange({
                  ...plan,
                  targetVerifiedProspects: Math.max(1, Number(event.target.value) || 1),
                })
              }
              className="mt-1"
            />
            <p className="mt-1 text-[11.5px] text-content-muted">
              How many prospects to find
              {budget.maxTarget > 0 && (
                <> · up to {budget.maxTarget.toLocaleString("en-GB")} on your plan</>
              )}
            </p>
          </div>

          <div>
            <Label htmlFor="max-cost">Max provider cost</Label>
            <Input
              id="max-cost"
              type="number"
              min={0}
              step={1}
              disabled={!canManage}
              value={(plan.maxProviderCostMinor / 100).toFixed(0)}
              onChange={(event) =>
                onChange({
                  ...plan,
                  maxProviderCostMinor: Math.max(0, Number(event.target.value) || 0) * 100,
                })
              }
              className="mt-1"
            />
            {/* The ceiling shown is the enforceable one from the budget engine,
                not the customer's request — so the number on screen is the
                number the run will honour. */}
            <p className="mt-1 text-[11.5px] text-content-muted">
              Ceiling for this run · max {formatMinor(budget.maxProviderCostMinor)}
            </p>
          </div>

          <div>
            <Label htmlFor="minimum-score">Minimum score</Label>
            <Select
              id="minimum-score"
              disabled={!canManage}
              value={plan.minimumGrade}
              onChange={(event) =>
                onChange({
                  ...plan,
                  minimumGrade: event.target.value as SearchPlan["minimumGrade"],
                })
              }
              className="mt-1"
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11.5px] text-content-muted">Minimum match score</p>
          </div>
        </div>

        <div className="space-y-3">
          <ToggleRow
            label="Intent required"
            description="Only include businesses with intent signals"
            checked={plan.intent.required}
            disabled={!canManage}
            onChange={(required) =>
              onChange({ ...plan, intent: { ...plan.intent, required } })
            }
          />
          <ToggleRow
            label="Auto-contact prospects"
            description={
              plan.reviewMode === "AUTO_CONTACT"
                ? "Prospects will be contacted by your active campaign"
                : "Do not send automatically"
            }
            checked={plan.reviewMode === "AUTO_CONTACT"}
            disabled={!canManage}
            onChange={(auto) =>
              onChange({ ...plan, reviewMode: auto ? "AUTO_CONTACT" : "HUMAN_REVIEW" })
            }
          />
          <ToggleRow
            label="Review before outreach"
            description="Manually review all prospects first"
            checked={plan.reviewMode === "HUMAN_REVIEW"}
            disabled={!canManage}
            onChange={(review) =>
              onChange({ ...plan, reviewMode: review ? "HUMAN_REVIEW" : "AUTO_CONTACT" })
            }
          />
        </div>
      </div>

      <div className="mx-4 mb-4 flex gap-2.5 rounded-lg bg-accent-50/60 px-3.5 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-accent-600" aria-hidden />
        <div className="min-w-0 text-[12px] leading-relaxed">
          <p className="font-medium text-content">
            No enrichment or provider spend will run until you start the sourcing run.
          </p>
          <p className="text-content-secondary">
            You can review the results before any outreach is sent.
          </p>
        </div>
      </div>

      {!readiness.ready && (
        <ul className="mx-4 mb-3 space-y-1" role="status">
          {readiness.problems.map((problem) => (
            <li key={problem} className="text-[12px] text-warning-700">
              {planProblemSentence(problem)}
            </li>
          ))}
        </ul>
      )}

      {readiness.ready && !budget.allowed && (
        <p role="status" className="mx-4 mb-3 text-[12px] text-warning-700">
          {budget.reason === "PROSPECT_ALLOWANCE_EXHAUSTED"
            ? "You have used your verified prospect allowance for this billing period."
            : "There is not enough remaining allowance to start this run."}
        </p>
      )}

      {!canManage && (
        <p className="mx-4 mb-3 text-[12px] text-content-muted">
          Only owners and admins can start a sourcing run.
        </p>
      )}

      <div className="px-4 pb-4">
        <Button
          size="lg"
          fullWidth
          onClick={start}
          loading={starting}
          disabled={blocked}
          className={cn("text-[15px]", blocked && "opacity-60")}
        >
          <Play className="size-4" aria-hidden />
          Start sourcing run
        </Button>
        <p className="mt-2.5 text-center text-[11px] leading-relaxed text-content-subtle">
          This will use your plan limits. Overage charges may apply. All sourcing
          complies with our{" "}
          <a
            href="/privacy"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            data and privacy policies
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        label={label}
        tone="success"
        className="mt-0.5"
      />
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-content">{label}</p>
        <p className="text-[11.5px] leading-snug text-content-muted">{description}</p>
      </div>
    </div>
  );
}
