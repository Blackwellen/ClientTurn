import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { obs } from "@/lib/observability/log";
import {
  OPS_THRESHOLDS,
  evaluateBacklog,
  evaluateCronHealth,
  evaluateDeadJobs,
  evaluateMarginAlerts,
  evaluateProviders,
  evaluateWebhookFailures,
  formatAlertEmail,
  formatSlackPayload,
  type CronHealthRow,
  type OpsAlert,
  type OpsCheckScope,
} from "./alert-model";

/**
 * Push alerts for the platform operator (docs/OBSERVABILITY.md "Push alerts").
 *
 * Before this, dead jobs, webhook failures, cron misses and margin alerts were
 * pull-only: somebody had to open Admin. The checks (alert-model.ts) run:
 *
 *   * from the worker, every 5 minutes (`isOpsCheckTick`), with provider
 *     probes every 15 minutes;
 *   * from the daily cron, everything;
 *   * from `/api/cron/heartbeat`, the cron checks only, for an external uptime
 *     monitor to call: it is the one path that still works when pg_cron itself
 *     has stopped.
 *
 * DELIVERY. Email to `OPS_ALERT_EMAIL` (comma separated) through Resend, the
 * same API path as the other system email, and/or a POST to
 * `OPS_ALERT_WEBHOOK_URL` (Slack incoming-webhook compatible). With neither
 * configured, the alert is still written to the log as `ops.alert`.
 *
 * DEDUPE. Per alert kind, at most one delivery an hour, and the same
 * fingerprint (the same dead jobs, the same stopped schedule) at most once a
 * day. Both use the shared Postgres fixed-window counter (`consume_rate_limit`)
 * so they hold across serverless instances; if that counter is unavailable an
 * in-process map stands in, so a database blip cannot become an email storm.
 *
 * Never throws: an alert failure must not fail the worker tick it rides on.
 */

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;
const DELIVERY_TIMEOUT_MS = 5_000;

type Admin = ReturnType<typeof createAdminClient>;

function alertEmails(): string[] {
  return (process.env.OPS_ALERT_EMAIL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function alertWebhookUrl(): string | null {
  const url = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  return url && url.startsWith("https://") ? url : null;
}

/* ------------------------------------------------------------- gathering */

async function lastJobCompletedAt(admin: Admin): Promise<string | null> {
  // The newest completed jobs by created_at (indexed on state, created_at);
  // outreach.tick completes every 5 minutes on a live worker.
  const { data, error } = await admin
    .from("jobs")
    .select("completed_at")
    .eq("state", "completed")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`jobs read: ${error.message}`);
  const times = (data ?? []).map((row) => row.completed_at).filter((value): value is string => Boolean(value));
  return times.sort().at(-1) ?? null;
}

async function cronHealth(admin: Admin): Promise<CronHealthRow[] | null> {
  const { data, error } = await (admin as unknown as {
    from: (table: string) => { select: (columns: string) => Promise<{ data: CronHealthRow[] | null; error: { message: string } | null }> };
  })
    .from("cron_job_health")
    .select("jobname, status, start_time, return_message");
  if (error) {
    obs.warn("ops.error", { stage: "cron_job_health", code: error.message.slice(0, 120) });
    return null;
  }
  return data ?? [];
}

async function gather(scope: OpsCheckScope, now: Date, probeProviders: boolean): Promise<OpsAlert[]> {
  const admin = createAdminClient();
  const alerts: OpsAlert[] = [];

  const attempt = async (stage: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      obs.error("ops.error", { stage, error });
    }
  };

  // Cron health: every scope. The worker cannot usefully report its own
  // schedule missing (it is running), so it checks the daily job and the app
  // completions; the daily cron and the heartbeat check the worker too.
  await attempt("cron", async () => {
    const [rows, lastCompleted] = await Promise.all([cronHealth(admin), lastJobCompletedAt(admin)]);
    alerts.push(
      ...evaluateCronHealth({
        rows,
        lastJobCompletedAt: lastCompleted,
        now,
        checkWorker: scope !== "worker",
      }),
    );
  });

  if (scope === "heartbeat") return alerts;

  await attempt("dead_jobs", async () => {
    const since = new Date(now.getTime() - OPS_THRESHOLDS.deadJobLookbackHours * HOUR_S * 1000).toISOString();
    const { data, error } = await admin
      .from("jobs")
      .select("id, type, business_id, last_error, created_at")
      .eq("state", "dead")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const alert = evaluateDeadJobs(data ?? []);
    if (alert) alerts.push(alert);
  });

  await attempt("webhooks", async () => {
    const since = new Date(now.getTime() - OPS_THRESHOLDS.webhookWindowMinutes * 60_000).toISOString();
    const { data, error } = await admin
      .from("webhook_events")
      .select("provider, status")
      .gte("received_at", since)
      .limit(5000);
    if (error) throw new Error(error.message);
    const alert = evaluateWebhookFailures(data ?? [], now);
    if (alert) alerts.push(alert);
  });

  await attempt("backlog", async () => {
    const cutoff = now.toISOString();
    const { data, error, count } = await admin
      .from("jobs")
      .select("run_at", { count: "estimated" })
      .eq("state", "pending")
      .lte("run_at", cutoff)
      .order("run_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    const alert = evaluateBacklog({ oldestDueRunAt: data?.[0]?.run_at ?? null, dueCount: count ?? 0, now });
    if (alert) alerts.push(alert);
  });

  await attempt("margin", async () => {
    const since = new Date(now.getTime() - OPS_THRESHOLDS.marginLookbackHours * HOUR_S * 1000).toISOString();
    const { data, error } = await admin
      .from("economics_alerts")
      .select("id, business_id, severity, title, metrics_json, created_at")
      .eq("alert_type", "MARGIN_BELOW_THRESHOLD")
      .eq("status", "OPEN")
      .gte("created_at", since)
      .limit(200);
    if (error) throw new Error(error.message);
    alerts.push(...evaluateMarginAlerts((data ?? []) as never));
  });

  if (probeProviders || scope === "daily") {
    await attempt("providers", async () => {
      const { runProviderProbes, recordProbeResults } = await import("@/lib/admin/providers");
      const results = await runProviderProbes();
      // Recorded too, so the probe series behind Admin -> System uptime is
      // filled on a schedule rather than only when somebody presses refresh.
      await recordProbeResults(admin as never, results);
      const alert = evaluateProviders(results, now);
      if (alert) alerts.push(alert);
    });
  }

  return alerts;
}

/* --------------------------------------------------------------- dedupe */

const memory = new Map<string, number>();

function memoryAllow(key: string, windowSeconds: number, now: number): boolean {
  const until = memory.get(key);
  if (until && until > now) return false;
  memory.set(key, now + windowSeconds * 1000);
  return true;
}

async function consume(admin: Admin, bucket: string, identifier: string, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_identifier: identifier,
      p_limit: 1,
      p_window_seconds: windowSeconds,
    });
    if (error || !data || data.length === 0) return memoryAllow(`${bucket}:${identifier}`, windowSeconds, Date.now());
    return Boolean(data[0].allowed);
  } catch {
    return memoryAllow(`${bucket}:${identifier}`, windowSeconds, Date.now());
  }
}

/** One delivery per kind per hour, and one per fingerprint per day. */
async function shouldSend(admin: Admin, alert: OpsAlert): Promise<boolean> {
  if (!(await consume(admin, "ops_alert:hour", alert.kind, HOUR_S))) return false;
  return consume(admin, "ops_alert:fingerprint", `${alert.kind}:${alert.fingerprint}`.slice(0, 400), DAY_S);
}

/* ------------------------------------------------------------- delivery */

async function sendEmail(alerts: OpsAlert[]): Promise<boolean> {
  const to = alertEmails();
  const key = serverEnv.resend.apiKey;
  if (to.length === 0 || !key) return false;
  const { subject, text } = formatAlertEmail(alerts, serverEnv.siteUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: serverEnv.resend.from, to, subject, text }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Resend responded ${response.status}`);
  return true;
}

async function sendWebhook(alerts: OpsAlert[]): Promise<boolean> {
  const url = alertWebhookUrl();
  if (!url) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formatSlackPayload(alerts)),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Alert webhook responded ${response.status}`);
  return true;
}

export type OpsCheckResult = { raised: string[]; sent: string[]; delivered: string[] };

/**
 * Runs the checks for `scope`, dedupes, and delivers what is new.
 * Never throws.
 */
export async function runOpsAlertChecks(
  scope: OpsCheckScope,
  options: { now?: Date; probeProviders?: boolean } = {},
): Promise<OpsCheckResult> {
  const now = options.now ?? new Date();
  const result: OpsCheckResult = { raised: [], sent: [], delivered: [] };
  try {
    const alerts = await gather(scope, now, options.probeProviders ?? false);
    result.raised = alerts.map((alert) => alert.kind);
    if (alerts.length === 0) return result;

    const admin = createAdminClient();
    const fresh: OpsAlert[] = [];
    for (const alert of alerts) {
      if (await shouldSend(admin, alert)) fresh.push(alert);
    }
    result.sent = fresh.map((alert) => alert.kind);
    if (fresh.length === 0) return result;

    for (const alert of fresh) {
      obs.warn("ops.alert", { kind: alert.kind, severity: alert.severity, title: alert.title, scope });
    }

    const outcomes = await Promise.allSettled([sendEmail(fresh), sendWebhook(fresh)]);
    const [email, webhook] = outcomes;
    if (email.status === "fulfilled" && email.value) result.delivered.push("email");
    if (webhook.status === "fulfilled" && webhook.value) result.delivered.push("webhook");
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") obs.error("ops.error", { stage: "delivery", error: outcome.reason });
    }
  } catch (error) {
    obs.error("ops.error", { stage: "run", scope, error });
  }
  return result;
}

/** For the heartbeat route: is the worker alive? Read-only, no delivery. */
export async function workerIsAlive(now = new Date()): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const [rows, lastCompleted] = await Promise.all([cronHealth(admin), lastJobCompletedAt(admin)]);
    const misses = evaluateCronHealth({ rows, lastJobCompletedAt: lastCompleted, now, checkWorker: true }).filter(
      (alert) => alert.kind === "worker_cron_miss" || alert.kind === "worker_app_miss",
    );
    return misses.length === 0;
  } catch {
    return false;
  }
}
