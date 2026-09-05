/**
 * Booking shapes, URL filter parsing and pure calendar helpers. No
 * `server-only` and no Supabase import, so client components can use these.
 */

import { z } from "zod";

export const BOOKING_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export const BOOKING_PROVIDER_LABEL: Record<string, string> = {
  calendly: "Calendly",
  google_calendar: "Google Calendar",
  manual: "Added by hand",
};

export type BookingListRow = {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  serviceName: string | null;
  provider: string;
  status: BookingStatus;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  bookingUrl: string | null;
  rescheduleUrl: string | null;
  assignedUserId: string | null;
  assigneeName: string | null;
  createdAt: string;
};

export type BookingMetrics = {
  upcoming: number;
  completed: number;
  cancelled: number;
  noShow: number;
};

export type BookingDestination = {
  /** calendly | google_calendar | handover */
  mode: string;
  configured: boolean;
  label: string;
};

export const BOOKING_TABS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
] as const;

export const BOOKING_VIEWS = [
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar" },
] as const;

const optional = z.string().trim().min(1).max(120).optional().catch(undefined);

export const bookingFilterSchema = z.object({
  tab: z.enum(["upcoming", "past", "all"]).default("upcoming").catch("upcoming"),
  view: z.enum(["list", "calendar"]).default("list").catch("list"),
  status: z.enum(["all", ...BOOKING_STATUSES]).default("all").catch("all"),
  service: optional,
  assignee: optional,
  from: optional,
  to: optional,
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25).catch(25),
  lead: z.string().trim().max(64).optional().catch(undefined),
  leadTab: z.string().trim().max(24).optional().catch(undefined),
});

export type BookingFilters = z.infer<typeof bookingFilterSchema>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseBookingFilters(
  params: Record<string, string | string[] | undefined>,
): BookingFilters {
  return bookingFilterSchema.parse({
    tab: first(params.tab),
    view: first(params.view),
    status: first(params.status),
    service: first(params.service),
    assignee: first(params.assignee),
    from: first(params.from),
    to: first(params.to),
    month: first(params.month),
    page: first(params.page),
    pageSize: first(params.pageSize),
    lead: first(params.lead),
    leadTab: first(params.leadTab),
  });
}

const DEFAULTS: Record<string, string> = {
  tab: "upcoming",
  view: "list",
  status: "all",
  page: "1",
  pageSize: "25",
};

export function bookingFiltersToQuery(
  filters: Partial<BookingFilters> & Record<string, unknown>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    const asString = String(value);
    if (DEFAULTS[key] === asString) continue;
    params.set(key, asString);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function bookingsHref(
  filters: Partial<BookingFilters> & Record<string, unknown>,
) {
  return `/app/bookings${bookingFiltersToQuery(filters)}`;
}

export function hasActiveBookingFilters(filters: BookingFilters) {
  return Boolean(
    filters.status !== "all" ||
      filters.service ||
      filters.assignee ||
      filters.from ||
      filters.to,
  );
}

// ----------------------------------------------------------------- calendar

export type CalendarDay = {
  /** "YYYY-MM-DD" */
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
};

export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthBounds(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function dayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Six Monday-first weeks covering the month, so the grid never reflows. */
export function buildMonthGrid(monthKey: string, today = new Date()): CalendarDay[] {
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const weekday = (firstOfMonth.getUTCDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setUTCDate(start.getUTCDate() - weekday);

  const todayKey = dayKey(
    new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    ),
  );

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = dayKey(date);
    return {
      key,
      dayOfMonth: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
      isToday: key === todayKey,
    };
  });
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Groups bookings by local day key so a calendar cell can look them up. */
export function groupByDay(
  rows: BookingListRow[],
  timezone: string,
): Map<string, BookingListRow[]> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const map = new Map<string, BookingListRow[]>();
  for (const row of rows) {
    if (!row.startsAt) continue;
    const key = formatter.format(new Date(row.startsAt));
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

export function formatTimeInZone(
  value: string | null,
  timezone: string,
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDateInZone(
  value: string | null,
  timezone: string,
): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

// ------------------------------------------------------------------ schemas

export const bookingStatusSchema = z.object({
  bookingId: z.uuid(),
  status: z.enum(BOOKING_STATUSES),
});
