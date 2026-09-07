import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobLabel } from "./format";
import { adminRead, rangeWindow, redactPayload, truncate, unique, namesFor, type AdminClient } from "./shared";
import type { AdminRange } from "./types";
import {
  priorityBand,
  type DeadLetterGroup,
  type JobAttempt,
  type JobDetail,
  type JobListResult,
  type JobRelatedResource,
  type JobRow,
  type JobSideEffectClass,
  type JobStatus,
  type JobStatusFilter,
  type JobSummary,
  type JobTypeSlice,
  type JobsViewData,
  type QueueLagPoint,
} from "./jobs-types";

/**
 * The platform Jobs surface. Everything here reads `public.jobs` — the same
 * table the worker claims from — rather than a mirror, so what an operator
 * cancels or retries is the row the worker will actually pick up.
 */

/* ------------------------------------------------------------- vocabulary --- */

/**
 * Which provider a job type reaches for. Where a type spans several providers
 * (a message can be SMS, WhatsApp or email) the subsystem is named instead of
 * guessing one, because an invented provider on an incident screen is worse
 * than an honest "Messaging".
 */
const JOB_PROVIDER: Record<string, string> = {
  "app.ingest": "webhook",
  "lead.process": "job",
  "message.send": "sms",
  "message.process_inbound": "sms",
  "email.poll": "email",
  "automation.advance": "job",
  "booking.sync": "calendly",
  "campaign.expand": "job",
  "campaign.send": "sms",
  "integration.health_check": "job",
  "webhook.replay": "webhook",
  "notification.send": "resend",
  "notification.slack": "slack",
  "usage.aggregate": "job",
  "retention.cleanup": "job",
  "cost.rollup_daily": "billing",
  "cost.rollup_monthly": "billing",
  "lead_source.poll": "meta",
  "crm.push": "hubspot",
  "agent.run": "openai",
  "sourcing.run": "job",
  "business.analyse": "openai",
  "recurring_search.tick": "job",
  "maintenance.expiry": "job",
  "outreach.dispatch": "email",
  "outreach.audience": "job",
  "outreach.tick": "job",
};

const PROVIDER_DISPLAY: Record<string, string> = {
  webhook: "Webhook",
  job: "Platform",
  sms: "Messaging",
  email: "Email",
  calendly: "Calendly",
  resend: "Resend",
  slack: "Slack",
  billing: "Billing",
  meta: "Meta",
  hubspot: "CRM",
  openai: "Azure OpenAI",
};

export function jobProvider(type: string): string {
  return JOB_PROVIDER[type] ?? "job";
}

function jobProviderLabel(type: string): string {
  return PROVIDER_DISPLAY[jobProvider(type)] ?? "Platform";
}

/** The queue a job type belongs to. Purely descriptive; the worker is one pool. */
const JOB_QUEUE: Record<string, string> = {
  "message.send": "messaging",
  "message.process_inbound": "messaging",
  "campaign.send": "messaging",
  "outreach.dispatch": "outreach",
  "outreach.audience": "outreach",
  "outreach.tick": "outreach",
  "sourcing.run": "sourcing",
  "recurring_search.tick": "sourcing",
  "agent.run": "ai",
  "business.analyse": "ai",
  "cost.rollup_daily": "billing",
  "cost.rollup_monthly": "billing",
  "crm.push": "sync",
  "lead_source.poll": "sync",
  "booking.sync": "sync",
  "email.poll": "sync",
};

function jobQueue(type: string): string {
  return JOB_QUEUE[type] ?? "default";
}

/**
 * What a repeat run would do outside our own database. See the doc comment on
 * `JobSideEffectClass` — this table is the single place that judgement lives,
 * and the retry path refuses to act without consulting it.
 */
const JOB_SIDE_EFFECT: Record<string, JobSideEffectClass> = {
  // performSend re-reads the message and dispatches only one still QUEUED.
  "message.send": "idempotent",
  "campaign.send": "idempotent",
  // webhook_events is unique on (provider, external_event_id).
  "webhook.replay": "idempotent",
  "booking.sync": "idempotent",
  "message.process_inbound": "idempotent",
  // These spend money or write to a third party, and leave a record we can check.
  "outreach.dispatch": "reconcile",
  "notification.send": "reconcile",
  "crm.push": "reconcile",
  "agent.run": "reconcile",
  "business.analyse": "reconcile",
  "sourcing.run": "reconcile",
  // A Slack webhook POST returns no id we persist, so a repeat cannot be ruled out.
  "notification.slack": "unverifiable",
};

export function sideEffectOf(type: string): JobSideEffectClass {
  return JOB_SIDE_EFFECT[type] ?? "none";
}

const SAFETY_NOTE: Record<JobSideEffectClass, string> = {
  none: "This job only reads and writes ClientTurn's own tables. Running it again cannot duplicate anything a customer or provider would see.",
  idempotent:
    "This job is idempotent. The domain service re-reads current state before it acts, so a repeat run will not send or charge twice.",
  reconcile:
    "This job calls an external provider. Before a retry runs, the platform checks the provider record for this job to confirm the original attempt did not already succeed.",
  unverifiable:
    "This job calls an external provider that returns no identifier we store, so the platform cannot prove the original attempt failed. Retrying may repeat the side effect and needs an explicit decision.",
};

export function safetyNoteFor(type: string): string {
  return SAFETY_NOTE[sideEffectOf(type)];
}

/* ------------------------------------------------------------------ rows --- */

type JobRecord = {
  id: string;
  type: string;
  business_id: string | null;
  payload: Record<string, unknown> | null;
  state: string;
  priority: number;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  completed_at: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
  retried_from_job_id?: string | null;
};

const JOB_COLUMNS =
  "id, type, business_id, payload, state, priority, run_at, attempts, max_attempts, locked_at, locked_by, completed_at, last_error, idempotency_key, created_at, cancel_requested_at, cancelled_at, retried_from_job_id";

/**
 * The single mapping from the queue's six states to the seven the operator
 * sees. A pending row that has already burned an attempt is a retry; a pending
 * row with a cancellation request outstanding is on its way to cancelled.
 */
export function jobStatusOf(job: {
  state: string;
  attempts: number;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
}): JobStatus {
  if (job.cancelled_at || job.state === "cancelled") return "CANCELLED";
  switch (job.state) {
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "dead":
      return "DEAD_LETTER";
    case "pending":
      return job.attempts > 0 ? "RETRYING" : "QUEUED";
    default:
      return "QUEUED";
  }
}

function shortIdOf(id: string): string {
  return `job_${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function durationOf(job: JobRecord): number | null {
  if (!job.locked_at) return null;
  const started = new Date(job.locked_at).getTime();
  const ended = job.completed_at
    ? new Date(job.completed_at).getTime()
    : job.state === "running"
      ? Date.now()
      : null;
  if (ended === null) return null;
  const ms = ended - started;
  return ms >= 0 ? ms : null;
}

function toRow(job: JobRecord, businessNames: Map<string, string>): JobRow {
  const status = jobStatusOf(job);
  return {
    id: job.id,
    shortId: shortIdOf(job.id),
    type: job.type,
    typeLabel: jobLabel(job.type),
    provider: jobProvider(job.type),
    providerLabel: jobProviderLabel(job.type),
    status,
    priority: job.priority,
    priorityBand: priorityBand(job.priority),
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    businessId: job.business_id,
    businessName: job.business_id
      ? (businessNames.get(job.business_id) ?? null)
      : null,
    queue: jobQueue(job.type),
    createdAt: job.created_at,
    startedAt: job.locked_at,
    completedAt: job.completed_at,
    durationMs: durationOf(job),
    lastError: job.last_error ? truncate(job.last_error, 240) : null,
    // Only a job that has stopped can be re-queued. A running job is still the
    // worker's, and a completed one has nothing to repeat.
    retryable: status === "FAILED" || status === "DEAD_LETTER",
    cancellable:
      status === "QUEUED" || status === "RETRYING" || status === "RUNNING",
  };
}

/* ---------------------------------------------------------------- filters --- */

export type JobFilters = {
  range: AdminRange;
  q: string;
  type: string;
  status: JobStatusFilter;
  provider: string;
  priority: string;
  queue: string;
  page: number;
  pageSize: number;
};

/** Queue states that back each admin status, for a server-side filter. */
const STATUS_TO_STATES: Record<Exclude<JobStatusFilter, "all">, string[]> = {
  QUEUED: ["pending"],
  RETRYING: ["pending"],
  RUNNING: ["running"],
  COMPLETED: ["completed"],
  FAILED: ["failed"],
  CANCELLED: ["cancelled"],
  DEAD_LETTER: ["dead"],
};

/* ----------------------------------------------------------------- reads --- */

export async function getJobsView(
  filters: JobFilters,
  detailId?: string,
): Promise<JobsViewData> {
  const supabase = await adminRead();
  const window = rangeWindow(filters.range);

  // One windowed fetch feeds the KPIs, the lag chart, the type donut and the
  // dead-letter grouping. Paging the table separately keeps the payload bounded
  // while the aggregates still see the whole window.
  const { data: windowRows } = await supabase
    .from("jobs")
    .select(
      "id, type, state, priority, attempts, run_at, locked_at, completed_at, created_at, last_error, cancelled_at",
    )
    .gte("created_at", window.start.toISOString())
    .order("created_at", { ascending: false })
    .limit(20_000);

  const all = (windowRows ?? []) as Pick<
    JobRecord,
    | "id"
    | "type"
    | "state"
    | "priority"
    | "attempts"
    | "run_at"
    | "locked_at"
    | "completed_at"
    | "created_at"
    | "last_error"
    | "cancelled_at"
  >[];

  const { count: previousTotal } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", window.previousStart.toISOString())
    .lt("created_at", window.start.toISOString());

  const summary = summarise(all, window.buckets, window.start.getTime(), window.bucketMs, previousTotal ?? 0);
  const queueLag = buildQueueLag(all, window.buckets, window.start.getTime(), window.bucketMs);
  const byType = buildTypeSlices(all);
  const deadLetter = buildDeadLetter(all);

  const list = await listJobs(supabase, filters);
  const detail = detailId ? await getJobDetail(supabase, detailId) : null;

  return { summary, queueLag, byType, deadLetter, list, detail };
}

type WindowRow = {
  id: string;
  type: string;
  state: string;
  priority: number;
  attempts: number;
  run_at: string;
  locked_at: string | null;
  completed_at: string | null;
  created_at: string;
  last_error: string | null;
  cancelled_at?: string | null;
};

function summarise(
  rows: WindowRow[],
  buckets: number,
  startMs: number,
  bucketMs: number,
  previousTotal: number,
): JobSummary {
  const series = {
    total: new Array<number>(buckets).fill(0),
    completed: new Array<number>(buckets).fill(0),
    failed: new Array<number>(buckets).fill(0),
    running: new Array<number>(buckets).fill(0),
  };
  let completed = 0;
  let failed = 0;
  let running = 0;
  let queued = 0;
  let cancelled = 0;
  let deadLettered = 0;

  for (const row of rows) {
    const status = jobStatusOf(row);
    if (status === "COMPLETED") completed += 1;
    else if (status === "FAILED") failed += 1;
    else if (status === "RUNNING") running += 1;
    else if (status === "CANCELLED") cancelled += 1;
    else if (status === "DEAD_LETTER") deadLettered += 1;
    else queued += 1;

    const index = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((new Date(row.created_at).getTime() - startMs) / bucketMs)),
    );
    series.total[index] += 1;
    if (status === "COMPLETED") series.completed[index] += 1;
    if (status === "FAILED" || status === "DEAD_LETTER") series.failed[index] += 1;
    if (status === "RUNNING") series.running[index] += 1;
  }

  const finished = completed + failed + deadLettered;
  return {
    total: rows.length,
    completed,
    failed,
    running,
    queued,
    cancelled,
    deadLettered,
    completionRate: finished === 0 ? null : completed / finished,
    previousTotal,
    series,
  };
}

/**
 * Time a job waited between becoming due and being claimed, averaged per
 * bucket and split by priority band. Only claimed jobs contribute — a job still
 * waiting has no final lag yet, and counting it as zero would flatten a spike.
 */
function buildQueueLag(
  rows: WindowRow[],
  buckets: number,
  startMs: number,
  bucketMs: number,
): QueueLagPoint[] {
  const sums = Array.from({ length: buckets }, () => ({
    critical: [0, 0] as [number, number],
    high: [0, 0] as [number, number],
    normal: [0, 0] as [number, number],
  }));

  for (const row of rows) {
    if (!row.locked_at) continue;
    const lagMs = new Date(row.locked_at).getTime() - new Date(row.run_at).getTime();
    if (lagMs < 0) continue;
    const index = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((new Date(row.locked_at).getTime() - startMs) / bucketMs)),
    );
    const band = priorityBand(row.priority);
    sums[index][band][0] += lagMs / 60_000;
    sums[index][band][1] += 1;
  }

  return sums.map((slot, index) => ({
    bucket: new Date(startMs + index * bucketMs).toISOString(),
    critical: slot.critical[1] ? round1(slot.critical[0] / slot.critical[1]) : 0,
    high: slot.high[1] ? round1(slot.high[0] / slot.high[1]) : 0,
    normal: slot.normal[1] ? round1(slot.normal[0] / slot.normal[1]) : 0,
  }));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildTypeSlices(rows: WindowRow[]): JobTypeSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  const total = rows.length || 1;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Everything past the top seven becomes one "Other" slice — a donut with
  // twenty-eight segments communicates nothing.
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((sum, [, count]) => sum + count, 0);
  const slices: JobTypeSlice[] = top.map(([type, count]) => ({
    type,
    label: jobLabel(type),
    count,
    share: count / total,
  }));
  if (rest > 0) {
    slices.push({ type: "__other", label: "Other", count: rest, share: rest / total });
  }
  return slices;
}

function buildDeadLetter(rows: WindowRow[]): DeadLetterGroup[] {
  const groups = new Map<string, DeadLetterGroup>();
  for (const row of rows) {
    if (jobStatusOf(row) !== "DEAD_LETTER") continue;
    const existing = groups.get(row.type);
    if (!existing) {
      groups.set(row.type, {
        type: row.type,
        label: jobLabel(row.type),
        count: 1,
        oldestAt: row.created_at,
        latestAt: row.created_at,
        sampleError: row.last_error ? truncate(row.last_error, 120) : null,
      });
      continue;
    }
    existing.count += 1;
    if (row.created_at < existing.oldestAt) existing.oldestAt = row.created_at;
    if (row.created_at > existing.latestAt) existing.latestAt = row.created_at;
    if (!existing.sampleError && row.last_error) {
      existing.sampleError = truncate(row.last_error, 120);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

async function listJobs(
  supabase: AdminClient,
  filters: JobFilters,
): Promise<JobListResult> {
  const window = rangeWindow(filters.range);

  let query = supabase
    .from("jobs")
    .select(JOB_COLUMNS, { count: "exact" })
    .gte("created_at", window.start.toISOString());

  if (filters.type !== "all") query = query.eq("type", filters.type);
  if (filters.queue !== "all") {
    const types = Object.keys(JOB_QUEUE).filter(
      (type) => JOB_QUEUE[type] === filters.queue,
    );
    if (types.length > 0) query = query.in("type", types);
  }
  if (filters.status !== "all") {
    query = query.in("state", STATUS_TO_STATES[filters.status]);
    // QUEUED and RETRYING share the `pending` state and are told apart by the
    // attempt count, so the distinction has to be pushed down here too.
    if (filters.status === "QUEUED") query = query.eq("attempts", 0);
    if (filters.status === "RETRYING") query = query.gt("attempts", 0);
  }
  if (filters.priority !== "all") {
    if (filters.priority === "critical") query = query.lte("priority", 25);
    else if (filters.priority === "high") query = query.gt("priority", 25).lt("priority", 100);
    else query = query.gte("priority", 100);
  }
  if (filters.provider !== "all") {
    const types = Object.keys(JOB_PROVIDER).filter(
      (type) => JOB_PROVIDER[type] === filters.provider,
    );
    if (types.length > 0) query = query.in("type", types);
  }
  if (filters.q) {
    // A UUID prefix matches the id; anything else is matched against the type
    // and the recorded error, which is where an operator's search term lives.
    const term = filters.q.replace(/^job_/i, "");
    query = query.or(
      `type.ilike.%${term}%,last_error.ilike.%${term}%,idempotency_key.ilike.%${term}%`,
    );
  }

  const from = (filters.page - 1) * filters.pageSize;
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + filters.pageSize - 1);

  const records = (data ?? []) as unknown as JobRecord[];
  const names = await namesFor(
    supabase,
    unique(records.map((row) => row.business_id)),
  );

  const { data: typeRows } = await supabase
    .from("jobs")
    .select("type")
    .gte("created_at", window.start.toISOString())
    .limit(20_000);

  const typeCounts = new Map<string, number>();
  for (const row of (typeRows ?? []) as { type: string }[]) {
    typeCounts.set(row.type, (typeCounts.get(row.type) ?? 0) + 1);
  }

  return {
    rows: records.map((row) => toRow(row, names)),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    types: [...typeCounts.entries()]
      .map(([value, count]) => ({ value, label: jobLabel(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    providers: unique(
      [...typeCounts.keys()].map((type) => jobProvider(type)),
    ).sort(),
  };
}

/* ---------------------------------------------------------------- detail --- */

export async function getJobDetail(
  supabase: AdminClient,
  jobId: string,
): Promise<JobDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;

  const { data } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;

  const job = data as unknown as JobRecord;
  const names = await namesFor(supabase, unique([job.business_id]));
  const row = toRow(job, names);
  const sideEffect = sideEffectOf(job.type);

  const reconciliation = row.retryable
    ? await reconcile(supabase, job)
    : { alreadySucceeded: false, evidence: null };

  const payload = redactPayload(job.payload ?? {}) as Record<string, unknown>;

  const related: JobRelatedResource[] = [];
  if (job.business_id) {
    related.push({
      kind: "customer",
      label: names.get(job.business_id) ?? "View customer",
      href: `/admin/customers?customer=${job.business_id}`,
    });
  }
  related.push({
    kind: "provider",
    label: `${jobProviderLabel(job.type)} status`,
    href: "/admin/system?view=health",
  });
  related.push({
    kind: "similar",
    label: "Similar jobs",
    href: `/admin/system?view=jobs&type=${encodeURIComponent(job.type)}`,
  });

  return {
    ...row,
    worker: job.locked_by,
    actionKey: job.idempotency_key,
    runAt: job.run_at,
    payload: Object.entries(payload).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
    payloadJson: JSON.stringify(payload, null, 2),
    sideEffect,
    safetyNote: safetyNoteFor(job.type),
    retryBlockedReason: reconciliation.alreadySucceeded
      ? `The original attempt appears to have succeeded (${reconciliation.evidence}). Re-running would repeat a side effect the customer has already seen.`
      : row.retryable
        ? null
        : `A ${row.status.toLowerCase().replace("_", " ")} job cannot be re-queued.`,
    requiresUnverifiableConfirmation: sideEffect === "unverifiable",
    attemptHistory: buildAttempts(job),
    related,
    logLines: buildLogLines(job),
  };
}

/**
 * The queue stores one `last_error` and an attempt count, not a per-attempt
 * log, so the history is reconstructed honestly: the number of attempts is
 * known, the recorded error belongs to the most recent one, and earlier
 * attempts are shown as failed without inventing a message for them.
 */
function buildAttempts(job: JobRecord): JobAttempt[] {
  const attempts: JobAttempt[] = [];
  for (let index = job.attempts; index >= 1; index -= 1) {
    const isLatest = index === job.attempts;
    const status: JobAttempt["status"] =
      isLatest && job.state === "running"
        ? "Running"
        : isLatest && job.state === "completed"
          ? "Completed"
          : "Failed";
    attempts.push({
      index,
      status,
      startedAt: isLatest ? job.locked_at : null,
      durationMs: isLatest ? durationOf(job) : null,
      error: isLatest && job.last_error ? truncate(job.last_error, 200) : null,
    });
  }
  return attempts;
}

function buildLogLines(job: JobRecord): JobDetail["logLines"] {
  const lines: JobDetail["logLines"] = [
    { at: job.created_at, level: "info", message: `Job enqueued (${job.type})` },
    { at: job.run_at, level: "info", message: "Became due to run" },
  ];
  if (job.locked_at) {
    lines.push({
      at: job.locked_at,
      level: "info",
      message: `Claimed by ${job.locked_by ?? "a worker"}`,
    });
  }
  if (job.last_error) {
    lines.push({
      at: job.completed_at ?? job.locked_at ?? job.created_at,
      level: job.state === "dead" ? "error" : "warn",
      message: truncate(job.last_error, 300),
    });
  }
  if (job.cancel_requested_at) {
    lines.push({
      at: job.cancel_requested_at,
      level: "warn",
      message: "Cancellation requested by an operator",
    });
  }
  if (job.cancelled_at) {
    lines.push({ at: job.cancelled_at, level: "warn", message: "Cancellation confirmed" });
  }
  if (job.completed_at && job.state === "completed") {
    lines.push({ at: job.completed_at, level: "info", message: "Completed" });
  }
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

/* --------------------------------------------------------- reconciliation --- */

export type Reconciliation = {
  alreadySucceeded: boolean;
  evidence: string | null;
};

const NOT_CHECKED: Reconciliation = { alreadySucceeded: false, evidence: null };

function idFrom(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * Asks the domain whether this job's side effect already landed.
 *
 * This is the guard that separates "retry" from "send it twice". It is called
 * before every retry, not only when the drawer is open, and a checker that
 * cannot reach a verdict returns "not already succeeded" *only* for job types
 * classified `none` or `idempotent` — for `unverifiable` types the retry path
 * demands a human decision regardless of what this returns.
 */
export async function reconcile(
  supabase: AdminClient,
  job: Pick<JobRecord, "type" | "payload" | "business_id">,
): Promise<Reconciliation> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  switch (job.type) {
    case "message.send":
    case "campaign.send": {
      const messageId = idFrom(payload, "messageId");
      if (!messageId) return NOT_CHECKED;
      const { data } = await supabase
        .from("messages")
        .select("status, provider_message_id, sent_at")
        .eq("id", messageId)
        .maybeSingle();
      if (!data) return NOT_CHECKED;
      if (data.provider_message_id || data.sent_at) {
        return {
          alreadySucceeded: true,
          evidence: data.provider_message_id
            ? `the provider accepted it as ${data.provider_message_id}`
            : "the message is recorded as sent",
        };
      }
      return NOT_CHECKED;
    }

    case "crm.push": {
      const leadId = idFrom(payload, "leadId");
      if (!leadId) return NOT_CHECKED;
      const { data } = await supabase
        .from("crm_push_records")
        .select("status, external_contact_id, pushed_at")
        .eq("lead_id", leadId)
        .maybeSingle();
      if (data?.external_contact_id) {
        return {
          alreadySucceeded: true,
          evidence: `the CRM already holds contact ${data.external_contact_id}`,
        };
      }
      return NOT_CHECKED;
    }

    case "outreach.dispatch": {
      const runId = idFrom(payload, "recipientRunId") ?? idFrom(payload, "runId");
      if (!runId) return NOT_CHECKED;
      const { data } = await supabase
        .from("outreach_recipient_runs")
        .select("status, steps_sent, last_sent_at")
        .eq("id", runId)
        .maybeSingle();
      if (data?.last_sent_at) {
        return {
          alreadySucceeded: true,
          evidence: `the recipient was last sent to at ${data.last_sent_at}`,
        };
      }
      return NOT_CHECKED;
    }

    case "agent.run":
    case "business.analyse": {
      const runId = idFrom(payload, "runId") ?? idFrom(payload, "agentRunId");
      if (!runId) return NOT_CHECKED;
      const { data } = await supabase
        .from("agent_runs")
        .select("status, completed_at")
        .eq("id", runId)
        .maybeSingle();
      if (data?.completed_at) {
        return {
          alreadySucceeded: true,
          evidence: "the model run completed and was already billed",
        };
      }
      return NOT_CHECKED;
    }

    case "sourcing.run": {
      const runId = idFrom(payload, "runId") ?? idFrom(payload, "sourcingRunId");
      if (!runId) return NOT_CHECKED;
      const { data } = await supabase
        .from("sourcing_runs")
        .select("status, completed_at, spent_cost_minor")
        .eq("id", runId)
        .maybeSingle();
      if (data?.completed_at) {
        return {
          alreadySucceeded: true,
          evidence: "the sourcing run already completed and spent budget",
        };
      }
      return NOT_CHECKED;
    }

    case "notification.send": {
      const entityId = idFrom(payload, "entityId");
      const businessId = job.business_id;
      if (!entityId || !businessId) return NOT_CHECKED;
      const { data } = await supabase
        .from("notifications")
        .select("id")
        .eq("business_id", businessId)
        .eq("entity_id", entityId)
        .limit(1);
      if ((data ?? []).length > 0) {
        return {
          alreadySucceeded: true,
          evidence: "a notification for this entity was already delivered",
        };
      }
      return NOT_CHECKED;
    }

    default:
      return NOT_CHECKED;
  }
}

/** Used by the actions module, which holds its own service-role client. */
export function adminJobClient(): AdminClient {
  return createAdminClient();
}
