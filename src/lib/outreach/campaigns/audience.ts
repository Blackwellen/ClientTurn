import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GRADES, type CampaignDraft, type Grade } from "../campaign-draft";

/**
 * Audience sizing for the wizard (V4 section 16.9).
 *
 * Every number this module returns is counted, not modelled. The estimate is a
 * `head: true` count over the workspace's own prospects with the campaign's own
 * predicates applied by Postgres — no provider is called to answer "how many
 * would this reach", because estimating must never cost money.
 *
 * When the campaign will also source new prospects, the sourcing *target* is
 * reported alongside the local count and labelled as a target. It is not added
 * in as though it were a discovered figure: a provider has not been asked, so
 * claiming a number it might return would be a fabrication.
 */

export type AudienceEstimate = {
  /** Prospects already held that match the criteria. */
  existing: number;
  /** What new sourcing is configured to add, when sourcing is enabled. */
  sourcingTarget: number;
  /** What the campaign could reach in total, as configured. */
  total: number;
  /** Null when the count could not be produced at all. */
  available: boolean;
  gradeDistribution: { grade: Grade; count: number; percent: number }[];
};

type CountBuilder = {
  eq: (column: string, value: string | number | boolean) => CountBuilder;
  in: (column: string, values: readonly (string | number)[]) => CountBuilder;
  is: (column: string, value: null) => CountBuilder;
  not: (column: string, operator: string, value: null) => CountBuilder;
  or: (filter: string, options?: { referencedTable?: string }) => CountBuilder;
};

/** A value reaching PostgREST as raw filter syntax has to be defanged first. */
function escapeOr(value: string): string {
  return value.replace(/[,()\\*]/g, " ").trim();
}

/**
 * Applies the campaign's audience predicates to a prospects query.
 *
 * The company-side filters need an `!inner` embed at the call site: with a
 * plain embed PostgREST filters the embedded rows and leaves every parent in
 * place, so the filter appears to do nothing.
 */
function applyAudience<T>(query: T, draft: CampaignDraft, minimumGrade: Grade | null): T {
  const { audience } = draft;
  let q = query as unknown as CountBuilder;

  // Never count anyone who could not lawfully be contacted anyway.
  q = q.is("promoted_to_lead_id", null);
  q = q.not("email", "is", null);
  q = q.in("status", ["DISCOVERED", "VERIFIED", "READY", "APPROVED", "REVIEW"]);

  if (minimumGrade) {
    q = q.in("grade", gradesFrom(minimumGrade));
  }
  if (audience.roles.length > 0) {
    q = q.or(audience.roles.map((role) => `role_title.ilike.*${escapeOr(role)}*`).join(","));
  }
  if (audience.industries.length > 0) {
    q = q.or(
      audience.industries.map((v) => `industry.eq.${escapeOr(v)}`).join(","),
      { referencedTable: "prospect_companies" },
    );
  }
  if (audience.companySizes.length > 0) {
    q = q.or(
      audience.companySizes.map((v) => `company_size.eq.${escapeOr(v)}`).join(","),
      { referencedTable: "prospect_companies" },
    );
  }
  if (audience.locations.length > 0) {
    q = q.or(
      audience.locations
        .map((v) => `location_json->>city.ilike.*${escapeOr(v)}*`)
        .join(","),
      { referencedTable: "prospect_companies" },
    );
  }
  if (audience.exclusions.existingCustomers) {
    q = q.eq("prospect_companies.is_existing_customer", false);
  }

  return q as unknown as T;
}

function gradesFrom(minimum: Grade): Grade[] {
  const order: Grade[] = ["A+", "A", "B", "C", "D"];
  const cut = order.indexOf(minimum);
  return cut === -1 ? order : order.slice(0, cut + 1);
}

const needsCompanyJoin = (draft: CampaignDraft) =>
  draft.audience.industries.length > 0 ||
  draft.audience.companySizes.length > 0 ||
  draft.audience.locations.length > 0 ||
  draft.audience.exclusions.existingCustomers;

/**
 * The estimate and the grade split behind it.
 *
 * The distribution is counted over the audience *before* the minimum grade is
 * applied, because "1,248 prospects, 18% of them A+" is only meaningful if the
 * denominator is everyone the criteria match rather than everyone who already
 * passes the grade filter.
 */
export async function estimateAudience(
  businessId: string,
  draft: CampaignDraft,
): Promise<AudienceEstimate> {
  const admin = createAdminClient();
  const join = needsCompanyJoin(draft);
  const select = join
    ? "id, prospect_companies!inner(id)"
    : "id";

  const base = () =>
    applyAudience(
      admin
        .from("prospects")
        .select(select, { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_test", false),
      draft,
      null,
    );

  try {
    const [total, ...byGrade] = await Promise.all([
      base(),
      ...GRADES.map((grade) => base().eq("grade", grade)),
    ]);

    const existing = total.count ?? 0;
    const distribution = GRADES.map((grade, index) => {
      const count = byGrade[index]?.count ?? 0;
      return {
        grade,
        count,
        percent: existing > 0 ? Math.round((count / existing) * 100) : 0,
      };
      // Strongest grade first reads better in the legend than D upward.
    }).reverse();

    const sourcingTarget =
      draft.audience.source === "EXISTING_ONLY" ? 0 : draft.budget.prospectsPerRun;

    return {
      existing,
      sourcingTarget,
      total:
        draft.audience.source === "NEW_ONLY" ? sourcingTarget : existing + sourcingTarget,
      available: true,
      gradeDistribution: distribution,
    };
  } catch {
    // A failed count is "we do not know", never zero. Zero would read as
    // "nobody matches", which is a different and much more alarming claim.
    return {
      existing: 0,
      sourcingTarget: 0,
      total: 0,
      available: false,
      gradeDistribution: [],
    };
  }
}

/* --------------------------------------------------------- intent insight */

export type IntentCategoryInsight = {
  id: string;
  name: string;
  freshnessDays: number;
  /** Signals matched inside the campaign's freshness window. */
  recentSignals: number;
  /** Change against the previous window of the same length, or null when
   *  there was no previous window to compare against. */
  trend: number | null;
};

/**
 * Recent activity per selected intent category.
 *
 * Counted from `prospect_intent_matches`, which is where a signal becomes a
 * fact about a prospect. Counting `intent_events` instead would report signals
 * that matched nobody, which is not what "124 signals" implies on this card.
 */
export async function loadIntentInsights(
  businessId: string,
  categoryIds: string[],
  maxAgeDays: number,
): Promise<IntentCategoryInsight[]> {
  if (categoryIds.length === 0) return [];
  const admin = createAdminClient();

  const { data: categories } = await admin
    .from("intent_categories")
    .select("id, name, freshness_days, active")
    .eq("business_id", businessId)
    .in("id", categoryIds.slice(0, 12));

  const now = Date.now();
  const windowMs = maxAgeDays * 864e5;
  const currentFrom = new Date(now - windowMs).toISOString();
  const priorFrom = new Date(now - windowMs * 2).toISOString();

  const insights = await Promise.all(
    (categories ?? []).map(async (category) => {
      // The stricter of the campaign window and the category's own freshness.
      const effectiveDays = Math.min(maxAgeDays, category.freshness_days);
      const from = new Date(now - effectiveDays * 864e5).toISOString();

      const [current, prior] = await Promise.all([
        admin
          .from("prospect_intent_matches")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("intent_category_id", category.id)
          .gte("matched_at", from),
        admin
          .from("prospect_intent_matches")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("intent_category_id", category.id)
          .gte("matched_at", priorFrom)
          .lt("matched_at", currentFrom),
      ]);

      const recent = current.count ?? 0;
      const before = prior.count ?? 0;

      return {
        id: category.id,
        name: category.name,
        freshnessDays: category.freshness_days,
        recentSignals: recent,
        // No prior window means the trend is unknown, not flat. "+0%" against
        // a month with no data would be a claim we cannot support.
        trend: before > 0 ? (recent - before) / before : null,
      };
    }),
  );

  return insights;
}

/* ---------------------------------------------------------- wizard options */

export type CampaignWizardOptions = {
  services: { id: string; name: string; active: boolean }[];
  icpProfiles: {
    id: string;
    name: string;
    locations: string[];
    industries: string[];
    roles: string[];
    companySizes: string[];
    intentCategoryIds: string[];
  }[];
  savedSearches: { id: string; title: string; icpProfileId: string | null }[];
  intentCategories: { id: string; name: string; freshnessDays: number }[];
  industries: string[];
  companySizes: string[];
  locations: string[];
  roles: string[];
};

const KNOWN_COMPANY_SIZES = [
  "1-10",
  "11-50",
  "50-200",
  "50-500",
  "200-1000",
  "1000+",
];

/** Everything the wizard's selects need, in one round of parallel reads. */
export async function loadWizardOptions(
  businessId: string,
): Promise<CampaignWizardOptions> {
  const admin = createAdminClient();

  const [services, icps, searches, categories, companies, prospects] = await Promise.all([
    admin
      .from("services")
      .select("id, name, active")
      .eq("business_id", businessId)
      .order("position", { ascending: true }),
    admin
      .from("icp_profiles")
      .select("id, name, locations, industries, roles, company_filters, default_intent_category_ids")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
    admin
      .from("search_sessions")
      .select("id, title, icp_profile_id, updated_at")
      .eq("business_id", businessId)
      .eq("status", "ACTIVE")
      .order("updated_at", { ascending: false })
      .limit(50),
    admin
      .from("intent_categories")
      .select("id, name, freshness_days")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
    admin
      .from("prospect_companies")
      .select("industry, company_size, location_json")
      .eq("business_id", businessId)
      .limit(1000),
    admin
      .from("prospects")
      .select("role_title")
      .eq("business_id", businessId)
      .limit(1000),
  ]);

  const distinct = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
      a.localeCompare(b, "en-GB"),
    );

  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  const observedSizes = distinct((companies.data ?? []).map((row) => row.company_size));

  return {
    services: (services.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
    })),
    icpProfiles: (icps.data ?? []).map((row) => {
      const filters = (row.company_filters ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        name: row.name,
        locations: asStrings(row.locations).map(String),
        industries: asStrings(row.industries),
        roles: asStrings(row.roles),
        companySizes: asStrings(filters.sizes ?? filters.companySizes),
        intentCategoryIds: Array.isArray(row.default_intent_category_ids)
          ? (row.default_intent_category_ids as string[])
          : [],
      };
    }),
    savedSearches: (searches.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      icpProfileId: row.icp_profile_id,
    })),
    intentCategories: (categories.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      freshnessDays: row.freshness_days,
    })),
    industries: distinct((companies.data ?? []).map((row) => row.industry)),
    // Offer the standard bands as well as whatever the data actually shows, so
    // a new workspace is not stuck with an empty select.
    companySizes: distinct([...KNOWN_COMPANY_SIZES, ...observedSizes]),
    locations: distinct(
      (companies.data ?? []).map((row) => {
        const location = row.location_json as Record<string, unknown> | null;
        return typeof location?.city === "string" ? location.city : null;
      }),
    ).slice(0, 200),
    roles: distinct((prospects.data ?? []).map((row) => row.role_title)).slice(0, 200),
  };
}
