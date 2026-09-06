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

/**
 * Checked immediately before every send. A stale scheduled job can never
 * bypass current lead state.
 */
export function evaluateStopConditions(
  lead: LeadState,
  channel: ChannelState,
): StopReason | null {
  if (lead.hasReplied) return "replied";
  if (lead.status === "BOOKED") return "booked";
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
