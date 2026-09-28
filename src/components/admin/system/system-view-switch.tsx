"use client";

import * as React from "react";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { cn } from "@/lib/cn";

export const SYSTEM_VIEWS = [
  "health",
  "events",
  "errors",
  "jobs",
  "compliance",
  "readiness",
  "lead-ops",
  "ai-spend",
  "domain-events",
  "audit",
  "voice",
] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];

export const SYSTEM_VIEW_LABEL: Record<SystemView, string> = {
  health: "Health",
  events: "Events",
  errors: "Errors",
  jobs: "Jobs",
  compliance: "Compliance",
  readiness: "Readiness",
  "lead-ops": "Lead ops",
  "ai-spend": "AI spend",
  "domain-events": "Domain events",
  audit: "Audit log",
  voice: "Voice ops",
};

export const SYSTEM_VIEW_DESCRIPTION: Record<SystemView, string> = {
  health: "Monitor platform health, jobs and degraded workspaces.",
  events: "Inspect operational events, retries and webhook activity across the platform.",
  errors: "Review platform errors, investigate impact, and triage issues quickly.",
  jobs: "Monitor and manage background jobs across the ClientTurn platform.",
  compliance:
    "Manage communication policies, regional requirements and compliance controls.",
  readiness:
    "Release readiness, measured from the running system rather than ticked by hand.",
  "lead-ops": "Stuck leads across every workspace, and the duplicate queue with reversible merges.",
  "ai-spend": "AI spend per workspace and task, budget refusals, and provider quota usage.",
  "domain-events": "The domain event outbox: what happened, and whether it has been dispatched.",
  audit: "The platform audit log: every recorded write, filterable by action, actor and period.",
  voice: "AI calling across the platform: live calls, minutes, spend, margin, numbers, failures and emergency controls.",
};

/**
 * Switching resets every view-specific parameter, so a filter set on Events
 * cannot silently narrow Errors or Jobs.
 */
export function SystemViewSwitch({ view }: { view: SystemView }) {
  const { setParams } = useAdminParams();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function select(next: SystemView) {
    setParams({
      view: next === "health" ? null : next,
      q: null,
      page: null,
      provider: null,
      status: null,
      type: null,
      severity: null,
      area: null,
      event: null,
      error: null,
      job: null,
      policy: null,
      priority: null,
      queue: null,
      sort: null,
      merge: null,
      state: null,
      action: null,
      actor: null,
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = SYSTEM_VIEWS.indexOf(view);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % SYSTEM_VIEWS.length
        : (index - 1 + SYSTEM_VIEWS.length) % SYSTEM_VIEWS.length;
    refs.current[next]?.focus();
    select(SYSTEM_VIEWS[next]);
  }

  return (
    <div
      role="tablist"
      aria-label="System view"
      onKeyDown={onKeyDown}
      className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
    >
      {SYSTEM_VIEWS.map((option, index) => {
        const active = option === view;
        return (
          <button
            key={option}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(option)}
            className={cn(
              "h-8 rounded-md px-4 text-[12.5px] font-medium",
              "transition-colors duration-[var(--lr-duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
              active
                ? "bg-surface text-content shadow-xs ring-1 ring-accent-500"
                : "text-content-muted hover:text-content",
            )}
          >
            {SYSTEM_VIEW_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
