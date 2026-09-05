import { z } from "zod";

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFIED",
  "BOOKED",
  "WON",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const QUALIFICATION_RESULTS = [
  "PENDING",
  "QUALIFIED",
  "REVIEW",
  "NOT_QUALIFIED",
] as const;

export type QualificationResult = (typeof QUALIFICATION_RESULTS)[number];

/**
 * The five quick filters. Deliberately not one tab per status — Leads is an
 * operational inbox, so the top-level split is "what needs me now", not a
 * mirror of the status enum. Advanced status filtering lives in the popover.
 */
export const QUICK_FILTERS = [
  { value: "all", label: "All", caption: "All leads" },
  { value: "active", label: "Active", caption: "In progress" },
  { value: "attention", label: "Needs Attention", caption: "Require follow-up" },
  { value: "qualified", label: "Qualified", caption: "Ready to book" },
  { value: "booked", label: "Booked", caption: "Converted to jobs" },
] as const;

export type QuickFilter = (typeof QUICK_FILTERS)[number]["value"];

/**
 * "Active" means the lead is still moving through follow-up: it has not been
 * closed (WON/LOST) and has not yet converted to a booking. QUALIFIED counts
 * as active because the job of booking it is still outstanding.
 */
export const ACTIVE_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFIED",
];

export const SORTABLE_COLUMNS = [
  "created_at",
  "last_contact_at",
  "status",
] as const;

export type SortColumn = (typeof SORTABLE_COLUMNS)[number];

export const LEAD_VIEWS = ["cards", "table"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

/** Card view shows 12 per page, table view 10 — matching the approved designs. */
export const DEFAULT_PAGE_SIZE: Record<LeadView, number> = {
  cards: 12,
  table: 10,
};

export const PAGE_SIZE_OPTIONS: Record<LeadView, number[]> = {
  cards: [12, 24, 48],
  table: [10, 25, 50, 100],
};

const optionalText = z.string().trim().min(1).max(120).optional().catch(undefined);

/** Comma-separated multi-select, e.g. `status=NEW,CONTACTED`. */
function multi<T extends string>(values: readonly T[]) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part): part is T => (values as readonly string[]).includes(part)),
    )
    .refine((list) => list.length > 0)
    .optional()
    .catch(undefined);
}

const idList = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part.length <= 64),
  )
  .refine((list) => list.length > 0 && list.length <= 30)
  .optional()
  .catch(undefined);

export const leadFilterSchema = z.object({
  quick: z
    .enum(["all", "active", "attention", "qualified", "booked"])
    .default("all")
    .catch("all"),
  view: z.enum(LEAD_VIEWS).default("cards").catch("cards"),

  /* advanced filters */
  status: multi(LEAD_STATUSES),
  service: idList,
  source: idList,
  form: optionalText,
  campaign: optionalText,
  assignee: optionalText,
  attention: z
    .enum(["1", "0"])
    .transform((value) => value === "1")
    .optional()
    .catch(undefined),

  q: z.string().trim().max(120).optional().catch(undefined),
  range: z.enum(["7d", "30d", "90d", "custom", "all"]).default("all").catch("all"),
  from: optionalText,
  to: optionalText,

  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).optional().catch(undefined),
  sort: z.enum(SORTABLE_COLUMNS).default("last_contact_at").catch("last_contact_at"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),

  lead: z.string().trim().max(64).optional().catch(undefined),
});

export type LeadFilters = z.infer<typeof leadFilterSchema> & {
  /** Always resolved — falls back to the per-view default. */
  pageSize: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseLeadFilters(
  params: RawSearchParams,
  defaultView: LeadView = "cards",
): LeadFilters {
  const parsed = leadFilterSchema.parse({
    quick: first(params.quick),
    view: first(params.view) ?? defaultView,
    status: first(params.status),
    service: first(params.service),
    source: first(params.source),
    form: first(params.form),
    campaign: first(params.campaign),
    assignee: first(params.assignee),
    attention: first(params.attention),
    q: first(params.q),
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
    page: first(params.page),
    pageSize: first(params.pageSize),
    sort: first(params.sort),
    dir: first(params.dir),
    lead: first(params.lead),
  });

  return {
    ...parsed,
    pageSize: parsed.pageSize ?? DEFAULT_PAGE_SIZE[parsed.view],
  };
}

const DEFAULTS: Record<string, string> = {
  quick: "all",
  view: "cards",
  range: "all",
  page: "1",
  sort: "last_contact_at",
  dir: "desc",
};

/** Serialises filters back to a query string, omitting defaults so links stay short. */
export function leadFiltersToQuery(
  filters: Partial<Record<string, unknown>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    const asString = Array.isArray(value) ? value.join(",") : String(value);
    if (!asString) continue;
    if (DEFAULTS[key] === asString) continue;
    params.set(key, asString);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Deep links from Dashboard / Follow-Up land on the matching quick filter. */
export function leadsHrefForQuickFilter(quick: QuickFilter) {
  return `/app/leads${leadFiltersToQuery({ quick })}`;
}

export function leadsHrefForStatus(status: LeadStatus) {
  return `/app/leads${leadFiltersToQuery({ status })}`;
}

/** True when any *advanced* filter (not the quick filter) narrows the list. */
export function hasActiveFilters(filters: LeadFilters) {
  return Boolean(
    filters.status?.length ||
      filters.service?.length ||
      filters.source?.length ||
      filters.form ||
      filters.campaign ||
      filters.assignee ||
      filters.attention ||
      filters.q ||
      (filters.range && filters.range !== "all"),
  );
}

export function activeFilterCount(filters: LeadFilters) {
  let count = 0;
  if (filters.status?.length) count += 1;
  if (filters.service?.length) count += 1;
  if (filters.source?.length) count += 1;
  if (filters.form) count += 1;
  if (filters.campaign) count += 1;
  if (filters.assignee) count += 1;
  if (filters.attention) count += 1;
  if (filters.range !== "all") count += 1;
  return count;
}

export const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;
