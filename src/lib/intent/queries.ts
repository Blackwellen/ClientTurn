import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import {
  HIGH_INTENT_SCORE_IMPACT,
  type IntentCategoryRow,
  type IntentEventRow,
  type IntentMonitorRow,
  type IntentOverview,
  type IntentSourceUsage,
  type MonitoredCompanyRow,
  type SignalSourceKey,
  type IntentViewData,
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

/** Keyword terms out of the stored blob, dropping anything that is not text. */
function readKeywords(value: unknown): string[] {
  const blob = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const terms = Array.isArray(blob.terms) ? blob.terms : [];
  return terms.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** Empty means "every ICP": the stored scope is {mode:"ALL"} in that case, and
 *  an unrecognised blob is treated the same way rather than silently scoping a
 *  category to nothing. */
function readIcpScope(value: unknown): string[] {
  const blob = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (blob.mode !== "SELECTED") return [];
  const ids = Array.isArray(blob.icpProfileIds) ? blob.icpProfileIds : [];
  return ids.filter((v): v is string => typeof v === "string");
}

function asStringArray(value: unknown): SignalSourceKey[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "string") as SignalSourceKey[]) : [];
}

export async function listIntentCategories(
  businessId: string,
): Promise<IntentCategoryRow[]> {
  const supabase = await createClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const from30 = new Date(now - 30 * 864e5).toISOString();
  const from60 = new Date(now - 60 * 864e5).toISOString();

  const [{ data: categories }, { data: liveMatches }, { data: monitors }, { data: windowed }] =
    await Promise.all([
      supabase
        .from("intent_categories")
        .select(
          "id, name, description, signal_types, keywords_entities, icp_scope, freshness_days, score_impact, auto_add_to_search, default_cadence, active, created_at",
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
      // Two windows in one read: the events table is indexed on
      // (business_id, observed_at), so fetching 60 days once beats two counts
      // per category.
      supabase
        .from("intent_events")
        .select("intent_category_id, observed_at")
        .eq("business_id", businessId)
        .gte("observed_at", from60),
    ]);

  const current = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const row of windowed ?? []) {
    const bucket = row.observed_at >= from30 ? current : prior;
    bucket.set(row.intent_category_id, (bucket.get(row.intent_category_id) ?? 0) + 1);
  }

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
    keywords: readKeywords(row.keywords_entities),
    icpProfileIds: readIcpScope(row.icp_scope),
    defaultCadence: row.default_cadence as IntentCategoryRow["defaultCadence"],
    freshnessDays: row.freshness_days,
    scoreImpact: Number(row.score_impact),
    autoAddToSearch: row.auto_add_to_search,
    active: row.active,
    liveSignals: signalsByCategory.get(row.id) ?? 0,
    signals30d: current.get(row.id) ?? 0,
    signalTrend: trend(current.get(row.id) ?? 0, prior.get(row.id) ?? 0),
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

/** Growth against the previous window. Null when there was no previous window
 *  — growth from nothing is undefined, not infinite. */
function trend(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return (current - prior) / prior;
}

export async function getIntentOverview(businessId: string): Promise<IntentOverview> {
  const supabase = await createClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const weekAgo = new Date(now - 7 * 864e5).toISOString();
  const from30 = new Date(now - 30 * 864e5).toISOString();
  const from60 = new Date(now - 60 * 864e5).toISOString();

  const [categories, monitors, live, recent, windowed, companies, entitlements] =
    await Promise.all([
      supabase
        .from("intent_categories")
        .select("id, active, score_impact")
        .eq("business_id", businessId),
      supabase
        .from("intent_monitors")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "ACTIVE"),
      // Live matches carry the category, so "high intent" can be resolved from
      // the same read rather than a second pass.
      supabase
        .from("prospect_intent_matches")
        .select("prospect_id, intent_category_id")
        .eq("business_id", businessId)
        .gt("expires_at", nowIso),
      supabase
        .from("intent_events")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("observed_at", weekAgo),
      supabase
        .from("intent_events")
        .select("observed_at, company_id")
        .eq("business_id", businessId)
        .gte("observed_at", from60),
      supabase
        .from("intent_monitors")
        .select("target_json")
        .eq("business_id", businessId)
        .eq("monitor_type", "NAMED_COMPANIES"),
      getV4Entitlements(businessId),
    ]);

  const categoryRows = categories.data ?? [];
  const highImpact = new Set(
    categoryRows
      .filter((row) => Number(row.score_impact) >= HIGH_INTENT_SCORE_IMPACT)
      .map((row) => row.id),
  );

  const prospects = new Set<string>();
  const highIntent = new Set<string>();
  for (const row of live.data ?? []) {
    prospects.add(row.prospect_id);
    if (highImpact.has(row.intent_category_id)) highIntent.add(row.prospect_id);
  }

  let signals30d = 0;
  let signalsPrior30d = 0;
  const companiesWithIntent = new Set<string>();
  for (const row of windowed.data ?? []) {
    if (row.observed_at >= from30) {
      signals30d += 1;
      if (row.company_id) companiesWithIntent.add(row.company_id);
    } else {
      signalsPrior30d += 1;
    }
  }

  // A company watched by two categories is one company being monitored, not
  // two, so the targets are de-duplicated across monitors.
  const monitored = new Set<string>();
  for (const row of companies.data ?? []) {
    for (const entry of readCompanyTargets(row.target_json)) {
      monitored.add(entry.key);
    }
  }

  return {
    activeCategories: categoryRows.filter((row) => row.active).length,
    totalCategories: categoryRows.length,
    activeMonitors: monitors.count ?? 0,
    liveSignals: (live.data ?? []).length,
    signals30d,
    signalsPrior30d,
    companiesWithIntent: companiesWithIntent.size,
    highIntentProspects: highIntent.size,
    prospectsWithIntent: prospects.size,
    signalsLast7Days: recent.count ?? 0,
    monitoredCompanies: monitored.size,
    monitorLimit: entitlements.allowances.intent_monitor.hardLimit,
    monitorsUsed: monitors.count ?? 0,
  };
}

type CompanyTarget = { key: string; name: string; domain: string | null };

/**
 * The company list inside a monitor's `target_json`, read defensively.
 *
 * The blob is written by the monitor builder and by imports, so an entry may be
 * a bare domain string or an object. Anything unrecognised is dropped rather
 * than rendered — a malformed target must produce a shorter list, not a broken
 * row.
 */
function readCompanyTargets(value: unknown): CompanyTarget[] {
  const blob = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const raw = Array.isArray(blob.companies) ? blob.companies : [];

  const out: CompanyTarget[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      const text = entry.trim();
      out.push({
        key: text.toLowerCase(),
        name: text,
        domain: text.includes(".") ? text : null,
      });
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const domain = typeof record.domain === "string" ? record.domain.trim() : "";
      if (!name && !domain) continue;
      out.push({
        key: (domain || name).toLowerCase(),
        name: name || domain,
        domain: domain || null,
      });
    }
  }
  return out;
}

/**
 * The named companies being watched, one row per company.
 *
 * Built from the monitors rather than from a separate table: a company is
 * "monitored" precisely because a monitor names it, and a second list would be
 * a copy that could disagree with the thing actually doing the work.
 */
export async function listMonitoredCompanies(
  businessId: string,
  monitors: IntentMonitorRow[],
  events: IntentEventRow[],
): Promise<MonitoredCompanyRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("intent_monitors")
    .select("id, status, target_json, intent_category_id")
    .eq("business_id", businessId)
    .eq("monitor_type", "NAMED_COMPANIES");

  const categoryNames = new Map(monitors.map((m) => [m.categoryId, m.categoryName]));
  const byCompany = new Map<string, MonitoredCompanyRow>();

  for (const row of data ?? []) {
    const categoryName = categoryNames.get(row.intent_category_id) ?? "Intent";

    for (const target of readCompanyTargets(row.target_json)) {
      const existing = byCompany.get(target.key);
      if (existing) {
        if (!existing.categories.includes(categoryName)) {
          existing.categories.push(categoryName);
        }
        // Any active monitor is enough for the company to count as watched.
        if (row.status === "ACTIVE" && existing.status === "PAUSED") {
          existing.status = "MONITORING";
        }
        continue;
      }

      byCompany.set(target.key, {
        key: target.key,
        name: target.name,
        domain: target.domain,
        categories: [categoryName],
        lastSignalAt: null,
        status: row.status === "ACTIVE" ? "MONITORING" : "PAUSED",
      });
    }
  }

  // The newest signal per company. Events arrive newest first, so the first
  // match for a company is the one to keep.
  for (const event of events) {
    if (!event.companyName) continue;
    const key = event.companyName.toLowerCase();
    const company =
      byCompany.get(key) ??
      [...byCompany.values()].find(
        (row) => row.name.toLowerCase() === key || row.domain?.toLowerCase() === key,
      );
    if (!company || company.lastSignalAt) continue;
    company.lastSignalAt = event.observedAt;
    if (company.status === "MONITORING") company.status = "INTENT_DETECTED";
  }

  return [...byCompany.values()].sort((a, b) => {
    if (a.lastSignalAt && b.lastSignalAt) return b.lastSignalAt.localeCompare(a.lastSignalAt);
    if (a.lastSignalAt) return -1;
    if (b.lastSignalAt) return 1;
    return a.name.localeCompare(b.name, "en-GB");
  });
}

/**
 * This month's signals by source family (§15.7).
 *
 * Counted over the calendar month rather than a rolling window because it sits
 * beside the plan's monthly monitoring allowance, and two different periods on
 * one card would be unreadable.
 */
export async function getIntentSourceUsage(
  businessId: string,
): Promise<IntentSourceUsage[]> {
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const { data } = await supabase
    .from("intent_events")
    .select("signal_type")
    .eq("business_id", businessId)
    .gte("observed_at", monthStart);

  const rows = data ?? [];
  const total = rows.length;
  if (total === 0) return [];

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.signal_type, (counts.get(row.signal_type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, events]) => ({
      source: source as SignalSourceKey,
      events,
      percent: Math.round((events / total) * 100),
    }))
    .sort((a, b) => b.events - a.events);
}

/** Everything the Intent tab renders, in one pass so the page never waterfalls. */
export async function loadIntentData(businessId: string): Promise<IntentViewData> {
  const supabase = await createClient();

  const [overview, categories, monitors, events, sourceUsage, icps] = await Promise.all([
    getIntentOverview(businessId),
    listIntentCategories(businessId),
    listIntentMonitors(businessId),
    listIntentEvents(businessId),
    getIntentSourceUsage(businessId),
    supabase
      .from("icp_profiles")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
  ]);

  // Depends on both monitors and events, so it cannot join the batch above.
  const monitoredCompanies = await listMonitoredCompanies(businessId, monitors, events);

  return {
    overview,
    categories,
    monitors,
    monitoredCompanies,
    events,
    sourceUsage,
    icpProfiles: icps.data ?? [],
  };
}
