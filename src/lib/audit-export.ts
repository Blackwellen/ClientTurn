/**
 * Audit log export (enterprise readiness, 2026-09-28): the rules and the row
 * formatting. Pure, no `server-only`, so the route and the tests share it.
 *
 * The route (`src/app/api/exports/audit/route.ts`) streams the workspace's
 * `audit_log` rows for a date range as CSV or JSON, one page at a time, so a
 * year of history never has to be held in memory or finish inside a single
 * query.
 */
import { z } from "zod";
import { csvCell } from "./csv.ts";

/** The widest range one export may cover. Longer histories: export per year. */
export const AUDIT_EXPORT_MAX_DAYS = 366;
/** Rows read per page. Keyset-paged on (created_at, id). */
export const AUDIT_EXPORT_PAGE_SIZE = 1000;
/** A hard ceiling so one request cannot run unbounded. */
export const AUDIT_EXPORT_MAX_ROWS = 250_000;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-28.");

export const auditExportSchema = z
  .object({
    from: isoDay,
    to: isoDay,
    format: z.enum(["csv", "json"]).default("csv"),
  })
  .superRefine((value, ctx) => {
    const from = Date.parse(`${value.from}T00:00:00Z`);
    const to = Date.parse(`${value.to}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      ctx.addIssue({ code: "custom", message: "Enter valid dates.", path: ["from"] });
      return;
    }
    if (to < from) {
      ctx.addIssue({ code: "custom", message: "The end date is before the start date.", path: ["to"] });
    }
    const days = Math.round((to - from) / 86_400_000) + 1;
    if (days > AUDIT_EXPORT_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        message: `Export at most ${AUDIT_EXPORT_MAX_DAYS} days at a time.`,
        path: ["to"],
      });
    }
  });

export type AuditExportQuery = z.infer<typeof auditExportSchema>;

/** Inclusive UTC day range → half-open timestamp bounds [start, end). */
export function exportBounds(query: Pick<AuditExportQuery, "from" | "to">): { start: string; end: string } {
  const start = new Date(`${query.from}T00:00:00.000Z`);
  const end = new Date(`${query.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type AuditRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
};

export const AUDIT_CSV_HEADERS = [
  "Time (UTC)",
  "Event id",
  "Actor type",
  "Actor user id",
  "Actor email",
  "Action",
  "Entity type",
  "Entity id",
  "Details (JSON)",
] as const;

export function auditCsvHeader(): string {
  return AUDIT_CSV_HEADERS.map(csvCell).join(",") + "\r\n";
}

export function auditCsvLine(row: AuditRow, actorEmail: string | null): string {
  return (
    [
      row.created_at,
      row.id,
      row.actor_type,
      row.actor_user_id ?? "",
      actorEmail ?? "",
      row.action,
      row.entity_type ?? "",
      row.entity_id ?? "",
      JSON.stringify(row.metadata ?? {}),
    ]
      .map(csvCell)
      .join(",") + "\r\n"
  );
}

export function auditJsonRecord(row: AuditRow, actorEmail: string | null): Record<string, unknown> {
  return {
    id: row.id,
    created_at: row.created_at,
    actor_type: row.actor_type,
    actor_user_id: row.actor_user_id,
    actor_email: actorEmail,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    metadata: row.metadata ?? {},
  };
}

/**
 * The keyset filter for the page after `last`, in PostgREST `or=` syntax.
 * Ordered ascending on (created_at, id), so equal timestamps never repeat or
 * skip a row between pages.
 */
export function nextPageFilter(last: Pick<AuditRow, "created_at" | "id"> | null): string | null {
  if (!last) return null;
  // Values are double-quoted: a timestamp carries "+" and ":".
  const at = `"${last.created_at}"`;
  return `created_at.gt.${at},and(created_at.eq.${at},id.gt.${last.id})`;
}

export function auditExportFilename(query: AuditExportQuery): string {
  return `clientturn-audit-log-${query.from}-to-${query.to}.${query.format}`;
}

/** Only owners and admins may export the workspace's audit trail. */
export function mayExportAudit(role: string): boolean {
  return role === "owner" || role === "admin";
}
