/**
 * URL state for the Reactivation workspace (`/app/reactivation`): search,
 * filters, sort, view and pagination. Kept separate from `types.ts` because
 * it is list-page presentation state, not part of the campaign data model
 * shared with the wizard/server actions.
 *
 * Everything lives in the URL so a view is shareable, survives a refresh, and
 * so switching Cards/List keeps the current search, filters and sort — the
 * same convention `/app/leads` uses.
 */

import { z } from "zod";
import {
  CAMPAIGN_STATUSES,
  type CampaignStatus,
} from "./types";
import type { ReactivationCampaignRow } from "./reactivation-types";

export const REACTIVATION_VIEWS = ["cards", "list"] as const;
export type ReactivationView = (typeof REACTIVATION_VIEWS)[number];

export const REACTIVATION_SORTS = [
  "updated",
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
  "sent",
  "replies",
  "qualified",
  "booked",
  "conversion",
] as const;
export type ReactivationSort = (typeof REACTIVATION_SORTS)[number];

export const REACTIVATION_SORT_OPTIONS: {
  value: ReactivationSort;
  label: string;
}[] = [
  { value: "updated", label: "Last updated" },
  { value: "created_desc", label: "Created newest" },
  { value: "created_asc", label: "Created oldest" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "sent", label: "Most sent" },
  { value: "replies", label: "Most replies" },
  { value: "qualified", label: "Most qualified" },
  { value: "booked", label: "Most booked" },
  { value: "conversion", label: "Highest conversion rate" },
];

export const REACTIVATION_RANGES = [
  "all",
  "7d",
  "30d",
  "90d",
  "year",
  "custom",
] as const;
export type ReactivationRange = (typeof REACTIVATION_RANGES)[number];

export const REACTIVATION_RANGE_OPTIONS: {
  value: ReactivationRange;
  label: string;
}[] = [
  { value: "all", label: "Any date" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

export const CAMPAIGN_STATUS_OPTIONS: {
  value: CampaignStatus | "all";
  label: string;
}[] = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "RUNNING", label: "Running" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export const CAMPAIGN_CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any channel" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];

export const reactivationFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["all", ...CAMPAIGN_STATUSES]).default("all").catch("all"),
  audience: z.string().trim().max(160).optional(),
  range: z.enum(REACTIVATION_RANGES).default("all").catch("all"),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  channel: z.string().trim().max(20).optional(),
  tag: z.string().trim().max(60).optional(),
  hasReplies: z.boolean().default(false).catch(false),
  hasBookings: z.boolean().default(false).catch(false),
  sort: z.enum(REACTIVATION_SORTS).default("updated").catch("updated"),
  view: z.enum(REACTIVATION_VIEWS).default("cards").catch("cards"),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

export type ReactivationFilters = z.infer<typeof reactivationFiltersSchema>;

/** Cards fit a 4-wide grid two rows deep; the table is denser. */
export const PAGE_SIZE: Record<ReactivationView, number> = {
  cards: 8,
  list: 10,
};

export function parseReactivationFilters(
  params: Record<string, string | string[] | undefined>,
  defaultView: ReactivationView = "cards",
): ReactivationFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return reactivationFiltersSchema.parse({
    q: first(params.q) || undefined,
    status: first(params.status),
    audience: first(params.audience) || undefined,
    range: first(params.range),
    from: first(params.from) || undefined,
    to: first(params.to) || undefined,
    channel: first(params.channel) || undefined,
    tag: first(params.tag) || undefined,
    hasReplies: first(params.hasReplies) === "1",
    hasBookings: first(params.hasBookings) === "1",
    sort: first(params.sort),
    view: first(params.view) ?? defaultView,
    page: first(params.page),
  });
}

export function hasActiveReactivationFilters(filters: ReactivationFilters) {
  return Boolean(
    filters.q ||
      filters.status !== "all" ||
      filters.audience ||
      filters.range !== "all" ||
      filters.channel ||
      filters.tag ||
      filters.hasReplies ||
      filters.hasBookings,
  );
}

/** Count shown as a dot/badge on the "More filters" button. */
export function advancedFilterCount(filters: ReactivationFilters) {
  let count = 0;
  if (filters.channel) count += 1;
  if (filters.tag) count += 1;
  if (filters.hasReplies) count += 1;
  if (filters.hasBookings) count += 1;
  return count;
}

/* --------------------------------------------------- range resolution --- */

export function resolveFilterRange(
  filters: ReactivationFilters,
  now = new Date(),
): { from: Date | null; to: Date | null } {
  switch (filters.range) {
    case "7d":
      return { from: new Date(now.getTime() - 7 * 864e5), to: null };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 864e5), to: null };
    case "90d":
      return { from: new Date(now.getTime() - 90 * 864e5), to: null };
    case "year":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        to: null,
      };
    case "custom": {
      const from = filters.from
        ? new Date(filters.from + "T00:00:00.000Z")
        : null;
      const to = filters.to ? new Date(filters.to + "T23:59:59.999Z") : null;
      return {
        from: from && !Number.isNaN(from.getTime()) ? from : null,
        to: to && !Number.isNaN(to.getTime()) ? to : null,
      };
    }
    default:
      return { from: null, to: null };
  }
}

/* -------------------------------------------------- filtering/sorting --- */

/**
 * Campaign counts per workspace are small (capped at 200 rows read), so
 * filtering and sorting happen in memory rather than as a second round trip
 * with its own params. Pagination below slices the same array.
 */
export function filterCampaignRows(
  rows: ReactivationCampaignRow[],
  filters: ReactivationFilters,
  now = new Date(),
): ReactivationCampaignRow[] {
  const q = filters.q?.toLowerCase();
  const { from, to } = resolveFilterRange(filters, now);

  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.audience && row.audienceLabel !== filters.audience) return false;
    if (filters.channel && row.channel !== filters.channel) return false;
    if (filters.tag && !row.tags.includes(filters.tag)) return false;
    if (filters.hasReplies && row.replies === 0) return false;
    if (filters.hasBookings && row.booked === 0) return false;

    if (from || to) {
      const created = new Date(row.createdAt).getTime();
      if (from && created < from.getTime()) return false;
      if (to && created > to.getTime()) return false;
    }

    if (q) {
      const haystack = [
        row.name,
        row.description ?? "",
        row.audienceLabel,
        ...row.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

function conversion(row: ReactivationCampaignRow) {
  return row.sent === 0 ? 0 : row.booked / row.sent;
}

export function sortCampaignRows(
  rows: ReactivationCampaignRow[],
  sort: ReactivationSort,
): ReactivationCampaignRow[] {
  const out = [...rows];
  const byTime = (value: string) => new Date(value).getTime();

  switch (sort) {
    case "created_desc":
      return out.sort((a, b) => byTime(b.createdAt) - byTime(a.createdAt));
    case "created_asc":
      return out.sort((a, b) => byTime(a.createdAt) - byTime(b.createdAt));
    case "name_asc":
      return out.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
    case "name_desc":
      return out.sort((a, b) => b.name.localeCompare(a.name, "en-GB"));
    case "sent":
      return out.sort((a, b) => b.sent - a.sent);
    case "replies":
      return out.sort((a, b) => b.replies - a.replies);
    case "qualified":
      return out.sort((a, b) => b.qualified - a.qualified);
    case "booked":
      return out.sort((a, b) => b.booked - a.booked);
    case "conversion":
      return out.sort((a, b) => conversion(b) - conversion(a));
    default:
      return out.sort((a, b) => byTime(b.updatedAt) - byTime(a.updatedAt));
  }
}

export type ReactivationPage = {
  rows: ReactivationCampaignRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function paginateCampaignRows(
  rows: ReactivationCampaignRow[],
  filters: ReactivationFilters,
): ReactivationPage {
  const pageSize = PAGE_SIZE[filters.view];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // A filter change can leave the URL pointing past the end; clamp rather
  // than render an empty page the user did not ask for.
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

/** One call so the page, and any test, applies the pipeline identically. */
export function applyReactivationFilters(
  rows: ReactivationCampaignRow[],
  filters: ReactivationFilters,
  now = new Date(),
): ReactivationPage {
  return paginateCampaignRows(
    sortCampaignRows(filterCampaignRows(rows, filters, now), filters.sort),
    filters,
  );
}
