/**
 * The public-safe status vocabulary.
 *
 * Pure — no `server-only`, no Supabase — because the System Status tab in the
 * support popout is a client component and needs the labels and the shape. It
 * used to import them from `service.ts`, which pulled the service-role client
 * into the browser bundle; the same boundary `outreach/types.ts` keeps from
 * `outreach/queries.ts`.
 *
 * Only names and shapes live here. Everything that reads the database, and the
 * allow-listing that keeps tenant data out of a public page, stays in
 * `service.ts`.
 */

export type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "MAINTENANCE";

export const STATUS_META: Record<
  ServiceStatus,
  { label: string; tone: "success" | "warning" | "danger" | "info" }
> = {
  OPERATIONAL: { label: "Operational", tone: "success" },
  DEGRADED: { label: "Degraded", tone: "warning" },
  OUTAGE: { label: "Outage", tone: "danger" },
  MAINTENANCE: { label: "Maintenance", tone: "info" },
};

export type StatusService = {
  key: string;
  name: string;
  description: string;
  status: ServiceStatus;
  /** Share of probes in the last 30 days that were healthy, 0–1. */
  uptime: number | null;
  /** 30 daily buckets, oldest first, for the sparkline. */
  history: (ServiceStatus | null)[];
  /** ISO timestamp of the most recent successful check. */
  lastSuccessAt: string | null;
};

export type StatusGroup = {
  key: string;
  name: string;
  services: StatusService[];
};

export type RecentFailure = {
  id: string;
  at: string;
  service: string;
  /** A short, stable label. Never a stack trace or a provider response body. */
  label: string;
  resolved: boolean;
};

export type JobSummary = {
  total24h: number;
  completed: number;
  failed: number;
  retrying: number;
  completedShare: number | null;
  failedShare: number | null;
  retryingShare: number | null;
  /** Seconds, rounded to one decimal. Null when nothing completed. */
  averageProcessingSeconds: number | null;
};

export type StatusSnapshot = {
  overall: ServiceStatus;
  generatedAt: string;
  /** True when the newest probe is older than the staleness threshold. */
  stale: boolean;
  groups: StatusGroup[];
  failures: RecentFailure[];
  jobs: JobSummary;
  lastSync: { key: string; name: string; at: string | null }[];
};
