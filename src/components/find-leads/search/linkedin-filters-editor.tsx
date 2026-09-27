"use client";

import * as React from "react";
import { Copy, ExternalLink, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  LINKEDIN_COMPANY_TYPES,
  LINKEDIN_COMPANY_TYPE_LABELS,
  LINKEDIN_FUNCTIONS,
  LINKEDIN_HEADCOUNT_BANDS,
  LINKEDIN_SENIORITIES,
  LINKEDIN_SENIORITY_LABELS,
  LINKEDIN_TENURE_BANDS,
  LINKEDIN_TENURE_LABELS,
  linkedinFiltersText,
  linkedinSearchKeywords,
  linkedinSearchUrl,
  type LinkedinFilters,
} from "@/lib/find-leads/linkedin-filters";
import { importLinkedinListAction } from "@/lib/find-leads/linkedin-import-actions";

/**
 * LinkedIn's lead and account filters, edited as part of the plan.
 *
 * They are the customer's own targeting. ClientTurn does not search LinkedIn
 * and never uses the customer's session; the filters are applied by hand in
 * LinkedIn or Sales Navigator, and to the customer's own imported list.
 */
export function LinkedinFiltersEditor({
  value,
  onChange,
}: {
  value: LinkedinFilters;
  onChange: (next: LinkedinFilters) => void;
}) {
  const set = <K extends keyof LinkedinFilters>(key: K, next: LinkedinFilters[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <LinesField label="Geography" hint="One place per line." values={value.geography} onChange={(v) => set("geography", v)} />
        <LinesField label="Industry" hint="LinkedIn industry names." values={value.industries} onChange={(v) => set("industries", v)} />
        <LinesField label="Current job title" hint="Include, one per line." values={value.titlesInclude} onChange={(v) => set("titlesInclude", v)} />
        <LinesField label="Exclude job title" hint="One per line." values={value.titlesExclude} onChange={(v) => set("titlesExclude", v)} />
      </div>

      <ChoiceGroup
        label="Seniority level"
        options={LINKEDIN_SENIORITIES.map((key) => ({ value: key, label: LINKEDIN_SENIORITY_LABELS[key] }))}
        selected={value.seniorities}
        onChange={(v) => set("seniorities", v)}
      />
      <ChoiceGroup
        label="Function"
        options={LINKEDIN_FUNCTIONS.map((name) => ({ value: name, label: name }))}
        selected={value.functions}
        onChange={(v) => set("functions", v)}
      />
      <ChoiceGroup
        label="Company headcount"
        options={LINKEDIN_HEADCOUNT_BANDS.map((band) => ({ value: band, label: band }))}
        selected={value.headcountBands}
        onChange={(v) => set("headcountBands", v)}
      />
      <ChoiceGroup
        label="Company type"
        options={LINKEDIN_COMPANY_TYPES.map((key) => ({ value: key, label: LINKEDIN_COMPANY_TYPE_LABELS[key] }))}
        selected={value.companyTypes}
        onChange={(v) => set("companyTypes", v)}
      />
      <ChoiceGroup
        label="Years in current position"
        options={LINKEDIN_TENURE_BANDS.map((key) => ({ value: key, label: LINKEDIN_TENURE_LABELS[key] }))}
        selected={value.yearsInCurrentPosition}
        onChange={(v) => set("yearsInCurrentPosition", v)}
      />
      <ChoiceGroup
        label="Years at current company"
        options={LINKEDIN_TENURE_BANDS.map((key) => ({ value: key, label: LINKEDIN_TENURE_LABELS[key] }))}
        selected={value.yearsAtCurrentCompany}
        onChange={(v) => set("yearsAtCurrentCompany", v)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="li-growth-min">Headcount growth from (%)</Label>
          <Input
            id="li-growth-min"
            type="number"
            value={value.headcountGrowth.minPct ?? ""}
            onChange={(event) =>
              set("headcountGrowth", {
                ...value.headcountGrowth,
                minPct: event.target.value === "" ? null : Math.round(Number(event.target.value)),
              })
            }
          />
        </div>
        <div>
          <Label htmlFor="li-growth-max">to (%)</Label>
          <Input
            id="li-growth-max"
            type="number"
            value={value.headcountGrowth.maxPct ?? ""}
            onChange={(event) =>
              set("headcountGrowth", {
                ...value.headcountGrowth,
                maxPct: event.target.value === "" ? null : Math.round(Number(event.target.value)),
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[12.5px] text-content">
          <Checkbox
            checked={value.changedJobsPast90Days}
            onChange={(event) => set("changedJobsPast90Days", event.target.checked)}
          />
          Changed jobs in the past 90 days
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-content">
          <Checkbox
            checked={value.postedOnLinkedinPast30Days}
            onChange={(event) => set("postedOnLinkedinPast30Days", event.target.checked)}
          />
          Posted on LinkedIn in the past 30 days
        </label>
      </div>

      <div>
        <Label htmlFor="li-keywords">Keywords</Label>
        <Input
          id="li-keywords"
          maxLength={200}
          value={value.keywords}
          onChange={(event) => set("keywords", event.target.value)}
        />
      </div>
    </div>
  );
}
/**
 * Apply the filters by hand, and import your own list.
 *
 * The link is LinkedIn's standard people search with keywords only, exactly
 * the URL the browser shows. Every other filter is in the copyable list, to be
 * applied by hand in LinkedIn or Sales Navigator.
 */
export function LinkedinHandoff({
  filters,
  industries,
  canImport,
  sessionId,
}: {
  filters: LinkedinFilters;
  /** The plan's industries, used for the search keywords when none are set. */
  industries: string[];
  canImport: boolean;
  sessionId: string | null;
}) {
  const keywords = linkedinSearchKeywords({
    titles: filters.titlesInclude,
    industries: filters.industries.length ? filters.industries : industries,
    keywords: filters.keywords,
  });
  const text = React.useMemo(() => linkedinFiltersText(filters), [filters]);
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text || "No LinkedIn filters set.");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-sunken/50 p-3">
      <p className="text-[12px] leading-relaxed text-content-secondary">
        ClientTurn does not search LinkedIn and never uses your LinkedIn session. Apply these
        filters by hand in LinkedIn or Sales Navigator, and import your own list below.
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href={linkedinSearchUrl(keywords)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-content hover:bg-surface-hover"
        >
          Search LinkedIn <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <Button size="sm" variant="secondary" onClick={copy}>
          <Copy className="size-3.5" aria-hidden />
          {copied ? "Copied" : "Copy filters"}
        </Button>
      </div>

      <div>
        <p className="mb-1 text-[11.5px] font-medium text-content-secondary">
          Filters to apply by hand in LinkedIn or Sales Navigator
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-2 text-[11.5px] text-content-secondary">
          {text || "No LinkedIn filters set."}
        </pre>
      </div>

      {canImport && <LinkedinListImport sessionId={sessionId} />}
    </div>
  );
}

/** Server actions cap a request body at about 1 MB. */
const MAX_FILE_BYTES = 950_000;

function LinkedinListImport({ sessionId }: { sessionId: string | null }) {
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inputId = React.useId();

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ tone: "error", text: "That file is over 1 MB. Split it and import each part." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const csv = await file.text();
      const result = await importLinkedinListAction({ csv, fileName: file.name, surface: null, sessionId });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const parts = [
        `Added ${result.imported.toLocaleString("en-GB")} prospect${result.imported === 1 ? "" : "s"}${result.surface === "LINKEDIN_CONNECTIONS" ? " from your LinkedIn connections" : ""}.`,
        result.duplicates ? `${result.duplicates} already held.` : null,
        result.withoutWebsite ? `${result.withoutWebsite} without a company website yet.` : null,
        result.rejected
          ? `${result.rejected} skipped${result.firstErrors[0] ? ` (row ${result.firstErrors[0].row}: ${result.firstErrors[0].message})` : ""}.`
          : null,
        result.warning,
      ];
      setMessage({ tone: "ok", text: parts.filter(Boolean).join(" ") });
    });
  }

  return (
    <div className="border-t border-line-subtle pt-3">
      <label
        htmlFor={inputId}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-content hover:bg-surface-hover",
          pending && "pointer-events-none opacity-60",
        )}
      >
        <Upload className="size-3.5" aria-hidden />
        {pending ? "Importing…" : "Import your list (CSV)"}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="mt-1.5 text-[11.5px] text-content-muted">
        Your LinkedIn Connections export (Settings → Data privacy → Get a copy of your data), or
        any list you own. Needs names and a company. Each row becomes a prospect for review.
        Phone numbers are discarded, never stored.
      </p>
      {message && (
        <p
          role="status"
          className={cn(
            "mt-1.5 text-[12px]",
            message.tone === "error" ? "text-danger-700" : "text-content-secondary",
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function LinesField({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = React.useId();
  // Kept as raw text while typing so a trailing newline is not eaten.
  const [draft, setDraft] = React.useState(values.join("\n"));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={3}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(
            event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          );
        }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-content focus:border-accent-400 focus:outline-none"
      />
      <p className="mt-1 text-[11.5px] text-content-muted">{hint}</p>
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium text-content-secondary">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] font-medium",
                on
                  ? "border-accent-500 bg-accent-50 text-content-accent"
                  : "border-line bg-surface text-content-muted hover:text-content",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
