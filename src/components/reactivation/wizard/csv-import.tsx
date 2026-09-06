"use client";

import * as React from "react";
import { CheckCircle2, FileUp, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Select } from "@/components/ui/form";
import {
  analyseImportFile,
  confirmImportFile,
  previewImportFile,
} from "@/lib/campaigns/actions";
import {
  IMPORT_FIELDS,
  type ImportMapping,
  type ImportPreview,
} from "@/lib/campaigns/types";
import type { CsvUploadState } from "./state";
import { formatCount } from "./pieces";

/** Matches the server-side `MAX_CSV_BYTES` cap in `lib/campaigns/actions`. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * `CSVImportDropzone` + `CSVValidationSummary`. Drag-and-drop with a real
 * file input behind it (so keyboard and screen-reader users get the same
 * path), then column mapping, then a validation summary — nothing is written
 * until "Import" is pressed. Every byte is parsed and validated on the
 * server; the browser only reads the file and reports its size.
 */
export function CsvImportPanel({
  upload,
  onUploaded,
  onRemoved,
  onBusyChange,
}: {
  upload: CsvUploadState | null;
  onUploaded: (result: CsvUploadState) => void;
  onRemoved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [stage, setStage] = React.useState<"upload" | "map" | "check">("upload");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const [filename, setFilename] = React.useState("");
  const [csv, setCsv] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const errorId = React.useId();

  React.useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  function setWorking(value: boolean) {
    setBusy(value);
  }

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    const isCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel";

    if (!isCsv) {
      setError("That is not a CSV file. Export your list as .csv and try again.");
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than the 2MB limit.");
      return;
    }

    setWorking(true);
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
    } catch {
      setError("That file could not be read. Try exporting it again.");
    } finally {
      setWorking(false);
    }
  }

  async function runPreview() {
    setWorking(true);
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
      setWorking(false);
    }
  }

  async function runImport() {
    setWorking(true);
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
      if (!response.data.sourceId) {
        setError("The list imported but could not be selected. Try again.");
        return;
      }
      onUploaded({
        sourceId: response.data.sourceId,
        label: response.data.sourceLabel ?? filename,
        imported: response.data.imported,
      });
    } finally {
      setWorking(false);
    }
  }

  function reset() {
    setStage("upload");
    setFilename("");
    setCsv("");
    setHeaders([]);
    setMapping({});
    setPreview(null);
    setError(null);
    onRemoved();
  }

  if (upload) {
    return (
      <div className="border-success-100 bg-success-50 flex items-start gap-3 rounded-lg border px-3.5 py-3">
        <CheckCircle2 className="text-success-600 mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-content text-[13px] font-medium">
            {formatCount(upload.imported)} contacts imported from {upload.label}
          </p>
          <p className="text-content-muted mt-0.5 text-[12px]">
            Suppression rules are still applied on top of this list. Imported
            contacts do not trigger the new-lead follow-up sequence.
          </p>
        </div>
        <Button size="xs" variant="ghost" onClick={reset}>
          <RotateCcw className="size-3.5" aria-hidden />
          Replace
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          id={errorId}
          role="alert"
          className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-3 py-2 text-[12px]"
        >
          {error}
        </p>
      )}

      {stage === "upload" && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void acceptFile(event.dataTransfer.files?.[0]);
          }}
          className={`rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
            dragging
              ? "border-success-500 bg-success-50"
              : "border-line-strong bg-surface-sunken/40"
          }`}
        >
          <Upload className="text-content-muted mx-auto size-5" aria-hidden />
          <p className="text-content mt-2 text-[13px] font-medium">
            Choose a CSV file or drag and drop
          </p>
          <p className="text-content-muted mt-1 text-[12px]">
            CSV files up to 2MB. We&rsquo;ll validate your file and show any
            issues before importing.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="size-3.5" aria-hidden />
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file"
            aria-describedby={error ? errorId : undefined}
            disabled={busy}
            onChange={(event) => {
              void acceptFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      )}

      {stage === "map" && (
        <div className="border-line space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-content truncate text-[13px] font-medium">
              {filename}
            </p>
            <Button size="xs" variant="ghost" onClick={reset} aria-label="Remove file">
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
          <p className="text-content-muted text-[12px]">
            Match your columns. A mobile number is required — every other field
            is optional.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((field) => (
              <FormField
                key={field.key}
                label={field.label}
                htmlFor={`csv-map-${field.key}`}
                required={field.required}
              >
                <Select
                  id={`csv-map-${field.key}`}
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
          <Button
            size="sm"
            loading={busy}
            disabled={!mapping.phone}
            onClick={runPreview}
          >
            Validate file
          </Button>
        </div>
      )}

      {stage === "check" && preview && (
        <div className="border-line space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-content truncate text-[13px] font-medium">
              {filename}
            </p>
            <Button size="xs" variant="ghost" onClick={reset} aria-label="Remove file">
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Total rows", value: preview.rowCount, tone: "text-content" },
              {
                label: "Valid contacts",
                value: preview.validCount,
                tone: "text-success-600",
              },
              {
                label: "Invalid rows",
                value: preview.invalidCount,
                tone: preview.invalidCount > 0 ? "text-danger-600" : "text-content",
              },
            ].map((cell) => (
              <div
                key={cell.label}
                className="border-line rounded-lg border px-2 py-2"
              >
                <dd className={`lr-tabular text-[18px] font-semibold ${cell.tone}`}>
                  {formatCount(cell.value)}
                </dd>
                <dt className="text-content-muted mt-0.5 text-[11px]">
                  {cell.label}
                </dt>
              </div>
            ))}
          </dl>

          {preview.errors.length > 0 && (
            <details className="border-line rounded-lg border px-3 py-2">
              <summary className="text-content-secondary cursor-pointer text-[12px]">
                {formatCount(preview.errors.length)} issue
                {preview.errors.length === 1 ? "" : "s"} found — these rows are
                skipped
              </summary>
              <ul className="text-content-muted mt-2 space-y-1 text-[12px]">
                {preview.errors.slice(0, 12).map((issue, index) => (
                  <li key={`${issue.row}-${issue.field}-${index}`}>
                    Row {issue.row}, {issue.field}: {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="text-content-muted text-[12px]">
            Duplicates within the file are removed automatically. Opt-outs,
            bookings and cooldowns are applied after import as suppression.
          </p>

          <Button
            size="sm"
            loading={busy}
            disabled={preview.validCount === 0}
            onClick={runImport}
          >
            Import {formatCount(preview.validCount)} contacts
          </Button>
        </div>
      )}
    </div>
  );
}
