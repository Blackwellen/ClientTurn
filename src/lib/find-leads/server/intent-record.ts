import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVIDENCE_SIGNAL_TYPE,
  evidenceSummary,
  kindsForCategory,
  type IntentEvidenceKind,
} from "../intent-evidence";
import { emptyPlan } from "../plan";
import { intentWantsFor } from "../signals";
import { providersFor, unhealthyProviders } from "./providers/registry";
import type { IntentCategoryQuery, IntentResult } from "./providers/types";

/**
 * Writing one intent signal as evidence on a prospect, and checking one
 * prospect's company on demand.
 *
 * The sourcing run and the "Add website" action both record signals, and they
 * must record them identically -- same dedupe key, same expiry rule, same
 * evidence summary -- or the drawer's "Why this lead" would depend on which
 * path found the signal.
 */

export type IntentCategory = {
  id: string;
  freshness_days: number;
  score_impact: number;
};

/**
 * Records one signal for one prospect. Returns true when a new live match was
 * written; false for a duplicate, an expired signal or a failed write.
 */
export async function recordIntentSignal(input: {
  businessId: string;
  prospectId: string;
  companyId: string | null;
  category: IntentCategory;
  signal: IntentResult;
  provider: string;
  now?: number;
}): Promise<boolean> {
  const { signal, category } = input;
  const now = input.now ?? Date.now();

  const expiresAtMs = new Date(signal.observedAt).getTime() + category.freshness_days * 864e5;
  // Dated evidence already outside the category's window is history, not a
  // live signal.
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;
  const expiresAt = new Date(expiresAtMs).toISOString();

  // The same underlying fact (the same filing, the same page, on the same
  // day) collapses to one event per prospect, whichever path reports it.
  const dedupeKey = [
    signal.domain,
    signal.evidence.kind,
    signal.evidence.reference ?? signal.sourceUrl ?? "",
    signal.observedAt.slice(0, 10),
    input.prospectId,
  ].join(":");

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("intent_events")
    .upsert(
      {
        business_id: input.businessId,
        intent_category_id: category.id,
        company_id: input.companyId,
        prospect_id: input.prospectId,
        signal_type: EVIDENCE_SIGNAL_TYPE[signal.evidence.kind],
        source: input.provider,
        source_url: signal.sourceUrl,
        observed_at: signal.observedAt,
        expires_at: expiresAt,
        confidence: Math.max(0, Math.min(1, signal.strength)),
        score_impact: category.score_impact,
        evidence_summary: evidenceSummary(signal.evidence),
        dedupe_key: dedupeKey,
      },
      // Must name the unique index's columns exactly. The run used to say
      // (business_id, dedupe_key), which matches no constraint, so the upsert
      // errored and no intent event was ever recorded.
      { onConflict: "business_id,intent_category_id,dedupe_key", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (!event) return false;

  const { error } = await admin.from("prospect_intent_matches").insert({
    business_id: input.businessId,
    prospect_id: input.prospectId,
    intent_category_id: category.id,
    intent_event_id: event.id,
    expires_at: expiresAt,
    score_impact: category.score_impact,
  });

  // 23505 is the (prospect_id, intent_event_id) unique index: the same match
  // already recorded, which is not a new one.
  return !error;
}

/**
 * Checks one prospect's company against the workspace's active intent
 * categories, using the free sources only (the company's website and, when a
 * key is set, Companies House). Used after a person adds a website to an
 * imported prospect, which had nothing to check before.
 *
 * Paid sources are not called: outside a sourcing run there is no budget
 * reservation to charge them against.
 */
export async function checkProspectIntent(
  businessId: string,
  prospectId: string,
): Promise<{ checked: boolean; matched: number }> {
  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, company_id, company:prospect_companies(id, domain, registration_id)")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();
  const company = prospect?.company as unknown as {
    id: string;
    domain: string | null;
    registration_id: string | null;
  } | null;
  if (!prospect || !company?.domain) return { checked: false, matched: 0 };

  const { data: rows } = await admin
    .from("intent_categories")
    .select("id, name, score_impact, freshness_days, keywords_entities, signal_types")
    .eq("business_id", businessId)
    .eq("active", true);
  if (!rows || rows.length === 0) return { checked: false, matched: 0 };

  const shapes = rows.map((row) => {
    const configured = row.keywords_entities as { keywords?: unknown } | null;
    const keywords = Array.isArray(configured?.keywords)
      ? configured.keywords.filter((k): k is string => typeof k === "string")
      : [];
    const signalTypes = Array.isArray(row.signal_types)
      ? (row.signal_types as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    return { row, shape: { name: row.name, keywords, signalTypes } };
  });

  const categories: IntentCategoryQuery[] = shapes.map(({ shape }) => ({
    name: shape.name,
    keywords: shape.keywords,
  }));
  // No plan here: the kinds are what the workspace's own categories collect.
  const wants = intentWantsFor(emptyPlan(), shapes.map(({ shape }) => shape));
  const freshnessDays = Math.max(...rows.map((row) => row.freshness_days));

  const byName = new Map(rows.map((row) => [row.name.trim().toLowerCase(), row]));
  const byKind = (kind: IntentEvidenceKind) =>
    shapes.find(({ shape }) => kindsForCategory(shape).includes(kind))?.row ?? null;

  const sources = providersFor("INTENT", await unhealthyProviders()).filter(
    (provider) => provider.freeOfCharge && provider.fetchIntent,
  );

  let matched = 0;
  for (const source of sources) {
    const response = await source.fetchIntent!({
      domains: [company.domain],
      categories,
      freshnessDays,
      wants,
      companies: [{ domain: company.domain, registrationId: company.registration_id }],
    });
    if (!response.ok) continue;

    for (const signal of response.records) {
      const category = signal.category
        ? byName.get(signal.category.trim().toLowerCase())
        : byKind(signal.evidence.kind);
      if (!category) continue;
      const recorded = await recordIntentSignal({
        businessId,
        prospectId,
        companyId: company.id,
        category,
        signal,
        provider: source.key,
      });
      if (recorded) matched += 1;
    }
  }

  if (matched > 0) {
    await admin
      .from("prospects")
      .update({ last_intent_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .eq("id", prospectId);
  }

  return { checked: sources.length > 0, matched };
}
