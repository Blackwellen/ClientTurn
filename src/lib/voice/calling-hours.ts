/**
 * Calling hours in the RECIPIENT's local time.
 *
 * Pure. Time zones come from the platform's `Intl` data; nothing here reads a
 * clock (every function takes `at`).
 *
 * Three decisions live here:
 *  1. Which time zone the recipient is in. Explicit lead time zone, else the
 *     phone number's country (only where that country has one zone), else the
 *     workspace's. The source is always returned, so a caller can see (and a
 *     test can assert) that nothing was guessed silently. When none resolves the
 *     answer is UNRESOLVED, and eligibility refuses the call.
 *  2. The windows: weekdays 09:00 to 20:00, Saturday 10:00 to 16:00, no Sunday,
 *     no UK bank holiday, by default.
 *  3. The legal bounds a workspace may configure within: never before 08:00 or
 *     after 21:00 local (the Ofcom persistent-misuse and DMA guidance hours).
 */

import { z } from "zod";

// ------------------------------------------------------------------ zones

export type TimezoneSource = "LEAD" | "PHONE_COUNTRY" | "WORKSPACE";
export type TimezoneResolution =
  | { timezone: string; source: TimezoneSource }
  | { timezone: null; source: "UNRESOLVED"; reason: "NO_VALID_TIMEZONE" };

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Country calling codes that map to exactly one IANA zone. Multi-zone
 * countries (+1, +7, +61, +55, ...) are deliberately absent: the number alone
 * cannot say which zone, so they fall through to the workspace.
 */
const SINGLE_ZONE_CALLING_CODES: ReadonlyArray<readonly [string, string]> = [
  ["+44", "Europe/London"],
  ["+353", "Europe/Dublin"],
  ["+33", "Europe/Paris"],
  ["+49", "Europe/Berlin"],
  ["+31", "Europe/Amsterdam"],
  ["+32", "Europe/Brussels"],
  ["+34", "Europe/Madrid"], // Canary Islands differ; Spain is treated as mainland.
  ["+39", "Europe/Rome"],
  ["+41", "Europe/Zurich"],
  ["+45", "Europe/Copenhagen"],
  ["+46", "Europe/Stockholm"],
  ["+47", "Europe/Oslo"],
  ["+48", "Europe/Warsaw"],
  ["+351", "Europe/Lisbon"], // Azores differ; mainland assumed.
];

export function timezoneForPhone(e164: string | null | undefined): string | null {
  if (!e164 || !e164.startsWith("+")) return null;
  // Longest prefix first so +353 is not read as +35x.
  const sorted = [...SINGLE_ZONE_CALLING_CODES].sort((a, b) => b[0].length - a[0].length);
  for (const [code, tz] of sorted) if (e164.startsWith(code)) return tz;
  return null;
}

export function resolveRecipientTimezone(input: {
  leadTimezone?: string | null;
  phoneE164?: string | null;
  workspaceTimezone?: string | null;
}): TimezoneResolution {
  if (isValidTimezone(input.leadTimezone)) return { timezone: input.leadTimezone, source: "LEAD" };
  const fromPhone = timezoneForPhone(input.phoneE164);
  if (fromPhone) return { timezone: fromPhone, source: "PHONE_COUNTRY" };
  if (isValidTimezone(input.workspaceTimezone)) return { timezone: input.workspaceTimezone, source: "WORKSPACE" };
  return { timezone: null, source: "UNRESOLVED", reason: "NO_VALID_TIMEZONE" };
}

// ------------------------------------------------------------ local parts

export type LocalParts = {
  /** YYYY-MM-DD in the zone. */
  date: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** Minutes since local midnight. */
  minuteOfDay: number;
  hhmm: string;
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(at: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** Offset of `timezone` from UTC at `at`, in minutes (London in BST = +60). */
function offsetMinutes(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant a local wall-clock time occurs in `timezone`. */
export function zonedTimeToUtc(date: string, minuteOfDay: number, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let guess = naive - offsetMinutes(new Date(naive), timezone) * 60000;
  // Second pass settles the DST edge where the first guess lands across it.
  guess = naive - offsetMinutes(new Date(guess), timezone) * 60000;
  return new Date(guess);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------- bank holidays

export type UkRegion = "ENGLAND_AND_WALES" | "SCOTLAND" | "NORTHERN_IRELAND";

/**
 * UK bank holidays 2026 and 2027, from https://www.gov.uk/bank-holidays.json,
 * fetched and checked 2026-09-27. Substitute days are the dates gov.uk lists
 * (e.g. Boxing Day 2026 is Monday 28 December). Scotland 2026 includes the
 * one-off "World Cup bank holiday" (15 June) that gov.uk lists.
 *
 * Extend this list before 2028: `isUkBankHoliday` fails CLOSED for a year it
 * does not cover (see `BANK_HOLIDAY_YEARS_COVERED`).
 */
export const UK_BANK_HOLIDAYS_SOURCE = {
  url: "https://www.gov.uk/bank-holidays.json",
  checkedOn: "2026-09-27",
} as const;

export const BANK_HOLIDAY_YEARS_COVERED: readonly number[] = [2026, 2027];

export const UK_BANK_HOLIDAYS: Readonly<Record<UkRegion, readonly string[]>> = {
  ENGLAND_AND_WALES: [
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31",
    "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30",
    "2027-12-27", "2027-12-28",
  ],
  SCOTLAND: [
    "2026-01-01", "2026-01-02", "2026-04-03", "2026-05-04", "2026-05-25", "2026-06-15",
    "2026-08-03", "2026-11-30", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-01-04", "2027-03-26", "2027-05-03", "2027-05-31", "2027-08-02",
    "2027-11-30", "2027-12-27", "2027-12-28",
  ],
  NORTHERN_IRELAND: [
    "2026-01-01", "2026-03-17", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
    "2026-07-13", "2026-08-31", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-17", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31",
    "2027-07-12", "2027-08-30", "2027-12-27", "2027-12-28",
  ],
};

export type BankHolidayCheck =
  | { holiday: false }
  | { holiday: true; reason: "BANK_HOLIDAY" | "YEAR_NOT_COVERED" };

/**
 * Is `date` (a local YYYY-MM-DD) a bank holiday for `region`? With no region
 * known, a holiday in ANY UK region counts: the conservative reading, since
 * the recipient's nation is not known.
 */
export function isUkBankHoliday(date: string, region: UkRegion | null = null): BankHolidayCheck {
  const year = Number(date.slice(0, 4));
  if (!BANK_HOLIDAY_YEARS_COVERED.includes(year)) return { holiday: true, reason: "YEAR_NOT_COVERED" };
  const regions: UkRegion[] = region ? [region] : ["ENGLAND_AND_WALES", "SCOTLAND", "NORTHERN_IRELAND"];
  for (const r of regions) if (UK_BANK_HOLIDAYS[r].includes(date)) return { holiday: true, reason: "BANK_HOLIDAY" };
  return { holiday: false };
}

// ---------------------------------------------------------------- windows

/** Earliest start and latest end any workspace may configure, local time. */
export const CALLING_HOURS_BOUNDS = { earliest: "08:00", latest: "21:00" } as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour");
function toMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

const windowSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((w) => toMinutes(w.start) < toMinutes(w.end), { message: "start must be before end" })
  .refine((w) => toMinutes(w.start) >= toMinutes(CALLING_HOURS_BOUNDS.earliest), {
    message: `no earlier than ${CALLING_HOURS_BOUNDS.earliest}`,
  })
  .refine((w) => toMinutes(w.end) <= toMinutes(CALLING_HOURS_BOUNDS.latest), {
    message: `no later than ${CALLING_HOURS_BOUNDS.latest}`,
  });
export type CallingWindow = z.infer<typeof windowSchema>;

/** Index 0 = Sunday ... 6 = Saturday. `null` means no calls that day. */
export const callingHoursConfigSchema = z.object({
  days: z.tuple([
    windowSchema.nullable(),
    windowSchema.nullable(),
    windowSchema.nullable(),
    windowSchema.nullable(),
    windowSchema.nullable(),
    windowSchema.nullable(),
    windowSchema.nullable(),
  ]),
  /** Default false. Turning it on is a deliberate workspace choice. */
  callOnBankHolidays: z.boolean(),
});
export type CallingHoursConfig = z.infer<typeof callingHoursConfigSchema>;

export const DEFAULT_CALLING_HOURS: CallingHoursConfig = {
  days: [
    null,
    { start: "09:00", end: "20:00" },
    { start: "09:00", end: "20:00" },
    { start: "09:00", end: "20:00" },
    { start: "09:00", end: "20:00" },
    { start: "09:00", end: "20:00" },
    { start: "10:00", end: "16:00" },
  ],
  callOnBankHolidays: false,
};

/** Validate a workspace's configuration against the legal bounds. */
export function parseCallingHoursConfig(
  input: unknown,
): { ok: true; config: CallingHoursConfig } | { ok: false; errors: string[] } {
  const r = callingHoursConfigSchema.safeParse(input);
  if (r.success) return { ok: true, config: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

export type CallingHoursDenial = "NO_WINDOW_TODAY" | "SUNDAY" | "BANK_HOLIDAY" | "BEFORE_WINDOW" | "AFTER_WINDOW";

export type CallingHoursCheck =
  | { allowed: true; local: LocalParts }
  | { allowed: false; reason: CallingHoursDenial; local: LocalParts };

export function isWithinCallingHours(input: {
  at: Date;
  timezone: string;
  config?: CallingHoursConfig;
  region?: UkRegion | null;
  /** Bank holidays apply only to UK recipients. */
  applyUkBankHolidays?: boolean;
}): CallingHoursCheck {
  const config = input.config ?? DEFAULT_CALLING_HOURS;
  const local = localParts(input.at, input.timezone);
  const applyBh = input.applyUkBankHolidays ?? true;
  if (applyBh && !config.callOnBankHolidays && isUkBankHoliday(local.date, input.region ?? null).holiday) {
    return { allowed: false, reason: "BANK_HOLIDAY", local };
  }
  const window = config.days[local.weekday];
  if (!window) return { allowed: false, reason: local.weekday === 0 ? "SUNDAY" : "NO_WINDOW_TODAY", local };
  if (local.minuteOfDay < toMinutes(window.start)) return { allowed: false, reason: "BEFORE_WINDOW", local };
  // The end is exclusive: 20:00 is already outside a window ending 20:00.
  if (local.minuteOfDay >= toMinutes(window.end)) return { allowed: false, reason: "AFTER_WINDOW", local };
  return { allowed: true, local };
}

/**
 * The next instant at or after `at` that is inside a window, searching
 * `horizonDays` ahead. Null when there is none (e.g. every day disabled).
 * `minMinutesBeforeEnd` keeps a new call from starting in the last minutes of a
 * window (default 5: a 5-minute call started at 19:59 would run past 20:00).
 */
export function nextCallableAt(input: {
  at: Date;
  timezone: string;
  config?: CallingHoursConfig;
  region?: UkRegion | null;
  applyUkBankHolidays?: boolean;
  horizonDays?: number;
  minMinutesBeforeEnd?: number;
}): Date | null {
  const config = input.config ?? DEFAULT_CALLING_HOURS;
  const horizon = input.horizonDays ?? 14;
  const tail = input.minMinutesBeforeEnd ?? 5;
  const applyBh = input.applyUkBankHolidays ?? true;
  const start = localParts(input.at, input.timezone);

  for (let i = 0; i <= horizon; i++) {
    const date = addDays(start.date, i);
    const noonUtc = zonedTimeToUtc(date, 12 * 60, input.timezone);
    const weekday = localParts(noonUtc, input.timezone).weekday;
    if (applyBh && !config.callOnBankHolidays && isUkBankHoliday(date, input.region ?? null).holiday) continue;
    const w = config.days[weekday];
    if (!w) continue;
    const open = toMinutes(w.start);
    const lastStart = toMinutes(w.end) - tail;
    if (lastStart < open) continue;
    const fromMinute = i === 0 ? Math.max(open, start.minuteOfDay) : open;
    if (fromMinute > lastStart) continue;
    const candidate = zonedTimeToUtc(date, fromMinute, input.timezone);
    // Never return a time before `at` (the same minute keeps its seconds).
    return candidate.getTime() < input.at.getTime() ? input.at : candidate;
  }
  return null;
}
