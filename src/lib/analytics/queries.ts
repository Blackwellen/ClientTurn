import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ResolvedRange } from "@/lib/dates";
import type { LeadSourceRef } from "@/lib/leads/types";
import { type AttributionRow } from "./types";

/**
 * Source attribution for the CSV export.
 *
 * What remains of the V3 analytics service. `getAnalyticsData` and the six
 * helpers only it used — funnel summaries, speed-to-lead buckets, replies by
 * attempt, service rows, qualification outcomes and messaging volume — were
 * superseded by `v4-queries` / `v4-extras` and had no caller left. They are
 * deleted rather than kept "in case", because a second analytics implementation
 * nobody runs is exactly how two screens come to disagree.
 *
 * `/api/exports/attribution` is the only consumer of what is left.
 */

const LEAD_LIMIT = 5000;

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
    // percentage-points: this feeds one CSV column, headed "Booking rate (%)"
    // and rendered with `.toFixed(1)`. A spreadsheet column labelled with its
    // unit is the one place percentage points are the clearer choice.
    entry.bookingRate =
      entry.leads === 0 ? 0 : (entry.booked / entry.leads) * 100;
  }

  return [...map.values()];
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

export async function getAttributionRows(
  businessId: string,
  range: ResolvedRange,
): Promise<AttributionRow[]> {
  const leadRows = await loadLeads(businessId, range);
  return attributionRows(
    leadRows.filter((row) => new Date(row.created_at) >= range.from),
  );
}
