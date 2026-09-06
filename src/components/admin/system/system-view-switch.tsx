"use client";

import * as React from "react";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { cn } from "@/lib/cn";

export const SYSTEM_VIEWS = ["health", "events", "errors"] as const;
export type SystemView = (typeof SYSTEM_VIEWS)[number];

export const SYSTEM_VIEW_LABEL: Record<SystemView, string> = {
  health: "Health",
  events: "Events",
  errors: "Errors",
};

export const SYSTEM_VIEW_DESCRIPTION: Record<SystemView, string> = {
  health: "Monitor platform health, jobs and degraded workspaces.",
  events: "Inspect operational events, retries and webhook activity across the platform.",
  errors: "Review platform errors, investigate impact, and triage issues quickly.",
};

/**
 * Three views, and only three. Switching resets the view-specific parameters
 * so a filter from Events cannot silently narrow Errors.
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
      sort: null,
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
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
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
