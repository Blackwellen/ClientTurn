import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type WizardStepMeta = { label: string; description: string };

export const WIZARD_STEPS: WizardStepMeta[] = [
  { label: "Audience", description: "Choose who to reach" },
  { label: "Message & Timing", description: "Create your outreach" },
  { label: "Review & Launch", description: "Confirm and send" },
];

/**
 * The three-step rail beneath the page title. The connecting segment before a
 * step turns green once that step has been reached, so progress reads left to
 * right at a glance. Identical on all three screens by construction.
 */
export function WizardProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Campaign setup progress">
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
        {WIZARD_STEPS.map((step, index) => {
          const complete = index < current;
          const active = index === current;
          const reached = index <= current;

          return (
            <li
              key={step.label}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <span
                aria-hidden
                className={cn(
                  "hidden h-0.5 w-6 shrink-0 rounded-full sm:block lg:w-12",
                  reached ? "bg-success-500" : "bg-line",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "lr-tabular flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  complete || active
                    ? "bg-success-500 text-white"
                    : "bg-surface-sunken text-content-muted border-line border",
                )}
              >
                {complete ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-[14px] font-semibold",
                    reached ? "text-content" : "text-content-muted",
                  )}
                >
                  {step.label}
                </span>
                <span className="text-content-muted block truncate text-[12px]">
                  {step.description}
                </span>
                <span className="sr-only">
                  {complete
                    ? " — complete"
                    : active
                      ? " — current step"
                      : " — not started"}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "hidden h-0.5 min-w-4 flex-1 rounded-full sm:block",
                  complete ? "bg-success-500" : "bg-line",
                )}
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
