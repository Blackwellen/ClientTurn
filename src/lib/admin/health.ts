import "server-only";
import type { JobType } from "@/lib/jobs/queue";
import { providerLabel } from "./format";
import { getProviderHealth } from "./providers";
import { adminRead, namesFor, truncate, unique } from "./shared";
import type {
  DegradedWorkspaceRow,
  QueueHealthRow,
  QueueHealthStatus,
  SystemHealth,
} from "./types";

/**
 * Health is the operational view: is each provider answering, is each queue
 * draining, and which customer workspaces are feeling it. Queue names below
 * are groupings of the real `JobType` union — nothing is invented, and adding
 * a job type without adding it here is a type error.
 */

const QUEUES: { key: string; label: string; types: JobType[] }[] = [
  {
    key: "lead_ingestion",
    label: "Lead ingestion",
    types: ["lead.process", "lead_source.poll"],
  },
  {
    key: "message_dispatch",
    label: "Message dispatch",
    types: [
      "message.send",
      "message.process_inbound",
      "automation.advance",
      "campaign.expand",
      "campaign.send",
    ],
  },
  { key: "booking_sync", label: "Booking sync", types: ["booking.sync"] },
  {
    key: "billing_webhooks",
    label: "Billing webhooks",
    types: ["webhook.replay"],
  },
  {
    key: "notifications",
    label: "Notifications",
    types: ["notification.send", "notification.slack"],
  },
  {
    key: "nightly_summaries",
    label: "Nightly summaries",
    types: [
      "usage.aggregate",
      "retention.cleanup",
      "cost.rollup_daily",
      "cost.rollup_monthly",
      "integration.health_check",
      "crm.push",
    ],
  },
];

/** A queue with work waiting and nothing moving for this long is stalled. */
const STALL_MS = 30 * 60 * 1000;

function queueStatus(
  pending: number,
  failed: number,
  lastRunAt: string | null,
): QueueHealthStatus {
  const stale =
    lastRunAt === null || Date.now() - new Date(lastRunAt).getTime() > STALL_MS;
  if (pending > 0 && stale) return "STALLED";
  if (failed > 0) return "DEGRADED";
  return "HEALTHY";
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const supabase = await adminRead();

  const [providers, openJobs, recentRuns, integrationIssues, failedJobRows] =
    await Promise.all([
      getProviderHealth(supabase),
      // Everything not yet finished, plus every failure. Completed jobs are
      // excluded so this stays small no matter how much has been processed.
      supabase
        .from("jobs")
        .select("type, state")
        .in("state", ["pending", "running", "failed", "dead"])
        .limit(20000),
      supabase
        .from("jobs")
        .select("type, completed_at")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(400),
      supabase
        .from("integrations")
        .select("business_id, provider_type, status, last_error_at, last_error_message")
        .in("status", ["DEGRADED", "ACTION_REQUIRED", "DISCONNECTED"])
        .order("last_error_at", { ascending: false, nullsFirst: false })
        .limit(400),
      supabase
        .from("jobs")
        .select("business_id, type, state, created_at")
        .in("state", ["failed", "dead"])
        .not("business_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(400),
    ]);

  /* ---------------------------------------------------------------- queues */

  const typeToQueue = new Map<string, string>();
  for (const queue of QUEUES) {
    for (const type of queue.types) typeToQueue.set(type, queue.key);
  }

  const tally = new Map<
    string,
    { pending: number; processing: number; failed: number }
  >();
  for (const queue of QUEUES) {
    tally.set(queue.key, { pending: 0, processing: 0, failed: 0 });
  }

  for (const row of openJobs.data ?? []) {
    const key = typeToQueue.get(row.type);
    if (!key) continue;
    const entry = tally.get(key)!;
    if (row.state === "pending") entry.pending += 1;
    else if (row.state === "running") entry.processing += 1;
    else entry.failed += 1;
  }

  const lastRunByQueue = new Map<string, string>();
  for (const row of recentRuns.data ?? []) {
    const key = typeToQueue.get(row.type);
    if (!key || !row.completed_at) continue;
    if (!lastRunByQueue.has(key)) lastRunByQueue.set(key, row.completed_at);
  }

  const queues: QueueHealthRow[] = QUEUES.map((queue) => {
    const entry = tally.get(queue.key)!;
    const lastRunAt = lastRunByQueue.get(queue.key) ?? null;
    return {
      key: queue.key,
      label: queue.label,
      pending: entry.pending,
      processing: entry.processing,
      failed: entry.failed,
      lastRunAt,
      status: queueStatus(entry.pending, entry.failed, lastRunAt),
    };
  });

  /* --------------------------------------------------- degraded workspaces */

  const names = await namesFor(
    supabase,
    unique([
      ...(integrationIssues.data ?? []).map((row) => row.business_id),
      ...(failedJobRows.data ?? []).map((row) => row.business_id),
    ]),
  );
  const nameOf = (id: string) => names.get(id) ?? "Unknown workspace";

  const degraded: DegradedWorkspaceRow[] = [];
  const seen = new Set<string>();

  for (const row of integrationIssues.data ?? []) {
    const key = `${row.business_id}:${row.provider_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    degraded.push({
      id: `integration-${key}`,
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      area: `${providerLabel(row.provider_type)} connection`,
      impact:
        row.status === "DISCONNECTED"
          ? "Connection dropped — this provider is not running for the workspace"
          : truncate(
              row.last_error_message ?? "Connection reporting errors",
              70,
            ),
      since: row.last_error_at,
      status: row.status === "ACTION_REQUIRED" ? "Critical" : "Degraded",
    });
  }

  const jobsByBusiness = new Map<
    string,
    { count: number; type: string; since: string }
  >();
  for (const row of failedJobRows.data ?? []) {
    if (!row.business_id) continue;
    const entry = jobsByBusiness.get(row.business_id);
    if (entry) entry.count += 1;
    else
      jobsByBusiness.set(row.business_id, {
        count: 1,
        type: row.type,
        since: row.created_at,
      });
  }

  for (const [businessId, entry] of jobsByBusiness) {
    if (entry.count < 2) continue;
    degraded.push({
      id: `jobs-${businessId}`,
      businessId,
      businessName: nameOf(businessId),
      area: "Background jobs",
      impact: `${entry.count} failed jobs, most recently ${entry.type}`,
      since: entry.since,
      status: entry.count >= 5 ? "Critical" : "Investigating",
    });
  }

  degraded.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));

  const failedJobs = queues.reduce((total, queue) => total + queue.failed, 0);
  const impactedWorkspaces = unique(degraded.map((row) => row.businessId)).length;

  return {
    checkedAt:
      providers.map((row) => row.lastCheckedAt).filter(Boolean).sort().at(-1) ??
      null,
    summary: {
      providersMonitored: providers.length,
      healthyProviders: providers.filter((row) => row.status === "HEALTHY").length,
      degradedServices: providers.filter(
        (row) => row.status === "DEGRADED" || row.status === "DOWN",
      ).length,
      failedJobs,
      workspacesWithIssues: impactedWorkspaces,
    },
    providers,
    queues,
    degradedWorkspaces: degraded.slice(0, 12),
  };
}
