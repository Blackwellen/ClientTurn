/**
 * Analytics shapes and pure helpers. No `server-only` and no Supabase import,
 * so client components can share these types with the server queries.
 */

import { z } from "zod";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const ATTRIBUTION_SORT_KEYS = [
  "source",
  "campaign",
  "ad",
  "leads",
  "contacted",
  "replied",
  "qualified",
  "booked",
  "won",
  "bookingRate",
  "pipeline",
] as const;

export type AttributionSortKey = (typeof ATTRIBUTION_SORT_KEYS)[number];

export const analyticsParamsSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "custom"]).default("30d").catch("30d"),
  from: z.string().trim().max(10).optional().catch(undefined),
  to: z.string().trim().max(10).optional().catch(undefined),
  sort: z.enum(ATTRIBUTION_SORT_KEYS).default("leads").catch("leads"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
});

export type AnalyticsParams = z.infer<typeof analyticsParamsSchema>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAnalyticsParams(params: RawSearchParams): AnalyticsParams {
  return analyticsParamsSchema.parse({
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
    sort: first(params.sort),
    dir: first(params.dir),
  });
}

export type AttributionRow = {
  key: string;
  source: string;
  campaign: string;
  ad: string;
  leads: number;
  contacted: number;
  replied: number;
  qualified: number;
  booked: number;
  won: number;
  bookingRate: number;
  pipeline: number;
};

export function sortAttribution(
  rows: AttributionRow[],
  key: AttributionSortKey,
  direction: "asc" | "desc",
): AttributionRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right), "en-GB") * factor;
    }
    return ((left as number) - (right as number)) * factor;
  });
}

export const SPEED_BUCKETS = [
  { key: "under_1m", label: "Under 1 minute", tone: "success" },
  { key: "1_5m", label: "1 to 5 minutes", tone: "success" },
  { key: "5_30m", label: "5 to 30 minutes", tone: "warning" },
  { key: "30m_plus", label: "Over 30 minutes", tone: "danger" },
  { key: "never", label: "Never contacted", tone: "danger" },
] as const;

export type SpeedBucketKey = (typeof SPEED_BUCKETS)[number]["key"];

export type SpeedToLead = {
  averageSeconds: number | null;
  medianSeconds: number | null;
  fastestSeconds: number | null;
  contacted: number;
  total: number;
  buckets: Record<SpeedBucketKey, number>;
};

export type AttemptRow = {
  attempt: number;
  sent: number;
  replies: number;
  replyRate: number;
};

export type ServiceRow = {
  key: string;
  name: string;
  leads: number;
  booked: number;
  pipeline: number;
};

export type QualificationOutcomes = {
  qualified: number;
  notQualified: number;
  review: number;
  pending: number;
  topFailure: { code: string; label: string; count: number } | null;
};

export type MessagingVolume = {
  outbound: number;
  inbound: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  optOuts: number;
};

/** Reason codes emitted by the deterministic qualification engine. */
const FAILURE_LABELS: Record<string, string> = {
  service_missing: "No service identified",
  service_inactive: "Service is not active",
  out_of_area: "Outside the service area",
  blocked_postcode: "Blocked postcode",
  hard_fail: "Answer failed a required rule",
  missing_required_answer: "Required answer never given",
  unmatched_answer: "Answer could not be matched",
  no_contact_details: "No usable contact details",
};

export function failureLabel(code: string) {
  return (
    FAILURE_LABELS[code] ??
    code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
