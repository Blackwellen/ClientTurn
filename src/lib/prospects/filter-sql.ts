import "server-only";
import type { ProspectFilters } from "./filters";

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
  in: (column: string, values: readonly (string | number)[]) => FilterOps;
  gte: (column: string, value: string | number) => FilterOps;
  or: (filters: string) => FilterOps;
};

const QUICK_STATUS: Record<string, string[]> = {
  ready: ["READY"],
  contacted: ["APPROVED", "OUTREACH_ACTIVE"],
  replied: ["REPLIED"],
};

/**
 * `escapeOr` guards the one place a value reaches PostgREST as raw filter
 * syntax. A comma or parenthesis in a search term would otherwise be parsed as
 * additional predicates rather than as text.
 */
function escapeOr(value: string): string {
  return value.replace(/[,()\\]/g, " ").trim();
}

export function applyProspectFilters<T>(query: T, filters: ProspectFilters): T {
  let q = query as FilterOps;

  /* Quick filters. These are the chips, and they are deliberately expressed as
   * ordinary predicates so they compose with the advanced panel rather than
   * replacing it. */
  if (filters.quick === "a-grade") {
    q = q.in("grade", ["A+", "A"]);
  } else if (filters.quick === "review") {
    q = q.or("status.eq.REVIEW,outreach_eligibility.eq.REVIEW");
  } else if (QUICK_STATUS[filters.quick]) {
    q = q.in("status", QUICK_STATUS[filters.quick]);
  }
  // `quick === "intent"` is handled by the caller, which needs a join against
  // prospect_intent_matches rather than a column predicate.

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
  if (filters.sourceProvider) q = q.eq("source_provider", filters.sourceProvider);
  if (filters.minScore !== null) q = q.gte("score", filters.minScore);

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
    const term = escapeOr(filters.search);
    if (term) {
      q = q.or(
        [
          `first_name.ilike.*${term}*`,
          `last_name.ilike.*${term}*`,
          `email.ilike.*${term}*`,
          `role_title.ilike.*${term}*`,
        ].join(","),
      );
    }
  }

  return q as T;
}
