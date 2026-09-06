/**
 * Prospect list filter parsing (V4 §12.3-12.4).
 *
 * Pure: no `server-only`, no Supabase. The page parses the URL into this shape
 * server-side and the client components read it back, so a shared link always
 * reproduces the view the sender saw — the same contract the Leads and
 * Reactivation filters follow.
 */

import type { Grade, ProspectStatus, VerificationStatus } from "./types.ts";

export const PROSPECT_QUICK_FILTERS = [
  "all",
  "a-grade",
  "intent",
  "ready",
  "contacted",
  "replied",
  "review",
] as const;

export type ProspectQuickFilter = (typeof PROSPECT_QUICK_FILTERS)[number];

export const PROSPECT_VIEWS = ["discover", "prospects", "intent", "campaigns"] as const;
export type FindLeadsView = (typeof PROSPECT_VIEWS)[number];

export const PROSPECT_SORTS = [
  "score",
  "recent",
  "activity",
  "company",
  "name",
] as const;
export type ProspectSort = (typeof PROSPECT_SORTS)[number];

export const GRADES: Grade[] = ["A+", "A", "B", "C", "D"];

export const PROSPECT_STATUSES: ProspectStatus[] = [
  "DISCOVERED",
  "ENRICHING",
  "VERIFIED",
  "READY",
  "APPROVED",
  "OUTREACH_ACTIVE",
  "REPLIED",
  "CONVERTED",
  "DISQUALIFIED",
  "SUPPRESSED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "REVIEW",
];

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "VALID",
  "RISKY",
  "CATCH_ALL",
  "INVALID",
  "UNKNOWN",
  "UNVERIFIABLE",
];

export type ProspectFilters = {
  view: FindLeadsView;
  quick: ProspectQuickFilter;
  search: string;
  grades: Grade[];
  statuses: ProspectStatus[];
  verification: VerificationStatus[];
  eligibility: string[];
  industries: string[];
  locations: string[];
  roles: string[];
  intentCategoryIds: string[];
  /** Only count intent signals observed within this many days. */
  intentWithinDays: number | null;
  icpProfileId: string | null;
  campaignId: string | null;
  /** Scopes the list to one sourcing run, so "Open prospects" on a run means
   *  that run's prospects rather than every prospect in the workspace. */
  sourceRunId: string | null;
  sourceProvider: string | null;
  minScore: number | null;
  range: "7d" | "30d" | "90d" | "all";
  sort: ProspectSort;
  page: number;
  pageSize: number;
};

export const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [10, 25, 50, 100];

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Accepts both repeated params and a comma-joined list. */
function list(params: Params, key: string): string[] {
  const value = params[key];
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids arrive from the URL, so anything that is not a UUID is dropped rather
 *  than passed to the query builder. */
function uuidOrNull(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function intOrNull(value: string | undefined, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function parseProspectFilters(params: Params): ProspectFilters {
  const pageSizeRaw = intOrNull(first(params, "size"), 1, 100);

  return {
    view: oneOf(first(params, "view"), PROSPECT_VIEWS, "discover"),
    quick: oneOf(first(params, "quick"), PROSPECT_QUICK_FILTERS, "all"),
    search: (first(params, "q") ?? "").trim().slice(0, 120),
    grades: list(params, "grade").filter((g): g is Grade => GRADES.includes(g as Grade)),
    statuses: list(params, "status").filter((s): s is ProspectStatus =>
      PROSPECT_STATUSES.includes(s as ProspectStatus),
    ),
    verification: list(params, "verification").filter((v): v is VerificationStatus =>
      VERIFICATION_STATUSES.includes(v as VerificationStatus),
    ),
    eligibility: list(params, "eligibility").filter((e) =>
      ["ELIGIBLE", "CONSENT_REQUIRED", "REVIEW", "SUPPRESSED"].includes(e),
    ),
    industries: list(params, "industry").slice(0, 20),
    locations: list(params, "location").slice(0, 20),
    roles: list(params, "role").slice(0, 20),
    intentCategoryIds: list(params, "intent").slice(0, 20),
    intentWithinDays: intOrNull(first(params, "intentDays"), 1, 365),
    icpProfileId: first(params, "icp") ?? null,
    campaignId: first(params, "campaign") ?? null,
    sourceRunId: uuidOrNull(first(params, "runId")),
    sourceProvider: first(params, "provider") ?? null,
    minScore: intOrNull(first(params, "minScore"), 0, 100),
    range: oneOf(first(params, "range"), ["7d", "30d", "90d", "all"] as const, "all"),
    sort: oneOf(first(params, "sort"), PROSPECT_SORTS, "score"),
    page: intOrNull(first(params, "page"), 1, 10000) ?? 1,
    pageSize: pageSizeRaw && PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE,
  };
}

/** Serialises back to a query string, dropping defaults so links stay short. */
export function prospectFiltersToParams(filters: ProspectFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
  };
  const setList = (key: string, values: string[]) => {
    if (values.length) params.set(key, values.join(","));
  };

  if (filters.view !== "discover") set("view", filters.view);
  if (filters.quick !== "all") set("quick", filters.quick);
  set("q", filters.search || null);
  setList("grade", filters.grades);
  setList("status", filters.statuses);
  setList("verification", filters.verification);
  setList("eligibility", filters.eligibility);
  setList("industry", filters.industries);
  setList("location", filters.locations);
  setList("role", filters.roles);
  setList("intent", filters.intentCategoryIds);
  if (filters.intentWithinDays) set("intentDays", String(filters.intentWithinDays));
  set("icp", filters.icpProfileId);
  set("campaign", filters.campaignId);
  set("runId", filters.sourceRunId);
  set("provider", filters.sourceProvider);
  if (filters.minScore !== null) set("minScore", String(filters.minScore));
  if (filters.range !== "all") set("range", filters.range);
  if (filters.sort !== "score") set("sort", filters.sort);
  if (filters.page > 1) set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) set("size", String(filters.pageSize));

  return params;
}

/** How many advanced filters are active, for the "Filters •" dot on the button. */
export function activeFilterCount(filters: ProspectFilters): number {
  return (
    filters.grades.length +
    filters.statuses.length +
    filters.verification.length +
    filters.eligibility.length +
    filters.industries.length +
    filters.locations.length +
    filters.roles.length +
    filters.intentCategoryIds.length +
    (filters.intentWithinDays ? 1 : 0) +
    (filters.icpProfileId ? 1 : 0) +
    (filters.campaignId ? 1 : 0) +
    (filters.sourceProvider ? 1 : 0) +
    (filters.minScore !== null ? 1 : 0) +
    (filters.range !== "all" ? 1 : 0)
  );
}

export const QUICK_FILTER_LABELS: Record<ProspectQuickFilter, string> = {
  all: "All",
  "a-grade": "A grade",
  intent: "Intent",
  ready: "Ready",
  contacted: "Contacted",
  replied: "Replied",
  review: "Review",
};
