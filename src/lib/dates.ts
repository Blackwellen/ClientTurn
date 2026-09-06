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

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Time of day on its own, for dense rows that already show the date above it.
 * 24-hour en-GB, matching `formatDateTime` — the product is UK, so a 12-hour
 * "AM/PM" clock would read as an import from somewhere else.
 */
export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536e6],
  ["month", 2592e6],
  ["week", 6048e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 6e4) return "just now";
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(Math.round(diff / 6e4), "minute");
}

/**
 * The compact form used in dense dashboard rows: "12m ago", "3h ago",
 * "Yesterday", "4d ago". Falls back to a date once a week has passed, so a row
 * never reads "37d ago".
 */
export function formatRelativeShort(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDateTime(date);
  if (diff < 6e4) return "just now";

  const minutes = Math.floor(diff / 6e4);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / 36e5);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / 864e5);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  // "29 Aug" in dense rows; the year only appears when it is not this one.
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "6 Aug 2026 – 4 Sep 2026". `to` is exclusive, so the last day is to − 1ms. */
export function formatRangeLabel(range: ResolvedRange) {
  return `${formatDate(range.from)} – ${formatDate(new Date(range.to.getTime() - 1))}`;
}

/** Day heading used to group notification and timeline rows. */
export function dayGroupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(date)) / 864e5);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(date);
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
    return offset ? `(${offset}) ${region}` : region;
  } catch {
    // Unknown identifier: show it as given rather than inventing a label.
    return zone;
  }
}
