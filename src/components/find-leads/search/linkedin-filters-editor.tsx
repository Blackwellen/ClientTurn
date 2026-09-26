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
  type LinkedinFilters,
} from "@/lib/find-leads/linkedin-filters";
import { buildSalesNavigatorSearchUrl } from "@/lib/find-leads/sales-navigator-url";
import { importLinkedinListAction } from "@/lib/find-leads/linkedin-import-actions";

/**
 * Sales Navigator's lead and account filters, edited as part of the plan.
 *
 * With a SNAP partner token they drive the server-side search. Without one --
 * the normal case -- LinkedIn permits no server-side search and we never drive
 * the customer's session, so the handoff below is the route: open the same
 * search in their own Sales Navigator, export it, import the file here.
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
 * Open the search in Sales Navigator, copy the filters, import the export.
 *
 * The link is best effort: its format is undocumented, so the filters are
 * always shown as copyable text too, and anything the link could not carry is
 * named.
 */
export function SalesNavigatorHandoff({
  filters,
  partnerConfigured,
  canImport,
}: {
  filters: LinkedinFilters;
  partnerConfigured: boolean;
  canImport: boolean;
}) {
  const link = React.useMemo(() => buildSalesNavigatorSearchUrl(filters), [filters]);
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
        {partnerConfigured
          ? "A LinkedIn partner connection is configured, so these filters also run in the server-side search."
          : "LinkedIn does not allow server-side search without a partner contract, and ClientTurn never uses your LinkedIn session. Open the search in your own Sales Navigator, export the list, and import it here."}
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[12.5px] font-medium text-content hover:bg-surface-hover"
        >
          Open this search in Sales Navigator <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <Button size="sm" variant="secondary" onClick={copy}>
          <Copy className="size-3.5" aria-hidden />
          {copied ? "Copied" : "Copy filters"}
        </Button>
      </div>

      {link.notApplied.length > 0 && (
        <p className="text-[11.5px] text-content-muted">
          Add these by hand in Sales Navigator; the link cannot carry them: {link.notApplied.join(", ")}.
        </p>
      )}

      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-2 text-[11.5px] text-content-secondary">
        {text || "No LinkedIn filters set."}
      </pre>

      {canImport && <LinkedinListImport />}
    </div>
  );
}

/** Server actions cap a request body at about 1 MB. */
const MAX_FILE_BYTES = 950_000;

function LinkedinListImport() {
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
      const result = await importLinkedinListAction({ csv, fileName: file.name, surface: null });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const parts = [
        `Imported ${result.imported.toLocaleString("en-GB")} ${result.surface === "SALES_NAVIGATOR" ? "Sales Navigator" : "LinkedIn"} lead${result.imported === 1 ? "" : "s"}.`,
        result.duplicates ? `${result.duplicates} already held.` : null,
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
        {pending ? "Importing…" : "Import your export (CSV)"}
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
        Needs first name, last name, company and company website columns. Phone numbers are
        discarded, never stored.
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
