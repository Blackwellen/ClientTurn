import { test, describe } from "node:test";
import assert from "node:assert/strict";
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
  isOpsCheckTick,
} from "../src/lib/ops/alert-model.ts";

/**
 * The push-alert rules (src/lib/ops/alert-model.ts). Pure: rows in, alerts
 * out. No database, no email, no network.
 */

const now = new Date("2026-09-28T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;

describe("dead jobs", () => {
  test("none -> no alert; some -> one critical alert grouped by type, fingerprint changes with a new dead job", () => {
    assert.equal(evaluateDeadJobs([]), null);
    const rows = [
      { id: "a1", type: "voice.dial", business_id: "b", last_error: "Provider refused +447700900123 for jo@example.co.uk", created_at: ago(5 * MIN) },
      { id: "a2", type: "voice.dial", business_id: "b", last_error: null, created_at: ago(10 * MIN) },
      { id: "a3", type: "invoice.issue", business_id: null, last_error: null, created_at: ago(20 * MIN) },
    ];
    const alert = evaluateDeadJobs(rows)!;
    assert.equal(alert.kind, "dead_jobs");
    assert.equal(alert.severity, "critical");
    assert.ok(alert.lines.includes("voice.dial: 2"));
    const text = alert.lines.join(" ");
    assert.ok(!text.includes("jo@example.co.uk") && !text.includes("7700900123"), "error text is scrubbed");
    const again = evaluateDeadJobs([...rows, { id: "a4", type: "quote.render_pdf", business_id: null, last_error: null, created_at: ago(MIN) }])!;
    assert.notEqual(again.fingerprint, alert.fingerprint);
    assert.equal(evaluateDeadJobs([...rows].reverse())!.fingerprint, alert.fingerprint);
  });
});

describe("webhook failure spike", () => {
  test("below the threshold is quiet; at it, one alert per provider set per window", () => {
    const few = Array.from({ length: OPS_THRESHOLDS.webhookFailures - 1 }, () => ({ provider: "stripe", status: "failed" }));
    assert.equal(evaluateWebhookFailures(few, now), null);
    const many = [...few, { provider: "twilio", status: "failed" }, { provider: "meta", status: "processed" }];
    const alert = evaluateWebhookFailures(many, now)!;
    assert.equal(alert.kind, "webhook_failures");
    assert.match(alert.lines.join("\n"), /stripe: 4 failed/);
  });
});

describe("cron health", () => {
  const healthy = [
    { jobname: "clientturn-worker", status: "succeeded", start_time: ago(20_000) },
    { jobname: "clientturn-daily", status: "succeeded", start_time: ago(9 * 60 * MIN) },
    { jobname: "clientturn-reap", status: "succeeded", start_time: ago(2 * MIN) },
  ];

  test("a healthy schedule raises nothing", () => {
    assert.deepEqual(evaluateCronHealth({ rows: healthy, lastJobCompletedAt: ago(MIN), now, checkWorker: true }), []);
  });

  test("worker not scheduled for over N minutes -> worker_cron_miss", () => {
    const rows = healthy.map((row) => (row.jobname === "clientturn-worker" ? { ...row, start_time: ago(30 * MIN) } : row));
    const kinds = evaluateCronHealth({ rows, lastJobCompletedAt: ago(MIN), now, checkWorker: true }).map((a) => a.kind);
    assert.deepEqual(kinds, ["worker_cron_miss"]);
    // The worker itself does not check its own schedule.
    assert.deepEqual(evaluateCronHealth({ rows, lastJobCompletedAt: ago(MIN), now, checkWorker: false }), []);
  });

  test("pg_cron firing but no job completing (401 / 5xx) -> worker_app_miss", () => {
    const kinds = evaluateCronHealth({ rows: healthy, lastJobCompletedAt: ago(60 * MIN), now, checkWorker: true }).map((a) => a.kind);
    assert.deepEqual(kinds, ["worker_app_miss"]);
  });

  test("daily not run for 26 h -> daily_cron_miss; a failed run -> cron_job_failed", () => {
    const rows = [
      healthy[0],
      { jobname: "clientturn-daily", status: "succeeded", start_time: ago(27 * 60 * MIN) },
      { jobname: "clientturn-reap", status: "failed", start_time: ago(MIN), return_message: "ERROR: canceling statement" },
    ];
    const kinds = evaluateCronHealth({ rows, lastJobCompletedAt: ago(MIN), now, checkWorker: false }).map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["cron_job_failed", "daily_cron_miss"]);
  });

  test("a missing schedule row is itself an alert", () => {
    const kinds = evaluateCronHealth({ rows: [], lastJobCompletedAt: ago(MIN), now, checkWorker: true }).map((a) => a.kind).sort();
    assert.deepEqual(kinds, ["daily_cron_miss", "worker_cron_miss"]);
  });

  test("an unreadable view (null) still checks the app side", () => {
    assert.deepEqual(evaluateCronHealth({ rows: null, lastJobCompletedAt: ago(MIN), now, checkWorker: true }), []);
  });
});

describe("backlog, providers and margins", () => {
  test("backlog alerts only when the oldest due job is older than the threshold", () => {
    assert.equal(evaluateBacklog({ oldestDueRunAt: ago(2 * MIN), dueCount: 3, now }), null);
    assert.equal(evaluateBacklog({ oldestDueRunAt: null, dueCount: 0, now }), null);
    assert.equal(evaluateBacklog({ oldestDueRunAt: ago(40 * MIN), dueCount: 120, now })!.kind, "queue_backlog");
  });

  test("only configured providers that are DOWN alert", () => {
    assert.equal(
      evaluateProviders([{ provider: "stripe", status: "DEGRADED", errorCode: "slow", configured: true }], now),
      null,
    );
    assert.equal(evaluateProviders([{ provider: "meta", status: "DOWN", errorCode: null, configured: false }], now), null);
    const alert = evaluateProviders([{ provider: "twilio_sms", status: "DOWN", errorCode: "503", configured: true }], now)!;
    assert.equal(alert.kind, "provider_outage");
    assert.match(alert.title, /twilio_sms/);
  });

  test("voice and platform margin alerts are split by period", () => {
    const alerts = evaluateMarginAlerts([
      { id: "1", business_id: "b1", severity: "HIGH", title: "x", metrics_json: { period: "2026-09:voice" }, created_at: ago(MIN) },
      { id: "2", business_id: "b2", severity: "MEDIUM", title: "y", metrics_json: { period: "2026-09" }, created_at: ago(MIN) },
    ]);
    assert.deepEqual(alerts.map((a) => a.kind).sort(), ["platform_margin", "voice_margin"]);
    assert.deepEqual(evaluateMarginAlerts([]), []);
  });
});

describe("delivery formats", () => {
  test("email subject marks critical alerts and the body links to admin", () => {
    const alert = evaluateDeadJobs([{ id: "a", type: "voice.dial", business_id: null, last_error: null, created_at: ago(MIN) }])!;
    const email = formatAlertEmail([alert], "https://clientturn.com/");
    assert.match(email.subject, /^\[ClientTurn ops\] CRITICAL: 1 dead job/);
    assert.match(email.text, /https:\/\/clientturn\.com\/admin\/system/);
    assert.match(formatSlackPayload([alert]).text, /dead job/);
  });

  test("the worker runs the checks on one tick in each five minutes", () => {
    assert.equal(isOpsCheckTick(new Date("2026-09-28T12:05:10Z")), true);
    assert.equal(isOpsCheckTick(new Date("2026-09-28T12:05:40Z")), false);
    assert.equal(isOpsCheckTick(new Date("2026-09-28T12:06:10Z")), false);
  });
});
