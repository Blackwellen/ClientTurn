"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useStagedReveal } from "./use-staged";

const STAGES = [
  { label: "New Lead", detail: "Facebook lead form submitted", time: "10:32" },
  { label: "Message sent", detail: "First contact from your number", time: "10:32" },
  { label: "Lead replied", detail: "Two-way conversation open", time: "10:34" },
  { label: "Questions completed", detail: "Service, postcode, timing", time: "10:36" },
  { label: "Qualified", detail: "Meets your criteria", time: "10:37" },
  { label: "Quote booked", detail: "Survey in the calendar", time: "10:40" },
] as const;

export function FunnelVisual() {
  const { ref, revealed } = useStagedReveal(STAGES.length, 650);

  return (
    <div
      ref={ref}
      className="rounded-2xl border border-line bg-surface p-4 shadow-lg sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 pb-4">
        <p className="text-[13px] font-semibold text-content">Lead journey</p>
        <span className="rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-content-muted">
          Illustrative product demo
        </span>
      </div>

      <ol className="relative space-y-1">
        {STAGES.map((stage, index) => {
          const active = index < revealed;
          const last = index === STAGES.length - 1;
          return (
            <li key={stage.label} className="relative flex gap-3 pb-1">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-[var(--lr-duration-slow)]",
                    active
                      ? last
                        ? "border-success-500 bg-success-500 text-white"
                        : "border-accent-500 bg-accent-500 text-on-primary"
                      : "border-line-strong bg-surface-sunken text-content-subtle",
                  )}
                >
                  {active ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  )}
                </span>
                {!last && (
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 w-px flex-1 transition-colors duration-[var(--lr-duration-slow)]",
                      active ? "bg-accent-300" : "bg-line",
                    )}
                  />
                )}
              </div>

              <div
                className={cn(
                  "min-w-0 flex-1 rounded-lg border px-3 py-2.5 transition-all duration-[var(--lr-duration-slow)]",
                  active
                    ? "border-line bg-surface opacity-100 shadow-xs"
                    : "border-line-subtle bg-surface opacity-45",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-semibold text-content">
                    {stage.label}
                  </p>
                  <span className="lr-tabular shrink-0 text-[11px] text-content-muted">
                    {stage.time}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-content-muted">
                  {stage.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
