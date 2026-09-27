/**
 * Reading a lead's preferred day and time (story H3). Pure.
 *
 * In manual booking mode (booking_mode 'handover', or a calendar that cannot
 * be read) there are no offered slots to match against. The owner's decision
 * (docs/revenue-engine/00 §6) is that ClientTurn then holds a PENDING booking
 * for the time the lead asks for, and a person confirms or declines it. This
 * turns "Tuesday at 2pm" into that concrete time, in the workspace's timezone,
 * by string rules only. Anything that does not name exactly one day and
 * exactly one clock time is AMBIGUOUS: the agent asks once more, then hands
 * over. A time in the past is never booked.
 *
 * Never a model judgement: a wrong booking is worse than a clarifying question.
 */

import { formatSlotLabel, zonedTimeToUtc, type Slot } from "./slots.ts";

export type PreferredTime =
  | { kind: "slot"; slot: Slot }
  | { kind: "ambiguous"; missing: "day" | "time" | "both" | "past" | "several" };

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

type YMD = { year: number; month: number; day: number };

function todayIn(now: Date, timezone: string): YMD & { dow: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday").slice(0, 3));
  return { year: Number(read("year")), month: Number(read("month")), day: Number(read("day")), dow };
}

function addDays(date: YMD, days: number): YMD {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Every day the text names, resolved to a calendar date. */
function daysIn(text: string, today: YMD & { dow: number }): YMD[] {
  const found = new Map<string, YMD>();
  const add = (d: YMD) => found.set(`${d.year}-${d.month}-${d.day}`, d);

  if (/\bday after tomorrow\b/.test(text)) add(addDays(today, 2));
  else if (/\btomorrow\b/.test(text)) add(addDays(today, 1));
  if (/\btoday\b|\bthis (afternoon|morning|evening)\b/.test(text)) add(today);

  for (const match of text.matchAll(/\b(next\s+|this\s+)?(sun(day)?|mon(day)?|tue(s(day)?)?|wed(s|nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?)\b/g)) {
    const target = WEEKDAYS[match[2]];
    if (target === undefined) continue;
    let delta = (target - today.dow + 7) % 7;
    // "Tuesday" said on a Tuesday means next week's unless "this" or "today" says otherwise.
    if (delta === 0 && !match[1]?.startsWith("this")) delta = 7;
    add(addDays(today, delta));
  }

  // "3 Oct", "3rd October", "October 3", "Oct 3rd"
  const monthNames = Object.keys(MONTHS).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b`, "g"))) {
    add(resolveDate(Number(match[1]), MONTHS[match[2]], today));
  }
  for (const match of text.matchAll(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"))) {
    add(resolveDate(Number(match[2]), MONTHS[match[1]], today));
  }
  // UK numeric dates: 3/10, 03/10/2026
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : null;
    add(year ? { year, month, day } : resolveDate(day, month, today));
  }
  return [...found.values()];
}

/** A day and month with no year: this year, or next year if already past. */
function resolveDate(day: number, month: number, today: YMD): YMD {
  const thisYear = { year: today.year, month, day };
  const passed = month < today.month || (month === today.month && day < today.day);
  return passed ? { ...thisYear, year: today.year + 1 } : thisYear;
}

/** Every clock time the text names, as minutes of the day. */
function timesIn(text: string): number[] {
  const found = new Set<number>();
  // Strip dates so "3/10" is not read as a time.
  const clean = text.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  if (/\b(noon|midday|12 ?noon)\b/.test(clean)) found.add(12 * 60);
  for (const match of clean.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)\b/g)) {
    let hour = Number(match[1]) % 12;
    if (match[3] === "pm") hour += 12;
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour < 24 && minute < 60) found.add(hour * 60 + minute);
  }
  for (const match of clean.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\s?(am|pm))/g)) {
    found.add(Number(match[1]) * 60 + Number(match[2]));
  }
  // "at 3", "at 10": a bare hour after "at" is read as a working-day hour.
  for (const match of clean.matchAll(/\bat\s+(\d{1,2})\b(?![:.]\d|\s?(am|pm)|\s*\/)/g)) {
    const hour = Number(match[1]);
    if (hour >= 1 && hour <= 12) found.add((hour <= 7 ? hour + 12 : hour) * 60);
  }
  return [...found];
}

/**
 * The lead's preferred time, as one concrete slot, or why it is not one.
 * `now` is the moment of the reply; the slot must start after it.
 */
export function parsePreferredTime(
  reply: string,
  options: { now: Date; timezone: string; durationMinutes: number },
): PreferredTime {
  const text = reply.toLowerCase().normalize("NFKC");
  const today = todayIn(options.now, options.timezone);
  const days = daysIn(text, today);
  const times = timesIn(text);

  if (days.length > 1 || times.length > 1) return { kind: "ambiguous", missing: "several" };
  if (days.length === 0 && times.length === 0) return { kind: "ambiguous", missing: "both" };
  if (days.length === 0) return { kind: "ambiguous", missing: "day" };
  if (times.length === 0) return { kind: "ambiguous", missing: "time" };

  const [day] = days;
  const start = zonedTimeToUtc(day.year, day.month, day.day, times[0], options.timezone);
  if (start.getTime() <= options.now.getTime()) return { kind: "ambiguous", missing: "past" };

  const end = new Date(start.getTime() + Math.max(15, options.durationMinutes) * 60_000);
  return {
    kind: "slot",
    slot: { startsAt: start.toISOString(), endsAt: end.toISOString(), label: formatSlotLabel(start, options.timezone) },
  };
}

/** The one question asked for a preferred time (deterministic, zero tokens). */
export function preferredTimeQuestion(firstName: string | null, attempt: 1 | 2): string {
  if (attempt === 1) {
    return `${firstName ? `Thanks ${firstName}. ` : "Thanks. "}Happy to set up a time. Which day and time would suit you best?`;
  }
  return "Sorry, I want to get this right. Which day and what time would suit you, for example Tuesday at 2pm?";
}
