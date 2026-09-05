"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/dates";
import type { TimelineEvent } from "@/lib/leads/types";

const TONE_NODE: Record<TimelineEvent["tone"], string> = {
  neutral: "border-line-strong bg-surface",
  accent: "border-accent-400 bg-accent-50",
  success: "border-success-500 bg-success-50",
  warning: "border-warning-500 bg-warning-50",
  danger: "border-danger-500 bg-danger-50",
};

const TONE_DOT: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-content-subtle",
  accent: "bg-accent-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
};

/**
 * Built from the lead's real event and message records, newest last, so the
 * timeline reads as the history of what actually happened rather than a
 * reconstruction from whatever the list view happened to know.
 */
export function LeadActivitySection({ timeline }: { timeline: TimelineEvent[] }) {
  if (timeline.length === 0) {
    return (
      <p className="px-1 py-10 text-center text-[13px] text-content-muted">
        Nothing has happened on this lead yet.
      </p>
    );
  }

  return (
    <ol className="relative">
      {timeline.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                TONE_NODE[event.tone],
              )}
            >
              <span className={cn("size-1.5 rounded-full", TONE_DOT[event.tone])} />
            </span>
            {index < timeline.length - 1 && (
              <span className="w-px flex-1 bg-line" aria-hidden />
            )}
          </div>

          <div className="min-w-0 pb-5">
            <p className="text-[13px] font-medium text-content">{event.label}</p>
            {event.detail && (
              <p className="mt-0.5 truncate text-[12px] text-content-muted" title={event.detail}>
                {event.detail}
              </p>
            )}
            <p
              className="mt-0.5 text-[11px] text-content-subtle"
              title={formatDateTime(event.at)}
            >
              {formatRelative(event.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
