"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  GRADES,
  PROSPECT_STATUSES,
  VERIFICATION_STATUSES,
  type ProspectFilters,
} from "@/lib/prospects/filters";
import { prospectStatusLabel, verificationLabel } from "@/lib/prospects/types";
import { eligibilityLabel } from "@/lib/policy/types";
import type { ProspectFilterOptions } from "@/lib/prospects/queries";
import { useFindLeadsParams } from "./use-find-leads-params";

/**
 * The advanced filter panel (V4 §12.4).
 *
 * Every control writes straight to the URL rather than to local state, so the
 * panel has no "apply" button to forget and the result set always matches the
 * address bar.
 */
export function ProspectFilterPanel({
  filters,
  options,
  onClose,
}: {
  filters: ProspectFilters;
  options: ProspectFilterOptions;
  onClose: () => void;
}) {
  const params = useFindLeadsParams();

  return (
    <section
      aria-label="Prospect filters"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-content">Filters</h3>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Narrow the inbox. Filters apply as you choose them.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close filters">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <ChipGroup
          label="Grade"
          values={GRADES}
          selected={filters.grades}
          renderLabel={(g) => g}
          onToggle={(value) => params.toggleInList("grade", value, filters.grades)}
        />

        <ChipGroup
          label="Eligibility"
          values={["ELIGIBLE", "CONSENT_REQUIRED", "REVIEW", "SUPPRESSED"]}
          selected={filters.eligibility}
          renderLabel={(v) => eligibilityLabel(v as never)}
          onToggle={(value) => params.toggleInList("eligibility", value, filters.eligibility)}
        />

        <ChipGroup
          label="Email verification"
          values={VERIFICATION_STATUSES}
          selected={filters.verification}
          renderLabel={(v) => verificationLabel(v as never)}
          onToggle={(value) => params.toggleInList("verification", value, filters.verification)}
        />

        <ChipGroup
          label="Outreach status"
          values={PROSPECT_STATUSES}
          selected={filters.statuses}
          renderLabel={(v) => prospectStatusLabel(v as never)}
          onToggle={(value) => params.toggleInList("status", value, filters.statuses)}
        />

        {options.intentCategories.length > 0 && (
          <ChipGroup
            label="Intent category"
            values={options.intentCategories.map((c) => c.id)}
            selected={filters.intentCategoryIds}
            renderLabel={(id) =>
              options.intentCategories.find((c) => c.id === id)?.name ?? "Category"
            }
            onToggle={(value) =>
              params.toggleInList("intent", value, filters.intentCategoryIds)
            }
          />
        )}

        <SelectField
          label="Intent freshness"
          value={filters.intentWithinDays ? String(filters.intentWithinDays) : ""}
          onChange={(value) => params.setParam("intentDays", value || null)}
          options={[
            { value: "", label: "Any age" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
        />

        {options.industries.length > 0 && (
          <SelectField
            label="Industry"
            value={filters.industries[0] ?? ""}
            onChange={(value) => params.setList("industry", value ? [value] : [])}
            options={[
              { value: "", label: "All industries" },
              ...options.industries.map((i) => ({ value: i, label: i })),
            ]}
          />
        )}

        {options.icpProfiles.length > 0 && (
          <SelectField
            label="Ideal customer profile"
            value={filters.icpProfileId ?? ""}
            onChange={(value) => params.setParam("icp", value || null)}
            options={[
              { value: "", label: "All profiles" },
              ...options.icpProfiles.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        )}

        {options.campaigns.length > 0 && (
          <SelectField
            label="Campaign"
            value={filters.campaignId ?? ""}
            onChange={(value) => params.setParam("campaign", value || null)}
            options={[
              { value: "", label: "All campaigns" },
              ...options.campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        )}

        {options.providers.length > 0 && (
          <SelectField
            label="Source"
            value={filters.sourceProvider ?? ""}
            onChange={(value) => params.setParam("provider", value || null)}
            options={[
              { value: "", label: "All sources" },
              ...options.providers.map((p) => ({ value: p, label: p })),
            ]}
          />
        )}

        <SelectField
          label="Minimum score"
          value={filters.minScore !== null ? String(filters.minScore) : ""}
          onChange={(value) => params.setParam("minScore", value || null)}
          options={[
            { value: "", label: "Any score" },
            { value: "55", label: "55 and above (C+)" },
            { value: "70", label: "70 and above (B+)" },
            { value: "85", label: "85 and above (A+)" },
          ]}
        />

        <SelectField
          label="Discovered"
          value={filters.range}
          onChange={(value) => params.setParam("range", value === "all" ? null : value)}
          options={[
            { value: "all", label: "Any time" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
            { value: "90d", label: "Last 90 days" },
          ]}
        />
      </div>
    </section>
  );
}

function ChipGroup({
  label,
  values,
  selected,
  renderLabel,
  onToggle,
}: {
  label: string;
  values: readonly string[];
  selected: string[];
  renderLabel: (value: string) => string;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[12px] font-medium text-content-secondary">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                active
                  ? "border-accent-500 bg-accent-50 text-content-accent"
                  : "border-line bg-surface text-content-muted hover:bg-surface-hover hover:text-content",
              )}
            >
              {renderLabel(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = React.useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-content",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
