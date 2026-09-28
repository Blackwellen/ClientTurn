/**
 * Ops alert rules (docs/OBSERVABILITY.md "Push alerts").
 *
 * Pure: every function takes rows already read and returns the alerts they
 * justify. `alerts.ts` does the reading, the dedupe and the delivery. Tests:
 * tests/ops-alerts.test.ts.
 *
 * Alert text carries counts, job types, provider names, ids and short scrubbed
 * error codes, never a transcript, a phone number or an email address: every
 * free-text value goes through `scrubString` from the observability logger.
 */
import { scrubString } from "@/lib/observability/log";

export type OpsAlertKind =
  | "dead_jobs"
  | "webhook_failures"
  | "worker_cron_miss"
  | "worker_app_miss"
  | "daily_cron_miss"
  | "cron_job_failed"
  | "queue_backlog"
  | "provider_outage"
  | "voice_margin"
  | "platform_margin";

export type OpsAlertSeverity = "critical" | "warning";

export type OpsAlert = {
  kind: OpsAlertKind;
  severity: OpsAlertSeverity;
  title: string;
  lines: string[];
  /**
   * What makes this alert "the same one again". A repeat with the same
   * fingerprint is not re-sent (within a day); a changed fingerprint is new.
   */
  fingerprint: string;
};

export const OPS_THRESHOLDS = {
  /** pg_cron should start the worker every 30 s. */
  workerMissMinutes: 10,
  /** The app should complete a job at least every 5 min (outreach.tick). */
  workerAppMissMinutes: 15,
  /** The daily job runs at 03:07 UTC. */
  dailyMissHours: 26,
  webhookWindowMinutes: 15,
  webhookFailures: 5,
  backlogMinutes: 15,
  deadJobLookbackHours: 24,
  marginLookbackHours: 26,
  /** How often a persisting miss is re-alerted. */
  persistingRepeatHours: 6,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function bucket(now: Date, hours: number): number {
  return Math.floor(now.getTime() / (hours * HOUR));
}

function age(now: Date, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? now.getTime() - at : null;
}

function minutes(ms: number): string {
  const m = Math.round(ms / MINUTE);
  return m >= 120 ? `${Math.round(m / 60)} h` : `${m} min`;
}

/* ----------------------------------------------------------- dead jobs */

export type DeadJobRow = {
  id: string;
  type: string;
  business_id: string | null;
  last_error: string | null;
  created_at: string;
};

export function evaluateDeadJobs(rows: DeadJobRow[]): OpsAlert | null {
  if (rows.length === 0) return null;
  const byType = new Map<string, number>();
  for (const row of rows) byType.set(row.type, (byType.get(row.type) ?? 0) + 1);
  const ids = rows.map((row) => row.id).sort();
  const newest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    kind: "dead_jobs",
    severity: "critical",
    title: `${rows.length} dead job${rows.length === 1 ? "" : "s"} in the last ${OPS_THRESHOLDS.deadJobLookbackHours} h`,
    lines: [
      ...[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type}: ${n}`),
      `Most recent: ${newest.type} (job ${newest.id})${newest.last_error ? `: ${scrubString(newest.last_error).slice(0, 160)}` : ""}`,
      "Admin -> System -> Jobs to retry or cancel.",
    ],
    fingerprint: `${rows.length}:${ids.at(-1)}:${ids[0]}`,
  };
}

/* ---------------------------------------------------- webhook failures */

export type WebhookRow = { provider: string; status: string };

export function evaluateWebhookFailures(rows: WebhookRow[], now: Date): OpsAlert | null {
  const failed = rows.filter((row) => row.status === "failed");
  if (failed.length < OPS_THRESHOLDS.webhookFailures) return null;
  const byProvider = new Map<string, number>();
  for (const row of failed) byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + 1);
  const total = rows.length;
  return {
    kind: "webhook_failures",
    severity: "critical",
    title: `${failed.length} inbound webhooks failed in ${OPS_THRESHOLDS.webhookWindowMinutes} min`,
    lines: [
      ...[...byProvider.entries()].sort((a, b) => b[1] - a[1]).map(([provider, n]) => `${provider}: ${n} failed`),
      `${failed.length} of ${total} received in the window.`,
    ],
    fingerprint: `${[...byProvider.keys()].sort().join(",")}:${Math.floor(now.getTime() / (OPS_THRESHOLDS.webhookWindowMinutes * MINUTE))}`,
  };
}

/* ------------------------------------------------------------ cron health */

export type CronHealthRow = {
  jobname: string;
  status: string | null;
  start_time: string | null;
  return_message?: string | null;
};

/**
 * `cron_job_health` (0024b) says whether pg_cron fired; `lastJobCompletedAt`
 * says whether the app actually did work. pg_cron can be healthy while every
 * call returns 401 or 500, so both are checked.
 */
export function evaluateCronHealth(input: {
  rows: CronHealthRow[] | null;
  lastJobCompletedAt: string | null;
  now: Date;
  checkWorker: boolean;
}): OpsAlert[] {
  const { rows, now } = input;
  const alerts: OpsAlert[] = [];
  const repeat = bucket(now, OPS_THRESHOLDS.persistingRepeatHours);

  if (rows) {
    const worker = rows.find((row) => row.jobname === "clientturn-worker");
    const daily = rows.find((row) => row.jobname === "clientturn-daily");

    if (input.checkWorker) {
      const workerAge = age(now, worker?.start_time);
      if (workerAge === null || workerAge > OPS_THRESHOLDS.workerMissMinutes * MINUTE) {
        alerts.push({
          kind: "worker_cron_miss",
          severity: "critical",
          title: worker
            ? `The queue worker has not been scheduled for ${minutes(workerAge ?? 0)}`
            : "The queue worker schedule (clientturn-worker) is missing",
          lines: [
            `Last pg_cron start: ${worker?.start_time ?? "never"}.`,
            "Nothing is sending follow-ups or processing inbound replies. See docs/CRON.md.",
          ],
          fingerprint: `${worker?.start_time ?? "none"}:${repeat}`,
        });
      }
    }

    const dailyAge = age(now, daily?.start_time);
    if (dailyAge === null || dailyAge > OPS_THRESHOLDS.dailyMissHours * HOUR) {
      alerts.push({
        kind: "daily_cron_miss",
        severity: "warning",
        title: daily
          ? `The daily job has not run for ${minutes(dailyAge ?? 0)}`
          : "The daily schedule (clientturn-daily) is missing",
        lines: [
          `Last pg_cron start: ${daily?.start_time ?? "never"}. Expected 03:07 UTC daily.`,
          "Billing retries, rollups, retention and margin checks are not running.",
        ],
        fingerprint: `${daily?.start_time ?? "none"}:${repeat}`,
      });
    }

    const failed = rows.filter((row) => row.status === "failed");
    if (failed.length > 0) {
      alerts.push({
        kind: "cron_job_failed",
        severity: "critical",
        title: `pg_cron reported a failed run: ${failed.map((row) => row.jobname).join(", ")}`,
        lines: failed.map(
          (row) => `${row.jobname} at ${row.start_time ?? "?"}: ${scrubString(row.return_message ?? "no message").slice(0, 160)}`,
        ),
        fingerprint: failed.map((row) => `${row.jobname}@${row.start_time}`).sort().join(","),
      });
    }
  }

  if (input.checkWorker) {
    const appAge = age(now, input.lastJobCompletedAt);
    if (appAge === null || appAge > OPS_THRESHOLDS.workerAppMissMinutes * MINUTE) {
      alerts.push({
        kind: "worker_app_miss",
        severity: "critical",
        title: `No job has completed for ${appAge === null ? "a long time" : minutes(appAge)}`,
        lines: [
          `Last completion: ${input.lastJobCompletedAt ?? "none found"}.`,
          "pg_cron may be firing while the app refuses the call (401: CRON_SECRET mismatch) or fails (5xx). Check net._http_response (docs/CRON.md).",
        ],
        fingerprint: `${input.lastJobCompletedAt ?? "none"}:${repeat}`,
      });
    }
  }

  return alerts;
}

/* --------------------------------------------------------------- backlog */

export function evaluateBacklog(input: {
  oldestDueRunAt: string | null;
  dueCount: number;
  now: Date;
}): OpsAlert | null {
  const late = age(input.now, input.oldestDueRunAt);
  if (late === null || late <= OPS_THRESHOLDS.backlogMinutes * MINUTE) return null;
  return {
    kind: "queue_backlog",
    severity: "warning",
    title: `Queue backlog: the oldest due job has waited ${minutes(late)}`,
    lines: [
      `${input.dueCount}${input.dueCount >= 1000 ? "+" : ""} pending jobs are due now.`,
      "The worker is not keeping up. docs/CRON.md, Tuning throughput.",
    ],
    fingerprint: `${bucket(input.now, 1)}`,
  };
}

/* ------------------------------------------------------------- providers */

export type ProviderProbeRow = {
  provider: string;
  status: string;
  errorCode: string | null;
  configured: boolean;
};

export function evaluateProviders(rows: ProviderProbeRow[], now: Date): OpsAlert | null {
  const down = rows.filter((row) => row.configured && row.status === "DOWN");
  if (down.length === 0) return null;
  const names = down.map((row) => row.provider).sort();
  return {
    kind: "provider_outage",
    severity: "critical",
    title: `Provider down: ${names.join(", ")}`,
    lines: down.map((row) => `${row.provider}: ${scrubString(row.errorCode ?? "no response")}`),
    fingerprint: `${names.join(",")}:${bucket(now, OPS_THRESHOLDS.persistingRepeatHours)}`,
  };
}

/* ---------------------------------------------------------------- margin */

export type MarginAlertRow = {
  id: string;
  business_id: string | null;
  severity: string | null;
  title: string | null;
  metrics_json: unknown;
  created_at: string;
};

function periodOf(row: MarginAlertRow): string {
  const period = (row.metrics_json as { period?: unknown } | null)?.period;
  return typeof period === "string" ? period : "";
}

/**
 * New MARGIN_BELOW_THRESHOLD rows. Voice rows carry a `YYYY-MM:voice` period
 * (admin/voice-margin-check.ts); the rest are the platform margin check.
 */
export function evaluateMarginAlerts(rows: MarginAlertRow[]): OpsAlert[] {
  const voice = rows.filter((row) => periodOf(row).endsWith(":voice"));
  const platform = rows.filter((row) => !periodOf(row).endsWith(":voice"));
  const build = (kind: "voice_margin" | "platform_margin", list: MarginAlertRow[]): OpsAlert | null => {
    if (list.length === 0) return null;
    return {
      kind,
      severity: "warning",
      title:
        kind === "voice_margin"
          ? `Voice gross margin below the floor for ${list.length} workspace${list.length === 1 ? "" : "s"}`
          : `Margin below 75% for ${list.length} workspace${list.length === 1 ? "" : "s"}`,
      lines: [
        ...list.slice(0, 10).map((row) => `Workspace ${row.business_id ?? "?"} (${row.severity ?? "?"}), ${periodOf(row) || "no period"}`),
        "Admin -> Economics for the detail.",
      ],
      fingerprint: list.map((row) => row.id).sort().join(","),
    };
  };
  return [build("voice_margin", voice), build("platform_margin", platform)].filter(
    (alert): alert is OpsAlert => alert !== null,
  );
}

/* ------------------------------------------------------------- delivery */

export function formatAlertEmail(alerts: OpsAlert[], siteUrl: string): { subject: string; text: string } {
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const lead = alerts[0];
  const subject =
    alerts.length === 1
      ? `[ClientTurn ops] ${lead.severity === "critical" ? "CRITICAL: " : ""}${lead.title}`
      : `[ClientTurn ops] ${alerts.length} alerts${critical ? ` (${critical} critical)` : ""}: ${lead.title}`;
  const body = alerts
    .map((alert) => [`${alert.severity.toUpperCase()}: ${alert.title}`, ...alert.lines.map((line) => `  - ${line}`)].join("\n"))
    .join("\n\n");
  return {
    subject: scrubString(subject).slice(0, 180),
    text: `${body}\n\nAdmin: ${siteUrl.replace(/\/$/, "")}/admin/system\nSent by the ops alert check (src/lib/ops/alerts.ts). Each alert is sent at most once an hour.`,
  };
}

/** Slack incoming-webhook compatible (`text` with mrkdwn). */
export function formatSlackPayload(alerts: OpsAlert[]): { text: string } {
  return {
    text: alerts
      .map((alert) => [`*${alert.severity === "critical" ? ":red_circle:" : ":large_yellow_circle:"} ${alert.title}*`, ...alert.lines.map((line) => `• ${line}`)].join("\n"))
      .join("\n\n"),
  };
}

/** Which checks run where. The worker runs its set every 5 minutes. */
export type OpsCheckScope = "worker" | "daily" | "heartbeat";

/** True on the one worker tick per five minutes that runs the checks. */
export function isOpsCheckTick(now: Date): boolean {
  return now.getUTCMinutes() % 5 === 0 && now.getUTCSeconds() < 30;
}

/** Provider probes run on the ops check every 15 minutes. */
export function isProviderProbeTick(now: Date): boolean {
  return now.getUTCMinutes() % 15 === 0 && now.getUTCSeconds() < 30;
}
