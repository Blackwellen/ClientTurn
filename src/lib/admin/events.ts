import "server-only";
import { jobLabel, providerLabel, titleise } from "./format";
import {
  adminRead,
  namesFor,
  redactPayload,
  redactValue,
  truncate,
  unique,
  type AdminClient,
} from "./shared";
import {
  MAX_SAFE_RETRIES,
  isRetryable,
  jobEventStatus,
  messageEventStatus,
  parseEventId,
  retryBlockedReason,
  webhookEventStatus,
} from "./events-shared";
import type {
  AdminRange,
  EventDetail,
  EventListResult,
  EventStatusFilter,
  EventTypeFilter,
  OperationalEvent,
} from "./types";

/**
 * One operational event feed over the three tables that already record
 * platform activity — webhook_events, messages and jobs. Nothing is copied
 * into a second store: this is a normalising read layer, which is why an event
 * id carries its source (`webhook:<uuid>`) and why the retry path can tell
 * exactly which table a replay would touch.
 */

/** Per-source read cap. The feed is a recent-activity view, not an archive. */
const SOURCE_CAP = 600;

export { MAX_SAFE_RETRIES, parseEventId };

const RANGE_DAYS: Record<AdminRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function rangeStart(range: AdminRange): string {
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString();
}

/* ------------------------------------------------------------------ list */

export type EventFilters = {
  search: string;
  type: EventTypeFilter;
  provider: string;
  status: EventStatusFilter;
  range: AdminRange;
  page: number;
  pageSize: number;
};

export async function listOperationalEvents(
  filters: EventFilters,
): Promise<EventListResult> {
  const supabase = await adminRead();
  const since = rangeStart(filters.range);
  const search = filters.search.trim().slice(0, 80);

  const wantWebhooks = filters.type === "all" || filters.type === "webhook";
  const wantMessages = filters.type === "all" || filters.type === "message";
  const wantJobs = filters.type === "all" || filters.type === "job";

  const [webhookRows, messageRows, jobRows, providerRows] = await Promise.all([
    wantWebhooks
      ? supabase
          .from("webhook_events")
          .select(
            "id, provider, external_event_id, event_type, business_id, received_at, processed_at, status, attempts, last_error",
          )
          .gte("received_at", since)
          .order("received_at", { ascending: false })
          .limit(SOURCE_CAP)
      : null,
    wantMessages
      ? supabase
          .from("messages")
          .select(
            "id, business_id, direction, channel, provider, status, error_message, created_at, sent_at, delivered_at, failed_at",
          )
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(SOURCE_CAP)
      : null,
    wantJobs
      ? supabase
          .from("jobs")
          .select(
            "id, type, business_id, state, attempts, max_attempts, last_error, created_at, completed_at",
          )
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(SOURCE_CAP)
      : null,
    supabase.from("webhook_events").select("provider").limit(2000),
  ]);

  const businessIds = unique([
    ...(webhookRows?.data ?? []).map((row) => row.business_id),
    ...(messageRows?.data ?? []).map((row) => row.business_id),
    ...(jobRows?.data ?? []).map((row) => row.business_id),
  ]);
  const names = await namesFor(supabase, businessIds);
  const nameOf = (id: string | null) =>
    id ? (names.get(id) ?? "Unknown workspace") : null;

  const events: OperationalEvent[] = [];

  for (const row of webhookRows?.data ?? []) {
    const status = webhookEventStatus(row.status);
    events.push({
      id: `webhook:${row.id}`,
      source: "webhook",
      provider: row.provider,
      providerLabel: providerLabel(row.provider),
      type: row.event_type ?? "webhook",
      typeLabel: row.event_type ? titleise(row.event_type) : "Webhook",
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      status,
      attempts: row.attempts,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      lastError: row.last_error ? truncate(row.last_error, 80) : null,
      retryable: isRetryable({ source: "webhook", status, attempts: row.attempts }),
      reference: row.external_event_id,
    });
  }

  for (const row of messageRows?.data ?? []) {
    const provider = row.channel === "whatsapp" ? "twilio_whatsapp" : "twilio_sms";
    events.push({
      id: `message:${row.id}`,
      source: "message",
      provider,
      providerLabel: providerLabel(provider),
      type: row.direction === "inbound" ? "inbound_message" : "outbound_message",
      typeLabel: row.direction === "inbound" ? "Inbound reply" : "Outbound message",
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      status: messageEventStatus(row.status),
      attempts: 1,
      receivedAt: row.created_at,
      processedAt: row.delivered_at ?? row.sent_at ?? row.failed_at,
      lastError: row.error_message ? truncate(row.error_message, 80) : null,
      // Always false — the shared rule refuses message replays outright,
      // because an operator resend can duplicate a customer-facing message.
      retryable: isRetryable({
        source: "message",
        status: messageEventStatus(row.status),
        attempts: 1,
      }),
      reference: null,
    });
  }

  for (const row of jobRows?.data ?? []) {
    const status = jobEventStatus(row.state, row.attempts, row.max_attempts);
    events.push({
      id: `job:${row.id}`,
      source: "job",
      provider: "job",
      providerLabel: "Job",
      type: row.type,
      typeLabel: jobLabel(row.type),
      businessId: row.business_id,
      businessName: nameOf(row.business_id),
      status,
      attempts: row.attempts,
      receivedAt: row.created_at,
      processedAt: row.completed_at,
      lastError: row.last_error ? truncate(row.last_error, 80) : null,
      retryable: isRetryable({ source: "job", status, attempts: row.attempts }),
      reference: null,
    });
  }

  const matches = (event: OperationalEvent) => {
    if (filters.provider !== "all" && event.provider !== filters.provider) {
      return false;
    }
    if (filters.status !== "all" && event.status !== filters.status) return false;
    if (search) {
      const haystack = [
        event.id,
        event.reference ?? "",
        event.businessName ?? "",
        event.typeLabel,
        event.providerLabel,
        event.lastError ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  };

  const filtered = events
    .filter(matches)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  const from = (filters.page - 1) * filters.pageSize;

  // Summary counts describe the same filtered feed the table is showing, so
  // the numbers and the rows can never disagree.
  const counts = {
    processed: filtered.filter((e) => e.status === "PROCESSED").length,
    retrying: filtered.filter((e) => e.status === "RETRYING").length,
    failed: filtered.filter(
      (e) => e.status === "FAILED" || e.status === "DEAD_LETTERED",
    ).length,
    safeToRetry: filtered.filter((e) => e.retryable).length,
  };

  return {
    rows: filtered.slice(from, from + filters.pageSize),
    total: filtered.length,
    page: filters.page,
    pageSize: filters.pageSize,
    counts,
    safeRetryQueue: filtered.filter((e) => e.retryable).slice(0, 8),
    providers: unique([
      ...(providerRows.data ?? []).map((row) => row.provider),
      "twilio_sms",
      "twilio_whatsapp",
      "job",
    ]).sort(),
  };
}

/* ---------------------------------------------------------------- detail */

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const supabase = await adminRead();
  const parsed = parseEventId(id);
  if (!parsed) return null;

  if (parsed.source === "webhook") return webhookDetail(supabase, parsed.rowId);
  if (parsed.source === "job") return jobDetail(supabase, parsed.rowId);
  return messageDetail(supabase, parsed.rowId);
}

async function nameOfBusiness(
  supabase: AdminClient,
  businessId: string | null,
): Promise<string | null> {
  if (!businessId) return null;
  const names = await namesFor(supabase, [businessId]);
  return names.get(businessId) ?? "Unknown workspace";
}

async function webhookDetail(
  supabase: AdminClient,
  rowId: string,
): Promise<EventDetail | null> {
  const { data: row } = await supabase
    .from("webhook_events")
    .select(
      "id, provider, external_event_id, event_type, business_id, received_at, processed_at, status, attempts, last_error, payload",
    )
    .eq("id", rowId)
    .maybeSingle();
  if (!row) return null;

  const status = webhookEventStatus(row.status);
  const retryable = isRetryable({
    source: "webhook",
    status,
    attempts: row.attempts,
  });

  return {
    id: `webhook:${row.id}`,
    source: "webhook",
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    type: row.event_type ?? "webhook",
    typeLabel: row.event_type ? titleise(row.event_type) : "Webhook",
    businessId: row.business_id,
    businessName: await nameOfBusiness(supabase, row.business_id),
    status,
    attempts: row.attempts,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    lastError: row.last_error,
    retryable,
    reference: row.external_event_id,
    maxAttempts: MAX_SAFE_RETRIES,
    metadata: [
      { key: "Provider event id", value: redactValue("external_event_id", row.external_event_id) },
      { key: "Event type", value: redactValue("event_type", row.event_type) },
      { key: "Internal id", value: row.id },
    ],
    payloadPreview: row.payload
      ? JSON.stringify(redactPayload(row.payload), null, 2).slice(0, 4000)
      : null,
    retryBlockedReason: retryBlockedReason({
      source: "webhook",
      status,
      attempts: row.attempts,
    }),
  };
}

async function jobDetail(
  supabase: AdminClient,
  rowId: string,
): Promise<EventDetail | null> {
  const { data: row } = await supabase
    .from("jobs")
    .select(
      "id, type, business_id, state, attempts, max_attempts, last_error, created_at, completed_at, run_at, payload",
    )
    .eq("id", rowId)
    .maybeSingle();
  if (!row) return null;

  const status = jobEventStatus(row.state, row.attempts, row.max_attempts);
  const retryable = isRetryable({
    source: "job",
    status,
    attempts: row.attempts,
  });

  return {
    id: `job:${row.id}`,
    source: "job",
    provider: "job",
    providerLabel: "Job",
    type: row.type,
    typeLabel: jobLabel(row.type),
    businessId: row.business_id,
    businessName: await nameOfBusiness(supabase, row.business_id),
    status,
    attempts: row.attempts,
    receivedAt: row.created_at,
    processedAt: row.completed_at,
    lastError: row.last_error,
    retryable,
    reference: null,
    maxAttempts: row.max_attempts,
    metadata: [
      { key: "Job type", value: row.type },
      { key: "State", value: row.state },
      { key: "Attempts", value: `${row.attempts} of ${row.max_attempts}` },
      { key: "Next run", value: redactValue("run_at", row.run_at) },
      { key: "Internal id", value: row.id },
    ],
    payloadPreview: row.payload
      ? JSON.stringify(redactPayload(row.payload), null, 2).slice(0, 4000)
      : null,
    retryBlockedReason: retryBlockedReason({
      source: "job",
      status,
      attempts: row.attempts,
    }),
  };
}

async function messageDetail(
  supabase: AdminClient,
  rowId: string,
): Promise<EventDetail | null> {
  // `body` is deliberately not selected: an operator does not need to read a
  // customer's message content to triage a delivery failure.
  const { data: row } = await supabase
    .from("messages")
    .select(
      "id, business_id, direction, channel, provider, status, error_code, error_message, origin, created_at, sent_at, delivered_at, failed_at",
    )
    .eq("id", rowId)
    .maybeSingle();
  if (!row) return null;

  const provider = row.channel === "whatsapp" ? "twilio_whatsapp" : "twilio_sms";

  return {
    id: `message:${row.id}`,
    source: "message",
    provider,
    providerLabel: providerLabel(provider),
    type: row.direction === "inbound" ? "inbound_message" : "outbound_message",
    typeLabel: row.direction === "inbound" ? "Inbound reply" : "Outbound message",
    businessId: row.business_id,
    businessName: await nameOfBusiness(supabase, row.business_id),
    status: messageEventStatus(row.status),
    attempts: 1,
    receivedAt: row.created_at,
    processedAt: row.delivered_at ?? row.sent_at ?? row.failed_at,
    lastError: row.error_message,
    retryable: false,
    reference: null,
    maxAttempts: null,
    metadata: [
      { key: "Direction", value: row.direction },
      { key: "Channel", value: row.channel },
      { key: "Origin", value: row.origin },
      { key: "Error code", value: redactValue("error_code", row.error_code) },
      { key: "Internal id", value: row.id },
    ],
    payloadPreview: null,
    retryBlockedReason: retryBlockedReason({
      source: "message",
      status: messageEventStatus(row.status),
      attempts: 1,
    }),
  };
}
