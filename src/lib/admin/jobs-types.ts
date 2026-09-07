/**
 * Job shapes shared with client components. No `server-only`, no Supabase
 * import — the Jobs table, filters and detail drawer use these without pulling
 * the service-role client into the browser bundle.
 *
 * The seven statuses below are the *admin* vocabulary. `jobs.state` in Postgres
 * has six values and no notion of "retrying"; a pending row that has already
 * burned an attempt is a retry, and saying so is the whole point of the column.
 * The mapping lives in one place (`jobStatusOf` in jobs.ts) and nowhere else.
 */

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
  "DEAD_LETTER",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  RETRYING: "Retrying",
  CANCELLED: "Cancelled",
  DEAD_LETTER: "Dead lettered",
};

export const JOB_STATUS_TONE = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  RETRYING: "warning",
  CANCELLED: "neutral",
  DEAD_LETTER: "danger",
} as const;

export const JOB_STATUS_FILTERS = ["all", ...JOB_STATUSES] as const;
export type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number];

/**
 * Priority is an integer in the queue (lower runs first). Operators think in
 * three bands, so the table shows bands and the filter reads them back.
 */
export const JOB_PRIORITIES = ["critical", "high", "normal"] as const;
export type JobPriorityBand = (typeof JOB_PRIORITIES)[number];

export const JOB_PRIORITY_LABEL: Record<JobPriorityBand, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

export const JOB_PRIORITY_TONE = {
  critical: "danger",
  high: "warning",
  normal: "neutral",
} as const;

/** Boundaries of the three bands, applied to `jobs.priority`. */
export function priorityBand(priority: number): JobPriorityBand {
  if (priority <= 25) return "critical";
  if (priority < 100) return "high";
  return "normal";
}

/**
 * What re-running this job would do to the world outside the database.
 *
 * `none`      — the handler only reads and writes our own tables, so a repeat
 *               run is harmless.
 * `idempotent`— the handler performs an external call but the domain service
 *               re-reads state first and will not act twice (message.send only
 *               dispatches a message still QUEUED, for instance).
 * `reconcile` — the external call could have landed before the failure was
 *               recorded, and there is a record we can check to find out.
 * `unverifiable` — the external call could have landed and nothing we hold can
 *               confirm it. A retry needs an explicit human decision.
 */
export const JOB_SIDE_EFFECT_CLASSES = [
  "none",
  "idempotent",
  "reconcile",
  "unverifiable",
] as const;
export type JobSideEffectClass = (typeof JOB_SIDE_EFFECT_CLASSES)[number];

export type JobRow = {
  id: string;
  /** Short display form of the UUID, e.g. `job_01HX7…`. */
  shortId: string;
  type: string;
  typeLabel: string;
  provider: string;
  providerLabel: string;
  status: JobStatus;
  priority: number;
  priorityBand: JobPriorityBand;
  attempts: number;
  maxAttempts: number;
  businessId: string | null;
  businessName: string | null;
  queue: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Milliseconds from claim to completion, or to now while running. */
  durationMs: number | null;
  lastError: string | null;
  /** Server-decided. The UI never concludes on its own that a retry is safe. */
  retryable: boolean;
  cancellable: boolean;
};

export type JobListResult = {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Distinct job types present in the window, for the type filter. */
  types: { value: string; label: string; count: number }[];
  providers: string[];
};

export type JobSummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  queued: number;
  cancelled: number;
  deadLettered: number;
  /** Completion rate over the window, 0-1. Null when nothing finished. */
  completionRate: number | null;
  previousTotal: number;
  /** Per-bucket counts across the window, for the KPI sparklines. */
  series: {
    total: number[];
    completed: number[];
    failed: number[];
    running: number[];
  };
};

/** One line of the queue-lag chart: minutes waited, per priority band. */
export type QueueLagPoint = {
  bucket: string;
  critical: number;
  high: number;
  normal: number;
};

export type JobTypeSlice = {
  type: string;
  label: string;
  count: number;
  /** Fraction of the window's jobs, 0-1. */
  share: number;
};

export type DeadLetterGroup = {
  type: string;
  label: string;
  count: number;
  oldestAt: string;
  latestAt: string;
  sampleError: string | null;
};

export type JobAttempt = {
  index: number;
  status: "Failed" | "Completed" | "Running";
  startedAt: string | null;
  durationMs: number | null;
  error: string | null;
};

export type JobRelatedResource = {
  kind: "customer" | "provider" | "similar";
  label: string;
  href: string;
};

export type JobDetail = JobRow & {
  worker: string | null;
  /** Dedupe key the queue enforces. Null when the job type does not dedupe. */
  actionKey: string | null;
  runAt: string;
  /** Redacted. A payload never leaves the server with a credential in it. */
  payload: { key: string; value: string }[];
  payloadJson: string;
  sideEffect: JobSideEffectClass;
  /** Operator-language explanation of what a retry would and would not repeat. */
  safetyNote: string;
  /**
   * Non-null means Retry is unavailable and says why. Populated by the server
   * after reconciling with the provider, never guessed in the browser.
   */
  retryBlockedReason: string | null;
  /** True when retrying needs the operator to accept an unverifiable repeat. */
  requiresUnverifiableConfirmation: boolean;
  attemptHistory: JobAttempt[];
  related: JobRelatedResource[];
  /** Log lines derived from the audit trail and the recorded failures. */
  logLines: { at: string; level: "info" | "warn" | "error"; message: string }[];
};

export type JobsViewData = {
  summary: JobSummary;
  queueLag: QueueLagPoint[];
  byType: JobTypeSlice[];
  deadLetter: DeadLetterGroup[];
  list: JobListResult;
  detail: JobDetail | null;
};
