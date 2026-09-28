/**
 * The cross-loop contact-frequency guard (pure).
 *
 * One rule set for every AUTOMATED outbound path: follow-up sequences,
 * reactivation campaigns, the re-engagement agent's campaigns, the
 * intent-driven triggers (NOT_NOW resume, deadline, no-show, win-back), agent
 * turns the lead did not start, and the direct-sale agent's abandoned-checkout
 * nudges. Before it, each loop had its own cadence and none could see the
 * others, so a lead could get a sequence step, a campaign and a win-back on
 * the same morning.
 *
 * What it decides, and where: the send gate (jobs/handlers/send-store.ts
 * `policy()`) calls it immediately before every send, so no loop can go round
 * it. A send over the per-day cap is DEFERRED to when the window frees (up to
 * `DEFER_HORIZON_MS`); a send over the weekly or 30-day cap is SKIPPED with a
 * recorded reason. The "dead lead" rule stops automated loops for a lead who
 * has ignored N automated touches in a row (no reply, no open where opens are
 * known) and whose intent is LOW or below, until they engage again. A person
 * can always still send by hand.
 *
 * Exempt, always: a person's own message, system/transactional messages,
 * booking reminders, and the agent's replies to a message the lead sent. A
 * reply is owed; it is not a "touch".
 *
 * Pure: no Supabase, no `server-only`.
 */

import { isBookingReminderSendKey } from "../automation/scheduler.ts";
import {
  isCheckoutNudgeSendKey,
  TRIGGER_LOOP,
  triggerOfAgentKey,
  triggerOfSendKey,
  type LoopKey,
} from "./triggers.ts";

/* ---------------------------------------------------------- settings --- */

export type FrequencyCaps = {
  /** Automated touches per lead per rolling 24 hours. */
  perDay: number;
  /** Per rolling 7 days. */
  perWeek: number;
  /** Per rolling 30 days. */
  per30Days: number;
  /** Consecutive unanswered automated touches before the dead-lead rule stops loops. */
  deadAfter: number;
};

export const DEFAULT_FREQUENCY_CAPS: FrequencyCaps = {
  perDay: 1,
  perWeek: 3,
  per30Days: 6,
  deadAfter: 4,
};

/**
 * Safe bounds. A workspace may be stricter than the default or modestly
 * looser, never so loose the guard stops meaning anything.
 */
export const FREQUENCY_CAP_BOUNDS = {
  perDay: { min: 1, max: 3 },
  perWeek: { min: 1, max: 7 },
  per30Days: { min: 1, max: 15 },
  deadAfter: { min: 2, max: 10 },
} as const;

function clampOne(value: unknown, key: keyof FrequencyCaps): number {
  const fallback = DEFAULT_FREQUENCY_CAPS[key];
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  const { min, max } = FREQUENCY_CAP_BOUNDS[key];
  return Math.min(max, Math.max(min, number));
}

/**
 * Within bounds and consistent: a weekly cap below the daily one (or a 30-day
 * cap below the weekly one) would make the looser cap meaningless, so the
 * wider window is raised to at least the narrower one.
 */
export function clampFrequencyCaps(raw: Partial<Record<keyof FrequencyCaps, unknown>> | null | undefined): FrequencyCaps {
  const perDay = clampOne(raw?.perDay, "perDay");
  const perWeek = Math.max(perDay, clampOne(raw?.perWeek, "perWeek"));
  const per30Days = Math.max(perWeek, clampOne(raw?.per30Days, "per30Days"));
  return {
    perDay,
    perWeek: Math.min(FREQUENCY_CAP_BOUNDS.perWeek.max, perWeek),
    per30Days: Math.min(FREQUENCY_CAP_BOUNDS.per30Days.max, per30Days),
    deadAfter: clampOne(raw?.deadAfter, "deadAfter"),
  };
}

/* ----------------------------------------------------- classification --- */

export type TouchInput = {
  origin: string;
  sendKey: string | null | undefined;
  /**
   * Agent messages only: the event type that started the agent turn, or null
   * when the run could not be read. `isReplyTrigger` decides whether it
   * answered the lead.
   */
  agentTriggerIsReply?: boolean | null;
  /** Agent messages only: the run's idempotency key, which names a re-engagement trigger. */
  agentRunKey?: string | null;
  /** Campaign messages only: the campaign was drafted by the re-engagement agent. */
  agentDraftedCampaign?: boolean;
};

export type TouchClass =
  | { automated: true; loop: LoopKey }
  | { automated: false; exemptBecause: "manual" | "system" | "agent_reply" | "handover" | "booking_reminder" };

/** Whether a message is an automated touch, and which loop it belongs to. */
export function classifyTouch(input: TouchInput): TouchClass {
  switch (input.origin) {
    case "manual":
      return { automated: false, exemptBecause: "manual" };
    case "system":
      return { automated: false, exemptBecause: "system" };
    case "agent_handover":
      return { automated: false, exemptBecause: "handover" };
    case "campaign":
      return { automated: true, loop: input.agentDraftedCampaign ? "reengage_agent" : "campaign" };
    case "agent": {
      // Unknown run = treated as a reply. The agent is only started by an
      // inbound message except where a trigger asks for a turn, and a trigger
      // always opens a readable run; failing open here can only ever let a
      // reply through, which is the message the lead is owed.
      if (input.agentTriggerIsReply !== false) return { automated: false, exemptBecause: "agent_reply" };
      const trigger = triggerOfAgentKey(input.agentRunKey);
      if (trigger) return { automated: true, loop: TRIGGER_LOOP[trigger] };
      // The direct-sale agent's abandoned-checkout nudges are FOLLOW_UP_DUE
      // turns keyed `checkout-nudge:<attempt>:<n>` (payments/nudge-event.ts).
      if (isCheckoutNudgeSendKey(input.agentRunKey)) return { automated: true, loop: "checkout_nudge" };
      return { automated: true, loop: "sequence" };
    }
    case "automation":
    default: {
      if (isBookingReminderSendKey(input.sendKey)) return { automated: false, exemptBecause: "booking_reminder" };
      const trigger = triggerOfSendKey(input.sendKey);
      if (trigger) return { automated: true, loop: TRIGGER_LOOP[trigger] };
      if (isCheckoutNudgeSendKey(input.sendKey)) return { automated: true, loop: "checkout_nudge" };
      // A quote reminder (quote.nudge sends the quote link again as automation).
      if (isQuoteReminderSendKey(input.sendKey)) return { automated: true, loop: "quote_follow_up" };
      return { automated: true, loop: "sequence" };
    }
  }
}

/** The quote email's send key (quotes/service-core.ts sendQuote: `quote-link:<token hash>`). */
export function isQuoteReminderSendKey(sendKey: string | null | undefined): boolean {
  return Boolean(sendKey && sendKey.startsWith("quote-link:"));
}

/* --------------------------------------------------------- evaluation --- */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/**
 * A send over a cap that frees within this long is deferred to that moment;
 * one that would wait longer is skipped. The per-day cap always frees within
 * 24 hours, so it defers; a full week or month skips.
 */
export const DEFER_HORIZON_MS = 48 * HOUR_MS;

/**
 * The first 72 hours after a lead's enquiry is the response window: the lead
 * has just asked to be contacted, and the follow-up sequence the enquiry
 * started runs to its own cadence (instant, +10 min, +2 h, +1 day, +3 days).
 * Its steps are exempt from the per-day and per-week caps; they still count
 * towards every cap for the other loops, and the 30-day cap and the dead-lead
 * rule still bind them. Without this the default speed-to-lead sequence would
 * be spread over five days and cut at step three.
 */
export const ENQUIRY_WINDOW_MS = 72 * HOUR_MS;

export type FrequencyReason = "daily_cap" | "weekly_cap" | "monthly_cap" | "dead_lead";

export type FrequencyVerdict =
  | { action: "allow" }
  | { action: "defer"; at: Date; reason: FrequencyReason }
  | { action: "skip"; reason: FrequencyReason; message: string };

export const FREQUENCY_REASON_SENTENCE: Record<FrequencyReason, string> = {
  daily_cap: "This lead has already had an automated message in the last 24 hours.",
  weekly_cap: "This lead has reached the weekly limit on automated messages.",
  monthly_cap: "This lead has reached the 30-day limit on automated messages.",
  dead_lead:
    "This lead has not responded to several automated messages in a row, so automated follow-up has stopped until they engage. You can still message them yourself.",
};

/** Intent states the dead-lead rule applies to: LOW or below (INTENT_STATES). */
export const DEAD_LEAD_INTENT_STATES = ["NO_DETECTED_INTENT", "LOW", "NEGATIVE"] as const;

export function intentAtOrBelowLow(intentState: string | null | undefined): boolean {
  if (!intentState) return true;
  return (DEAD_LEAD_INTENT_STATES as readonly string[]).includes(intentState);
}

/**
 * The dead-lead rule. `touchesSinceEngagement` is the automated touches sent
 * since the lead last engaged (a reply, or an open where opens are known).
 * True means stop every automated loop for this lead; it clears itself the
 * moment the lead engages, because the count restarts from that engagement.
 */
export function isDeadLead(input: {
  touchesSinceEngagement: number;
  intentState: string | null | undefined;
  deadAfter: number;
}): boolean {
  return input.touchesSinceEngagement >= input.deadAfter && intentAtOrBelowLow(input.intentState);
}

/** Consecutive automated touches since the lead last engaged. */
export function touchesSinceEngagement(input: {
  automatedSentAt: readonly (string | Date)[];
  lastEngagedAt: string | Date | null | undefined;
}): number {
  const since = input.lastEngagedAt ? new Date(input.lastEngagedAt).getTime() : Number.NEGATIVE_INFINITY;
  return input.automatedSentAt.filter((at) => new Date(at).getTime() > since).length;
}

/**
 * When a window next has room: with `count >= cap` touches inside it, the
 * (count - cap + 1)-th oldest must age out.
 */
function freesAt(sorted: readonly number[], now: number, windowMs: number, cap: number): number {
  const inside = sorted.filter((at) => now - at < windowMs);
  if (inside.length < cap) return now;
  return inside[inside.length - cap] + windowMs;
}

/**
 * The verdict for one automated send.
 *
 * `automatedSentAt` is every automated touch to this lead in the last 30
 * days, whichever loop sent it. The dead-lead rule is checked first: it is the
 * stronger statement.
 */
export function evaluateFrequency(input: {
  now: Date;
  automatedSentAt: readonly (string | Date)[];
  caps: FrequencyCaps;
  /** Consecutive unanswered automated touches (see `touchesSinceEngagement`). */
  touchesSinceEngagement: number;
  intentState: string | null | undefined;
  /** A step of the enquiry's own follow-up sequence inside ENQUIRY_WINDOW_MS. */
  inEnquiryWindow?: boolean;
}): FrequencyVerdict {
  const now = input.now.getTime();

  if (
    isDeadLead({
      touchesSinceEngagement: input.touchesSinceEngagement,
      intentState: input.intentState,
      deadAfter: input.caps.deadAfter,
    })
  ) {
    return { action: "skip", reason: "dead_lead", message: FREQUENCY_REASON_SENTENCE.dead_lead };
  }

  // Oldest first, and only what is actually in the past: a touch "sent" in
  // the future is a clock artefact and must not block anything.
  const sorted = input.automatedSentAt
    .map((at) => new Date(at).getTime())
    .filter((at) => Number.isFinite(at) && at <= now)
    .sort((a, b) => a - b);

  const month = freesAt(sorted, now, MONTH_MS, input.caps.per30Days);
  const week = input.inEnquiryWindow ? now : freesAt(sorted, now, WEEK_MS, input.caps.perWeek);
  const day = input.inEnquiryWindow ? now : freesAt(sorted, now, DAY_MS, input.caps.perDay);

  const earliest = Math.max(month, week, day);
  if (earliest <= now) return { action: "allow" };

  // The binding window: the one that frees last.
  const reason: FrequencyReason = earliest === month ? "monthly_cap" : earliest === week ? "weekly_cap" : "daily_cap";

  if (earliest - now <= DEFER_HORIZON_MS) {
    return { action: "defer", at: new Date(earliest), reason };
  }
  return { action: "skip", reason, message: FREQUENCY_REASON_SENTENCE[reason] };
}

/** Whether an automated send is inside the lead's enquiry response window. */
export function inEnquiryWindow(input: {
  loop: LoopKey;
  leadCreatedAt: string | null | undefined;
  now: Date;
}): boolean {
  if (input.loop !== "sequence" || !input.leadCreatedAt) return false;
  const created = Date.parse(input.leadCreatedAt);
  return Number.isFinite(created) && input.now.getTime() - created < ENQUIRY_WINDOW_MS;
}
