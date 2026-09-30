"use client";

import * as React from "react";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { cn } from "@/lib/cn";

import {
  SYSTEM_VIEWS,
  SYSTEM_VIEW_LABEL,
  type SystemView,
} from "@/lib/admin/system-views";

// Re-exported for client callers. A Server Component must import these from
// "@/lib/admin/system-views": through this "use client" module it receives a
// client reference instead of the array, `z.enum` rejects it, and every
// ?view= silently fell back to Health (wave 5 QA, 2026-09-30).
export { SYSTEM_VIEWS, SYSTEM_VIEW_LABEL, type SystemView };

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
