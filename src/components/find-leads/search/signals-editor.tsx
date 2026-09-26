"use client";

import * as React from "react";
import { Checkbox, Label } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { PlanSignals } from "@/lib/find-leads/plan";
import {
  EVIDENCE_KIND_FEED,
  SIGNAL_FEED_NEEDS,
  type SignalFeed,
} from "@/lib/find-leads/signals";
import type { IntentEvidenceKind } from "@/lib/find-leads/intent-evidence";
import { TECH_FINGERPRINTS, type TechnologyKey } from "@/lib/find-leads/website-signals";

/**
 * The structured buying signals a search fetches.
 *
 * Only signals with a live source are offered. One whose source is missing is
 * shown disabled with what to connect, rather than accepted and then quietly
 * finding nothing -- which a customer would read as "no leads" when the truth
 * is "not set up".
 */

const TOGGLES: {
  key: "fundingFilings" | "leadershipChanges" | "recentlyIncorporated" | "officeMoves";
  kind: IntentEvidenceKind;
  label: string;
  detail: string;
}[] = [
  {
    key: "fundingFilings",
    kind: "FUNDING",
    label: "Raised new capital",
    detail: "A share allotment (SH01) filed at Companies House.",
  },
  {
    key: "leadershipChanges",
    kind: "JOB_CHANGE",
    label: "Leadership change",
    detail: "A new director or LLP member appointed. Only the role and date are kept.",
  },
  {
    key: "recentlyIncorporated",
    kind: "NEW_COMPANY",
    label: "Newly incorporated",
    detail: "Incorporated inside the freshness window.",
  },
  {
    key: "officeMoves",
    kind: "EXPANSION",
    label: "Moved registered office",
    detail: "A possible move or expansion. Often just a new accountant, so it counts for less.",
  },
];

export function SignalsEditor({
  value,
  onChange,
  live,
}: {
  value: PlanSignals;
  onChange: (next: PlanSignals) => void;
  live: SignalFeed[];
}) {
  const liveSet = new Set(live);
  const available = (kind: IntentEvidenceKind) => liveSet.has(EVIDENCE_KIND_FEED[kind]);
  const [rolesText, setRolesText] = React.useState(value.hiringRoles.join("\n"));
  const rolesId = React.useId();

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[12px] font-medium text-content-secondary">
          From the Companies House register
        </legend>
        {TOGGLES.map((toggle) => {
          const on = available(toggle.kind);
          return (
            <label
              key={toggle.key}
              className={cn("flex items-start gap-2 text-[12.5px]", !on && "opacity-70")}
            >
              <Checkbox
                className="mt-0.5"
                disabled={!on}
                checked={on && value[toggle.key]}
                onChange={(event) => onChange({ ...value, [toggle.key]: event.target.checked })}
              />
              <span>
                <span className="block font-medium text-content">{toggle.label}</span>
                <span className="block text-[11.5px] text-content-muted">
                  {on ? toggle.detail : SIGNAL_FEED_NEEDS[EVIDENCE_KIND_FEED[toggle.kind]]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div>
        <Label htmlFor={rolesId}>Hiring for these roles</Label>
        <textarea
          id={rolesId}
          rows={3}
          value={rolesText}
          onChange={(event) => {
            setRolesText(event.target.value);
            onChange({
              ...value,
              hiringRoles: event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 20),
            });
          }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-content focus:border-accent-400 focus:outline-none"
        />
        <p className="mt-1 text-[11.5px] text-content-muted">
          One per line, for example Head of Marketing. Read from each company&rsquo;s own careers
          and jobs pages.
        </p>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[12px] font-medium text-content-secondary">
          Uses these technologies
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {TECH_FINGERPRINTS.map((entry) => {
            const on = value.technologies.includes(entry.key as TechnologyKey);
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...value,
                    technologies: on
                      ? value.technologies.filter((key) => key !== entry.key)
                      : [...value.technologies, entry.key as TechnologyKey],
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-medium",
                  on
                    ? "border-accent-500 bg-accent-50 text-content-accent"
                    : "border-line bg-surface text-content-muted hover:text-content",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-content-muted">
          Detected from the scripts and assets each company&rsquo;s own site loads.
        </p>
      </fieldset>

      <p className="rounded-lg bg-surface-sunken px-3 py-2.5 text-[12px] leading-relaxed text-content-secondary">
        Every signal records its source, date and the text that matched, and shows it as
        &ldquo;Why this lead&rdquo; on the prospect. Competitor audiences are not offered: no free,
        lawful source can list them.
      </p>
    </div>
  );
}
