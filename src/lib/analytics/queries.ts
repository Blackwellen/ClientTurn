import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ResolvedRange } from "@/lib/dates";
import type { PeriodCounts } from "@/lib/dashboard/queries";
import type { LeadSourceRef } from "@/lib/leads/types";
import {
  failureLabel,
  type AttemptRow,
  type AttributionRow,
  type MessagingVolume,
  type QualificationOutcomes,
  type ServiceRow,
  type SpeedBucketKey,
  type SpeedToLead,
} from "./types";

const LEAD_LIMIT = 5000;
const MESSAGE_LIMIT = 20000;
const MAX_ATTEMPTS_TRACKED = 5;

type AnalyticsLeadRow = {
  id: string;
  created_at: string;
  first_contacted_at: string | null;
  first_replied_at: string | null;
  qualified_at: string | null;
  booked_at: string | null;
  won_at: string | null;
  opted_out: boolean;
  status: string;
  qualification_state: string;
  qualification_reason: unknown;
  source_id: string | null;
  services: { id: string; name: string; average_value: number | null } | null;
  lead_sources: LeadSourceRef | null;
};

type AnalyticsMessageRow = {
  lead_id: string;
  direction: string;
  status: string;
  created_at: string;
};

export type AnalyticsData = {
  current: PeriodCounts;
  previous: PeriodCounts;
  estimatedPipeline: number;
  speed: SpeedToLead;
  attempts: AttemptRow[];
  attribution: AttributionRow[];
  services: ServiceRow[];
  qualification: QualificationOutcomes;
  messaging: MessagingVolume;
  truncated: boolean;
};

function summarise(rows: AnalyticsLeadRow[]): PeriodCounts {
  const leads = rows.length;
  const booked = rows.filter((row) => row.booked_at).length;
  return {
    leads,
    contacted: rows.filter((row) => row.first_contacted_at).length,
    replied: rows.filter((row) => row.first_replied_at).length,
    qualified: rows.filter((row) => row.qualified_at).length,
    booked,
    won: rows.filter((row) => row.won_at).length,
    bookingRate: leads === 0 ? 0 : (booked / leads) * 100,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function bucketFor(seconds: number): SpeedBucketKey {
  if (seconds < 60) return "under_1m";
  if (seconds < 300) return "1_5m";
  if (seconds < 1800) return "5_30m";
  return "30m_plus";
}

function speedToLead(rows: AnalyticsLeadRow[]): SpeedToLead {
  const buckets: Record<SpeedBucketKey, number> = {
    under_1m: 0,
    "1_5m": 0,
    "5_30m": 0,
    "30m_plus": 0,
    never: 0,
  };
  const seconds: number[] = [];

  for (const row of rows) {
    if (!row.first_contacted_at) {
      buckets.never += 1;
      continue;
    }
    const delta =
      (new Date(row.first_contacted_at).getTime() -
        new Date(row.created_at).getTime()) /
      1000;
    const value = Math.max(0, delta);
    seconds.push(value);
    buckets[bucketFor(value)] += 1;
  }

  const total = seconds.reduce((sum, value) => sum + value, 0);

  return {
    averageSeconds: seconds.length === 0 ? null : total / seconds.length,
    medianSeconds: median(seconds),
    fastestSeconds: seconds.length === 0 ? null : Math.min(...seconds),
    contacted: seconds.length,
    total: rows.length,
    buckets,
  };
}

/**
 * Attempt N is the Nth outbound message to a lead. A reply is credited to the
 * attempt it directly followed, which is what shows whether chasing further is
 * still earning responses.
 */
function repliesByAttempt(messages: AnalyticsMessageRow[]): AttemptRow[] {
  const byLead = new Map<string, AnalyticsMessageRow[]>();
  for (const message of messages) {
    const list = byLead.get(message.lead_id);
    if (list) list.push(message);
    else byLead.set(message.lead_id, [message]);
  }

  const sent = new Array<number>(MAX_ATTEMPTS_TRACKED).fill(0);
  const replies = new Array<number>(MAX_ATTEMPTS_TRACKED).fill(0);

  for (const list of byLead.values()) {
    const ordered = [...list].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    let attempt = 0;
    let awaitingReply = false;

    for (const message of ordered) {
      if (message.direction === "outbound") {
        if (message.status === "QUEUED") continue;
        attempt += 1;
        if (attempt <= MAX_ATTEMPTS_TRACKED) {
          sent[attempt - 1] += 1;
          awaitingReply = true;
        }
        continue;
      }
      if (awaitingReply && attempt >= 1 && attempt <= MAX_ATTEMPTS_TRACKED) {
        replies[attempt - 1] += 1;
        awaitingReply = false;
      }
    }
  }

  return sent
    .map((count, index) => ({
      attempt: index + 1,
      sent: count,
      replies: replies[index],
      replyRate: count === 0 ? 0 : (replies[index] / count) * 100,
    }))
    .filter((row) => row.sent > 0);
}

function attributionRows(rows: AnalyticsLeadRow[]): AttributionRow[] {
  const map = new Map<string, AttributionRow>();

  for (const row of rows) {
    const source = row.lead_sources;
    const sourceName =
      source?.source_name ?? source?.page_name ?? source?.provider ?? "Unknown";
    const campaign = source?.campaign_name ?? source?.form_name ?? "—";
    const ad = source?.ad_name ?? source?.adset_name ?? "—";
    const key = `${sourceName}||${campaign}||${ad}`;

    const entry: AttributionRow = map.get(key) ?? {
      key,
      source: sourceName,
      campaign,
      ad,
      leads: 0,
      contacted: 0,
      replied: 0,
      qualified: 0,
      booked: 0,
      won: 0,
      bookingRate: 0,
      pipeline: 0,
    };

    entry.leads += 1;
    if (row.first_contacted_at) entry.contacted += 1;
    if (row.first_replied_at) entry.replied += 1;
    if (row.qualified_at) entry.qualified += 1;
    if (row.booked_at) entry.booked += 1;
    if (row.won_at) entry.won += 1;
    if (row.qualification_state === "QUALIFIED" && row.status !== "LOST") {
      entry.pipeline += Number(row.services?.average_value ?? 0);
    }
    map.set(key, entry);
  }

  for (const entry of map.values()) {
    entry.bookingRate =
      entry.leads === 0 ? 0 : (entry.booked / entry.leads) * 100;
  }

  return [...map.values()];
}

function serviceRows(rows: AnalyticsLeadRow[]): ServiceRow[] {
  const map = new Map<string, ServiceRow>();
  for (const row of rows) {
    const key = row.services?.id ?? "unassigned";
    const entry: ServiceRow = map.get(key) ?? {
      key,
      name: row.services?.name ?? "No service set",
      leads: 0,
      booked: 0,
      pipeline: 0,
    };
    entry.leads += 1;
    if (row.booked_at) entry.booked += 1;
    if (row.qualification_state === "QUALIFIED" && row.status !== "LOST") {
      entry.pipeline += Number(row.services?.average_value ?? 0);
    }
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

function qualificationOutcomes(
  rows: AnalyticsLeadRow[],
): QualificationOutcomes {
  const counts = { qualified: 0, notQualified: 0, review: 0, pending: 0 };
  const failures = new Map<string, number>();

  for (const row of rows) {
    if (row.qualification_state === "QUALIFIED") counts.qualified += 1;
    else if (row.qualification_state === "REVIEW") counts.review += 1;
    else if (row.qualification_state === "NOT_QUALIFIED") {
      counts.notQualified += 1;
      const reasons = Array.isArray(row.qualification_reason)
        ? (row.qualification_reason as { code?: unknown }[])
        : [];
      for (const reason of reasons) {
        if (typeof reason?.code !== "string") continue;
        failures.set(reason.code, (failures.get(reason.code) ?? 0) + 1);
      }
    } else counts.pending += 1;
  }

  const top = [...failures].sort((a, b) => b[1] - a[1])[0];

  return {
    ...counts,
    topFailure: top
      ? { code: top[0], label: failureLabel(top[0]), count: top[1] }
      : null,
  };
}

function messagingVolume(
  messages: AnalyticsMessageRow[],
  leads: AnalyticsLeadRow[],
): MessagingVolume {
  let outbound = 0;
  let inbound = 0;
  let delivered = 0;
  let failed = 0;

  for (const message of messages) {
    if (message.direction === "inbound") {
      inbound += 1;
      continue;
    }
    outbound += 1;
    if (message.status === "DELIVERED") delivered += 1;
    if (message.status === "FAILED") failed += 1;
  }

  const attempted = delivered + failed;

  return {
    outbound,
    inbound,
    delivered,
    failed,
    deliveryRate: attempted === 0 ? 0 : (delivered / attempted) * 100,
    optOuts: leads.filter((row) => row.opted_out).length,
  };
}

const LEAD_SELECT = `id, created_at, first_contacted_at, first_replied_at,
  qualified_at, booked_at, won_at, opted_out, status, qualification_state,
  qualification_reason, source_id,
  services ( id, name, average_value ),
  lead_sources ( id, provider, source_name, form_name, campaign_name,
                 campaign_id, ad_name, adset_name, page_name )`;

async function loadLeads(businessId: string, range: ResolvedRange) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select(LEAD_SELECT)
    .eq("business_id", businessId)
    .eq("is_test", false)
    .gte("created_at", range.previousFrom.toISOString())
    .lt("created_at", range.to.toISOString())
    .order("created_at", { ascending: false })
    .limit(LEAD_LIMIT);

  return (data ?? []) as unknown as AnalyticsLeadRow[];
}

export async function getAnalyticsData(
  businessId: string,
  range: ResolvedRange,
): Promise<AnalyticsData> {
  const supabase = await createClient();

  const [leadRows, messageResult] = await Promise.all([
    loadLeads(businessId, range),
    supabase
      .from("messages")
      .select("lead_id, direction, status, created_at")
      .eq("business_id", businessId)
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString())
      .order("created_at", { ascending: true })
      .limit(MESSAGE_LIMIT),
  ]);

  const currentRows = leadRows.filter(
    (row) => new Date(row.created_at) >= range.from,
  );
  const previousRows = leadRows.filter(
    (row) => new Date(row.created_at) < range.from,
  );
  const messages = (messageResult.data ?? []) as AnalyticsMessageRow[];

  const estimatedPipeline = currentRows.reduce(
    (total, row) =>
      row.qualification_state === "QUALIFIED" && row.status !== "LOST"
        ? total + Number(row.services?.average_value ?? 0)
        : total,
    0,
  );

  return {
    current: summarise(currentRows),
    previous: summarise(previousRows),
    estimatedPipeline,
    speed: speedToLead(currentRows),
    attempts: repliesByAttempt(messages),
    attribution: attributionRows(currentRows),
    services: serviceRows(currentRows),
    qualification: qualificationOutcomes(currentRows),
    messaging: messagingVolume(messages, currentRows),
    truncated: leadRows.length >= LEAD_LIMIT || messages.length >= MESSAGE_LIMIT,
  };
}

/** The export reuses the identical aggregation so the CSV can never disagree. */
export async function getAttributionRows(
  businessId: string,
  range: ResolvedRange,
): Promise<AttributionRow[]> {
  const leadRows = await loadLeads(businessId, range);
  return attributionRows(
    leadRows.filter((row) => new Date(row.created_at) >= range.from),
  );
}
