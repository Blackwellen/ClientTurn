"use client";

import * as React from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Select } from "@/components/ui/form";
import {
  analyseImportFile,
  confirmImportFile,
  previewImportFile,
} from "@/lib/campaigns/actions";
import { IMPORT_FIELDS, type ImportMapping, type ImportPreview } from "@/lib/campaigns/types";

const MAX_BYTES = 2 * 1024 * 1024;

export type AudienceSource = "existing" | "csv";

/**
 * `AudienceSourceSelector` + `CSVImportDropzone` + `CSVValidationSummary`
 * (spec §17.2). A compact, inline version of the standalone import wizard at
 * `/app/campaigns/import` — same server actions, same validation, so a CSV
 * imported here behaves identically to one imported through the older
 * dedicated page. On success the new lead source is handed back so the
 * audience filter can select it immediately.
 */
export function AudienceSourceSelector({
  source,
  onSourceChange,
  onImported,
}: {
  source: AudienceSource;
  onSourceChange: (source: AudienceSource) => void;
  onImported: (result: { sourceId: string; label: string; imported: number }) => void;
}) {
  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Audience source"
        className="border-line bg-surface-sunken inline-flex rounded-lg border p-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={source === "existing"}
          onClick={() => onSourceChange("existing")}
          className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
            source === "existing"
              ? "bg-surface text-content shadow-xs"
              : "text-content-muted hover:text-content"
          }`}
        >
          Existing leads
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "csv"}
          onClick={() => onSourceChange("csv")}
          className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
            source === "csv"
              ? "bg-surface text-content shadow-xs"
              : "text-content-muted hover:text-content"
          }`}
        >
          Import CSV
        </button>
      </div>

      {source === "csv" && <CsvImportFlow onImported={onImported} />}
    </div>
  );
}

function CsvImportFlow({
  onImported,
}: {
  onImported: (result: { sourceId: string; label: string; imported: number }) => void;
}) {
  const [stage, setStage] = React.useState<"upload" | "map" | "check" | "done">("upload");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [filename, setFilename] = React.useState("");
  const [csv, setCsv] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [done, setDone] = React.useState<{ imported: number; sourceLabel: string } | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > MAX_BYTES) {
      setError("That file is larger than the 2MB limit.");
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      const response = await analyseImportFile({ filename: file.name, csv: text });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setFilename(file.name);
      setCsv(text);
      setHeaders(response.data.headers);
      setMapping(response.data.mapping);
      setStage("map");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const response = await previewImportFile({
        filename,
        csv,
        mapping: mapping as unknown as ImportMapping,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setPreview(response.data);
      setStage("check");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const response = await confirmImportFile({
        filename,
        csv,
        mapping: mapping as unknown as ImportMapping,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setDone({ imported: response.data.imported, sourceLabel: response.data.sourceLabel ?? filename });
      setStage("done");
      if (response.data.sourceId) {
        onImported({
          sourceId: response.data.sourceId,
          label: response.data.sourceLabel ?? filename,
          imported: response.data.imported,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-line space-y-3 rounded-lg border p-3">
      {error && (
        <div className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-3 py-2 text-[13px]">
          {error}
        </div>
      )}

      {stage === "upload" && (
        <label className="border-line-strong hover:bg-surface-hover focus-within:outline-content-accent flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center focus-within:outline-2">
          <FileUp className="text-content-muted size-5" aria-hidden />
          <span className="text-content mt-2 text-[13px] font-medium">Choose a CSV file</span>
          <span className="text-content-muted mt-1 text-[12px]">
            Up to 2MB and 5,000 rows. Nothing is imported until you confirm.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={onFile}
          />
        </label>
      )}

      {stage === "map" && (
        <>
          <p className="text-content-muted text-[12px]">
            {filename} — match your columns, then check the file for errors.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((field) => (
              <FormField
                key={field.key}
                label={field.label}
                htmlFor={`ra-map-${field.key}`}
                required={field.required}
              >
                <Select
                  id={`ra-map-${field.key}`}
                  value={mapping[field.key] ?? ""}
                  onChange={(event) =>
                    setMapping((current) => {
                      const next = { ...current };
                      if (event.target.value) next[field.key] = event.target.value;
                      else delete next[field.key];
                      return next;
                    })
                  }
                >
                  <option value="">Not in this file</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </Select>
              </FormField>
            ))}
          </div>
          <Button size="sm" loading={busy} disabled={!mapping.phone} onClick={runPreview}>
            Check the file
          </Button>
        </>
      )}

      {stage === "check" && preview && (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-content-muted text-[12px]">Rows</dt>
              <dd className="text-content lr-tabular text-[18px] font-semibold">
                {preview.rowCount.toLocaleString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="text-content-muted text-[12px]">Valid</dt>
              <dd className="text-success-700 lr-tabular text-[18px] font-semibold">
                {preview.validCount.toLocaleString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="text-content-muted text-[12px]">Skipped</dt>
              <dd
                className={`lr-tabular text-[18px] font-semibold ${preview.invalidCount > 0 ? "text-danger-600" : "text-content"}`}
              >
                {preview.invalidCount.toLocaleString("en-GB")}
              </dd>
            </div>
          </dl>
          {preview.errors.length > 0 && (
            <p className="text-content-muted text-[12px]">
              {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} will be
              skipped — fix these in your file and re-upload if you need them.
            </p>
          )}
          <Button
            size="sm"
            loading={busy}
            disabled={preview.validCount === 0}
            onClick={runImport}
          >
            Import {preview.validCount.toLocaleString("en-GB")} contacts
          </Button>
        </>
      )}

      {stage === "done" && done && (
        <div className="flex items-start gap-3">
          <CheckCircle2 className="text-success-600 mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="text-content text-[13px] font-medium">
              {done.imported.toLocaleString("en-GB")} contacts imported
            </p>
            <p className="text-content-muted mt-0.5 text-[12px]">
              This list is now selected as your audience source below. Imported
              contacts do not trigger the new-lead follow-up sequence.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
