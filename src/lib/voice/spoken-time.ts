/**
 * Slot labels as a person says them (adversarial voice QA pass, 2026-09-28).
 * Pure.
 *
 * The booking service labels a slot for a screen: "Wed 30 Sep, 10:00am"
 * (agent/availability/slots.ts formatSlotLabel). Read aloud by a TTS voice
 * that is "Wed thirty Sep comma ten zero zero a m", and two slots on the
 * same day repeat the date. On a call the tool says "Wednesday 30 September
 * at 10am or 2pm". The words change; the time never does (the ISO start the
 * tool returned is what book_meeting books).
 */

const DAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const MONTHS: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
  Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
};

type Parsed = { day: string; time: string };

function parse(label: string): Parsed | null {
  const m = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),? (.+)$/.exec(label.trim());
  if (!m) return null;
  // "10:00am" is "10am" out loud; "1:30pm" and "13:30" stay as they are.
  const time = m[4].trim().replace(/^(\d{1,2}):00\s?(am|pm)$/i, "$1$2");
  return { day: `${DAYS[m[1]]} ${Number(m[2])} ${MONTHS[m[3]]}`, time };
}

/** One slot label, spoken: "Wednesday 30 September at 10am". Unknown formats pass through. */
export function spokenSlotLabel(label: string): string {
  const p = parse(label);
  return p ? `${p.day} at ${p.time}` : label;
}

/** Two slots as a choice: the date once when both are on the same day. */
export function spokenSlotChoice(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb && pa.day === pb.day) return `${pa.day} at ${pa.time} or ${pb.time}`;
  return `${spokenSlotLabel(a)} or ${spokenSlotLabel(b)}`;
}

/* ------------------------------------------- clock times (live call 2026-09-28) */

type LocalParts = { y: number; m: number; d: number; hour: number; minute: number; weekday: string; monthName: string };

function localParts(at: Date, timezone: string): LocalParts {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "long",
  });
  const get = (type: string) => f.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  const monthName = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, month: "long" }).format(at);
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday"), monthName };
}

/** "5pm", "5:30pm" (a person's way of saying a clock time). */
export function spokenClock(at: Date, timezone: string): string {
  const p = localParts(at, timezone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? "am" : "pm";
  return p.minute === 0 ? `${h12}${suffix}` : `${h12}:${String(p.minute).padStart(2, "0")}${suffix}`;
}

/** "today", "tomorrow", or "on Thursday 1 October", relative to `now` in the same time zone. */
export function spokenDay(at: Date, now: Date, timezone: string): string {
  const a = localParts(at, timezone);
  const n = localParts(now, timezone);
  const dayNo = (p: LocalParts) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;
  const diff = dayNo(a) - dayNo(n);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `on ${a.weekday} ${a.d} ${a.monthName}`;
}

/** "6pm today": the exact call-back time, read back once. */
export function spokenWhen(at: Date, now: Date, timezone: string): string {
  return `${spokenClock(at, timezone)} ${spokenDay(at, now, timezone)}`;
}

/** "Monday 28 September, 5:32pm": the local date and time, for the call brief. */
export function spokenNow(now: Date, timezone: string): string {
  const p = localParts(now, timezone);
  return `${p.weekday} ${p.d} ${p.monthName}, ${spokenClock(now, timezone)}`;
}

/**
 * A call-back time that has already gone: one natural reprompt with two real
 * choices, the next hour today (when there is one before 9pm) or the same
 * time tomorrow. "5pm has already gone today. Did you mean 6pm today, or 5pm
 * tomorrow?" The lead chooses; nothing is assumed.
 */
export function pastTimeReprompt(at: Date, now: Date, timezone: string): string {
  const said = spokenClock(at, timezone);
  const nextHour = new Date(at.getTime() + 3_600_000);
  const later = nextHour > now && localParts(nextHour, timezone).hour < 21 && spokenDay(nextHour, now, timezone) === "today" ? `${spokenClock(nextHour, timezone)} today, or ` : "";
  return `${said} has already gone today. Did you mean ${later}${said} tomorrow?`.replace(/^([a-z])/, (c) => c.toUpperCase());
}
