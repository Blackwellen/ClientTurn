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
