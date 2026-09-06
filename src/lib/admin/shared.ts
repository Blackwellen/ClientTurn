import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "./guard";
import type { AdminRange, IntegrationHealth } from "./types";

export type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Every admin read goes through here. `requirePlatformAdmin()` re-asserts
 * platform-admin status against the database before a service-role client is
 * handed out, so a service-role result can never be produced for a request
 * that has not proved its role — route visibility is never the control.
 */
export async function adminRead(): Promise<AdminClient> {
  await requirePlatformAdmin();
  return createAdminClient();
}

export function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

export async function namesFor(
  supabase: AdminClient,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("businesses")
    .select("id, name")
    .in("id", ids);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* ---------------------------------------------------------------- ranges --- */

export type RangeWindow = {
  range: AdminRange;
  /** Inclusive start of the selected window. */
  start: Date;
  end: Date;
  /** Start of the immediately preceding window of identical length. */
  previousStart: Date;
  /** Number of sparkline buckets across the window. */
  buckets: number;
  bucketMs: number;
};

const RANGE_HOURS: Record<AdminRange, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
};

/** 24 hourly points, or one point per day — enough shape without noise. */
const RANGE_BUCKETS: Record<AdminRange, number> = {
  "24h": 24,
  "7d": 28,
  "30d": 30,
  "90d": 30,
};

export function rangeWindow(range: AdminRange, now = new Date()): RangeWindow {
  const lengthMs = RANGE_HOURS[range] * 3_600_000;
  const end = now;
  const start = new Date(end.getTime() - lengthMs);
  const buckets = RANGE_BUCKETS[range];
  return {
    range,
    start,
    end,
    previousStart: new Date(start.getTime() - lengthMs),
    buckets,
    bucketMs: lengthMs / buckets,
  };
}

/**
 * Buckets ISO timestamps into the window's sparkline slots. Timestamps before
 * the window start are ignored, so a "current + previous" fetch can be bucketed
 * with the same call that counts it.
 */
export function bucketSeries(
  timestamps: (string | null | undefined)[],
  window: RangeWindow,
): number[] {
  const series = new Array<number>(window.buckets).fill(0);
  for (const value of timestamps) {
    if (!value) continue;
    const t = new Date(value).getTime();
    if (Number.isNaN(t) || t < window.start.getTime()) continue;
    const index = Math.min(
      window.buckets - 1,
      Math.floor((t - window.start.getTime()) / window.bucketMs),
    );
    if (index >= 0) series[index] += 1;
  }
  return series;
}

export function countInWindow(
  timestamps: (string | null | undefined)[],
  from: Date,
  to: Date,
): number {
  let total = 0;
  for (const value of timestamps) {
    if (!value) continue;
    const t = new Date(value).getTime();
    if (t >= from.getTime() && t < to.getTime()) total += 1;
  }
  return total;
}

export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

/* --------------------------------------------------------------- health --- */

const HEALTH_RANK: Record<string, number> = {
  DISCONNECTED: 0,
  HEALTHY: 1,
  TESTING: 1,
  DEGRADED: 2,
  ACTION_REQUIRED: 3,
};

/**
 * The single connection-health roll-up. A workspace is only as healthy as its
 * worst connection; a workspace with nothing connected is "unknown" rather
 * than healthy, because there is no evidence either way.
 */
export function rollUpHealth(statuses: string[]): IntegrationHealth {
  if (statuses.length === 0) return "DISCONNECTED";
  let worst = "HEALTHY";
  for (const status of statuses) {
    if ((HEALTH_RANK[status] ?? 0) > (HEALTH_RANK[worst] ?? 0)) worst = status;
  }
  if (worst === "TESTING") return "HEALTHY";
  return worst as IntegrationHealth;
}

export function countConnectionIssues(statuses: string[]): number {
  return statuses.filter(
    (status) => status === "DEGRADED" || status === "ACTION_REQUIRED",
  ).length;
}

/* ------------------------------------------------------------- redaction --- */

const SECRET_KEY = /(token|secret|password|signature|authorization|auth|key|credential|cookie|session|api[_-]?key|sig)/i;

/**
 * Truncates and redacts a value before it is shown to an operator. Anything
 * whose key looks like a credential is replaced outright rather than masked
 * partially — a partial secret is still a secret.
 */
export function redactValue(key: string, value: unknown): string {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    return truncate(JSON.stringify(value), 200);
  }
  return truncate(String(value), 200);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Redacts a webhook payload for the Event detail drawer: secret-looking keys
 * are dropped at every depth, and the result is capped so a huge payload
 * cannot be dumped into the browser.
 */
export function redactPayload(payload: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(payload)) {
    return payload.slice(0, 20).map((item) => redactPayload(item, depth + 1));
  }
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactPayload(value, depth + 1);
    }
    return out;
  }
  if (typeof payload === "string") return truncate(payload, 300);
  return payload;
}
