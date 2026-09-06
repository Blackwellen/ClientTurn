import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import type {
  IntentCategoryRow,
  IntentEventRow,
  IntentMonitorRow,
  IntentOverview,
  SignalSourceKey,
  IntentViewData,
} from "./types";

export * from "./types";

/**
 * Intent reads.
 *
 * Through the RLS-scoped client. `intent_events.cost_minor` is never selected —
 * the column is revoked from the browser role (0041) and a customer surface has
 * no reason to render provider spend.
 *
 * Every "live" count here means *unexpired*: a signal outside its freshness
 * window is history, not intent, and must not be presented as current.
 */

function asStringArray(value: unknown): SignalSourceKey[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as SignalSourceKey[]) : [];
}

export async function listIntentCategories(
  businessId: string,
): Promise<IntentCategoryRow[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [{ data: categories }, { data: liveMatches }, { data: monitors }] =
    await Promise.all([
      supabase
        .from("intent_categories")
        .select(
          "id, name, description, signal_types, freshness_days, score_impact, auto_add_to_search, active, created_at",
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      // Only unexpired matches count toward the live totals shown on a card.
      supabase
        .from("prospect_intent_matches")
        .select("intent_category_id, prospect_id")
        .eq("business_id", businessId)
        .gt("expires_at", nowIso),
      supabase
        .from("intent_monitors")
        .select("intent_category_id, status")
        .eq("business_id", businessId),
    ]);

  const signalsByCategory = new Map<string, number>();
  const prospectsByCategory = new Map<string, Set<string>>();
  for (const row of liveMatches ?? []) {
    signalsByCategory.set(
      row.intent_category_id,
      (signalsByCategory.get(row.intent_category_id) ?? 0) + 1,
    );
    const set = prospectsByCategory.get(row.intent_category_id) ?? new Set<string>();
    set.add(row.prospect_id);
    prospectsByCategory.set(row.intent_category_id, set);
  }

  const monitorsByCategory = new Map<string, number>();
  for (const row of monitors ?? []) {
    monitorsByCategory.set(
      row.intent_category_id,
      (monitorsByCategory.get(row.intent_category_id) ?? 0) + 1,
    );
  }

  return (categories ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    signalTypes: asStringArray(row.signal_types),
    freshnessDays: row.freshness_days,
    scoreImpact: Number(row.score_impact),
    autoAddToSearch: row.auto_add_to_search,
    active: row.active,
    liveSignals: signalsByCategory.get(row.id) ?? 0,
    matchedProspects: prospectsByCategory.get(row.id)?.size ?? 0,
    monitorCount: monitorsByCategory.get(row.id) ?? 0,
    createdAt: row.created_at,
  }));
}

export async function listIntentMonitors(businessId: string): Promise<IntentMonitorRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intent_monitors")
    .select(
      "id, intent_category_id, name, monitor_type, cadence, status, next_run_at, last_run_at, last_error, events_last_period, target_json, intent_categories ( name )",
    )
    .eq("business_id", businessId)
    .order("next_run_at", { ascending: true, nullsFirst: false });

  return (data ?? []).map((row) => {
    const target = (row.target_json ?? {}) as { companies?: unknown[]; icpProfileIds?: unknown[] };
    const category = row.intent_categories as unknown as { name: string } | null;

    return {
      id: row.id,
      categoryId: row.intent_category_id,
      categoryName: category?.name ?? "Category",
      name: row.name,
      monitorType: row.monitor_type as IntentMonitorRow["monitorType"],
      cadence: row.cadence as IntentMonitorRow["cadence"],
      status: row.status as IntentMonitorRow["status"],
      targetCount:
        (Array.isArray(target.companies) ? target.companies.length : 0) +
        (Array.isArray(target.icpProfileIds) ? target.icpProfileIds.length : 0),
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastError: row.last_error,
      eventsLastPeriod: row.events_last_period,
    };
  });
}

export async function listIntentEvents(
  businessId: string,
  limit = 50,
): Promise<IntentEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intent_events")
    .select(
      "id, signal_type, source, source_url, observed_at, expires_at, confidence, evidence_summary, prospect_id, intent_categories ( name ), prospect_companies ( name )",
    )
    .eq("business_id", businessId)
    .order("observed_at", { ascending: false })
    .limit(limit);

  const now = Date.now();

  return (data ?? []).map((row) => {
    const category = row.intent_categories as unknown as { name: string } | null;
    const company = row.prospect_companies as unknown as { name: string } | null;

    return {
      id: row.id,
      categoryName: category?.name ?? "Intent",
      signalType: row.signal_type,
      source: row.source,
      sourceUrl: row.source_url,
      companyName: company?.name ?? null,
      prospectId: row.prospect_id,
      observedAt: row.observed_at,
      expiresAt: row.expires_at,
      expired: new Date(row.expires_at).getTime() <= now,
      confidence: Number(row.confidence),
      evidenceSummary: row.evidence_summary,
    };
  });
}

export async function getIntentOverview(businessId: string): Promise<IntentOverview> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const [categories, monitors, live, recent, entitlements] = await Promise.all([
    supabase
      .from("intent_categories")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("active", true),
    supabase
      .from("intent_monitors")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "ACTIVE"),
    supabase
      .from("prospect_intent_matches")
      .select("prospect_id")
      .eq("business_id", businessId)
      .gt("expires_at", nowIso),
    supabase
      .from("intent_events")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("observed_at", weekAgo),
    getV4Entitlements(businessId),
  ]);

  const prospects = new Set((live.data ?? []).map((row) => row.prospect_id));

  return {
    activeCategories: categories.count ?? 0,
    activeMonitors: monitors.count ?? 0,
    liveSignals: (live.data ?? []).length,
    prospectsWithIntent: prospects.size,
    signalsLast7Days: recent.count ?? 0,
    monitorLimit: entitlements.allowances.intent_monitor.hardLimit,
    monitorsUsed: monitors.count ?? 0,
  };
}

/** Everything the Intent tab renders, in one pass so the page never waterfalls. */
export async function loadIntentData(businessId: string): Promise<IntentViewData> {
  const supabase = await createClient();

  const [overview, categories, monitors, events, icps] = await Promise.all([
    getIntentOverview(businessId),
    listIntentCategories(businessId),
    listIntentMonitors(businessId),
    listIntentEvents(businessId),
    supabase
      .from("icp_profiles")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
  ]);

  return {
    overview,
    categories,
    monitors,
    events,
    icpProfiles: icps.data ?? [],
  };
}
