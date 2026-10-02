/**
 * One definition per prospect count on Find Leads.
 *
 * Pure: no `server-only`, no Supabase. The Prospects quick-filter chips, the
 * KPI strip above them, the Discover strip and the list filter behind each
 * chip all read their predicates from here, so a chip saying "Ready 3" can no
 * longer sit above a KPI saying "Ready for outreach 0".
 *
 * Every definition is data (a list of clauses on columns of `prospects`), and
 * the same data is used three ways: applied as PostgREST predicates for the
 * head counts and the list (`filter-sql.ts`), evaluated in JS by
 * `matchesProspectCount` for tests, and rendered as the tooltip text below.
 *
 * Scope. Every count except "Converted" is over the prospect inbox: not a test
 * row, and not yet promoted to a lead (a promoted prospect lives in Leads).
 *
 *   Found               every prospect in the inbox.
 *   A grade             grade A+ or A.
 *   Live intent         at least one intent signal that has not expired.
 *   Verified            the email was verified as deliverable (VALID).
 *   Ready for outreach  approved or ready (status READY / APPROVED) AND
 *                       contact rules say ELIGIBLE AND has an email that has
 *                       not failed verification AND not suppressed (implied:
 *                       suppressed, bounced and unsubscribed are other
 *                       statuses / eligibilities) AND not in a LIVE
 *                       campaign (see LIVE_CAMPAIGN_STATUSES) AND never
 *                       contacted. A prospect whose campaign finished, was
 *                       stopped or is still a draft can be ready again.
 *   In campaigns        enrolled in a LIVE campaign (the real campaign
 *                       status, read through `liveCampaign` clauses).
 *   Contacted           at least one outreach message actually sent
 *                       (last_contacted_at set by the sender). Approval alone
 *                       is not contact.
 *   Replied             a reply was received (replied_at, or status REPLIED).
 *   Needs review        status REVIEW, or contact rules say REVIEW.
 *   Suppressed          contact rules say SUPPRESSED, or the prospect
 *                       bounced, unsubscribed or was suppressed.
 *   Converted           promoted to a lead (outside the inbox scope).
 *
 * Categories overlap on purpose (a replied prospect was also contacted), except
 * that Ready is disjoint from In campaigns and from Contacted by definition: a
 * prospect stops being "ready" the moment it joins a running sequence or is
 * sent to.
 *
 * "Live" needs the campaign's status, which is not a prospects column. It is a
 * `{ liveCampaign }` clause: in SQL the caller resolves the workspace's live
 * campaign ids once (`liveCampaignIdsFor` in filter-sql.ts) and the clause
 * becomes a `campaign_id` predicate on them; in JS it reads `campaign_status`.
 *
 * Known gap: cold dispatch also refuses a guessed address (email_origin
 * PATTERN_INFERRED) that is unverified. That column is not readable by the
 * member role, so "Ready" cannot apply it; such a prospect is counted ready and
 * is then held at send time by `evaluateEligibility`.
 */

export const PROSPECT_COUNT_KEYS = [
  "found",
  "aGrade",
  "intent",
  "verified",
  "ready",
  "inCampaign",
  "contacted",
  "replied",
  "review",
  "suppressed",
  "converted",
] as const;

export type ProspectCountKey = (typeof PROSPECT_COUNT_KEYS)[number];

/** The prospect columns a definition may read. */
export type ProspectCountColumn =
  | "status"
  | "grade"
  | "verification_status"
  | "outreach_eligibility"
  | "email"
  | "campaign_id"
  | "last_contacted_at"
  | "replied_at"
  | "promoted_to_lead_id";

export type SimpleClause =
  | { column: ProspectCountColumn; op: "eq" | "neq"; value: string }
  | { column: ProspectCountColumn; op: "in"; values: readonly string[] }
  | { column: ProspectCountColumn; op: "isNull" | "notNull" };

/**
 * A campaign is LIVE while its sequence can still send: running, optimising
 * or paused (a pause resumes). DRAFT and READY have not started; COMPLETED and
 * STOPPED are finished, so their prospects are free again.
 */
export const LIVE_CAMPAIGN_STATUSES = ["ACTIVE", "OPTIMIZING", "PAUSED"] as const;

/** `liveCampaign: true` = enrolled in a live campaign; `false` = not. */
export type LiveCampaignClause = { liveCampaign: boolean };

/** A clause is one simple predicate, any-of several (a PostgREST `or`), or a live-campaign test. */
export type CountClause = SimpleClause | { anyOf: readonly SimpleClause[] } | LiveCampaignClause;

export type ProspectCountDefinition = {
  label: string;
  /** Shown as the KPI tooltip. Plain words, one sentence or two. */
  definition: string;
  /** "inbox" = not a test row and not promoted; "converted" = promoted. */
  scope: "inbox" | "converted";
  clauses: readonly CountClause[];
  /** Needs an unexpired prospect_intent_matches row (a join, not a column). */
  requiresLiveIntent?: boolean;
};

export const PROSPECT_COUNT_DEFINITIONS: Record<ProspectCountKey, ProspectCountDefinition> = {
  found: {
    label: "Prospects found",
    definition: "Every prospect in your inbox that has not yet become a lead.",
    scope: "inbox",
    clauses: [],
  },
  aGrade: {
    label: "A grade",
    definition: "Prospects graded A+ or A.",
    scope: "inbox",
    clauses: [{ column: "grade", op: "in", values: ["A+", "A"] }],
  },
  intent: {
    label: "Live intent",
    definition: "Prospects with at least one intent signal that has not expired.",
    scope: "inbox",
    clauses: [],
    requiresLiveIntent: true,
  },
  verified: {
    label: "Verified contacts",
    definition: "Prospects whose email address was verified as deliverable.",
    scope: "inbox",
    clauses: [{ column: "verification_status", op: "eq", value: "VALID" }],
  },
  ready: {
    label: "Ready for outreach",
    definition:
      "Approved or ready, cleared by contact rules, with an email that has not failed verification, not suppressed, not in a running campaign and never contacted.",
    scope: "inbox",
    clauses: [
      { column: "status", op: "in", values: ["READY", "APPROVED"] },
      { column: "outreach_eligibility", op: "eq", value: "ELIGIBLE" },
      { column: "email", op: "notNull" },
      { column: "verification_status", op: "neq", value: "INVALID" },
      { liveCampaign: false },
      { column: "last_contacted_at", op: "isNull" },
    ],
  },
  inCampaign: {
    label: "In campaigns",
    definition: "Prospects enrolled in a running or paused campaign.",
    scope: "inbox",
    clauses: [{ liveCampaign: true }],
  },
  contacted: {
    label: "Contacted",
    definition: "Prospects who have been sent at least one outreach message. Approval alone is not contact.",
    scope: "inbox",
    clauses: [{ column: "last_contacted_at", op: "notNull" }],
  },
  replied: {
    label: "Replied",
    definition: "Prospects who have replied to your outreach.",
    scope: "inbox",
    clauses: [
      {
        anyOf: [
          { column: "replied_at", op: "notNull" },
          { column: "status", op: "eq", value: "REPLIED" },
        ],
      },
    ],
  },
  review: {
    label: "Needs review",
    definition: "Prospects waiting on a person: flagged for review, or contact rules need a decision.",
    scope: "inbox",
    clauses: [
      {
        anyOf: [
          { column: "status", op: "eq", value: "REVIEW" },
          { column: "outreach_eligibility", op: "eq", value: "REVIEW" },
        ],
      },
    ],
  },
  suppressed: {
    label: "Suppressed",
    definition: "Prospects who must not be contacted: suppressed, bounced or unsubscribed.",
    scope: "inbox",
    clauses: [
      {
        anyOf: [
          { column: "outreach_eligibility", op: "eq", value: "SUPPRESSED" },
          { column: "status", op: "in", values: ["SUPPRESSED", "BOUNCED", "UNSUBSCRIBED"] },
        ],
      },
    ],
  },
  converted: {
    label: "Converted to leads",
    definition: "Prospects promoted to a lead.",
    scope: "converted",
    clauses: [],
  },
};

/* ------------------------------------------------------------ evaluation */

/** One prospect, as the count definitions see it. */
export type ProspectCountFacts = {
  status: string;
  grade: string | null;
  verification_status: string | null;
  outreach_eligibility: string | null;
  email: string | null;
  campaign_id: string | null;
  /** The status of `campaign_id`'s campaign (a join); null/absent = none. */
  campaign_status?: string | null;
  last_contacted_at: string | null;
  replied_at: string | null;
  promoted_to_lead_id: string | null;
  is_test?: boolean;
  /** Whether the prospect has an unexpired intent match. */
  hasLiveIntent?: boolean;
};

function simpleMatches(clause: SimpleClause, row: ProspectCountFacts): boolean {
  const value = row[clause.column];
  switch (clause.op) {
    case "eq":
      return value === clause.value;
    case "neq":
      // PostgREST `neq` is SQL `<>`, which is never true for NULL.
      return value !== null && value !== undefined && value !== clause.value;
    case "in":
      return value !== null && value !== undefined && clause.values.includes(value);
    case "isNull":
      return value === null || value === undefined;
    case "notNull":
      return value !== null && value !== undefined;
  }
}

/** Whether the prospect is enrolled in a live campaign. */
export function inLiveCampaign(row: Pick<ProspectCountFacts, "campaign_id" | "campaign_status">): boolean {
  return (
    row.campaign_id !== null &&
    row.campaign_id !== undefined &&
    (LIVE_CAMPAIGN_STATUSES as readonly string[]).includes(row.campaign_status ?? "")
  );
}

function clauseMatches(clause: CountClause, row: ProspectCountFacts): boolean {
  if ("liveCampaign" in clause) return inLiveCampaign(row) === clause.liveCampaign;
  return "anyOf" in clause
    ? clause.anyOf.some((inner) => simpleMatches(inner, row))
    : simpleMatches(clause, row);
}

export function inScope(scope: ProspectCountDefinition["scope"], row: ProspectCountFacts): boolean {
  if (row.is_test) return false;
  return scope === "converted" ? row.promoted_to_lead_id !== null : row.promoted_to_lead_id === null;
}

/** Whether one prospect counts towards `key`. The JS twin of the SQL predicates. */
export function matchesProspectCount(key: ProspectCountKey, row: ProspectCountFacts): boolean {
  const definition = PROSPECT_COUNT_DEFINITIONS[key];
  if (!inScope(definition.scope, row)) return false;
  if (definition.requiresLiveIntent && !row.hasLiveIntent) return false;
  return definition.clauses.every((clause) => clauseMatches(clause, row));
}

export type ProspectCounts = Record<ProspectCountKey, number>;

export function tallyProspectCounts(rows: readonly ProspectCountFacts[]): ProspectCounts {
  const counts = Object.fromEntries(PROSPECT_COUNT_KEYS.map((key) => [key, 0])) as ProspectCounts;
  for (const row of rows) {
    for (const key of PROSPECT_COUNT_KEYS) {
      if (matchesProspectCount(key, row)) counts[key] += 1;
    }
  }
  return counts;
}

/* -------------------------------------------------- the surfaces' shapes */

/** Which count each quick-filter chip shows and filters by. */
export const QUICK_FILTER_COUNT_KEY = {
  all: "found",
  "a-grade": "aGrade",
  intent: "intent",
  ready: "ready",
  contacted: "contacted",
  replied: "replied",
  review: "review",
} as const satisfies Record<string, ProspectCountKey>;

export type QuickFilterCountKey = keyof typeof QUICK_FILTER_COUNT_KEY;

/** Chip counts, derived from the one set of counts. */
export function quickCountsFrom(counts: ProspectCounts) {
  return {
    all: counts.found,
    aGrade: counts.aGrade,
    intent: counts.intent,
    ready: counts.ready,
    contacted: counts.contacted,
    replied: counts.replied,
    review: counts.review,
  };
}

/** The KPI strip's cards, in order. */
export const PROSPECT_KPI_KEYS = [
  { key: "found", countKey: "found" },
  { key: "verified", countKey: "verified" },
  { key: "ready", countKey: "ready" },
  { key: "campaigns", countKey: "inCampaign" },
  { key: "converted", countKey: "converted" },
] as const satisfies readonly { key: string; countKey: ProspectCountKey }[];

export type ProspectKpi = {
  key: string;
  label: string;
  value: number;
  /** The count's definition, shown as the KPI tooltip. */
  definition: string;
  /**
   * Change against the previous 30 days, as a fraction.
   *
   * Null where the schema cannot support the comparison honestly. "Ready for
   * outreach" and "In campaigns" are *states*, not events: nothing records when
   * a prospect entered them, so no trend is shown rather than a made-up one.
   */
  trend: number | null;
};

/** KPI cards, derived from the same counts the chips use. */
export function prospectKpisFrom(
  counts: ProspectCounts,
  trends: Partial<Record<ProspectCountKey, number | null>> = {},
): ProspectKpi[] {
  return PROSPECT_KPI_KEYS.map(({ key, countKey }) => ({
    key,
    label: PROSPECT_COUNT_DEFINITIONS[countKey].label,
    value: counts[countKey],
    definition: PROSPECT_COUNT_DEFINITIONS[countKey].definition,
    trend: trends[countKey] ?? null,
  }));
}

/* ------------------------------------------------------- PostgREST text */

function simpleToPostgrest(clause: SimpleClause): string {
  switch (clause.op) {
    case "eq":
      return `${clause.column}.eq.${clause.value}`;
    case "neq":
      return `${clause.column}.neq.${clause.value}`;
    case "in":
      return `${clause.column}.in.(${clause.values.map((v) => `"${v}"`).join(",")})`;
    case "isNull":
      return `${clause.column}.is.null`;
    case "notNull":
      return `${clause.column}.not.is.null`;
  }
}

/** An `anyOf` clause as the argument of a PostgREST `.or(...)`. */
export function anyOfToPostgrest(clauses: readonly SimpleClause[]): string {
  return clauses.map(simpleToPostgrest).join(",");
}
