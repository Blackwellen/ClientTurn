/**
 * Dashboard shapes and pure display helpers. Deliberately free of
 * `server-only` and of any Supabase import so the dashboard's client
 * components can share them with the server queries.
 *
 * Metric definitions live here as comments so the Dashboard and any future
 * admin reporting can never drift apart on what a number means.
 */

import type { LeadListRow } from "@/lib/leads/types";

export type PeriodCounts = {
  /** Leads created inside the window. */
  leads: number;
  /** Of those, the ones that received a first outbound message. */
  contacted: number;
  /** Of those, the ones that replied at least once. */
  replied: number;
  /** Of those, the ones the deterministic engine marked QUALIFIED. */
  qualified: number;
  /** Of those, the ones with a confirmed booking. */
  booked: number;
  /** Of those, the ones whose status reached WON. Never inferred from a booking. */
  won: number;
  /** bookings ÷ leads received in the window, as a percentage. */
  bookingRate: number;
};

/* ------------------------------------------------------------- sparklines */

export const SERIES_KEYS = [
  "leads",
  "contacted",
  "replied",
  "qualified",
  "booked",
  "bookingRate",
] as const;

export type SeriesKey = (typeof SERIES_KEYS)[number];

/**
 * Real per-bucket counts across the selected window, bucketed by the event
 * that defines each stage. Never generated, so a KPI without history simply
 * has a flat series.
 */
export type DashboardSeries = Record<SeriesKey, number[]>;

/* ----------------------------------------------------------- attribution */

export type SourceSnapshotRow = {
  key: string;
  label: string;
  /** meta | csv | manual | test | webform — drives the row icon. */
  provider: string;
  leads: number;
  replies: number;
  qualified: number;
  booked: number;
  /** booked ÷ leads for this source, as a percentage. */
  conversionRate: number;
};

/* ------------------------------------------------------------- attention */

export type AttentionTone = "danger" | "warning" | "info";

export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  /** When the event happened. Null for a standing configuration problem. */
  at: string | null;
  href: string;
  tone: AttentionTone;
};

/** Known `attention_reason` codes written by the pipeline. */
const ATTENTION_LABELS: Record<string, string> = {
  human_requested: "Lead requested a person",
  message_failed: "Message failed to send",
  form_mapping: "Form mapping error",
  out_of_area: "Outside the service area",
  unmatched_answer: "Answer needs review",
  no_response: "No response after follow-ups",
};

export function attentionLabel(reason: string | null) {
  if (!reason) return "Needs attention";
  return (
    ATTENTION_LABELS[reason] ??
    reason.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

const TONE_RANK: Record<AttentionTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

/** Critical first, then action-required, then newest. Standing issues last. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const tone = TONE_RANK[a.tone] - TONE_RANK[b.tone];
    if (tone !== 0) return tone;
    if (a.at === b.at) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });
}

/* ---------------------------------------------------------------- health */

export type HealthStripStatus = "healthy" | "warning" | "error";

export type HealthStripItem = {
  key: "meta" | "messaging" | "booking" | "followup";
  label: string;
  status: HealthStripStatus;
  /** Pill text: "Connected", "Published", "Action required", "Not connected". */
  statusLabel: string;
  /** The specifics beneath it: "2 pages · 3 forms", "SMS · WhatsApp". */
  detail: string;
  href: string;
};

const SYSTEM_ATTENTION_TITLES: Record<HealthStripItem["key"], string> = {
  meta: "Meta connection needs attention",
  messaging: "Messaging needs attention",
  booking: "Booking destination missing",
  followup: "Follow-up is not published",
};

/**
 * Turns the health strip into attention rows, so a broken integration is
 * surfaced in the panel as well as the strip without a second round of
 * queries. Healthy items produce nothing — the panel never invents warnings.
 */
export function systemAttentionItems(
  health: HealthStripItem[],
  failedMessages: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const entry of health) {
    if (entry.status === "healthy") continue;
    items.push({
      id: `system-${entry.key}`,
      title: SYSTEM_ATTENTION_TITLES[entry.key],
      detail: entry.statusLabel,
      at: null,
      href: entry.href,
      tone: entry.status === "error" ? "danger" : "warning",
    });
  }

  if (failedMessages > 0) {
    items.push({
      id: "system-message-failures",
      title: "Messages failed to send",
      detail: `${failedMessages.toLocaleString("en-GB")} ${
        failedMessages === 1 ? "message" : "messages"
      } failed in the last 24 hours`,
      at: null,
      href: "/app/leads?tab=attention",
      tone: "danger",
    });
  }

  return items;
}

/* ------------------------------------------------------------- follow-up */

export type FollowUpMetricKey =
  | "latency"
  | "repliesFirst"
  | "repliesFollowUp"
  | "failureRate"
  | "optOutRate";

export type FollowUpMetric = {
  key: FollowUpMetricKey;
  label: string;
  hint: string;
  format: "duration" | "percent";
  /** True when a fall is an improvement — latency, failures, opt-outs. */
  invert: boolean;
  current: number | null;
  previous: number | null;
};

/* ------------------------------------------------------------ page model */

export type DashboardData = {
  current: PeriodCounts;
  previous: PeriodCounts;
  series: DashboardSeries;
  estimatedPipeline: number;
  qualifyingLeads: number;
  recentLeads: LeadListRow[];
  sources: SourceSnapshotRow[];
  followUp: FollowUpMetric[];
  /** Lead-level rows only. System rows come from `systemAttentionItems`. */
  leadAttention: AttentionItem[];
  failedMessages: number;
};
