/**
 * The acquisition campaign's send window (V4 §20.7). Pure.
 *
 * The wizard stores it ("9:00 AM – 5:00 PM" by default, in the campaign's
 * zone) and the cold dispatcher never read it, so a campaign sent at 23:30 on
 * a Sunday as readily as at 10:00 on a Tuesday (2026-09-29). The window can
 * only narrow what the compliance pack already permits.
 */

function minutesOf(clock: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((clock ?? "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

function localMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

/**
 * Whether `at` is inside the window. No window (either bound missing) is
 * "any time policy permits": open. A window that wraps midnight is supported.
 */
export function withinSendWindow(input: {
  at: Date;
  timeZone: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
}): boolean {
  const start = minutesOf(input.start);
  const end = minutesOf(input.end);
  if (start === null || end === null || start === end) return true;
  const now = localMinutes(input.at, input.timeZone || "Europe/London");
  return start < end ? now >= start && now < end : now >= start || now < end;
}
