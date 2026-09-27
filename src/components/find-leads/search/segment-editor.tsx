"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  ROLE_FUNCTIONS,
  ROLE_FUNCTION_NEEDS,
  intentType,
  intentTypeAvailability,
  type IntentTypeId,
  type RoleFunction,
} from "@/lib/find-leads/intent-catalogue";
import {
  SEGMENT_PRESETS,
  conditionSummary,
  segmentSummary,
  unsatisfiableTypes,
  type IntentSegment,
  type SegmentCondition,
} from "@/lib/find-leads/intent-segments";
import type { SignalFeed } from "@/lib/find-leads/signals";
import { IntentTypePicker } from "@/components/find-leads/intent/intent-type-picker";

/**
 * Combine buying signals with AND / OR and recency.
 *
 * The plain-English sentence at the top is the segment: it is what the
 * customer is agreeing to, so it is rebuilt on every change rather than being
 * a label someone typed. A condition whose types this workspace cannot run
 * says so, because a gate that can never open would quietly hold back every
 * prospect in the run.
 */

const WINDOWS = [7, 14, 30, 45, 60, 90, 120, 180, 365];
const MAX_CONDITIONS = 6;

function emptyCondition(): SegmentCondition {
  return { types: ["CAPITAL_RAISED"], withinDays: 90, roleFunction: null };
}

export function SegmentEditor({
  value,
  onChange,
  live,
}: {
  value: IntentSegment | null;
  onChange: (next: IntentSegment | null) => void;
  live: SignalFeed[];
}) {
  const [picking, setPicking] = React.useState<number | null>(null);
  const liveSet = React.useMemo(() => new Set(live), [live]);

  if (!value) {
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-content-secondary">
          Combine signals to narrow a search to companies showing more than one sign of buying,
          for example raised funds <strong>and</strong> hiring a marketing role. Only prospects
          whose evidence matches are marked ready.
        </p>
        <div>
          <p className="mb-1.5 text-[11.5px] text-content-muted">Start from a common one:</p>
          <div className="flex flex-wrap gap-1.5">
            {SEGMENT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => onChange(structuredClone(preset.segment))}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-content-secondary hover:bg-surface-hover hover:text-content"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange({ version: 1, op: "ALL", conditions: [emptyCondition()] })}
        >
          <Plus className="size-3.5" aria-hidden />
          Build a combination
        </Button>
      </div>
    );
  }

  const segment = value;
  const setCondition = (index: number, next: SegmentCondition) =>
    onChange({ ...segment, conditions: segment.conditions.map((c, i) => (i === index ? next : c)) });
  const removeCondition = (index: number) => {
    const conditions = segment.conditions.filter((_, i) => i !== index);
    onChange(conditions.length ? { ...segment, conditions } : null);
    setPicking(null);
  };
  const impossible = unsatisfiableTypes(segment);
  const blocked = segment.conditions
    .map((condition, index) => ({
      index,
      runnable: condition.types.some((id) => intentTypeAvailability(id, liveSet).available),
    }))
    .filter((entry) => !entry.runnable);

  return (
    <div className="space-y-4">
      <p
        aria-live="polite"
        className="rounded-lg border border-accent-200/60 bg-accent-50/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-content"
      >
        {segmentSummary(segment)}.
      </p>

      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-content-secondary">Match</span>
        {(["ALL", "ANY"] as const).map((op) => (
          <button
            key={op}
            type="button"
            aria-pressed={segment.op === op}
            onClick={() => onChange({ ...segment, op })}
            className={cn(
              "rounded-full border px-2.5 py-1 font-medium",
              segment.op === op
                ? "border-accent-500 bg-accent-50 text-content-accent"
                : "border-line bg-surface text-content-muted hover:text-content",
            )}
          >
            {op === "ALL" ? "All conditions (AND)" : "Any condition (OR)"}
          </button>
        ))}
      </div>

      <ol className="space-y-3">
        {segment.conditions.map((condition, index) => (
          <li key={index} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12.5px] font-medium text-content">
                {index > 0 && (
                  <span className="mr-1.5 text-[11px] font-semibold text-content-accent">
                    {segment.op === "ALL" ? "AND" : "OR"}
                  </span>
                )}
                {conditionSummary(condition).replace(/^./, (c) => c.toUpperCase())}
              </p>
              <IconButton size="sm" label="Remove condition" onClick={() => removeCondition(index)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor={`segment-window-${index}`}>Within</Label>
                <Select
                  id={`segment-window-${index}`}
                  value={String(condition.withinDays)}
                  onChange={(event) => setCondition(index, { ...condition, withinDays: Number(event.target.value) })}
                >
                  {WINDOWS.map((days) => (
                    <option key={days} value={days}>
                      Last {days} days
                    </option>
                  ))}
                </Select>
              </div>
              {condition.types.some((id) => intentType(id).hasRoleFunction) && (
                <div>
                  <Label htmlFor={`segment-fn-${index}`}>Role function</Label>
                  <Select
                    id={`segment-fn-${index}`}
                    value={condition.roleFunction ?? ""}
                    onChange={(event) =>
                      setCondition(index, {
                        ...condition,
                        roleFunction: (event.target.value || null) as RoleFunction | null,
                      })
                    }
                  >
                    <option value="">Any function</option>
                    {ROLE_FUNCTIONS.map((fn) => (
                      <option key={fn} value={fn}>
                        {ROLE_FUNCTION_NEEDS[fn].label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <button
              type="button"
              aria-expanded={picking === index}
              onClick={() => setPicking(picking === index ? null : index)}
              className="mt-2 text-[12px] font-medium text-content-accent hover:underline"
            >
              {picking === index ? "Done choosing signals" : `Choose signals (${condition.types.length})`}
            </button>
            {picking === index && (
              <div className="mt-2 max-h-80 overflow-y-auto rounded-md border border-line p-2">
                <IntentTypePicker
                  compact
                  selected={condition.types}
                  live={live}
                  onToggle={(id: IntentTypeId) => {
                    const has = condition.types.includes(id);
                    const types = has ? condition.types.filter((t) => t !== id) : [...condition.types, id];
                    if (types.length === 0 || types.length > 15) return;
                    setCondition(index, { ...condition, types });
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={segment.conditions.length >= MAX_CONDITIONS}
          onClick={() => onChange({ ...segment, conditions: [...segment.conditions, emptyCondition()] })}
        >
          <Plus className="size-3.5" aria-hidden />
          Add condition
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Remove combination
        </Button>
      </div>

      {(impossible.length > 0 || blocked.length > 0) && (
        <p role="status" className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          {blocked.length > 0
            ? `Condition ${blocked.map((b) => b.index + 1).join(", ")} cannot be found with the sources you have connected, so ${segment.op === "ALL" ? "no prospect would match" : "it will never match"}. `
            : ""}
          {impossible.length > 0
            ? `${impossible.map((id) => intentType(id).label).join(", ")} ${impossible.length === 1 ? "has" : "have"} no lawful source and never match.`
            : ""}
        </p>
      )}
    </div>
  );
}
