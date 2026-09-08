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

// The vocabulary lives in a pure sibling so a client component can import the
// labels without dragging `server-only` and the service-role client with it.
export * from "./types";

import type {
  JobSummary,
  RecentFailure,
  ServiceStatus,
  StatusGroup,
  StatusService,
  StatusSnapshot,
} from "./types";

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

  /*
   * Grouped in SQL, three small result sets instead of two 20,000-row fetches.
   *
   * Six providers on a schedule reach 20,000 probes well inside thirty days,
   * and the read was ordered newest-first -- so the window silently shortened
   * and the published uptime was computed over however long the most recent
   * 20,000 probes happened to cover, while the page said "30 days". This is the
   * one place in the product where a wrong number is read by people who are not
   * customers, during an incident, to decide whether to trust the service.
   *
   * The meaning of a probe result stays here: `statusFromProbe` and `worst()`
   * are what the page promises its readers, and belong beside the words they
   * produce. SQL counts; this file interprets.
   */
  const [daily, latest, jobHealth, failingProbes] = await Promise.all([
    admin.rpc("status_probe_daily", { p_since: since30d }),
    admin.rpc("status_provider_latest", { p_since: since30d }),
    admin.rpc("status_job_health", { p_since: since24h }),
    // Rows, deliberately: the incident list shows individual failures, and no
    // aggregate can name one. Bounded to the most recent 200 and filtered in
    // the query rather than after it, so the 40 shown are genuinely the latest
    // 40 -- the previous shape filtered a page of 20,000 mixed results and
    // could show none at all while the service was down.
    admin
      .from("platform_provider_checks")
      .select("provider, status, error_code, checked_at")
      .gte("checked_at", since30d)
      .in("status", ["DOWN", "DEGRADED"])
      .order("checked_at", { ascending: false })
      .limit(200),
  ]);

  const probeRows = failingProbes.data ?? [];

  const latestByProvider = new Map<
    string,
    { provider: string; status: string; error_code: string | null; checked_at: string }
  >();
  const lastSuccessByProvider = new Map<string, string>();

  for (const row of latest.data ?? []) {
    latestByProvider.set(row.provider, {
      provider: row.provider,
      status: row.status,
      error_code: row.error_code,
      checked_at: row.checked_at as string,
    });
    // A real aggregate now, not "the newest HEALTHY row that happened to be in
    // the page we fetched" -- which under truncation reported "last working:
    // never" for a provider whose successes had simply fallen off the end.
    if (row.last_success_at) {
      lastSuccessByProvider.set(row.provider, row.last_success_at);
    }
  }

  const dailyByProvider = new Map<string, Map<string, ServiceStatus>>();
  const probeCounts = new Map<string, { healthy: number; total: number }>();

  for (const row of daily.data ?? []) {
    const day = row.day as string;
    const days = dailyByProvider.get(row.provider) ?? new Map<string, ServiceStatus>();
    const status = statusFromProbe(row.status);
    days.set(day, worst([days.get(day) ?? "OPERATIONAL", status]));
    dailyByProvider.set(row.provider, days);

    const counts = probeCounts.get(row.provider) ?? { healthy: 0, total: 0 };
    counts.total += Number(row.probes);
    if (row.status === "HEALTHY") counts.healthy += Number(row.probes);
    probeCounts.set(row.provider, counts);
  }

  // Queue health per job type, from the last 24 hours.
  const jobStats = new Map<string, { failed: number; total: number; last: string | null }>();
  for (const row of jobHealth.data ?? []) {
    const entry = jobStats.get(row.job_type) ?? { failed: 0, total: 0, last: null };
    const count = Number(row.jobs);
    entry.total += count;
    if (row.state === "failed" || row.state === "dead") entry.failed += count;
    if (row.state === "completed" && row.last_at) {
      if (!entry.last || row.last_at > entry.last) entry.last = row.last_at;
    }
    jobStats.set(row.job_type, entry);
  }

  const historyDays: string[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
    historyDays.push(dayKey(new Date(now.getTime() - i * 864e5)));
  }

  const services: StatusService[] = SERVICES.map((definition) => {
    const providerStatuses = definition.providers
      .map((provider) => latestByProvider.get(provider))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
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

  // Summed from the same grouped read as the per-queue figures, so the totals
  // on the page and the rows beneath it cannot disagree.
  let total24h = 0;
  let completedCount = 0;
  let failedCount = 0;
  let retryingCount = 0;
  let durationWeight = 0;
  let durationSum = 0;

  for (const row of jobHealth.data ?? []) {
    const count = Number(row.jobs);
    total24h += count;
    if (row.state === "completed") {
      completedCount += count;
      if (row.avg_seconds !== null) {
        // Weighted: a queue that ran once must not pull the platform average
        // as hard as one that ran ten thousand times.
        durationSum += Number(row.avg_seconds) * count;
        durationWeight += count;
      }
    }
    if (row.state === "failed" || row.state === "dead") failedCount += count;
    if (row.state === "pending") retryingCount += Number(row.retrying);
  }

  const jobSummary: JobSummary = {
    total24h,
    completed: completedCount,
    failed: failedCount,
    retrying: retryingCount,
    completedShare: total24h > 0 ? completedCount / total24h : null,
    failedShare: total24h > 0 ? failedCount / total24h : null,
    retryingShare: total24h > 0 ? retryingCount / total24h : null,
    averageProcessingSeconds:
      durationWeight > 0 ? Math.round((durationSum / durationWeight) * 10) / 10 : null,
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
