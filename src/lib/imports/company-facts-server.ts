import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { categoryKeywords, kindsForCategory, type IntentEvidenceKind } from "@/lib/find-leads/intent-evidence";
import { recordIntentSignal, type IntentCategory } from "@/lib/find-leads/server/intent-record";
import type { IntentResult } from "@/lib/find-leads/server/providers/types";
import { companyFactSignals, hasCompanyFacts, type CompanyFacts } from "./company-facts";

/**
 * Records the signals one imported company's facts produce (company-facts.ts)
 * as intent evidence on the prospect, under whichever of the workspace's
 * active intent categories collects the kind -- the same recorder, dedupe
 * key and expiry the sourcing run uses. Also keeps the company's headcount
 * current, so the next import measures growth from it.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type CategoryRow = IntentCategory & { name: string; keywords_entities: unknown; signal_types: unknown };

export type CategoryPicker = (kind: IntentEvidenceKind) => IntentCategory | null;

/** Loaded once per import: the workspace's active categories, picked by kind. */
export async function categoryPicker(businessId: string): Promise<CategoryPicker> {
  const { data } = await db()
    .from("intent_categories")
    .select("id, name, score_impact, freshness_days, keywords_entities, signal_types")
    .eq("business_id", businessId)
    .eq("active", true);
  const shapes = ((data ?? []) as CategoryRow[]).map((row) => ({
    row,
    kinds: kindsForCategory({
      name: row.name,
      keywords: categoryKeywords(row.keywords_entities),
      signalTypes: Array.isArray(row.signal_types) ? (row.signal_types as unknown[]).filter((t): t is string => typeof t === "string") : [],
    }),
  }));
  return (kind) => shapes.find((shape) => shape.kinds.includes(kind))?.row ?? null;
}

export async function recordCompanyFacts(input: {
  businessId: string;
  prospectId: string;
  companyId: string | null;
  domain: string | null;
  facts: CompanyFacts;
  reference: string;
  pick: CategoryPicker;
  now?: Date;
}): Promise<{ recorded: number; uncategorised: number }> {
  if (!hasCompanyFacts(input.facts)) return { recorded: 0, uncategorised: 0 };
  const now = input.now ?? new Date();

  let previousHeadcount: number | null = null;
  if (input.companyId) {
    const { data } = await db().from("prospect_companies").select("employee_count").eq("id", input.companyId).eq("business_id", input.businessId).maybeSingle();
    previousHeadcount = (data as { employee_count: number | null } | null)?.employee_count ?? null;
    if (input.facts.headcount !== null && input.facts.headcount !== previousHeadcount) {
      await db().from("prospect_companies").update({ employee_count: input.facts.headcount }).eq("id", input.companyId).eq("business_id", input.businessId);
    }
  }

  const signals = companyFactSignals({
    facts: input.facts,
    previousHeadcount,
    // No ":" in the domain: the dedupe key is colon-separated (intent-evidence.ts).
    domain: input.domain ?? `company-${input.companyId ?? input.prospectId}`,
    reference: input.reference,
    now,
  });

  let recorded = 0;
  let uncategorised = 0;
  for (const signal of signals) {
    const category = input.pick(signal.evidence.kind);
    if (!category) {
      uncategorised += 1;
      continue;
    }
    const ok = await recordIntentSignal({
      businessId: input.businessId,
      prospectId: input.prospectId,
      companyId: input.companyId,
      category,
      signal: signal as IntentResult,
      provider: "customer_data",
      now: now.getTime(),
    });
    if (ok) recorded += 1;
  }
  if (recorded > 0) {
    await db().from("prospects").update({ last_intent_at: now.toISOString() }).eq("business_id", input.businessId).eq("id", input.prospectId);
  }
  return { recorded, uncategorised };
}
