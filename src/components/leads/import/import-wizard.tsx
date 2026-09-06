"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ShieldCheck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  CLASSIFICATION_LABELS,
  IMPORT_FIELDS,
  classificationTone,
  classifyRow,
  flagSentence,
  guessMapping,
  summarise,
  type ImportField,
  type ParsedRow,
  type RowVerdict,
} from "@/lib/imports/classify";
import { relationshipLabel, type RelationshipType } from "@/lib/policy/types";
import { commitImport, createImport } from "@/lib/imports/actions";

/**
 * The lead import wizard (V4 §7).
 *
 * Upload → Map → Relationship → Review → Import.
 *
 * The preview here is exactly that: a preview. The classification shown is
 * recomputed on the server before anything is written, against live suppression
 * and duplicate state, so a stale tab cannot smuggle a cold row into Leads.
 * The copy says so on the review step rather than implying the preview is the
 * decision.
 */

const STEPS = ["File", "Columns", "Relationship", "Review"] as const;

const RELATIONSHIP_OPTIONS: RelationshipType[] = [
  "THEY_CONTACTED_US",
  "EXISTING_CUSTOMER",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "REFERRAL",
  "FOUND_BY_US",
  "IMPORTED",
];

/** Minimal RFC4180-ish CSV reader: handles quoted cells and embedded commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [filename, setFilename] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<string[][]>([]);
  const [mapping, setMapping] = React.useState<Partial<Record<ImportField, number>>>({});
  const [relationship, setRelationship] = React.useState<RelationshipType | null>(null);
  const [sourceDetail, setSourceDetail] = React.useState("");
  const [startFollowUp, setStartFollowUp] = React.useState(false);

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5_000_000) {
      setError("That file is over 5 MB. Split it and import in batches.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        setError("That file has no data rows.");
        return;
      }
      const [head, ...body] = parsed;
      setFilename(file.name);
      setHeaders(head);
      setRows(body.slice(0, 5000));
      setMapping(guessMapping(head));
      setError("");
      setStep(1);
    };
    reader.readAsText(file);
  }

  /** The client-side preview. Recomputed server-side before anything is written. */
  const preview = React.useMemo(() => {
    const seen = new Set<string>();
    return rows.slice(0, 200).map<{ row: ParsedRow; verdict: RowVerdict }>((raw) => {
      const value = (field: ImportField) => {
        const index = mapping[field];
        const cell = index === undefined ? null : raw[index]?.trim();
        return cell ? cell : null;
      };

      const row: ParsedRow = {
        firstName: value("firstName"),
        lastName: value("lastName"),
        companyName: value("companyName"),
        email: value("email"),
        phone: value("phone"),
        postcode: value("postcode"),
        roleTitle: value("roleTitle"),
        sourceDetail: value("sourceDetail"),
        notes: value("notes"),
        relationshipType: null,
      };

      const key = row.email?.trim().toLowerCase() ?? "";
      const duplicateInFile = Boolean(key && seen.has(key));
      if (key) seen.add(key);

      return {
        row,
        verdict: classifyRow(row, {
          duplicateInFile,
          // The browser cannot know these; the server checks them at commit.
          existingLeadId: null,
          existingProspectId: null,
          suppressed: false,
          defaultRelationship: relationship,
        }),
      };
    });
  }, [rows, mapping, relationship]);

  const summary = React.useMemo(
    () => summarise(preview.map((entry) => entry.verdict)),
    [preview],
  );

  function submit() {
    startTransition(async () => {
      const created = await createImport({
        filename,
        headers,
        rows,
        mapping,
        defaultRelationship: relationship,
        sourceDetail,
        startFollowUp,
      });

      if (!created.ok) {
        setError(created.error);
        return;
      }

      const committed = await commitImport(created.data!.id);
      if (!committed.ok) {
        setError(committed.error);
        return;
      }

      router.push("/app/leads");
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 border-b-2 pb-3 text-[12.5px]",
              step === index
                ? "border-accent-600 font-medium text-content"
                : "border-line text-content-muted",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                step > index
                  ? "bg-success-500 text-white"
                  : step === index
                    ? "bg-accent-500 text-white"
                    : "bg-surface-sunken text-content-muted",
              )}
            >
              {step > index ? <Check className="size-3" aria-hidden /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Panel title="Choose a file" description="A CSV export from your CRM, spreadsheet or address book. Up to 5 MB.">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface-sunken/40 px-6 py-10 text-center hover:bg-surface-sunken/70">
            <Upload className="size-6 text-content-muted" aria-hidden />
            <span className="text-[13px] font-medium text-content">
              Click to choose a CSV file
            </span>
            <span className="text-[12px] text-content-muted">
              Nothing is imported until you have reviewed it.
            </span>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
          </label>
        </Panel>
      )}

      {step === 1 && (
        <Panel
          title="Match your columns"
          description={`${filename} · ${rows.length.toLocaleString("en-GB")} rows. We have guessed these — check them.`}
        >
          <div className="space-y-2">
            {IMPORT_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-wrap items-center gap-3">
                <span className="w-32 shrink-0 text-[12.5px] text-content-secondary">
                  {field.label}
                </span>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [field.key]:
                        event.target.value === "" ? undefined : Number(event.target.value),
                    }))
                  }
                  className={cn(INPUT, "h-9 flex-1 py-0")}
                >
                  <option value="">Not in this file</option>
                  {headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel
          title="How do you know these people?"
          description="This decides whether a row becomes a lead you can contact, or a prospect that waits for review. It is the most important answer in this wizard."
        >
          <div className="space-y-2">
            {RELATIONSHIP_OPTIONS.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                  relationship === option
                    ? "border-accent-500 bg-accent-50/40"
                    : "border-line bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="relationship"
                  checked={relationship === option}
                  onChange={() => setRelationship(option)}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-content">
                    {relationshipLabel(option)}
                  </span>
                  <span className="block text-[11.5px] text-content-muted">
                    {option === "FOUND_BY_US"
                      ? "These become prospects. Nothing is contacted until you approve it."
                      : option === "REFERRAL" || option === "IMPORTED"
                        ? "Each row is held for review — this could be warm or cold."
                        : "These become leads and can enter follow-up."}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-line-subtle pt-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-content-secondary">
                Where did this list come from?
              </span>
              <input
                value={sourceDetail}
                maxLength={200}
                onChange={(event) => setSourceDetail(event.target.value)}
                placeholder="e.g. Export from our old CRM, June 2026"
                className={INPUT}
              />
              <span className="mt-1 block text-[11px] text-content-muted">
                Recorded as provenance against every imported record.
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={startFollowUp}
                onChange={(event) => setStartFollowUp(event.target.checked)}
                className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-content">
                  Start follow-up on imported leads
                </span>
                <span className="block text-[11px] text-content-muted">
                  Off by default. Importing a list is not the same as choosing to message it —
                  every send is still checked against consent and opt-outs.
                </span>
              </span>
            </label>
          </div>
        </Panel>
      )}

      {step === 3 && (
        <Panel
          title="Review"
          description={`Showing the first ${preview.length.toLocaleString("en-GB")} of ${rows.length.toLocaleString("en-GB")} rows.`}
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            {(
              ["IMPORT_AS_LEAD", "IMPORT_AS_PROSPECT", "REVIEW", "SKIP"] as const
            ).map((key) => (
              <div key={key} className="rounded-lg border border-line bg-surface p-3">
                <p className="text-[19px] font-semibold tabular-nums text-content">
                  {summary[key]}
                </p>
                <p className="mt-0.5 text-[11.5px] text-content-muted">
                  {CLASSIFICATION_LABELS[key]}
                </p>
              </div>
            ))}
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {preview.map((entry, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">
                      <p className="text-[12.5px] text-content">
                        {[entry.row.firstName, entry.row.lastName].filter(Boolean).join(" ") ||
                          entry.row.companyName ||
                          entry.row.email ||
                          `Row ${index + 1}`}
                      </p>
                      {entry.row.email && (
                        <p className="text-[11px] text-content-subtle">{entry.row.email}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={classificationTone(entry.verdict.classification)} dense>
                        {CLASSIFICATION_LABELS[entry.verdict.classification]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-[11.5px] text-content-muted">{entry.verdict.reason}</p>
                      {entry.verdict.flags.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-content-subtle">
                          {entry.verdict.flags.map(flagSentence).join(" · ")}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 flex gap-3 rounded-lg border border-line bg-surface-sunken/50 p-3.5 text-[12px] text-content-secondary">
            <ShieldCheck className="size-4 shrink-0 text-content-accent" aria-hidden />
            <span>
              This preview is recomputed on the server before anything is written. Rows that
              are already in your workspace, or that have opted out since you uploaded, are
              skipped at that point even if they look importable here.
            </span>
          </p>
        </Panel>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        {step === 0 ? (
          <Button variant="secondary" onClick={() => router.push("/app/leads")}>
            Cancel
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}

        {step === 0 ? (
          <Link
            href="/app/leads"
            className="text-[12.5px] text-content-muted underline-offset-4 hover:underline"
          >
            Back to Leads
          </Link>
        ) : step < 3 ? (
          <Button
            onClick={() => {
              if (step === 1 && mapping.email === undefined && mapping.phone === undefined) {
                setError("Map at least an email or a phone column — there is no way to reach anyone otherwise.");
                return;
              }
              if (step === 2 && !relationship) {
                setError("Choose how you know these people.");
                return;
              }
              setError("");
              setStep(step + 1);
            }}
          >
            Continue
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button loading={pending} onClick={submit}>
            Import {summary.IMPORT_AS_LEAD + summary.IMPORT_AS_PROSPECT} record
            {summary.IMPORT_AS_LEAD + summary.IMPORT_AS_PROSPECT === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}

const INPUT = cn(
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-content",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
);

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h2 className="text-[15px] font-semibold text-content">{title}</h2>
      {description && <p className="mt-1 text-[12.5px] text-content-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
