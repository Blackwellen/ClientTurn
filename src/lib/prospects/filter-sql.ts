import "server-only";
import type { ProspectFilters } from "./filters";
import { orIlike } from "../supabase/ilike.ts";
import {
  anyOfToPostgrest,
  LIVE_CAMPAIGN_STATUSES,
  PROSPECT_COUNT_DEFINITIONS,
  QUICK_FILTER_COUNT_KEY,
  type ProspectCountKey,
} from "./prospect-counts.ts";

/**
 * What a count needs that is not a prospects column: the workspace's live
 * campaign ids (LIVE_CAMPAIGN_STATUSES), resolved once per request by
 * `liveCampaignIdsFor`. Required, so no caller can silently treat every
 * campaign as finished.
 */
export type CountContext = { liveCampaignIds: readonly string[] };

/** Matches no row: `in.()` on an empty list is not portable PostgREST. */
const NO_CAMPAIGN = "00000000-0000-0000-0000-000000000000";

type CampaignReader = {
  from: (table: "outreach_campaigns") => {
    select: (columns: "id") => {
      eq: (column: "business_id", value: string) => {
        in: (column: "status", values: readonly string[]) => PromiseLike<{
          data: { id: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/** The workspace's live campaign ids, for `CountContext`. Throws on a failed read. */
export async function liveCampaignIdsFor(client: unknown, businessId: string): Promise<string[]> {
  const { data, error } = await (client as CampaignReader)
    .from("outreach_campaigns")
    .select("id")
    .eq("business_id", businessId)
    .in("status", LIVE_CAMPAIGN_STATUSES);
  if (error) throw new Error(`outreach_campaigns: live ids: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

/**
 * Translates parsed prospect filters into PostgREST predicates.
 *
 * Split out of `queries.ts` so the filter shape itself (`filters.ts`) stays
 * importable by client components, while the part that needs a Supabase query
 * builder stays server-only — the same boundary `lib/leads` keeps between
 * `filters.ts` and `queries.ts`.
 *
 * Every predicate below is applied by the database. A workspace with 50,000
 * prospects must never ship its whole table to the app server to be filtered.
 */

/** Intent filters only ever count signals that have not expired (§62.2). */
export const ACTIVE_INTENT_ONLY = "expires_at.gt.now()";

/**
 * The subset of the PostgREST builder this module uses.
 *
 * `applyProspectFilters` is generic over the caller's builder so the column
 * typing at the call site is preserved; the cast to this shape happens once,
 * here, rather than at every predicate.
 */
type FilterOps = {
  eq: (column: string, value: string | number | boolean) => FilterOps;
  neq: (column: string, value: string | number | boolean) => FilterOps;
  in: (column: string, values: readonly (string | number)[]) => FilterOps;
  gte: (column: string, value: string | number) => FilterOps;
  is: (column: string, value: null) => FilterOps;
  not: (column: string, operator: string, value: null) => FilterOps;
  or: (filters: string) => FilterOps;
};

/**
 * Applies one count definition from `prospect-counts.ts` as predicates.
 *
 * The chips, the KPI strip and the list behind each chip all go through this,
 * so a chip's number and the rows it shows cannot drift apart. The inbox scope
 * (not a test row, not promoted) and the live-intent join are the caller's:
 * both depend on which select the caller built.
 */
export function applyCountDefinition<T>(query: T, key: ProspectCountKey, context: CountContext): T {
  let q = query as FilterOps;
  for (const clause of PROSPECT_COUNT_DEFINITIONS[key].clauses) {
    if ("liveCampaign" in clause) {
      const ids = context.liveCampaignIds;
      if (clause.liveCampaign) {
        q = q.in("campaign_id", ids.length > 0 ? ids : [NO_CAMPAIGN]);
      } else if (ids.length > 0) {
        // Not enrolled, or enrolled in a campaign that is not live.
        q = q.or(`campaign_id.is.null,campaign_id.not.in.(${ids.join(",")})`);
      }
      continue;
    }
    if ("anyOf" in clause) {
      q = q.or(anyOfToPostgrest(clause.anyOf));
      continue;
    }
    switch (clause.op) {
      case "eq":
        q = q.eq(clause.column, clause.value);
        break;
      case "neq":
        q = q.neq(clause.column, clause.value);
        break;
      case "in":
        q = q.in(clause.column, clause.values);
        break;
      case "isNull":
        q = q.is(clause.column, null);
        break;
      case "notNull":
        q = q.not(clause.column, "is", null);
        break;
    }
  }
  return q as T;
}

/**
 * True when a filter reaches into the company row, which the caller must then
 * embed as `prospect_companies!inner(...)`. With a plain embed PostgREST
 * filters the *embedded* rows and leaves every parent in place, so the filter
 * would appear to do nothing.
 */
export function needsCompanyJoin(filters: ProspectFilters): boolean {
  return (
    filters.industries.length > 0 ||
    filters.companySizes.length > 0 ||
    filters.locations.length > 0
  );
}

export function applyProspectFilters<T>(query: T, filters: ProspectFilters, context: CountContext): T {
  let q = query as FilterOps;

  /* Quick filters. These are the chips, and they are deliberately expressed as
   * ordinary predicates so they compose with the advanced panel rather than
   * replacing it. */
  if (filters.quick !== "all") {
    q = applyCountDefinition(q, QUICK_FILTER_COUNT_KEY[filters.quick], context);
  }
  // The live-intent part of `quick === "intent"` is applied by the caller,
  // which needs an inner join against prospect_intent_matches.

  if (filters.grades.length > 0) q = q.in("grade", filters.grades);
  if (filters.statuses.length > 0) q = q.in("status", filters.statuses);
  if (filters.verification.length > 0) {
    q = q.in("verification_status", filters.verification);
  }
  if (filters.eligibility.length > 0) {
    q = q.in("outreach_eligibility", filters.eligibility);
  }
  if (filters.icpProfileId) q = q.eq("icp_profile_id", filters.icpProfileId);
  if (filters.campaignId) q = q.eq("campaign_id", filters.campaignId);
  // Backed by the partial index prospects(business_id, source_run_id, status).
  if (filters.sourceRunId) q = q.eq("source_run_id", filters.sourceRunId);
  if (filters.sourceProvider) q = q.eq("source_provider", filters.sourceProvider);
  if (filters.minScore !== null) q = q.gte("score", filters.minScore);

  /* Company-scoped predicates. These only restrict the parent rows when the
   * company is embedded with `!inner` — see `needsCompanyJoin` — so the caller
   * picks its select accordingly. Applied through the embedded resource rather
   * than by pre-resolving company ids, which would not scale past a workspace
   * with a few thousand companies. */
  if (filters.industries.length > 0) {
    q = q.in("prospect_companies.industry", filters.industries);
  }
  if (filters.companySizes.length > 0) {
    q = q.in("prospect_companies.company_size", filters.companySizes);
  }
  if (filters.locations.length > 0) {
    q = q.in("prospect_companies.location_json->>city", filters.locations);
  }

  if (filters.roles.length > 0) {
    // Role titles are free text from providers, so this matches the recorded
    // values rather than attempting a fuzzy match.
    q = q.in("role_title", filters.roles);
  }

  if (filters.range !== "all") {
    const days = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 90;
    q = q.gte("created_at", new Date(Date.now() - days * 864e5).toISOString());
  }

  if (filters.search) {
    // The one place a value reaches PostgREST as raw filter syntax: `orIlike`
    // double-quotes it and escapes LIKE wildcards, so a comma or parenthesis
    // is matched as text rather than parsed as another predicate.
    const or = orIlike(["first_name", "last_name", "email", "role_title"], filters.search);
    if (or) q = q.or(or);
  }

  return q as T;
}
