"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { STEP_NAV, stepIndex, type OnboardingStep } from "@/lib/onboarding/steps";

export function WizardProgress({
  current,
  completedThrough,
  onJump,
}: {
  current: OnboardingStep;
  /** Highest step index the workspace has actually completed server-side. */
  completedThrough: number;
  onJump?: (step: OnboardingStep) => void;
}) {
  return (
    <ol
      aria-label="Setup progress"
      className="mt-6 hidden items-center sm:flex"
    >
      {STEP_NAV.map((item, i) => {
        const done = i < completedThrough;
        const isCurrent = item.step === current;
        const reachable = Boolean(onJump) && i <= completedThrough;

        return (
          <li key={item.step} className={cn("flex items-center", i < STEP_NAV.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump?.(item.step)}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-full py-1 pr-2",
                reachable ? "cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full border text-[14px] font-semibold transition-colors duration-200",
                  done
                    ? "border-[var(--auth-lime)] bg-[var(--auth-lime)] text-[#071009]"
                    : isCurrent
                      ? "border-[var(--auth-lime)] bg-[var(--auth-lime)] text-[#071009] shadow-[0_0_0_5px_rgba(168,255,31,0.14)]"
                      : "border-[#7890a5] bg-transparent text-[#d4dae3]",
                )}
              >
                {done ? <Check className="size-4" strokeWidth={2.75} aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[14.5px] font-medium whitespace-nowrap",
                  done || isCurrent ? "text-[var(--auth-lime)]" : "text-[#c1cad6]",
                )}
              >
                {item.label}
              </span>
            </button>
            {i < STEP_NAV.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "mx-3 h-px flex-1 min-w-6",
                  i < completedThrough ? "bg-[var(--auth-lime)]" : "bg-[#3d4a5a]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact mobile equivalent: "Step X of 5" plus a filled progress bar. */
export function WizardProgressMobile({ current }: { current: OnboardingStep }) {
  const index = stepIndex(current);
  const total = STEP_NAV.length;

  return (
    <div className="mt-5 sm:hidden">
      <p className="text-[13px] font-medium text-[var(--auth-lime)]">
        Step {index + 1} of {total}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#232d38]">
        <div
          className="h-full rounded-full bg-[var(--auth-lime)] transition-all duration-300"
          style={{ width: `${((index + 1) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
