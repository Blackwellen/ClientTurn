/**
 * Follow-up scheduling rules. Pure functions so they are directly testable —
 * the worker re-reads live state and calls these before every send.
 */

// A relative path with the extension, not the `@/` alias: this module is pure
// so that `node --test` can load it directly, and the runner does not resolve
// tsconfig path aliases.
import {
  renderPreview,
  unknownTokens,
} from "../messaging/merge-fields.ts";

export type StopReason =
  | "replied"
  | "booked"
  | "won"
  | "lost"
  | "opted_out"
  | "human_takeover"
  | "paused"
  | "subscription_inactive"
  | "integration_unavailable"
  | "suppressed";

export type LeadState = {
  status: string;
  optedOut: boolean;
  humanTakeover: boolean;
  automationActive: boolean;
  hasReplied: boolean;
};

export type ChannelState = {
  subscriptionActive: boolean;
  integrationHealthy: boolean;
  contactSuppressed: boolean;
};

export type StopOptions = {
  /**
   * The message is a `booking_reminder` automation step (Phase 3.1). Exempt
   * from BOOKED and from a reply; bound by everything else.
   */
  bookingReminder?: boolean;
};

/** Send-key prefix that marks a booking reminder step on the outbound row. */
export const BOOKING_REMINDER_SEND_KEY_PREFIX = "booking-reminder:";

export function isBookingReminderSendKey(sendKey: string | null | undefined): boolean {
  return Boolean(sendKey && sendKey.startsWith(BOOKING_REMINDER_SEND_KEY_PREFIX));
}

/**
 * Checked immediately before every send. A stale scheduled job can never
 * bypass current lead state.
 */
export function evaluateStopConditions(
  lead: LeadState,
  channel: ChannelState,
  options: StopOptions = {},
): StopReason | null {
  // A booking reminder exists *because* the lead is booked, and a lead saying
  // "see you then" must not cancel the reminder for the meeting they just
  // confirmed. Every other stop condition -- opt-out, takeover, won/lost,
  // suppression, channel health -- still binds it.
  if (lead.hasReplied && !options.bookingReminder) return "replied";
  if (lead.status === "BOOKED" && !options.bookingReminder) return "booked";
  if (lead.status === "WON") return "won";
  if (lead.status === "LOST") return "lost";
  if (lead.optedOut) return "opted_out";
  if (lead.humanTakeover) return "human_takeover";
  if (!lead.automationActive) return "paused";
  if (!channel.subscriptionActive) return "subscription_inactive";
  if (!channel.integrationHealthy) return "integration_unavailable";
  if (channel.contactSuppressed) return "suppressed";
  return null;
}

export type QuietHours = {
  enabled: boolean;
  /** "HH:MM" local to the business timezone. */
  start: string;
  end: string;
  timezone: string;
};

function minutesInZone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function parseTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

export function isWithinQuietHours(at: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;

  const now = minutesInZone(at, quiet.timezone);
  const start = parseTime(quiet.start);
  const end = parseTime(quiet.end);

  // A window like 20:00–08:00 wraps past midnight.
  return start > end ? now >= start || now < end : now >= start && now < end;
}

/**
 * Rolls a send time forward to the next permitted moment rather than
 * dropping it.
 */
export function nextPermittedSendTime(at: Date, quiet: QuietHours): Date {
  if (!isWithinQuietHours(at, quiet)) return at;

  const endMinutes = parseTime(quiet.end);
  const candidate = new Date(at);

  // Step forward in 15-minute increments until the window opens. Bounded to
  // 24h so a misconfigured window can never loop forever.
  for (let step = 0; step < 96; step += 1) {
    candidate.setTime(candidate.getTime() + 15 * 60 * 1000);
    if (!isWithinQuietHours(candidate, quiet)) {
      const current = minutesInZone(candidate, quiet.timezone);
      // Snap to the exact opening minute when we land just past it.
      if (Math.abs(current - endMinutes) <= 15) {
        candidate.setTime(
          candidate.getTime() - (current - endMinutes) * 60 * 1000,
        );
      }
      return candidate;
    }
  }

  return candidate;
}

/** Default cadence: immediately, +10m, +2h, +1d, +3d. */
export const DEFAULT_CADENCE_SECONDS = [0, 600, 7200, 86400, 259200];

export function computeNextRunAt(
  from: Date,
  delaySeconds: number,
  quiet: QuietHours,
): Date {
  return nextPermittedSendTime(
    new Date(from.getTime() + delaySeconds * 1000),
    quiet,
  );
}

/* ----------------------------------------------------- booking reminders */

/**
 * The latest permitted moment at or before `at`. The mirror of
 * `nextPermittedSendTime` for a message that must go out BEFORE something --
 * a booking reminder rolled forward out of quiet hours could land after the
 * meeting it is reminding about, so it is pulled earlier instead.
 *
 * Lands one minute before the quiet window opens (e.g. 19:59 for a window
 * starting 20:00).
 */
export function previousPermittedSendTime(at: Date, quiet: QuietHours): Date {
  if (!isWithinQuietHours(at, quiet)) return at;

  const start = parseTime(quiet.start);
  const since = (minutesInZone(at, quiet.timezone) - start + 1440) % 1440;
  const withinMinuteMs = at.getTime() % 60_000;
  const candidate = new Date(at.getTime() - withinMinuteMs - (since + 1) * 60_000);

  // A daylight-saving change inside the window can make the arithmetic above
  // land a little off; walk back minute by minute, bounded to 24h.
  for (let step = 0; step < 1440 && isWithinQuietHours(candidate, quiet); step += 1) {
    candidate.setTime(candidate.getTime() - 60_000);
  }
  return candidate;
}

/** Longest a due reminder may run late (worker lag) and still be sent. */
export const BOOKING_REMINDER_MAX_GRACE_SECONDS = 30 * 60;

/**
 * When one booking reminder step should go out: `offsetSeconds` before the
 * meeting starts, pulled EARLIER out of quiet hours (never later, which could
 * put it after the meeting). Returns null when there is no moment to send it:
 *
 *   * the meeting has no start, or the offset is not before it;
 *   * the send time has already passed -- a booking made two hours out never
 *     gets its "24 hours before" reminder late. A job running a little behind
 *     (up to half the offset, at most 30 minutes) still sends, at `now`, as
 *     long as `now` is outside quiet hours and before the meeting.
 */
export function bookingReminderSendTime(input: {
  startsAt: Date;
  offsetSeconds: number;
  now: Date;
  quiet: QuietHours;
}): Date | null {
  const start = input.startsAt.getTime();
  const now = input.now.getTime();
  if (!Number.isFinite(start) || !(input.offsetSeconds > 0)) return null;
  if (start <= now) return null;

  const target = new Date(start - input.offsetSeconds * 1000);
  const at = previousPermittedSendTime(target, input.quiet);
  if (at.getTime() >= start) return null;
  if (at.getTime() > now) return at;

  const graceMs =
    Math.min(BOOKING_REMINDER_MAX_GRACE_SECONDS, input.offsetSeconds / 2) * 1000;
  if (now - at.getTime() > graceMs) return null;
  if (isWithinQuietHours(input.now, input.quiet)) return null;
  return new Date(now);
}

/**
 * The next booking reminder step to send, from `fromIndex` on (steps in
 * position order, each `delay_seconds` read as "this long before the
 * meeting"). Steps with no moment left to send are skipped; null means the
 * run has nothing more to do. Recomputed from the booking's current start on
 * every run, so a rescheduled meeting moves its reminders with it.
 */
export function planBookingReminder(input: {
  startsAt: Date;
  offsetsSeconds: readonly number[];
  fromIndex: number;
  now: Date;
  quiet: QuietHours;
}): { stepIndex: number; at: Date } | null {
  for (let index = Math.max(0, input.fromIndex); index < input.offsetsSeconds.length; index += 1) {
    const at = bookingReminderSendTime({
      startsAt: input.startsAt,
      offsetSeconds: input.offsetsSeconds[index],
      now: input.now,
      quiet: input.quiet,
    });
    if (at) return { stepIndex: index, at };
  }
  return null;
}

/**
 * Warm follow-up merge fields now come from the canonical registry in
 * `@/lib/messaging/merge-fields`. The two helpers below are kept as named
 * exports so the many existing callers do not all have to change, but there is
 * only one list behind them.
 */
export type MergeField = string;

/** Unknown tokens block publishing rather than shipping a broken message. */
export function findUnknownMergeFields(template: string): string[] {
  return unknownTokens(template, "follow-up");
}

export function renderTemplate(
  template: string,
  values: Partial<Record<string, string>>,
): string {
  return renderPreview(template, values, "follow-up");
}
