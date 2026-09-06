"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { WIZARD_STEPS, type WizardStepKey } from "@/lib/outreach/campaign-draft";

/**
 * The six-step tracker.
 *
 * A real `<ol>` of buttons rather than a decorative row: each reached step is
 * navigable, `aria-current` marks the one in view, and the state of every
 * other step is announced rather than conveyed by colour alone.
 *
 * A step ahead of the furthest valid one is disabled here *and* refused by the
 * wizard's own routing, so a hand-edited `?step=review` cannot skip validation.
 */
export function CampaignStepper({
  current,
  furthest,
  completed,
  onSelect,
}: {
  current: WizardStepKey;
  /** The furthest step the draft has earned the right to reach. */
  furthest: WizardStepKey;
  completed: Record<WizardStepKey, boolean>;
  onSelect: (step: WizardStepKey) => void;
}) {
  const order = WIZARD_STEPS.map((step) => step.key);
  const currentIndex = order.indexOf(current);
  const furthestIndex = order.indexOf(furthest);

  return (
    <nav aria-label="Campaign setup progress">
      <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line-subtle shadow-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {WIZARD_STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = completed[step.key] && index < currentIndex;
          const reachable = index <= Math.max(furthestIndex, currentIndex);

          return (
            <li key={step.key} className="min-w-0">
              <button
                type="button"
                onClick={() => reachable && onSelect(step.key)}
                disabled={!reachable}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex h-full w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                  isCurrent ? "bg-success-50/70" : "bg-surface",
                  reachable && !isCurrent && "hover:bg-surface-hover",
                  !reachable && "cursor-not-allowed",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold tabular-nums",
                    isDone
                      ? "bg-success-50 text-success-600 ring-2 ring-inset ring-success-500"
                      : isCurrent
                        ? "bg-success-600 text-white"
                        : "border border-line-strong bg-surface text-content-muted",
                  )}
                >
                  {isDone ? <Check className="size-4" strokeWidth={3} /> : index + 1}
                </span>

                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-[13px] font-semibold leading-tight",
                      reachable ? "text-content" : "text-content-muted",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-content-muted">
                    {step.description}
                  </span>
                  <span className="sr-only">
                    {isDone
                      ? " — complete"
                      : isCurrent
                        ? " — current step"
                        : reachable
                          ? " — available"
                          : " — finish the earlier steps first"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
