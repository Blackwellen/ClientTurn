"use client";

import * as React from "react";
import { Download, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form";
import { AUDIT_EXPORT_MAX_DAYS, auditExportSchema } from "@/lib/audit-export";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Settings -> Data Controls -> Audit log export. Owners and admins only (the
 * route re-checks). Posts to `/api/exports/audit`, which streams the file; the
 * download is saved from the response so an error can be shown in place.
 */
export function AuditLogExport({ canExport }: { canExport: boolean }) {
  const today = React.useMemo(() => new Date(), []);
  const [from, setFrom] = React.useState(() => isoDay(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = React.useState(() => isoDay(today));
  const [format, setFormat] = React.useState<"csv" | "json">("csv");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    const parsed = auditExportSchema.safeParse({ from, to, format });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the dates.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("from", from);
      body.set("to", to);
      body.set("format", format);
      const response = await fetch("/api/exports/audit", { method: "POST", body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(
          response.status === 429
            ? "You have exported the audit log several times recently. Try again in an hour."
            : response.status === 403
              ? "Only the owner or an admin can export the audit log."
              : (payload.message ?? "The export could not be created. Try again."),
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clientturn-audit-log-${from}-to-${to}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDone("Your download has started. The export itself is recorded in the audit log.");
    } catch {
      setError("The export stopped before it finished. Try a shorter date range.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-content">
        <ScrollText className="h-4 w-4 text-content-muted" aria-hidden />
        Audit log export
      </h3>
      <p className="mt-0.5 text-[12.5px] text-content-muted">
        Every change made in this workspace, by a person, the API, MCP or the system, with
        who did it and when. Up to {AUDIT_EXPORT_MAX_DAYS} days per export, as CSV or JSON.
      </p>

      {!canExport ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-4 text-[12.5px] text-content-muted">
          Only the workspace owner or an admin can export the audit log.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
          <FormField label="From" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField label="To" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="date"
              value={to}
              min={from}
              max={isoDay(today)}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Format" htmlFor="audit-format">
            <Select
              id="audit-format"
              value={format}
              onChange={(event) => setFormat(event.target.value === "json" ? "json" : "csv")}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </Select>
          </FormField>
          <Button type="submit" disabled={busy}>
            <Download className="h-4 w-4" aria-hidden />
            {busy ? "Exporting…" : "Export"}
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-danger-600">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-2 text-[12.5px] text-content-muted">
          {done}
        </p>
      ) : null}
    </section>
  );
}
