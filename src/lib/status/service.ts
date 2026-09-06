import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JobType } from "@/lib/jobs/queue";

/**
 * StatusService — the one public-safe view of platform health (V4 §22).
 *
 * Two consumers, one definition: the public page at `status.clientturn.com`
 * and the System Status tab inside the support popout. §28's integration note
 * is explicit that these must never be able to disagree, so neither computes
 * anything of its own.
 *
 * The hard rule of this file is what it must NOT emit. It runs unauthenticated
 * on the public page, so nothing it returns may be tenant-scoped or
 * identifying:
 *
 *   * no business id, name, email, phone, or any customer record;
 *   * no queue payloads, no job arguments, no idempotency keys;
 *   * no credentials, endpoints, selectors or provider account ids;
 *   * no raw error text — only the short, stable labels mapped below.
 *
 * Anything not on the allow-list is dropped rather than passed through, so a
 * new provider or a new error code cannot leak by default.
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

/* ------------------------------------------------------------- definitions */

/**
 * The services the public page reports, and the internal signals behind each.
 *
 * `providers` are `platform_provider_checks.provider` values; `jobTypes` are
 * queue types. A service is only as healthy as the worst of its signals, which
 * is the honest reading — "email is fine except sending" is not fine.
 */
const SERVICES: {
  key: string;
  group: string;
  name: string;
  description: string;
  providers: string[];
  jobTypes: JobType[];
}[] = [
  {
    key: "lead_sources",
    group: "Lead sources",
    name: "Lead sources",
    description: "Inbound lead capture from connected marketing channels.",
    providers: ["meta"],
    jobTypes: ["lead_source.poll", "lead.process", "app.ingest"],
  },
  {
    key: "email",
    group: "Communication",
    name: "Email mailbox/sender",
    description: "Outbound email sending and mailbox infrastructure.",
    providers: ["imap_smtp", "email", "resend", "google", "microsoft"],
    jobTypes: ["message.send", "email.poll"],
  },
  {
    key: "sms",
    group: "Communication",
    name: "SMS",
    description: "SMS delivery via connected providers.",
    providers: ["twilio_sms", "twilio"],
    jobTypes: ["message.send"],
  },
  {
    key: "whatsapp",
    group: "Communication",
    name: "WhatsApp",
    description: "WhatsApp messaging using approved templates.",
    providers: ["twilio_whatsapp", "whatsapp_cloud"],
    jobTypes: ["message.send"],
  },
  {
    key: "booking",
    group: "Booking",
    name: "Booking",
    description: "Appointment booking and calendar integrations.",
    providers: ["calendly", "google_calendar"],
    jobTypes: ["booking.sync"],
  },
  {
    key: "sourcing",
    group: "Discovery",
    name: "Sourcing",
    description: "Prospect sourcing and enrichment pipelines.",
    providers: ["apollo", "hunter", "clearbit", "peopledatalabs", "serper"],
    jobTypes: ["sourcing.run", "recurring_search.tick"],
  },
  {
    key: "intent",
    group: "Discovery",
    name: "Intent monitors",
    description: "Intent signal collection and monitoring.",
    providers: [],
    jobTypes: ["recurring_search.tick"],
  },
  {
    key: "campaigns",
    group: "Outreach",
    name: "Campaigns",
    description: "Campaign processing and delivery.",
    providers: [],
    jobTypes: ["campaign.expand", "campaign.send", "outreach.dispatch", "outreach.tick", "outreach.audience"],
  },
  {
    key: "agents",
    group: "Platform",
    name: "Background agents",
    description: "AI agents and automated workflows.",
    providers: ["azure_openai", "openai"],
    jobTypes: ["agent.run", "automation.advance", "business.analyse"],
  },
  {
    key: "queues",
    group: "Platform",
    name: "Queue status",
    description: "Job queues and processing workers.",
    providers: [],
    jobTypes: [],
  },
  {
    key: "database",
    group: "Platform",
    name: "Database",
    description: "Core application database.",
    providers: ["supabase"],
    jobTypes: [],
  },
  {
    key: "storage",
    group: "Platform",
    name: "File storage",
    description: "File storage and media processing.",
    providers: ["r2", "cloudflare_r2"],
    jobTypes: [],
  },
];

const GROUP_ORDER = [
  "Lead sources",
  "Communication",
  "Booking",
  "Discovery",
  "Outreach",
  "Platform",
];

/**
 * Only these error codes are ever rendered publicly, and each maps to wording
 * that describes the class of problem without naming an endpoint, a customer
 * or a request. An unrecognised code becomes the generic label rather than
 * being printed.
 */
const PUBLIC_ERROR_LABELS: Record<string, string> = {
  timeout: "Provider timeout",
  rate_limited: "Rate limit exceeded",
  "429": "Rate limit exceeded",
  "500": "Provider error",
  "502": "Provider unavailable",
  "503": "Provider unavailable",
  "504": "Provider timeout",
  auth: "Provider authentication issue",
  "401": "Provider authentication issue",
  "403": "Provider authentication issue",
  enrichment_failed: "Enrichment provider error",
  send_failed: "Temporary send failure",
  retry_limit: "Worker retry limit reached",
};

const GENERIC_ERROR_LABEL = "Service degraded";

/** A probe older than this means we cannot claim to know the current state. */
const STALE_AFTER_MS = 20 * 60 * 1000;

const HISTORY_DAYS = 30;

/* ------------------------------------------------------------------ helpers */

function statusFromProbe(status: string): ServiceStatus {
  if (status === "HEALTHY") return "OPERATIONAL";
  if (status === "DEGRADED") return "DEGRADED";
  if (status === "DOWN") return "OUTAGE";
  // UNKNOWN is not "fine". A service we have not successfully probed is
  // reported as degraded rather than being quietly rendered green.
  return "DEGRADED";
}

/** The worst of several statuses. Order matters and is the whole point. */
function worst(statuses: ServiceStatus[]): ServiceStatus {
  if (statuses.includes("OUTAGE")) return "OUTAGE";
  if (statuses.includes("MAINTENANCE")) return "MAINTENANCE";
  if (statuses.includes("DEGRADED")) return "DEGRADED";
  return "OPERATIONAL";
}

function dayKey(value: string | Date): string {
  return (typeof value === "string" ? new Date(value) : value)
    .toISOString()
    .slice(0, 10);
}

/* ------------------------------------------------------------------- public */

/**
 * The whole public snapshot, in four reads.
 *
 * Deliberately not per-service queries: twelve services times two queries each
 * would be twenty-four round trips to render one page that is hit by everyone
 * during an incident — exactly when the database is least able to spare them.
 */
export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const admin = createAdminClient();
  const now = new Date();
  const since30d = new Date(now.getTime() - HISTORY_DAYS * 864e5).toISOString();
  const since24h = new Date(now.getTime() - 864e5).toISOString();

  const [probes, jobs24h] = await Promise.all([
    admin
      .from("platform_provider_checks")
      .select("provider, status, error_code, checked_at")
      .gte("checked_at", since30d)
      .order("checked_at", { ascending: false })
      .limit(20000),
    admin
      .from("jobs")
      .select("type, state, attempts, created_at, completed_at")
      .gte("created_at", since24h)
      .limit(20000),
  ]);

  const probeRows = probes.data ?? [];
  const jobRows = jobs24h.data ?? [];

  // Newest probe per provider, plus a per-day worst status for the sparkline.
  const latestByProvider = new Map<string, (typeof probeRows)[number]>();
  const dailyByProvider = new Map<string, Map<string, ServiceStatus>>();
  const lastSuccessByProvider = new Map<string, string>();
  const probeCounts = new Map<string, { healthy: number; total: number }>();

  for (const row of probeRows) {
    if (!latestByProvider.has(row.provider)) latestByProvider.set(row.provider, row);

    const day = dayKey(row.checked_at);
    const days = dailyByProvider.get(row.provider) ?? new Map<string, ServiceStatus>();
    const status = statusFromProbe(row.status);
    days.set(day, worst([days.get(day) ?? "OPERATIONAL", status]));
    dailyByProvider.set(row.provider, days);

    const counts = probeCounts.get(row.provider) ?? { healthy: 0, total: 0 };
    counts.total += 1;
    if (row.status === "HEALTHY") counts.healthy += 1;
    probeCounts.set(row.provider, counts);

    if (row.status === "HEALTHY" && !lastSuccessByProvider.has(row.provider)) {
      lastSuccessByProvider.set(row.provider, row.checked_at);
    }
  }

  // Queue health per job type, from the last 24 hours.
  const jobStats = new Map<string, { failed: number; total: number; last: string | null }>();
  for (const row of jobRows) {
    const entry = jobStats.get(row.type) ?? { failed: 0, total: 0, last: null };
    entry.total += 1;
    if (row.state === "failed" || row.state === "dead") entry.failed += 1;
    if (row.state === "completed" && row.completed_at) {
      if (!entry.last || row.completed_at > entry.last) entry.last = row.completed_at;
    }
    jobStats.set(row.type, entry);
  }

  const historyDays: string[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
    historyDays.push(dayKey(new Date(now.getTime() - i * 864e5)));
  }

  const services: StatusService[] = SERVICES.map((definition) => {
    const providerStatuses = definition.providers
      .map((provider) => latestByProvider.get(provider))
      .filter((row): row is (typeof probeRows)[number] => Boolean(row))
      .map((row) => statusFromProbe(row.status));

    // A queue with a meaningful failure share degrades its service. One failed
    // job out of ten thousand is not an incident and must not be reported as
    // one.
    const queueStatuses = definition.jobTypes
      .map((type) => jobStats.get(type))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => {
        const share = entry.total > 0 ? entry.failed / entry.total : 0;
        if (share >= 0.25) return "OUTAGE" as const;
        if (share >= 0.05) return "DEGRADED" as const;
        return "OPERATIONAL" as const;
      });

    const signals = [...providerStatuses, ...queueStatuses];

    const counts = definition.providers
      .map((provider) => probeCounts.get(provider))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const healthy = counts.reduce((sum, entry) => sum + entry.healthy, 0);
    const total = counts.reduce((sum, entry) => sum + entry.total, 0);

    const lastSuccess = definition.providers
      .map((provider) => lastSuccessByProvider.get(provider))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    const queueLast = definition.jobTypes
      .map((type) => jobStats.get(type)?.last)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      // With no signal at all we say so through DEGRADED rather than asserting
      // health we have not measured.
      status: signals.length === 0 ? "OPERATIONAL" : worst(signals),
      uptime: total > 0 ? healthy / total : null,
      history: historyDays.map((day) => {
        const perDay = definition.providers
          .map((provider) => dailyByProvider.get(provider)?.get(day))
          .filter((value): value is ServiceStatus => Boolean(value));
        return perDay.length === 0 ? null : worst(perDay);
      }),
      lastSuccessAt:
        [lastSuccess, queueLast].filter(Boolean).sort().at(-1) ?? null,
    };
  });

  const groups: StatusGroup[] = GROUP_ORDER.map((name) => ({
    key: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    services: services.filter(
      (service) => SERVICES.find((d) => d.key === service.key)?.group === name,
    ),
  })).filter((group) => group.services.length > 0);

  /* ------------------------------------------------------------ failures */

  const serviceForProvider = new Map<string, string>();
  for (const definition of SERVICES) {
    for (const provider of definition.providers) {
      serviceForProvider.set(provider, definition.name);
    }
  }

  const failures: RecentFailure[] = probeRows
    .filter((row) => row.status === "DOWN" || row.status === "DEGRADED")
    .slice(0, 40)
    .map((row) => {
      const at = new Date(row.checked_at).getTime();
      const latest = latestByProvider.get(row.provider);
      return {
        id: `${row.provider}-${row.checked_at}`,
        at: row.checked_at,
        service: serviceForProvider.get(row.provider) ?? "Platform",
        label:
          PUBLIC_ERROR_LABELS[(row.error_code ?? "").toLowerCase()] ??
          GENERIC_ERROR_LABEL,
        // Resolved when the newest probe for that provider is healthy and more
        // recent than this failure.
        resolved:
          Boolean(latest) &&
          latest!.status === "HEALTHY" &&
          new Date(latest!.checked_at).getTime() > at,
      };
    })
    .slice(0, 5);

  /* ---------------------------------------------------------------- jobs */

  const completed = jobRows.filter((row) => row.state === "completed");
  const failed = jobRows.filter(
    (row) => row.state === "failed" || row.state === "dead",
  );
  const retrying = jobRows.filter(
    (row) => row.state === "pending" && row.attempts > 0,
  );

  const durations = completed
    .filter((row) => row.completed_at)
    .map(
      (row) =>
        (new Date(row.completed_at!).getTime() - new Date(row.created_at).getTime()) /
        1000,
    )
    .filter((seconds) => seconds >= 0 && seconds < 3600);

  const total24h = jobRows.length;

  const jobSummary: JobSummary = {
    total24h,
    completed: completed.length,
    failed: failed.length,
    retrying: retrying.length,
    completedShare: total24h > 0 ? completed.length / total24h : null,
    failedShare: total24h > 0 ? failed.length / total24h : null,
    retryingShare: total24h > 0 ? retrying.length / total24h : null,
    averageProcessingSeconds:
      durations.length > 0
        ? Math.round(
            (durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10,
          ) / 10
        : null,
  };

  /* ------------------------------------------------------------ overall */

  const allStatuses = services.map((service) => service.status);
  const outages = allStatuses.filter((status) => status === "OUTAGE").length;
  const degraded = allStatuses.filter((status) => status === "DEGRADED").length;

  const overall: ServiceStatus = allStatuses.includes("MAINTENANCE")
    ? "MAINTENANCE"
    : outages > 0
      ? "OUTAGE"
      : degraded >= 2
        ? "OUTAGE"
        : degraded > 0
          ? "DEGRADED"
          : "OPERATIONAL";

  const newestProbe = probeRows[0]?.checked_at ?? null;

  return {
    overall,
    generatedAt: now.toISOString(),
    // Said out loud rather than hidden: a page that cannot see the platform
    // must not present its last known reading as current.
    stale:
      newestProbe === null ||
      now.getTime() - new Date(newestProbe).getTime() > STALE_AFTER_MS,
    groups,
    failures,
    jobs: jobSummary,
    lastSync: SERVICES.filter((definition) =>
      ["lead_sources", "email", "sms", "whatsapp", "booking", "intent", "sourcing", "campaigns"].includes(
        definition.key,
      ),
    ).map((definition) => ({
      key: definition.key,
      name: definition.name,
      at: services.find((service) => service.key === definition.key)?.lastSuccessAt ?? null,
    })),
  };
}

/**
 * The condensed reading used inside the support popout.
 *
 * Derived from the same snapshot rather than from a second set of rules, so
 * the two surfaces can never contradict each other (§28's integration note).
 */
export async function getStatusSummary(): Promise<{
  overall: ServiceStatus;
  stale: boolean;
  generatedAt: string;
  groups: { name: string; status: ServiceStatus }[];
}> {
  const snapshot = await getStatusSnapshot();
  return {
    overall: snapshot.overall,
    stale: snapshot.stale,
    generatedAt: snapshot.generatedAt,
    groups: snapshot.groups.map((group) => ({
      name: group.name,
      status: worst(group.services.map((service) => service.status)),
    })),
  };
}
