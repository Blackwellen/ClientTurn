import "server-only";
import {
  areaForJobType,
  areaForProvider,
  fingerprintFor,
  referenceFor,
  severityForArea,
} from "./errors-shared";
import { rangeStart } from "./events";
import { adminRead, namesFor, truncate, unique, type AdminClient } from "./shared";
import type {
  AdminRange,
  ErrorListResult,
  ErrorSeverity,
  ErrorTriageStatus,
  PlatformErrorRow,
} from "./types";

/**
 * One consolidated platform-error surface, derived from the tables that
 * already record failures. There is no Sentry SDK in this codebase, so there
 * is nothing to mirror and nothing to copy — a Sentry link is only ever shown
 * when `platform_error_triage.sentry_issue_url` actually holds one.
 *
 * Local triage state (status, who resolved it, when) is the one thing the
 * source rows cannot express, so that — and only that — is persisted.
 */

const SOURCE_CAP = 1000;

type RawError = {
  area: string;
  businessId: string | null;
  message: string;
  occurredAt: string;
};

async function collectRawErrors(
  supabase: AdminClient,
  since: string,
): Promise<RawError[]> {
  const [jobs, webhooks, messages, integrations] = await Promise.all([
    supabase
      .from("jobs")
      .select("type, business_id, last_error, created_at, state, attempts, max_attempts")
      .in("state", ["failed", "dead"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_CAP),
    supabase
      .from("webhook_events")
      .select("provider, business_id, last_error, received_at")
      .eq("status", "failed")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(SOURCE_CAP),
    supabase
      .from("messages")
      .select("business_id, channel, error_code, error_message, created_at")
      .eq("status", "FAILED")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SOURCE_CAP),
    supabase
      .from("integrations")
      .select("business_id, provider_type, last_error_code, last_error_message, last_error_at")
      .not("last_error_at", "is", null)
      .gte("last_error_at", since)
      .order("last_error_at", { ascending: false })
      .limit(SOURCE_CAP),
  ]);

  const raw: RawError[] = [];

  for (const row of jobs.data ?? []) {
    const exhausted = row.state === "dead" || row.attempts >= row.max_attempts;
    raw.push({
      area: areaForJobType(row.type),
      businessId: row.business_id,
      message: row.last_error
        ? truncate(row.last_error, 160)
        : exhausted
          ? "Retry worker exceeded max attempts"
          : "Background job failed without an error message",
      occurredAt: row.created_at,
    });
  }

  for (const row of webhooks.data ?? []) {
    raw.push({
      area: areaForProvider(row.provider),
      businessId: row.business_id,
      message: truncate(row.last_error ?? "Webhook delivery failed", 160),
      occurredAt: row.received_at,
    });
  }

  for (const row of messages.data ?? []) {
    raw.push({
      area: row.channel === "whatsapp" ? "WhatsApp" : "Messaging / SMS",
      businessId: row.business_id,
      message: truncate(
        row.error_message ?? `Message delivery failed (${row.error_code ?? "no code"})`,
        160,
      ),
      occurredAt: row.created_at,
    });
  }

  for (const row of integrations.data ?? []) {
    if (!row.last_error_at) continue;
    raw.push({
      area: areaForProvider(row.provider_type),
      businessId: row.business_id,
      message: truncate(
        row.last_error_message ??
          `Connection error (${row.last_error_code ?? "no code"})`,
        160,
      ),
      occurredAt: row.last_error_at,
    });
  }

  return raw;
}

type Group = {
  fingerprint: string;
  reference: string;
  area: string;
  businessId: string | null;
  message: string;
  severity: ErrorSeverity;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
};

/** Groups identical faults so one flapping job cannot flood the table. */
function group(raw: RawError[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const row of raw) {
    const fingerprint = fingerprintFor(row.area, row.message, row.businessId);
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.occurrences += 1;
      if (row.occurredAt < existing.firstSeen) existing.firstSeen = row.occurredAt;
      if (row.occurredAt > existing.lastSeen) existing.lastSeen = row.occurredAt;
      continue;
    }
    groups.set(fingerprint, {
      fingerprint,
      reference: referenceFor(row.area, fingerprint),
      area: row.area,
      businessId: row.businessId,
      message: row.message,
      severity: severityForArea(row.area, row.message),
      firstSeen: row.occurredAt,
      lastSeen: row.occurredAt,
      occurrences: 1,
    });
  }
  return groups;
}

const EMPTY_COUNTS = (): Record<ErrorSeverity, number> => ({
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
});

export type ErrorFilters = {
  search: string;
  severity: ErrorSeverity | "all";
  area: string;
  status: ErrorTriageStatus | "all";
  range: AdminRange;
  sort: "newest" | "oldest" | "severity" | "occurrences";
  page: number;
  pageSize: number;
};

const SEVERITY_ORDER: Record<ErrorSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const SERIES_BUCKETS = 24;

export async function listPlatformErrors(
  filters: ErrorFilters,
): Promise<ErrorListResult> {
  const supabase = await adminRead();
  const since = rangeStart(filters.range);
  const windowMs = Date.now() - new Date(since).getTime();
  const previousSince = new Date(Date.now() - windowMs * 2).toISOString();

  const raw = await collectRawErrors(supabase, previousSince);
  const currentRaw = raw.filter((row) => row.occurredAt >= since);
  const previousRaw = raw.filter((row) => row.occurredAt < since);

  const groups = [...group(currentRaw).values()];
  const previousGroups = [...group(previousRaw).values()];

  const [{ data: triageRows }, names] = await Promise.all([
    supabase
      .from("platform_error_triage")
      .select("fingerprint, status, sentry_issue_url, resolved_at")
      .in(
        "fingerprint",
        groups.length > 0 ? groups.map((row) => row.fingerprint) : ["none"],
      ),
    namesFor(supabase, unique(groups.map((row) => row.businessId))),
  ]);

  const triageByFingerprint = new Map(
    (triageRows ?? []).map((row) => [row.fingerprint, row]),
  );

  const rows: PlatformErrorRow[] = groups.map((row) => {
    const triage = triageByFingerprint.get(row.fingerprint);
    return {
      fingerprint: row.fingerprint,
      reference: row.reference,
      area: row.area,
      businessId: row.businessId,
      businessName: row.businessId
        ? (names.get(row.businessId) ?? "Unknown workspace")
        : "Platform",
      message: row.message,
      severity: row.severity,
      status: (triage?.status as ErrorTriageStatus) ?? "OPEN",
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      occurrences: row.occurrences,
      sentryIssueUrl: triage?.sentry_issue_url ?? null,
      resolvedAt: triage?.resolved_at ?? null,
    };
  });

  const search = filters.search.trim().toLowerCase().slice(0, 80);
  const filtered = rows.filter((row) => {
    if (filters.severity !== "all" && row.severity !== filters.severity) return false;
    if (filters.area !== "all" && row.area !== filters.area) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (search) {
      const haystack =
        `${row.reference} ${row.area} ${row.businessName} ${row.message}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    switch (filters.sort) {
      case "oldest":
        return a.lastSeen.localeCompare(b.lastSeen);
      case "severity":
        return (
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          b.lastSeen.localeCompare(a.lastSeen)
        );
      case "occurrences":
        return b.occurrences - a.occurrences;
      case "newest":
      default:
        return b.lastSeen.localeCompare(a.lastSeen);
    }
  });

  const counts = EMPTY_COUNTS();
  for (const row of rows) counts[row.severity] += 1;
  const previousCounts = EMPTY_COUNTS();
  for (const row of previousGroups) previousCounts[row.severity] += 1;

  // Real per-bucket occurrence counts over the selected window — the card
  // sparklines are the same data as the counts above, not a decoration.
  const series: Record<ErrorSeverity, number[]> = {
    CRITICAL: new Array(SERIES_BUCKETS).fill(0),
    HIGH: new Array(SERIES_BUCKETS).fill(0),
    MEDIUM: new Array(SERIES_BUCKETS).fill(0),
    LOW: new Array(SERIES_BUCKETS).fill(0),
  };
  const startMs = new Date(since).getTime();
  const bucketMs = windowMs / SERIES_BUCKETS;
  for (const row of currentRaw) {
    const severity = severityForArea(row.area, row.message);
    const index = Math.min(
      SERIES_BUCKETS - 1,
      Math.max(0, Math.floor((new Date(row.occurredAt).getTime() - startMs) / bucketMs)),
    );
    series[severity][index] += 1;
  }

  const from = (filters.page - 1) * filters.pageSize;

  return {
    rows: filtered.slice(from, from + filters.pageSize),
    total: filtered.length,
    page: filters.page,
    pageSize: filters.pageSize,
    counts,
    previousCounts,
    series,
    areas: unique(rows.map((row) => row.area)).sort(),
  };
}

/**
 * Re-derives one group so a drawer opened from a deep link shows current data
 * rather than whatever the table happened to be holding.
 */
export async function getPlatformError(
  fingerprint: string,
  range: AdminRange,
): Promise<PlatformErrorRow | null> {
  const result = await listPlatformErrors({
    search: "",
    severity: "all",
    area: "all",
    status: "all",
    range,
    sort: "newest",
    page: 1,
    pageSize: 10000,
  });
  return result.rows.find((row) => row.fingerprint === fingerprint) ?? null;
}
