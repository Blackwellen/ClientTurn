export type RangeKey = "7d" | "30d" | "90d" | "custom";

export type ResolvedRange = {
  key: RangeKey;
  from: Date;
  to: Date;
  /** Equal-length window immediately before `from`, for period-over-period deltas. */
  previousFrom: Date;
  previousTo: Date;
  label: string;
  days: number;
};

const PRESET_DAYS: Record<Exclude<RangeKey, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom" },
];

function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDayString(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The window a freshly chosen "Custom" range starts from: the same span as the
 * preset it replaces, ending today. Without it, choosing Custom sent
 * `range=custom` with no dates, `resolveRange` fell back to 30 days, and the
 * date inputs never appeared, so a custom range could not be picked at all.
 */
export function defaultCustomRange(
  current: RangeKey,
  now = new Date(),
): { from: string; to: string } {
  const days = current === "custom" ? 30 : PRESET_DAYS[current];
  const to = toDayString(now);
  const from = toDayString(new Date(now.getTime() - (days - 1) * 864e5));
  return { from, to };
}

export function resolveRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): ResolvedRange {
  const requested = (params.range ?? "30d") as RangeKey;
  const customFrom = parseDay(params.from);
  const customTo = parseDay(params.to);

  if (requested === "custom" && customFrom && customTo && customFrom <= customTo) {
    const to = new Date(customTo.getTime() + 864e5);
    const days = Math.max(1, Math.round((to.getTime() - customFrom.getTime()) / 864e5));
    const span = to.getTime() - customFrom.getTime();
    return {
      key: "custom",
      from: customFrom,
      to,
      previousFrom: new Date(customFrom.getTime() - span),
      previousTo: customFrom,
      label: `${toDayString(customFrom)} to ${toDayString(customTo)}`,
      days,
    };
  }

  const key: Exclude<RangeKey, "custom"> =
    requested === "7d" || requested === "90d" ? requested : "30d";
  const days = PRESET_DAYS[key];
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);

  return {
    key,
    from,
    to,
    previousFrom: new Date(from.getTime() - days * 864e5),
    previousTo: from,
    label: `Last ${days} days`,
    days,
  };
}

export function comparisonLabel(range: ResolvedRange) {
  return `vs. previous ${range.days} days`;
}

/** Hour of day in the business's own timezone, so the greeting is never wrong. */
export function greetingFor(timezone: string, now = new Date()) {
  let hour = now.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const value = parts.find((p) => p.type === "hour")?.value;
    if (value !== undefined) hour = Number(value) % 24;
  } catch {
    // Unknown timezone string: fall back to server local time.
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The zone every date in the product is shown in unless the workspace says
 * otherwise. The product is UK: formatting in the runtime's own zone (UTC on
 * Vercel, the viewer's zone in a browser) put times an hour out during BST and
 * made server and client render different text, which is a hydration error.
 */
export const DEFAULT_TIMEZONE = "Europe/London";

export type DateInput = string | number | Date | null | undefined;

/**
 * Named shapes for the common cases. Each is exactly what the old
 * `toLocale*String("en-GB")` call with no options produced, so converting a
 * call site does not change what the user reads.
 */
export const DATE_PRESETS = {
  /** "05/03/2025", as `toLocaleDateString("en-GB")` printed it. */
  date: { day: "2-digit", month: "2-digit", year: "numeric" },
  /** "14:05:09", as `toLocaleTimeString("en-GB")` printed it. */
  time: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  /** "05/03/2025, 14:05:09", as `toLocaleString("en-GB")` printed it. */
  datetime: {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DatePreset = keyof typeof DATE_PRESETS;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** A valid IANA zone, or the default. An unknown string never throws. */
export function resolveTimezone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function formatterFor(
  options: Intl.DateTimeFormatOptions,
  timeZone: string | null | undefined,
): Intl.DateTimeFormat {
  const zone = resolveTimezone(timeZone);
  const key = `${zone}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    // `timeZone` is always explicit, applied last, and cannot be overridden
    // by `options`: that is the whole point of this function.
    formatter = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function toValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * THE date formatter. Every date or time shown in the app goes through this
 * (directly or through the helpers below): always en-GB and always with an
 * explicit `timeZone`, the workspace's when the caller knows it and
 * Europe/London otherwise. It therefore renders the same text on the server
 * and in the browser, whatever zone either of them runs in.
 *
 * Do not call `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString`, or
 * build an `Intl.DateTimeFormat` without a `timeZone`, for display.
 *
 * Empty or unparseable input renders "—".
 */
export function formatInZone(
  value: DateInput,
  options: Intl.DateTimeFormatOptions | DatePreset = "date",
  timeZone?: string | null,
): string {
  const date = toValidDate(value);
  if (!date) return "—";
  const resolved = typeof options === "string" ? DATE_PRESETS[options] : options;
  return formatterFor(resolved, timeZone).format(date);
}

/** `formatToParts` in the zone, for callers that assemble their own layout. */
export function formatPartsInZone(
  value: Date,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
): Intl.DateTimeFormatPart[] {
  return formatterFor(options, timeZone).formatToParts(value);
}

/** "2025-03-05": the calendar day an instant falls on, in the zone. */
export function dayKeyInZone(value: Date, timeZone?: string | null): string {
  const parts = formatPartsInZone(
    value,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    timeZone,
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type ZoneOption = { timeZone?: string | null };

/** "5 Mar 2025". Empty or unparseable input renders "—". */
export function formatDate(value: DateInput, options: ZoneOption = {}) {
  return formatInZone(
    value,
    { day: "numeric", month: "short", year: "numeric" },
    options.timeZone,
  );
}

/**
 * Date plus 24-hour time. The default is the compact "5 Mar, 14:05";
 * `{ year: true }` gives "5 Mar 2025, 14:05", the admin console's form.
 */
export function formatDateTime(
  value: DateInput,
  options: { year?: boolean } & ZoneOption = {},
) {
  return formatInZone(
    value,
    options.year
      ? {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
    options.timeZone,
  );
}

/**
 * Time of day on its own, for dense rows that already show the date above it.
 * 24-hour en-GB, matching `formatDateTime` — the product is UK, so a 12-hour
 * "AM/PM" clock would read as an import from somewhere else.
 */
export function formatTime(value: DateInput, options: ZoneOption = {}) {
  return formatInZone(value, { hour: "2-digit", minute: "2-digit" }, options.timeZone);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536e6],
  ["month", 2592e6],
  ["week", 6048e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];

const RELATIVE_AGO_WINDOW_MS = 30 * 864e5;

/**
 * True when `formatRelative(value, { style: "ago" })` would produce an actual
 * "N ago" phrase rather than falling back to a date. Callers that pair an
 * absolute date with a relative one use this so they never render
 * "5 Mar 2024 (5 Mar 2024)".
 */
export function hasRelativePhrase(value: DateInput): boolean {
  const date = toValidDate(value);
  if (!date) return false;
  return Date.now() - date.getTime() < RELATIVE_AGO_WINDOW_MS;
}

/**
 * Relative time.
 *
 * - Default (`style: "auto"`): `Intl.RelativeTimeFormat` — "5 minutes ago",
 *   "in 2 hours", "yesterday", "last month". Empty input renders "—".
 * - `style: "ago"` (the admin console's form): past-only "5 minutes ago",
 *   "1 day ago", switching to an absolute date after 30 days; a future
 *   timestamp reads "just now" and empty input reads "Never".
 */
export function formatRelative(
  value: DateInput,
  options: { style?: "auto" | "ago" } = {},
) {
  if (options.style === "ago") return formatRelativeAgo(value);
  const date = toValidDate(value);
  if (!date) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 6e4) return "just now";
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(Math.round(diff / 6e4), "minute");
}

function formatRelativeAgo(value: DateInput) {
  if (!value) return "Never";
  const date = toValidDate(value);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (diff < RELATIVE_AGO_WINDOW_MS) return `${days} days ago`;
  return formatDate(date);
}

/**
 * The compact form used in dense dashboard rows: "12m ago", "3h ago",
 * "Yesterday", "4d ago". Falls back to a date once a week has passed, so a row
 * never reads "37d ago".
 */
export function formatRelativeShort(value: DateInput, options: ZoneOption = {}) {
  const date = toValidDate(value);
  if (!date) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDateTime(date, options);
  if (diff < 6e4) return "just now";

  const minutes = Math.floor(diff / 6e4);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / 36e5);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / 864e5);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  // "29 Aug" in dense rows; the year only appears when it is not this one.
  const sameYear =
    dayKeyInZone(date, options.timeZone).slice(0, 4) ===
    dayKeyInZone(new Date(), options.timeZone).slice(0, 4);
  return formatInZone(
    date,
    { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) },
    options.timeZone,
  );
}

/** "6 Aug 2026 – 4 Sep 2026". `to` is exclusive, so the last day is to − 1ms. */
export function formatRangeLabel(range: ResolvedRange) {
  // A custom range is whole UTC days (`parseDay`), so it is labelled in UTC:
  // in BST the exclusive end, 23:59:59Z, is already the next day, and a range
  // picked as 1-30 Sept read "1 Sept - 1 Oct".
  const zone = range.key === "custom" ? { timeZone: "UTC" } : {};
  return `${formatDate(range.from, zone)} – ${formatDate(new Date(range.to.getTime() - 1), zone)}`;
}

/** Day heading used to group notification and timeline rows. */
export function dayGroupLabel(value: string, options: ZoneOption = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  // Calendar days in the zone, not the runtime's: at 00:30 BST a row from
  // 23:45 the previous evening is "Yesterday" on the server and the client.
  const dayMs = (d: Date) => Date.parse(`${dayKeyInZone(d, options.timeZone)}T00:00:00Z`);
  const diffDays = Math.round((dayMs(new Date()) - dayMs(date)) / 864e5);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(date, options);
}

export function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * A percentage from a value **already expressed in percentage points** (0–100).
 *
 * The unit is documented because it is not obvious and was not consistent: the
 * product has two percentage conventions, and passing the wrong one renders
 * without complaint. This one takes 0–100, which is what every current caller
 * passes.
 *
 * For a rate produced by `analytics/v4-metrics.rate()` — a fraction in [0, 1],
 * or null when the denominator is empty — use `formatMetric(value, "percent")`
 * instead. Do not convert at the call site; picking the formatter that matches
 * the producer is what stops the two conventions leaking into each other.
 */
export function formatPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/**
 * Display label for an IANA timezone, derived rather than stored: the offset
 * comes from `Intl` so it follows DST on its own, and the region comes from
 * the identifier. A hardcoded table would quietly go wrong twice a year.
 *
 * Both server and client resolve the same instant to the same offset, so this
 * is hydration-safe outside the exact millisecond of a DST transition.
 */
export function formatTimezoneLabel(zone: string): string {
  try {
    const offset =
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? "";

    const region = zone === "UTC" ? "UTC" : (zone.split("/").pop() ?? zone).replace(/_/g, " ");
    // Chromium writes a zero offset as bare "GMT", Node as "GMT+00:00";
    // normalised so server and client render the same text.
    const shown = offset === "GMT" ? "GMT+00:00" : offset;
    return shown ? `(${shown}) ${region}` : region;
  } catch {
    // Unknown identifier: show it as given rather than inventing a label.
    return zone;
  }
}
