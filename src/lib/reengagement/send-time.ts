/**
 * Best send time for automated re-engagement (pure).
 *
 * A re-engagement message has no reason to arrive at 03:14 because that is
 * when a timer fired. It goes at the hour this lead has actually replied in
 * before; with no history, at the hour the workspace's leads reply most; and
 * with neither, at a sensible B2B default (Tuesday to Thursday, 10:00 local).
 *
 * Applies to automated re-engagement and campaign sends only. Never to an
 * instant first response, and never to an agent's reply: those go now.
 *
 * The chosen moment is only ever LATER than the trigger's due time, never
 * earlier, and it is always inside the workspace's permitted hours: quiet
 * hours are applied to the result here, and the send gate re-checks them (and
 * the compliance pack's own window) immediately before sending.
 *
 * Pure: no Supabase, no `server-only`.
 */

import { isWithinQuietHours, nextPermittedSendTime, type QuietHours } from "../automation/scheduler.ts";

/** 10:00 local: inside the 9-11am B2B window. */
export const DEFAULT_SEND_HOUR = 10;
/** Tuesday, Wednesday, Thursday (0 = Sunday). */
export const DEFAULT_SEND_DAYS = [2, 3, 4] as const;
/** Monday to Friday, for a lead or workspace with its own history. */
export const BUSINESS_DAYS = [1, 2, 3, 4, 5] as const;
/** Business rules: a learned hour is kept inside the working day. */
export const EARLIEST_SEND_HOUR = 8;
export const LATEST_SEND_HOUR = 18;

/** A lead needs this many replies before their own hour is trusted. */
export const MIN_LEAD_SAMPLES = 2;
/** The workspace needs this many before its hour is trusted. */
export const MIN_WORKSPACE_SAMPLES = 20;

/** How far ahead a best slot is looked for. */
export const SEND_SLOT_HORIZON_DAYS = 14;

export type SendHourSource = "lead" | "workspace" | "default";

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; dow: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(at: Date, timeZone: string): LocalParts {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      hour: Number(get("hour")) % 24,
      minute: Number(get("minute")),
      dow: WEEKDAYS.indexOf(get("weekday")),
    };
  } catch {
    return {
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
      hour: at.getUTCHours(),
      minute: at.getUTCMinutes(),
      dow: at.getUTCDay(),
    };
  }
}

/** The instant a local wall-clock time occurs in `timeZone` (DST-safe to the hour). */
export function zonedInstant(
  local: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, 0, 0);
  let guess = target;
  // Two corrections converge for every real zone (the offset changes at most once near a date).
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const diff = target - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Replies per local hour (0-23). */
export function hourHistogram(times: readonly (string | Date)[], timeZone: string): number[] {
  const histogram = new Array<number>(24).fill(0);
  for (const value of times) {
    const at = new Date(value);
    if (!Number.isFinite(at.getTime())) continue;
    histogram[localParts(at, timeZone).hour] += 1;
  }
  return histogram;
}

/** The busiest hour, earliest on a tie; null for an empty histogram. */
export function modeHour(histogram: readonly number[]): number | null {
  let best: number | null = null;
  for (let hour = 0; hour < histogram.length; hour += 1) {
    if (histogram[hour] > 0 && (best === null || histogram[hour] > histogram[best])) best = hour;
  }
  return best;
}

function withinWorkingDay(hour: number): number {
  return Math.min(LATEST_SEND_HOUR, Math.max(EARLIEST_SEND_HOUR, hour));
}

/**
 * The hour to send at, and where it came from. `leadReplies` are this lead's
 * inbound message times; `workspaceReplies` the workspace's recent ones (or a
 * precomputed histogram).
 */
export function pickSendHour(input: {
  leadReplies: readonly (string | Date)[];
  workspaceHistogram: readonly number[] | null;
  timeZone: string;
}): { hour: number; source: SendHourSource } {
  if (input.leadReplies.length >= MIN_LEAD_SAMPLES) {
    const hour = modeHour(hourHistogram(input.leadReplies, input.timeZone));
    if (hour !== null) return { hour: withinWorkingDay(hour), source: "lead" };
  }
  const workspace = input.workspaceHistogram ?? [];
  const total = workspace.reduce((sum, count) => sum + count, 0);
  if (total >= MIN_WORKSPACE_SAMPLES) {
    const hour = modeHour(workspace);
    if (hour !== null) return { hour: withinWorkingDay(hour), source: "workspace" };
  }
  return { hour: DEFAULT_SEND_HOUR, source: "default" };
}

/**
 * The first moment at or after `notBefore` that falls at `hour`:00 local on a
 * permitted weekday and outside quiet hours. Falls back to the next permitted
 * moment after `notBefore` when no such slot exists within the horizon.
 */
export function nextSendSlot(input: {
  notBefore: Date;
  hour: number;
  source: SendHourSource;
  timeZone: string;
  quietHours: QuietHours;
}): Date {
  const days: readonly number[] = input.source === "default" ? DEFAULT_SEND_DAYS : BUSINESS_DAYS;
  const start = localParts(input.notBefore, input.timeZone);
  const base = Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0);

  for (let offset = 0; offset <= SEND_SLOT_HORIZON_DAYS; offset += 1) {
    const day = new Date(base + offset * 86_400_000);
    const local = { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: input.hour };
    const candidate = zonedInstant(local, input.timeZone);
    if (candidate.getTime() < input.notBefore.getTime()) continue;
    const parts = localParts(candidate, input.timeZone);
    if (!days.includes(parts.dow)) continue;
    if (isWithinQuietHours(candidate, input.quietHours)) continue;
    return candidate;
  }
  return nextPermittedSendTime(input.notBefore, input.quietHours);
}

/** One call for a caller: the hour, then the slot. */
export function bestSendTime(input: {
  notBefore: Date;
  leadReplies: readonly (string | Date)[];
  workspaceHistogram: readonly number[] | null;
  timeZone: string;
  quietHours: QuietHours;
}): { at: Date; hour: number; source: SendHourSource } {
  const pick = pickSendHour(input);
  return {
    ...pick,
    at: nextSendSlot({
      notBefore: input.notBefore,
      hour: pick.hour,
      source: pick.source,
      timeZone: input.timeZone,
      quietHours: input.quietHours,
    }),
  };
}
