"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  INTENT_GROUPS,
  INTENT_GROUP_LABELS,
  INTENT_SOURCE_LABELS,
  intentTypeAvailability,
  intentTypesInGroup,
  type IntentTypeDefinition,
  type IntentTypeId,
} from "@/lib/find-leads/intent-catalogue";
import type { SignalFeed } from "@/lib/find-leads/signals";

/**
 * The intent catalogue, grouped by type, for picking buying signals.
 *
 * Used by the plan's signals editor, the combination segment editor and the
 * intent category builder, so the three show the same list the same way.
 * Each type shows the source that backs it. One this workspace cannot run is
 * greyed out with the reason ("Needs a Companies House key"); one no lawful
 * source can supply says so, rather than being left out and leaving the
 * customer to wonder whether it was forgotten.
 */
export function IntentTypePicker({
  selected,
  onToggle,
  live,
  allowUnavailable = false,
  compact = false,
}: {
  selected: IntentTypeId[];
  onToggle: (id: IntentTypeId) => void;
  live: SignalFeed[];
  /** Let an unavailable type be chosen anyway (a category can wait for a key). */
  allowUnavailable?: boolean;
  compact?: boolean;
}) {
  const liveSet = React.useMemo(() => new Set(live), [live]);
  const chosen = new Set(selected);

  return (
    <div className="space-y-3">
      {INTENT_GROUPS.map((group) => (
        <fieldset key={group} className="min-w-0">
          <legend className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-content-muted">
            {INTENT_GROUP_LABELS[group]}
          </legend>
          <ul className={cn("grid gap-1.5", !compact && "sm:grid-cols-2")}>
            {intentTypesInGroup(group).map((entry) => (
              <TypeOption
                key={entry.id}
                entry={entry}
                checked={chosen.has(entry.id)}
                availability={intentTypeAvailability(entry.id, liveSet)}
                allowUnavailable={allowUnavailable}
                onToggle={() => onToggle(entry.id)}
              />
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

function TypeOption({
  entry,
  checked,
  availability,
  allowUnavailable,
  onToggle,
}: {
  entry: IntentTypeDefinition;
  checked: boolean;
  availability: ReturnType<typeof intentTypeAvailability>;
  allowUnavailable: boolean;
  onToggle: () => void;
}) {
  const noSource = entry.sources.length === 0;
  const disabled = noSource || (!availability.available && !allowUnavailable && !checked);
  const sources = [...new Set(entry.sources.map((source) => INTENT_SOURCE_LABELS[source.source]))];

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={onToggle}
        title={entry.caveat ?? entry.description}
        className={cn(
          "block h-full w-full rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          checked
            ? "border-accent-500 bg-accent-50"
            : "border-line bg-surface hover:bg-surface-hover",
          disabled && "cursor-not-allowed opacity-60 hover:bg-surface",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-content">{entry.label}</span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-px text-[10px] font-medium",
              entry.strength === "STRONG"
                ? "bg-success-50 text-success-700"
                : entry.strength === "MODERATE"
                  ? "bg-surface-sunken text-content-secondary"
                  : "bg-surface-sunken text-content-muted",
            )}
          >
            {entry.strength === "STRONG" ? "Strong" : entry.strength === "MODERATE" ? "Moderate" : "Weak"}
          </span>
        </span>
        {noSource ? (
          <span className="mt-0.5 block text-[11px] text-content-muted">Not available: {entry.notAvailable}</span>
        ) : (
          <>
            <span className="mt-0.5 block text-[11px] text-content-muted">
              {sources.join(" · ")} · lasts {entry.decayDays} days
            </span>
            {!availability.available && (
              <span className="mt-0.5 block text-[10.5px] text-warning-700">{availability.reason}</span>
            )}
          </>
        )}
      </button>
    </li>
  );
}
