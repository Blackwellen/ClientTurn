import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export const ADD_LEAD_STEPS = [
  "Contact",
  "Enquiry",
  "Permission & contactability",
  "Route & Start",
] as const;

/**
 * The four-step rail under the modal header. Identical in position and size on
 * every step by construction, so moving between steps never shifts the layout
 * beneath it.
 *
 * State is never carried by colour alone: a completed step also swaps its
 * numeral for a tick, and each item carries a screen-reader suffix.
 */
export function WizardProgress({
  current,
  furthest,
  onSelect,
}: {
  current: number;
  /** The highest step already cleared; earlier steps stay reachable. */
  furthest: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Add lead progress">
      <ol className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:gap-0 sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        {ADD_LEAD_STEPS.map((label, index) => {
          const complete = index < current;
          const active = index === current;
          const reachable = index <= furthest && index !== current;

          return (
            <li
              key={label}
              className={cn(
                "flex shrink-0 items-center gap-2.5",
                index < ADD_LEAD_STEPS.length - 1 && "sm:min-w-0 sm:flex-1",
              )}
            >
              <button
                type="button"
                disabled={!reachable}
                aria-current={active ? "step" : undefined}
                onClick={() => reachable && onSelect(index)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg py-0.5 pr-1 text-left",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  reachable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "lr-tabular flex size-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                    complete || active
                      ? "bg-success-500 text-white"
                      : "border border-line bg-surface-sunken text-content-muted",
                  )}
                >
                  {complete ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-[13px]",
                    active
                      ? "font-semibold text-content"
                      : complete
                        ? "font-medium text-content"
                        : "text-content-muted",
                  )}
                >
                  {label}
                </span>
                <span className="sr-only">
                  {complete
                    ? " — complete"
                    : active
                      ? " — current step"
                      : " — not started"}
                </span>
              </button>

              {index < ADD_LEAD_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "hidden h-0.5 min-w-4 flex-1 rounded-full sm:block",
                    complete ? "bg-success-500" : "bg-line",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
