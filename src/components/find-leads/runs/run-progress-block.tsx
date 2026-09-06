import * as React from "react";
import { AlertCircle, Check, Loader2, MinusCircle, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_BY_KEY } from "@/lib/find-leads/stages";
import { STAGE_STATUS_LABELS, type RunStageView } from "@/lib/find-leads/types";

/**
 * The twelve-stage progress block, rendered *inside* the run conversation.
 *
 * Placement is the point. A sourcing run is the assistant doing the work it
 * described a moment earlier, so the progress belongs in the same thread as
 * that description — not in a separate console pane that reframes the whole
 * thing as infrastructure the customer is being asked to supervise.
 *
 * The percentage is derived from stage state, never from elapsed time. A run
 * genuinely stuck on stage 6 shows 42% for as long as it is stuck.
 */

export function RunProgressBlock({
  stages,
  progressPercent,
  currentStageNumber,
  startedAtLabel,
}: {
  stages: RunStageView[];
  progressPercent: number;
  currentStageNumber: number;
  startedAtLabel: string | null;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-sunken/50 p-4">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700"
        >
          <Settings2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-content">Sourcing run started</h3>
            {startedAtLabel && (
              <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
                {startedAtLabel}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-content-muted">
            Working through 12 stages to find and qualify the best prospects for your
            business.
          </p>
        </div>
      </header>

      <div className="mt-3.5 flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Sourcing run progress"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`Stage ${currentStageNumber} of 12, ${progressPercent}% complete`}
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent-500 transition-[width] duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="w-[92px] shrink-0 text-right">
          <p className="text-[12px] font-medium tabular-nums text-content">
            Stage {currentStageNumber} of 12
          </p>
          <p className="text-[11px] tabular-nums text-content-muted">{progressPercent}%</p>
        </div>
      </div>

      <ol className="mt-3 space-y-0.5">
        {stages.map((stage) => (
          <StageRow key={stage.stage_number} stage={stage} />
        ))}
      </ol>
    </section>
  );
}

function StageRow({ stage }: { stage: RunStageView }) {
  const definition = STAGE_BY_KEY[stage.stage_key];
  const running = stage.status === "RUNNING";
  const done = stage.status === "COMPLETED";
  const failed = stage.status === "FAILED";
  const skipped = stage.status === "SKIPPED";

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg px-2 py-1.5",
        running && "bg-accent-50",
      )}
    >
      {/* Status is carried by an icon and by text, never by colour alone. */}
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
          done
            ? "bg-success-500 text-white"
            : running
              ? "bg-accent-600 text-white"
              : failed
                ? "bg-danger-500 text-white"
                : "bg-line text-content-muted",
        )}
      >
        {done ? (
          <Check className="size-3" />
        ) : failed ? (
          <AlertCircle className="size-3" />
        ) : skipped ? (
          <MinusCircle className="size-3" />
        ) : (
          stage.stage_number
        )}
      </span>

      <span className="w-4 shrink-0 text-[11.5px] tabular-nums text-content-subtle">
        {stage.stage_number}
      </span>

      <span
        className={cn(
          "w-[168px] shrink-0 truncate text-[12.5px] font-medium",
          running ? "text-content-accent" : done ? "text-content" : "text-content-secondary",
        )}
      >
        {definition.title}
      </span>

      <span className="hidden min-w-0 flex-1 truncate text-[12px] text-content-muted sm:block">
        {stage.safe_summary ?? definition.description}
      </span>

      <span className="shrink-0 text-right text-[11.5px] tabular-nums">
        {running ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-content-accent">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            In progress
          </span>
        ) : done && stage.completed_at ? (
          <span className="text-content-subtle">
            {new Date(stage.completed_at).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : (
          <span
            className={cn(
              failed ? "font-medium text-danger-600" : "text-content-subtle",
            )}
          >
            {STAGE_STATUS_LABELS[stage.status]}
          </span>
        )}
      </span>
    </li>
  );
}
