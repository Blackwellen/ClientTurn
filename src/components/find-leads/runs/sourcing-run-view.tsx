"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  RUN_STATUS_LABELS,
  runStatusTone,
  type SourcingRunView as RunView,
} from "@/lib/find-leads/types";
import { ChatComposer } from "../chat-composer";
import { RunProgressBlock } from "./run-progress-block";
import {
  ProviderActivityCard,
  ResultBreakdownCard,
  RunBudgetCard,
  RunCountersCard,
  RunIssuesCard,
} from "./run-panels";
import { RunControls } from "./run-controls";

/**
 * The sourcing run page (V4 §11).
 *
 * Still a conversation. The customer's original request, the assistant's reply
 * describing what it will do, the twelve-stage block, and milestone updates as
 * they land — all in one thread, with the operational panels beside it. That
 * shape is the whole design argument: background work the customer paid for
 * should read as work being done for them, not as a job runner they are being
 * asked to babysit.
 */

/** Poll cadence while live. A finished run stops polling entirely. */
const POLL_MS = 4000;

export function SourcingRunView({ initialRun }: { initialRun: RunView }) {
  const [run, setRun] = React.useState(initialRun);
  const live = run.status === "RUNNING" || run.status === "QUEUED";

  React.useEffect(() => {
    if (!live) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/find-leads/runs/${run.id}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { run: RunView };
        if (!cancelled) setRun(body.run);
      } catch {
        // A dropped poll is not worth surfacing — the next tick recovers, and
        // the page keeps showing the last state it successfully read.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, run.id]);

  const startedLabel = run.startedAt
    ? new Date(run.startedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      <Link
        href="/app/find-leads"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Find Leads
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-content">
              Sourcing run — {run.title}
            </h1>
            <Badge tone={runStatusTone(run.status)} dot>
              {RUN_STATUS_LABELS[run.status]}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-content-muted">
            {startedLabel && <span>Started today at {startedLabel}</span>}
            <span aria-hidden>·</span>
            <span>
              Using {run.providerCount} provider{run.providerCount === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">Target {run.targetVerified} prospects</span>
          </p>
        </div>

        <RunControls runId={run.id} controls={run.controls} variant="header" />
      </header>

      {run.status === "FAILED" && run.errorMessage && (
        <p
          role="alert"
          className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-[13px] text-danger-700"
        >
          {run.errorMessage}
        </p>
      )}

      {run.status === "PAUSED" && (
        <p
          role="status"
          className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-[13px] text-warning-700"
        >
          {run.pausedReason === "BUDGET_LIMIT_REACHED"
            ? "This run paused because it reached its cost limit. Raise the limit or start a new run to continue."
            : "This run is paused. Resume it to carry on from where it stopped — nothing is repeated."}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* The conversation, with the stage block embedded in it. */}
        <section
          aria-label="Sourcing run activity"
          className="flex min-h-[620px] flex-col rounded-xl border border-line bg-surface shadow-xs"
        >
          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {run.messages.map((message) => (
              <RunMessage key={message.id} message={message} />
            ))}

            <RunProgressBlock
              stages={run.stages}
              progressPercent={run.progressPercent}
              currentStageNumber={run.currentStageNumber}
              startedAtLabel={startedLabel}
            />
          </div>

          <div className="border-t border-line-subtle px-5 py-4">
            <ChatComposer
              onSend={() => {}}
              placeholder="This run is in progress — you can pause, stop, or review results."
              disabled
              disabledReason={
                live
                  ? "This run is in progress — you can pause, stop, or review results."
                  : "This run has finished. Start a new search to look for more prospects."
              }
            />
          </div>
        </section>

        <div className="space-y-4">
          <RunCountersCard
            counters={run.counters}
            updatedAtLabel={
              live
                ? new Date().toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null
            }
          />
          <RunBudgetCard budget={run.budget} />
          <ProviderActivityCard providers={run.providers} />
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <ResultBreakdownCard counters={run.counters} />
            <RunIssuesCard issues={run.issues} runId={run.id} />
          </div>
          <RunControls runId={run.id} controls={run.controls} />
        </div>
      </div>
    </div>
  );
}

function RunMessage({ message }: { message: RunView["messages"][number] }) {
  const time = new Date(message.createdAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-accent-50 px-3.5 py-2.5">
          <p className="sr-only">You said:</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-content">
            {message.content}
          </p>
          <p className="mt-1 text-right text-[10.5px] tabular-nums text-content-subtle">
            {time}
          </p>
        </div>
      </div>
    );
  }

  if (message.role === "SYSTEM_EVENT") {
    return (
      <p className="text-center text-[11.5px] text-content-subtle">{message.content}</p>
    );
  }

  return (
    <div className={cn("flex gap-2.5")}>
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
      >
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-content">ClientTurn AI</span>
          <span className="text-[10.5px] tabular-nums text-content-subtle">{time}</span>
        </div>
        <p className="sr-only">ClientTurn AI said:</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-content-secondary">
          {message.content}
        </p>
      </div>
    </div>
  );
}
