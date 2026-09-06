import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { FALLBACK_UNIT_COST_MINOR } from "../cost-model";
import { loadUnitCosts } from "./budget";
import { providersFor, unhealthyProviders } from "./providers/registry";
import type { CompanyCandidate } from "./providers/types";

/**
 * Re-running research for a single prospect (V4 §13.3).
 *
 * This is the one place in Find Leads where a customer can spend provider money
 * outside a sourcing run, so it carries its own set of brakes rather than
 * borrowing the run's:
 *
 *   * a **per-prospect cooldown**, because the answer to "has this company
 *     changed" does not differ between 10:00 and 10:05, and a refresh button
 *     with no cooldown is a way to spend a month's budget in an afternoon;
 *   * a **per-workspace daily cap**, so one person cannot drain the allowance
 *     across many prospects instead of one;
 *   * **plan entitlement**, checked before anything is called;
 *   * **provider health and configuration**, so a refresh that cannot possibly
 *     work is refused rather than billed.
 *
 * Every check runs again inside `refreshProspectResearch` immediately before the
 * provider call. `researchRefreshState` exists to *describe* the situation to
 * the UI; it is never the thing that authorises the spend.
 */

/** One refresh per prospect per day. */
export const RESEARCH_COOLDOWN_HOURS = 24;

/** How many prospects a workspace may refresh in a rolling day. */
export const RESEARCH_DAILY_WORKSPACE_LIMIT = 25;

export type ResearchRefreshState = {
  allowed: boolean;
  /** Customer-facing sentence. Present whenever `allowed` is false. */
  reason: string | null;
  /** When the cooldown lifts, if that is what is blocking. */
  nextAllowedAt: string | null;
  usedToday: number;
  dailyLimit: number;
  /**
   * What a refresh would cost, in pence, at current price-book rates.
   *
   * Shown so the decision is informed. This is the customer's own budget being
   * spent on their own prospect — it is not a provider unit-cost disclosure,
   * which stays admin-only.
   */
  estimatedCostMinor: number;
};

type ProspectRow = {
  id: string;
  business_id: string;
  email: string | null;
  company_id: string | null;
  status: string;
  outreach_eligibility: string;
};

async function loadProspect(
  businessId: string,
  prospectId: string,
): Promise<ProspectRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospects")
    .select("id, business_id, email, company_id, status, outreach_eligibility")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();
  return (data as ProspectRow | null) ?? null;
}

/** Estimated pence for one company enrichment plus one email verification. */
async function estimateRefreshCost(withEmail: boolean): Promise<number> {
  const unitCosts = await loadUnitCosts();
  const company =
    unitCosts.COMPANY_ENRICHMENT ?? FALLBACK_UNIT_COST_MINOR.COMPANY_ENRICHMENT;
  const email = unitCosts.EMAIL_VERIFICATION ?? FALLBACK_UNIT_COST_MINOR.EMAIL_VERIFICATION;
  return Math.ceil(company + (withEmail ? email : 0));
}

export async function researchRefreshState(
  businessId: string,
  prospectId: string,
): Promise<ResearchRefreshState> {
  const admin = createAdminClient();
  const now = Date.now();
  const dayAgo = new Date(now - 864e5).toISOString();
  const cooldownFrom = new Date(now - RESEARCH_COOLDOWN_HOURS * 3600_000).toISOString();

  const [prospect, entitlements, lastRefresh, todayRefreshes] = await Promise.all([
    loadProspect(businessId, prospectId),
    getV4Entitlements(businessId),
    // The cooldown is read from the enrichment rows themselves rather than a
    // separate counter, which could disagree with what actually ran.
    admin
      .from("prospect_enrichments")
      .select("requested_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .eq("provider", "USER_REFRESH")
      .gte("requested_at", cooldownFrom)
      .order("requested_at", { ascending: false })
      .limit(1),
    admin
      .from("prospect_enrichments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("provider", "USER_REFRESH")
      .gte("requested_at", dayAgo),
  ]);

  const usedToday = todayRefreshes.count ?? 0;
  const estimatedCostMinor = await estimateRefreshCost(Boolean(prospect?.email));

  const base = {
    nextAllowedAt: null as string | null,
    usedToday,
    dailyLimit: RESEARCH_DAILY_WORKSPACE_LIMIT,
    estimatedCostMinor,
  };

  if (!prospect) {
    return { ...base, allowed: false, reason: "That prospect could not be found." };
  }

  if (!entitlements.sourcingEnabled) {
    return {
      ...base,
      allowed: false,
      reason: "Refreshing research is part of Find Leads, which is not on your plan.",
    };
  }

  // Spending enrichment budget on someone who has opted out is money burned on
  // a record that can never be contacted.
  if (prospect.outreach_eligibility === "SUPPRESSED") {
    return {
      ...base,
      allowed: false,
      reason: "This prospect is suppressed, so there is nothing to be gained by refreshing it.",
    };
  }

  const previous = lastRefresh.data?.[0]?.requested_at ?? null;
  if (previous) {
    const nextAllowedAt = new Date(
      new Date(previous).getTime() + RESEARCH_COOLDOWN_HOURS * 3600_000,
    ).toISOString();
    return {
      ...base,
      allowed: false,
      nextAllowedAt,
      reason: `This prospect was refreshed in the last ${RESEARCH_COOLDOWN_HOURS} hours. Research is available again on ${new Date(
        nextAllowedAt,
      ).toLocaleString("en-GB")}.`,
    };
  }

  if (usedToday >= RESEARCH_DAILY_WORKSPACE_LIMIT) {
    return {
      ...base,
      allowed: false,
      reason: `Your workspace has refreshed ${usedToday} prospects in the last 24 hours, which is the daily limit.`,
    };
  }

  const unhealthy = await unhealthyProviders();
  if (providersFor("COMPANY_ENRICHMENT", unhealthy).length === 0) {
    return {
      ...base,
      allowed: false,
      reason: "No enrichment provider is available right now. Nothing has been charged.",
    };
  }

  return { ...base, allowed: true, reason: null };
}

export type RefreshOutcome = {
  ok: boolean;
  error: string | null;
  /** Fields that actually changed, for the toast. */
  updatedFields: string[];
  costMinor: number;
};

/**
 * Runs the refresh.
 *
 * Re-checks eligibility rather than trusting the state the UI was rendered
 * with: the button may have been on screen for an hour, and the cooldown may
 * have been consumed by a colleague in the meantime.
 *
 * The attempt row is written *before* the provider is called, so a crash
 * mid-call still consumes the cooldown. Failing closed is right here — the
 * alternative is a failure mode where an erroring provider can be hammered.
 */
export async function refreshProspectResearch(
  businessId: string,
  prospectId: string,
  userId: string | null,
): Promise<RefreshOutcome> {
  const state = await researchRefreshState(businessId, prospectId);
  if (!state.allowed) {
    return { ok: false, error: state.reason, updatedFields: [], costMinor: 0 };
  }

  const admin = createAdminClient();
  const prospect = await loadProspect(businessId, prospectId);
  if (!prospect) {
    return { ok: false, error: "That prospect could not be found.", updatedFields: [], costMinor: 0 };
  }

  const { data: company } = prospect.company_id
    ? await admin
        .from("prospect_companies")
        .select("id, name, domain, website_url, industry, employee_count, company_size, description, location_json")
        .eq("business_id", businessId)
        .eq("id", prospect.company_id)
        .maybeSingle()
    : { data: null };

  if (!company) {
    return {
      ok: false,
      error: "This prospect has no company resolved yet, so there is nothing to research.",
      updatedFields: [],
      costMinor: 0,
    };
  }

  // The attempt is on the record before any money is spent.
  const { data: attempt } = await admin
    .from("prospect_enrichments")
    .insert({
      business_id: businessId,
      prospect_id: prospectId,
      company_id: company.id,
      enrichment_type: "COMPANY",
      provider: "USER_REFRESH",
      status: "PENDING",
      result_json: { requestedBy: userId } as never,
    })
    .select("id")
    .single();

  const unhealthy = await unhealthyProviders();
  const candidates = providersFor("COMPANY_ENRICHMENT", unhealthy).filter(
    (provider) => typeof provider.enrichCompanies === "function",
  );

  if (candidates.length === 0) {
    if (attempt) {
      await admin
        .from("prospect_enrichments")
        .update({ status: "SKIPPED_GATE", error_code: "PROVIDER_NOT_CONFIGURED" })
        .eq("id", attempt.id);
    }
    return {
      ok: false,
      error: "No enrichment provider is available right now. Nothing has been charged.",
      updatedFields: [],
      costMinor: 0,
    };
  }

  const candidate: CompanyCandidate = {
    externalId: null,
    name: company.name,
    domain: company.domain,
    websiteUrl: company.website_url,
    industry: company.industry,
    employeeCount: company.employee_count,
    companySize: company.company_size,
    description: company.description,
    location: (company.location_json ?? {}) as CompanyCandidate["location"],
  };

  const provider = candidates[0];
  let updated: CompanyCandidate | null = null;
  let errorCode: string | null = null;

  try {
    const response = await provider.enrichCompanies!({ companies: [candidate] });
    updated = response.records?.[0] ?? null;
    errorCode = response.errorCode ?? null;
  } catch {
    // An adapter that throws must not take the request with it — the cooldown
    // row is already written and the failure is recorded like any other.
    errorCode = "PROVIDER_ERROR";
  }

  if (!updated) {
    if (attempt) {
      await admin
        .from("prospect_enrichments")
        .update({
          status: errorCode ? "FAILED" : "NOT_FOUND",
          error_code: errorCode,
          completed_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
    }
    return {
      ok: false,
      error:
        errorCode === "PROVIDER_ERROR"
          ? "The research provider could not be reached. Try again later."
          : "No newer information was found for this company.",
      updatedFields: [],
      costMinor: 0,
    };
  }

  // Only fields the provider actually returned are written. A null from an
  // adapter means "I don't know", never "this is now empty" — overwriting a
  // known value with a null is how good data gets destroyed by a refresh.
  const patch: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  const consider = (column: string, next: unknown, current: unknown) => {
    if (next === null || next === undefined || next === "") return;
    if (next === current) return;
    patch[column] = next;
    updatedFields.push(column);
  };

  consider("industry", updated.industry, company.industry);
  consider("employee_count", updated.employeeCount, company.employee_count);
  consider("company_size", updated.companySize, company.company_size);
  consider("description", updated.description, company.description);
  consider("website_url", updated.websiteUrl, company.website_url);

  if (Object.keys(patch).length > 0) {
    await admin
      .from("prospect_companies")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .eq("id", company.id);

    // Provenance for every field written, so the Research tab can say where
    // each new value came from and when.
    await admin.from("prospect_data_sources").insert(
      updatedFields.map((field) => ({
        business_id: businessId,
        prospect_id: prospectId,
        company_id: company.id,
        field_name: field,
        value_json: { value: patch[field] } as never,
        provider: provider.key,
        source_type: "LICENSED_PROVIDER",
        confidence: 0.8,
        obtained_at: new Date().toISOString(),
      })),
    );
  }

  const costMinor = provider.freeOfCharge ? 0 : state.estimatedCostMinor;

  if (attempt) {
    await admin
      .from("prospect_enrichments")
      .update({
        status: "SUCCESS",
        provider: "USER_REFRESH",
        cost_minor: costMinor,
        result_json: {
          requestedBy: userId,
          provider: provider.key,
          updatedFields,
        } as never,
        completed_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);
  }

  // The append-only ledger the admin cost views read. A refresh outside a run
  // still costs money, and money that is not ledgered does not exist as far as
  // margin reporting is concerned.
  if (costMinor > 0) {
    await admin.from("cost_events").insert({
      business_id: businessId,
      provider: provider.key,
      metric: "sourcing",
      quantity: 1,
      currency: "GBP",
      unit_cost: costMinor / 100,
      total_cost: costMinor / 100,
      source_event_id: attempt?.id ?? null,
      estimated: true,
      reconciled: false,
    });
  }

  await admin
    .from("prospects")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("id", prospectId);

  return { ok: true, error: null, updatedFields, costMinor };
}
