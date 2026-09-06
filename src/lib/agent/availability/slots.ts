/**
 * Slot generation.
 *
 * Pure, dependency-free and timezone-correct. Given a workspace's business
 * hours and a set of busy intervals from a real calendar, it produces the
 * bookable slots and nothing else -- no provider call, no database, no guess.
 *
 * The agent may only ever offer a time that came out of this file after a
 * provider supplied the busy intervals. That is the whole point: a slot the
 * model invents cannot survive `validateResponse`, and a slot this file
 * produces is defensible because it is business hours minus real commitments.
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayHours = { open: boolean; start: string; end: string };
export type WeekHours = Record<DayKey, DayHours>;

/** Half-open interval in epoch milliseconds: [start, end). */
export type BusyInterval = { start: number; end: number };

export type Slot = {
  /** ISO instant. */
  startsAt: string;
  endsAt: string;
  /** Human label in the workspace's timezone, e.g. "Tue 9 Sep, 1:30pm". */
  label: string;
};

const DAY_ORDER: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

/**
 * The offset, in minutes, between UTC and `timezone` at a given instant.
 * Derived by formatting the instant in the target zone and reading the parts
 * back, which is the only approach that stays correct across DST without a
 * timezone library.
 */
function offsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some engines; normalise it.
  const hour = read("hour") % 24;

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );

  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Converts a wall-clock time in `timezone` to the UTC instant it names.
 *
 * Two passes: the first guesses using the offset at the naive instant, the
 * second corrects it using the offset actually in force at the guessed
 * instant. That second pass is what makes the hour either side of a DST
 * transition come out right.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60_000;
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timezone) * 60_000);
  const corrected = naive - offsetMinutes(firstGuess, timezone) * 60_000;
  return new Date(corrected);
}

/** The weekday of an instant, in the workspace's timezone. */
export function dayKeyInZone(at: Date, timezone: string): DayKey {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
  }).format(at);

  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday.slice(0, 3));
  return DAY_ORDER[index === -1 ? 0 : index];
}

/** Calendar date parts of an instant, in the workspace's timezone. */
function dateParts(at: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day") };
}

export function formatSlotLabel(at: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    // "1:30 pm" -> "1:30pm", which is how a UK tradesperson writes it.
    .replace(/\s?(am|pm)$/i, (match) => match.trim().toLowerCase());

  return `${day}, ${time}`;
}

export type CandidateOptions = {
  businessHours: WeekHours;
  timezone: string;
  /** Window to search, as instants. */
  from: Date;
  to: Date;
  durationMinutes: number;
  /** Gap left after each appointment before the next may start. */
  bufferMinutes: number;
  /** Granularity of offered start times. */
  intervalMinutes?: number;
  /** Never offer a slot starting sooner than this many minutes from now. */
  minimumNoticeMinutes?: number;
};

/**
 * Every start time inside business hours in the window. Bounded to 14 days so
 * a misconfigured range cannot produce an unbounded list.
 */
export function generateCandidateSlots(options: CandidateOptions): Slot[] {
  const {
    businessHours,
    timezone,
    from,
    to,
    durationMinutes,
    bufferMinutes,
    intervalMinutes = 30,
    minimumNoticeMinutes = 120,
  } = options;

  if (durationMinutes <= 0 || intervalMinutes <= 0) return [];

  const earliest = from.getTime() + minimumNoticeMinutes * 60_000;
  const horizon = Math.min(to.getTime(), from.getTime() + 14 * 24 * 60 * 60_000);
  const slots: Slot[] = [];
  const occupied = durationMinutes + bufferMinutes;

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    // Step a day at a time in the workspace's own calendar, not in UTC.
    const cursor = new Date(from.getTime() + dayOffset * 24 * 60 * 60_000);
    if (cursor.getTime() > horizon) break;

    const hours = businessHours[dayKeyInZone(cursor, timezone)];
    if (!hours?.open) continue;

    const { year, month, day } = dateParts(cursor, timezone);
    const opens = parseTime(hours.start);
    const closes = parseTime(hours.end);
    if (closes <= opens) continue;

    for (let minute = opens; minute + occupied <= closes; minute += intervalMinutes) {
      const startsAt = zonedTimeToUtc(year, month, day, minute, timezone);
      const startMs = startsAt.getTime();
      if (startMs < earliest || startMs > horizon) continue;

      const endsAt = new Date(startMs + durationMinutes * 60_000);
      slots.push({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: formatSlotLabel(startsAt, timezone),
      });
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Drops every candidate that overlaps a real commitment. The buffer is applied
 * on both sides, so a slot butting up against an existing appointment is
 * removed rather than offered.
 */
export function subtractBusy(
  slots: Slot[],
  busy: BusyInterval[],
  bufferMinutes = 0,
): Slot[] {
  if (busy.length === 0) return slots;
  const buffer = bufferMinutes * 60_000;

  return slots.filter((slot) => {
    const start = Date.parse(slot.startsAt) - buffer;
    const end = Date.parse(slot.endsAt) + buffer;
    return !busy.some((interval) => start < interval.end && end > interval.start);
  });
}

/**
 * Narrows a slot list to a part of the day the lead asked for. Unrecognised
 * wording returns the list untouched -- a preference the runtime cannot parse
 * must never silently discard real availability.
 */
export function filterByDayPart(
  slots: Slot[],
  dayPart: string | null | undefined,
  timezone: string,
): Slot[] {
  if (!dayPart) return slots;
  const wanted = dayPart.trim().toLowerCase();

  const ranges: Record<string, [number, number]> = {
    morning: [0, 12 * 60],
    afternoon: [12 * 60, 17 * 60],
    evening: [17 * 60, 24 * 60],
  };

  const range = ranges[wanted];
  if (!range) return slots;

  return slots.filter((slot) => {
    const at = new Date(slot.startsAt);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const minutes = (read("hour") % 24) * 60 + read("minute");
    return minutes >= range[0] && minutes < range[1];
  });
}

/**
 * Narrows to a specific calendar date, expressed in the workspace's timezone.
 * An unparseable date returns the list untouched, for the same reason as
 * `filterByDayPart`.
 */
export function filterByDate(
  slots: Slot[],
  isoDate: string | null | undefined,
  timezone: string,
): Slot[] {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) return slots;
  const wanted = isoDate.trim();

  return slots.filter((slot) => {
    const { year, month, day } = dateParts(new Date(slot.startsAt), timezone);
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return key === wanted;
  });
}

/**
 * The handful of options actually offered to a lead. Three is the most a
 * person can weigh in an SMS without it becoming a menu, and spreading them
 * across the window beats offering three consecutive half-hours.
 */
export function pickOfferedSlots(slots: Slot[], count = 3): Slot[] {
  if (slots.length <= count) return slots;

  const step = Math.floor(slots.length / count);
  const picked: Slot[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(slots[index * step]);
  }
  return picked;
}

// ------------------------------------------------------- confirmation match

/**
 * Which of the offered slots did the lead just pick?
 *
 * Deterministic on purpose. A booking is a HIGH-risk, hard-to-reverse action,
 * so the choice is made by string matching against times the runtime itself
 * offered on a previous turn -- never by asking the model which one it thinks
 * they meant. An ambiguous or unmatched reply returns null, which becomes a
 * short clarifying question rather than a booking.
 */
export function matchOfferedSlot(reply: string, offered: Slot[]): Slot | null {
  if (offered.length === 0) return null;

  const text = reply
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  // Times as the labels render them: "1:30pm", "3pm", "13:30".
  const slotTimes = offered.map((slot) => {
    const match = slot.label.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3].toLowerCase();
    return { hour, minute, meridiem };
  });

  const spoken = [...text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g)]
    .map((match) => ({
      hour: Number(match[1]),
      minute: match[2] === undefined ? null : Number(match[2]),
      meridiem: match[3]?.toLowerCase() ?? null,
      bare: match[2] === undefined && !match[3],
    }))
    .filter((token) => token.hour >= 0 && token.hour <= 23);

  // 1) An explicit time the lead named that matches exactly one offered slot.
  for (const token of spoken) {
    if (token.bare) continue;
    const hits = offered.filter((_, index) => {
      const slot = slotTimes[index];
      if (!slot) return false;
      if (slot.hour !== token.hour) return false;
      if (token.minute !== null && slot.minute !== token.minute) return false;
      if (token.meridiem && slot.meridiem !== token.meridiem) return false;
      return true;
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }

  // 2) Ordinal wording.
  const ordinals: Record<string, number> = {
    first: 0,
    "1st": 0,
    second: 1,
    "2nd": 1,
    third: 2,
    "3rd": 2,
    last: offered.length - 1,
  };
  // Whole-word only, and without a constructed regex: the words are known
  // and a plain token check cannot be broken by escaping.
  const words = text.split(" ");
  for (const [word, index] of Object.entries(ordinals)) {
    if (words.includes(word) && index >= 0 && index < offered.length) {
      return offered[index];
    }
  }

  // 3) A bare number. Read as an hour when exactly one slot is at that hour --
  //    "3" after offering 1:30pm and 3:00pm means three o'clock, not the third
  //    option -- and only otherwise as a positional pick.
  const bare = spoken.filter((token) => token.bare);
  if (bare.length === 1) {
    const value = bare[0].hour;
    const byHour = offered.filter((_, index) => slotTimes[index]?.hour === value);
    if (byHour.length === 1) return byHour[0];
    if (byHour.length === 0 && value >= 1 && value <= offered.length) {
      return offered[value - 1];
    }
  }

  return null;
}
