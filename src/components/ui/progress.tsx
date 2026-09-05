import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "accent" | "success" | "warning" | "danger";

const BARS: Record<Tone, string> = {
  accent: "bg-accent-600",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
};

export function Progress({
  value,
  max = 100,
  tone = "accent",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label: string;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-[var(--lr-duration-slow)] ease-[var(--lr-ease)]",
          BARS[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function UsageMeter({
  label,
  used,
  limit,
  unit,
  className,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  className?: string;
}) {
  const pct = limit <= 0 ? 0 : (used / limit) * 100;
  const tone: Tone = pct >= 100 ? "danger" : pct >= 80 ? "warning" : "accent";

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-content">{label}</p>
        <p className="lr-tabular text-[12px] text-content-muted">
          {used.toLocaleString()} / {limit.toLocaleString()}
          {unit ? ` ${unit}` : ""}
        </p>
      </div>
      <Progress
        className="mt-2"
        value={used}
        max={limit}
        tone={tone}
        label={`${label} usage`}
      />
      {pct >= 100 ? (
        <p className="mt-1.5 text-[12px] text-danger-600">
          Limit reached. Upgrade to continue.
        </p>
      ) : pct >= 80 ? (
        <p className="mt-1.5 text-[12px] text-warning-700">
          {Math.max(0, limit - used).toLocaleString()} remaining this period.
        </p>
      ) : null}
    </div>
  );
}

export type Step = { label: string; description?: string };

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: Step[];
  /** Zero-based index of the step in progress. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start gap-2", className)}>
      {steps.map((step, i) => {
        const complete = i < current;
        const active = i === current;
        return (
          <li key={step.label} className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold lr-tabular",
                  complete && "bg-accent-600 border-accent-600 text-white",
                  active && "border-accent-600 text-content-accent bg-accent-50",
                  !complete &&
                    !active &&
                    "border-line-strong text-content-subtle bg-surface",
                )}
              >
                {complete ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[13px] font-medium truncate",
                    active
                      ? "text-content"
                      : complete
                        ? "text-content-secondary"
                        : "text-content-muted",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {complete
                      ? " (complete)"
                      : active
                        ? " (current step)"
                        : " (not started)"}
                  </span>
                </p>
                {step.description && (
                  <p className="mt-0.5 text-[12px] text-content-muted truncate">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "mt-3.5 hidden h-px flex-1 sm:block",
                  complete ? "bg-accent-600" : "bg-line",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
