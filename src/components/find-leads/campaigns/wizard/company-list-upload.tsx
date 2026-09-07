"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { parseCompanyCsv } from "@/lib/outreach/company-list";

/**
 * Uploading a named company list.
 *
 * Parsed in the browser and never stored as a file. The result is a list of
 * names and domains that goes into the draft like anything typed by hand, so
 * there is no upload to secure, nothing to scan, and no orphaned object in R2
 * when a draft is abandoned.
 *
 * A named company is a targeting preference, not a bypass: everything added
 * here still goes through deduplication, suppression, scoring and
 * verification, exactly as the card below it says.
 */

/** Matches the CSV cap used by the lead importer. */
const MAX_BYTES = 2 * 1024 * 1024;

export function CompanyListUpload({
  existing,
  max,
  onAdd,
}: {
  existing: string[];
  max: number;
  onAdd: (values: string[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSummary(null);

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
      const parsed = parseCompanyCsv(await file.text());

      if (parsed.length === 0) {
        setError(
          "No company names or domains were found. The file needs a column called name, company or domain.",
        );
        return;
      }

      // Deduplicated against what is already there, so uploading the same file
      // twice does not double the list.
      const seen = new Set(existing.map((value) => value.toLowerCase()));
      const fresh = parsed.filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const room = Math.max(0, max - existing.length);
      const added = fresh.slice(0, room);

      if (added.length > 0) onAdd([...existing, ...added]);

      setSummary(
        [
          `${added.length} added`,
          parsed.length - fresh.length > 0
            ? `${parsed.length - fresh.length} already on the list`
            : null,
          // Said plainly rather than silently truncating.
          fresh.length > room ? `${fresh.length - room} over the ${max} limit` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch {
      setError("That file could not be read. Try exporting it again.");
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(event) => void acceptFile(event.target.files?.[0])}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={working}
        disabled={existing.length >= max}
        onClick={() => inputRef.current?.click()}
        title={
          existing.length >= max ? `The list is limited to ${max} companies.` : undefined
        }
      >
        <Upload className="size-3.5" aria-hidden />
        Upload list
      </Button>

      {(error || summary) && (
        <p
          role="status"
          className={cn(
            "mt-1.5 text-[12px] leading-snug",
            error ? "text-danger-600" : "text-content-muted",
          )}
        >
          {error ?? summary}
        </p>
      )}
    </div>
  );
}
