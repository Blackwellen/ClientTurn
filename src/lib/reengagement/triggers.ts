/**
 * Intent-driven re-engagement triggers (pure).
 *
 * Timers ask "has it been N days?". These ask "did the lead tell us when?":
 *
 *   NOT_NOW_RESUME   the lead said "not now, try in March" (a NOT_NOW signal
 *                    with `resume_at`): a check-in at that time.
 *   DEADLINE_PASSED  the lead named a date or timeframe (a TIMEFRAME signal;
 *                    `flat_until` is the stated date + 7 days): a check-in the
 *                    day after the stated date.
 *   NO_SHOW_REBOOK   a booking marked no-show: a rebooking message with fresh
 *                    times within the hour...
 *   NO_SHOW_NUDGE    ...and one more nudge at 24 hours.
 *   WIN_BACK         a lost deal: one message after a delay chosen by the
 *                    recorded loss reason (lib/leads/close-reasons.ts).
 *   QUOTE_EXPIRED    a quote that ran out unanswered (brief §72): one
 *                    check-in QUOTE_EXPIRED_DELAY_DAYS after it expired,
 *                    offering to refresh it. Never a discount or a new price.
 *
 * This module only decides WHEN and WHETHER. Every trigger is a scheduled job
 * (`reengage.trigger`) that re-reads live state before acting, and every
 * message it produces goes through the one guarded send path: stop
 * conditions, quiet hours, opt-out, suppression, consent (the policy gate) and
 * the cross-loop frequency guard (./frequency.ts) are all re-checked
 * immediately before the carrier is called.
 *
 * Pure: no Supabase, no `server-only`, relative imports with extensions, so
 * `node --test` loads it directly.
 */

import { parseCloseReason, type CloseReasonCategory } from "../leads/close-reasons.ts";

export const REENGAGEMENT_TRIGGERS = [
  "NOT_NOW_RESUME",
  "DEADLINE_PASSED",
  "NO_SHOW_REBOOK",
  "NO_SHOW_NUDGE",
  "WIN_BACK",
  "QUOTE_EXPIRED",
] as const;

export type ReengagementTrigger = (typeof REENGAGEMENT_TRIGGERS)[number];

export function isReengagementTrigger(value: unknown): value is ReengagementTrigger {
  return typeof value === "string" && (REENGAGEMENT_TRIGGERS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ loops --- */

/**
 * Every automated loop the product runs, for measurement and for the
 * frequency guard's record of what a touch was. One vocabulary, used by the
 * send gate, the analytics query and the docs.
 */
export const LOOP_KEYS = [
  "sequence",
  "campaign",
  "reengage_agent",
  "win_back",
  "no_show",
  "not_now_resume",
  "deadline",
  "checkout_nudge",
  "quote_follow_up",
] as const;

export type LoopKey = (typeof LOOP_KEYS)[number];

export const LOOP_LABEL: Record<LoopKey, string> = {
  sequence: "Follow-up sequences",
  campaign: "Reactivation campaigns",
  reengage_agent: "Re-engagement agent",
  win_back: "Win-back (lost deals)",
  no_show: "No-show rebooking",
  not_now_resume: "“Not now” resume",
  deadline: "Stated date passed",
  checkout_nudge: "Abandoned checkout nudges",
  quote_follow_up: "Quote follow-up",
};

export const TRIGGER_LOOP: Record<ReengagementTrigger, LoopKey> = {
  NOT_NOW_RESUME: "not_now_resume",
  DEADLINE_PASSED: "deadline",
  NO_SHOW_REBOOK: "no_show",
  NO_SHOW_NUDGE: "no_show",
  WIN_BACK: "win_back",
  QUOTE_EXPIRED: "quote_follow_up",
};

/* --------------------------------------------------------- send keys --- */

/**
 * Every message a trigger queues carries `reengage:<trigger>:<source id>` as
 * its send key. The key is the idempotency (one message per trigger per
 * source, however often the job runs) and it is how the send gate knows,
 * without another read, which trigger a queued message belongs to -- the same
 * device the booking reminder uses (`booking-reminder:`).
 */
export const REENGAGE_SEND_KEY_PREFIX = "reengage:";

/**
 * The prefix the direct-sale agent's abandoned-checkout nudges use. Queued
 * with origin "automation", a message with this prefix is counted by the
 * frequency guard as a `checkout_nudge` touch and refused or deferred like any
 * other automated touch.
 */
export const CHECKOUT_NUDGE_SEND_KEY_PREFIX = "checkout-nudge:";

export function reengagementSendKey(trigger: ReengagementTrigger, sourceId: string): string {
  return `${REENGAGE_SEND_KEY_PREFIX}${trigger}:${sourceId}`;
}

export function triggerOfSendKey(sendKey: string | null | undefined): ReengagementTrigger | null {
  if (!sendKey || !sendKey.startsWith(REENGAGE_SEND_KEY_PREFIX)) return null;
  const kind = sendKey.slice(REENGAGE_SEND_KEY_PREFIX.length).split(":", 1)[0];
  return isReengagementTrigger(kind) ? kind : null;
}

export function isCheckoutNudgeSendKey(sendKey: string | null | undefined): boolean {
  return Boolean(sendKey && sendKey.startsWith(CHECKOUT_NUDGE_SEND_KEY_PREFIX));
}

/**
 * The agent turn a trigger asks for is keyed `reengage:<trigger>:<source>` as
 * well, so the conversation-agent run it opens (its `idempotency_key`) names
 * the loop it belongs to.
 */
export function reengagementAgentKey(trigger: ReengagementTrigger, sourceId: string): string {
  return `${REENGAGE_SEND_KEY_PREFIX}${trigger}:${sourceId}`;
}

export function triggerOfAgentKey(key: string | null | undefined): ReengagementTrigger | null {
  return triggerOfSendKey(key);
}

/** The job idempotency key: one trigger job per trigger and source. */
export function triggerJobKey(trigger: ReengagementTrigger, sourceId: string): string {
  return `reengage.trigger:${trigger}:${sourceId}`;
}

/* ------------------------------------------------------------ timing --- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * NOT_NOW: the engine re-scores the lead at `resume_at` (the NOT_NOW signal
 * stops holding intent flat then). The check-in goes a little after, so the
 * agent composes from the re-scored state rather than the stale NOT_NOW.
 */
export const NOT_NOW_SETTLE_MS = 30 * MINUTE;

/** A stated deadline: check in the day after the date the lead named. */
export const DEADLINE_GRACE_MS = DAY;

/** TIMEFRAME `flat_until` is the stated date + 7 days (design 08 §B.5). */
export const TIMEFRAME_FLAT_EXTENSION_MS = 7 * DAY;

/** No-show: the rebooking message is due this long after the no-show is recorded... */
export const NO_SHOW_REBOOK_DELAY_MS = 15 * MINUTE;
/** ...and is still worth sending up to this long after (a no-show recorded late). */
export const NO_SHOW_REBOOK_VALID_MS = 12 * HOUR;
/** The one further nudge. */
export const NO_SHOW_NUDGE_DELAY_MS = 24 * HOUR;
export const NO_SHOW_NUDGE_VALID_MS = 72 * HOUR;

/** A trigger whose moment passed this long ago is not sent late. */
export const INTENT_TRIGGER_VALID_MS = 14 * DAY;

/**
 * An expired quote: the check-in waits a week. Long enough not to read as
 * chasing the day it lapsed (the expiry reminder went two days before), short
 * enough that the lead still remembers the quote.
 */
export const QUOTE_EXPIRED_DELAY_DAYS = 7;
/** Still worth sending up to this long after its planned day. */
export const QUOTE_EXPIRED_VALID_MS = 21 * DAY;

/** A quote that expired: one check-in after QUOTE_EXPIRED_DELAY_DAYS. Null without a date. */
export function planQuoteExpired(quote: { id: string; expiredAt: string | null }): TriggerPlan | null {
  const at = valid(quote.expiredAt);
  if (!at) return null;
  const dueAt = new Date(at.getTime() + QUOTE_EXPIRED_DELAY_DAYS * DAY);
  return {
    trigger: "QUOTE_EXPIRED",
    sourceId: quote.id,
    dueAt,
    expiresAt: new Date(dueAt.getTime() + QUOTE_EXPIRED_VALID_MS),
    optimiseSendTime: true,
  };
}

/** Win-back is not planned for a deal lost more than a year ago. */
export const WIN_BACK_MAX_AGE_MS = 365 * DAY;
/** A win-back is still sent up to this long after its planned day. */
export const WIN_BACK_VALID_MS = 30 * DAY;

export type TriggerPlan = {
  trigger: ReengagementTrigger;
  sourceId: string;
  /** The earliest the trigger may act. The send-time chooser may move it later, never earlier. */
  dueAt: Date;
  /** After this the moment has passed and the trigger is not acted on. */
  expiresAt: Date;
  /** Whether best-send-time may move it (not for the time-critical no-show messages). */
  optimiseSendTime: boolean;
};

function valid(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** NOT_NOW with a resume date: a check-in just after it. */
export function planNotNowResume(signal: {
  id: string;
  type: string;
  resume_at: string | null;
  retracted_at?: string | null;
}): TriggerPlan | null {
  if (signal.type !== "NOT_NOW" || signal.retracted_at) return null;
  const resume = valid(signal.resume_at);
  if (!resume) return null;
  const dueAt = new Date(resume.getTime() + NOT_NOW_SETTLE_MS);
  return {
    trigger: "NOT_NOW_RESUME",
    sourceId: signal.id,
    dueAt,
    expiresAt: new Date(dueAt.getTime() + INTENT_TRIGGER_VALID_MS),
    optimiseSendTime: true,
  };
}

/**
 * The date the lead stated, recovered from a TIMEFRAME signal's `flat_until`
 * (stated date + 7 days). Null when the signal carries no date, or the date
 * was not in the future when it was said (a past date is not a deadline).
 */
export function statedDateOf(signal: {
  type: string;
  flat_until: string | null;
  observed_at?: string | null;
}): Date | null {
  if (signal.type !== "TIMEFRAME") return null;
  const flat = valid(signal.flat_until);
  if (!flat) return null;
  const stated = new Date(flat.getTime() - TIMEFRAME_FLAT_EXTENSION_MS);
  const observed = valid(signal.observed_at ?? null);
  if (observed && stated.getTime() <= observed.getTime()) return null;
  return stated;
}

/** A stated deadline passing: a check-in the day after it. */
export function planDeadlineCheckIn(signal: {
  id: string;
  type: string;
  flat_until: string | null;
  observed_at?: string | null;
  retracted_at?: string | null;
}): TriggerPlan | null {
  if (signal.retracted_at) return null;
  const stated = statedDateOf(signal);
  if (!stated) return null;
  const dueAt = new Date(stated.getTime() + DEADLINE_GRACE_MS);
  return {
    trigger: "DEADLINE_PASSED",
    sourceId: signal.id,
    dueAt,
    expiresAt: new Date(dueAt.getTime() + INTENT_TRIGGER_VALID_MS),
    optimiseSendTime: true,
  };
}

/**
 * A no-show: the rebooking message within the hour, then one nudge at 24h.
 * Time-critical, so neither is moved to a "best hour" (quiet hours still
 * apply at send time and defer it).
 */
export function planNoShow(booking: { id: string; noShowAt: string | null }): TriggerPlan[] {
  const at = valid(booking.noShowAt);
  if (!at) return [];
  const rebook = new Date(at.getTime() + NO_SHOW_REBOOK_DELAY_MS);
  const nudge = new Date(at.getTime() + NO_SHOW_NUDGE_DELAY_MS);
  return [
    {
      trigger: "NO_SHOW_REBOOK",
      sourceId: booking.id,
      dueAt: rebook,
      expiresAt: new Date(at.getTime() + NO_SHOW_REBOOK_VALID_MS),
      optimiseSendTime: false,
    },
    {
      trigger: "NO_SHOW_NUDGE",
      sourceId: booking.id,
      dueAt: nudge,
      expiresAt: new Date(at.getTime() + NO_SHOW_NUDGE_VALID_MS),
      optimiseSendTime: false,
    },
  ];
}

/* ---------------------------------------------------------- win-back --- */

/**
 * The delay after a loss, by its recorded reason. Chosen for B2B buying
 * cycles:
 *
 *   Price        75 days (the 60-90 day window: budgets reset, and any
 *                approved offer may now be sent)
 *   Timing       at the time the lead gave, else 90 days
 *   Competitor   120 days (the 90-180 day window: long enough for a new
 *                supplier's first renewal or disappointment)
 *   No response  60 days
 *
 * "No need" is a statement that it is not a fit and is never won back, nor is
 * "Other" (a reason we cannot read is not a reason to message someone), nor a
 * reason whose text says the person asked not to be contacted.
 */
export const WIN_BACK_DELAY_DAYS: Partial<Record<CloseReasonCategory, number>> = {
  Price: 75,
  Timing: 90,
  Competitor: 120,
  "No response": 60,
};

/** Wording in a loss reason that rules a win-back out whatever its category. */
const DO_NOT_WIN_BACK =
  /\b(not a (good )?fit|no fit|asked (us )?not to (be )?contact|do not contact|don'?t contact|stop contacting|remove (me|them)|unsubscribe|opted out|gdpr|wrong person|out of business|closed down|ceased trading|complain)/i;

const INFER: { category: CloseReasonCategory; pattern: RegExp }[] = [
  { category: "Price", pattern: /\b(price|pricing|budget|expensive|cost|afford|cheaper)\b/i },
  { category: "Timing", pattern: /\b(timing|not now|later|next (year|quarter|month)|revisit|on hold|paused)\b/i },
  { category: "Competitor", pattern: /\b(competitor|another (supplier|agency|provider|vendor)|went with|chose (another|someone)|in-house)\b/i },
  { category: "No response", pattern: /\b(no response|stopped (responding|replying)|went quiet|ghosted|unresponsive)\b/i },
];

export type WinBackDecision =
  | { action: "schedule"; category: CloseReasonCategory; delayDays: number; dueAt: Date }
  | { action: "skip"; reason: "not_a_fit" | "do_not_contact" | "unknown_reason" | "too_old" | "no_date" };

/**
 * Whether and when to win a lost deal back.
 *
 * `statedResumeAt` is the lead's own "come back in March" (a NOT_NOW or
 * TIMEFRAME date recorded before the loss); it is used for a Timing loss when
 * it is still in the future.
 */
export function planWinBack(input: {
  reason: string | null | undefined;
  lostAt: string | null | undefined;
  now: Date;
  statedResumeAt?: Date | null;
}): WinBackDecision {
  const lostAt = valid(input.lostAt);
  if (!lostAt) return { action: "skip", reason: "no_date" };
  if (input.now.getTime() - lostAt.getTime() > WIN_BACK_MAX_AGE_MS) return { action: "skip", reason: "too_old" };

  const { category: tagged, text } = parseCloseReason(input.reason);
  const whole = `${input.reason ?? ""}`;
  if (DO_NOT_WIN_BACK.test(whole)) return { action: "skip", reason: "do_not_contact" };

  const category = tagged ?? INFER.find((entry) => entry.pattern.test(text))?.category ?? null;
  if (!category) return { action: "skip", reason: "unknown_reason" };
  if (category === "No need" || category === "Chose us — fit") return { action: "skip", reason: "not_a_fit" };

  const days = WIN_BACK_DELAY_DAYS[category];
  if (!days) return { action: "skip", reason: "unknown_reason" };

  if (
    category === "Timing" &&
    input.statedResumeAt &&
    input.statedResumeAt.getTime() > lostAt.getTime() &&
    input.statedResumeAt.getTime() - lostAt.getTime() <= WIN_BACK_MAX_AGE_MS
  ) {
    return { action: "schedule", category, delayDays: Math.round((input.statedResumeAt.getTime() - lostAt.getTime()) / DAY), dueAt: input.statedResumeAt };
  }

  return { action: "schedule", category, delayDays: days, dueAt: new Date(lostAt.getTime() + days * DAY) };
}

export function winBackPlan(opportunityId: string, decision: Extract<WinBackDecision, { action: "schedule" }>): TriggerPlan {
  return {
    trigger: "WIN_BACK",
    sourceId: opportunityId,
    dueAt: decision.dueAt,
    expiresAt: new Date(decision.dueAt.getTime() + WIN_BACK_VALID_MS),
    optimiseSendTime: true,
  };
}

/* ------------------------------------------------- stop conditions --- */

export type TriggerSkipReason =
  | "disabled"
  | "lead_removed"
  | "test_lead"
  | "opted_out"
  | "human_takeover"
  | "won"
  | "lost"
  | "reopened"
  | "archived"
  | "booked"
  | "rebooked"
  | "replied"
  | "paused"
  | "superseded"
  | "expired";

export type TriggerState = {
  trigger: ReengagementTrigger;
  now: Date;
  expiresAt: Date | null;
  /** The workspace has this trigger switched on. */
  enabled: boolean;
  lead: {
    status: string;
    optedOut: boolean;
    humanTakeover: boolean;
    automationActive: boolean;
    archived: boolean;
    anonymised: boolean;
    isTest: boolean;
  } | null;
  /** The lead sent a message after the source (the signal, the no-show, the loss). */
  repliedSinceSource: boolean;
  /** A meeting was booked after the source. */
  bookedSinceSource: boolean;
  /** Intent triggers: the signal is still the lead's latest of its type, not retracted. */
  sourceCurrent: boolean;
};

/**
 * Re-read immediately before a trigger acts. Any reason here cancels the
 * trigger (it is not retried later); the send gate re-checks the rest --
 * suppression, consent, quiet hours, channel health, frequency -- again at
 * the moment of sending.
 */
export function triggerSkipReason(state: TriggerState): TriggerSkipReason | null {
  const { trigger, lead } = state;
  if (!state.enabled) return "disabled";
  if (!lead || lead.anonymised) return "lead_removed";
  if (lead.isTest) return "test_lead";
  if (state.expiresAt && state.now.getTime() > state.expiresAt.getTime()) return "expired";
  if (lead.optedOut) return "opted_out";
  if (lead.humanTakeover) return "human_takeover";
  if (lead.status === "WON") return "won";
  if (lead.archived) return "archived";
  if (!state.sourceCurrent) return "superseded";

  if (trigger === "WIN_BACK") {
    // Re-opened since (a person is working it again) or rebooked.
    if (lead.status !== "LOST") return "reopened";
    if (state.repliedSinceSource) return "replied";
    if (state.bookedSinceSource) return "booked";
    return null;
  }

  if (lead.status === "LOST") return "lost";

  if (trigger === "NO_SHOW_REBOOK" || trigger === "NO_SHOW_NUDGE") {
    if (state.bookedSinceSource) return "rebooked";
    // They answered: the conversation is live and the agent answers them.
    if (state.repliedSinceSource) return "replied";
    if (!lead.automationActive) return "paused";
    return null;
  }

  // NOT_NOW_RESUME, DEADLINE_PASSED
  if (lead.status === "BOOKED" || state.bookedSinceSource) return "booked";
  if (state.repliedSinceSource) return "replied";
  if (!lead.automationActive) return "paused";
  return null;
}

export const TRIGGER_SKIP_LABEL: Record<TriggerSkipReason, string> = {
  disabled: "switched off for this workspace",
  lead_removed: "the lead no longer exists",
  test_lead: "test lead",
  opted_out: "the lead opted out",
  human_takeover: "a person has taken over the conversation",
  won: "the deal was won",
  lost: "the deal was lost",
  reopened: "the deal was reopened",
  archived: "the lead is archived",
  booked: "the lead has a meeting booked",
  rebooked: "the lead booked a new meeting",
  replied: "the lead has already replied",
  paused: "follow-up is paused for this lead",
  superseded: "the lead has said something newer",
  expired: "the moment has passed",
};

/* ------------------------------------------- why the agent is writing --- */

/**
 * What a check-in agent turn is told about WHY it is writing, from the
 * structured payload the trigger queued (never from free text): the lead's
 * own resume date, the date they gave, the missed meeting, the loss reason.
 * One short line, added to the turn's strategy block by the orchestrator, so
 * the message can say why in the lead's terms ("you mentioned March").
 */
export type ReengagementReason = {
  trigger: ReengagementTrigger;
  /** NOT_NOW_RESUME: the lead's resume date; DEADLINE_PASSED: the date they gave. ISO. */
  date?: string | null;
  /** WIN_BACK: the recorded loss category. */
  lossCategory?: string | null;
};

const REASON_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function reasonDate(value: string | null | undefined): string | null {
  const at = valid(value ?? null);
  return at ? REASON_DATE.format(at) : null;
}

/** The reason a queued check-in carries, read back from an agent event payload. */
export function reengagementReasonOf(payload: Record<string, unknown> | null | undefined): ReengagementReason | null {
  const trigger = payload?.reengagement;
  if (!isReengagementTrigger(trigger)) return null;
  const date = typeof payload?.reengagementDate === "string" ? payload.reengagementDate : null;
  const lossCategory = typeof payload?.lossCategory === "string" ? payload.lossCategory.slice(0, 40) : null;
  return { trigger, date, lossCategory };
}

export function reengagementReasonLine(reason: ReengagementReason): string {
  const date = reasonDate(reason.date);
  let why: string;
  switch (reason.trigger) {
    case "NOT_NOW_RESUME":
      why = date ? `they asked to be contacted around ${date}` : "they asked to be contacted around now";
      break;
    case "DEADLINE_PASSED":
      why = date ? `the date they gave (${date}) has passed` : "the date they gave has passed";
      break;
    case "NO_SHOW_REBOOK":
    case "NO_SHOW_NUDGE":
      why = "they missed their booked meeting; offer to rebook, no blame";
      break;
    case "WIN_BACK":
      why = reason.lossCategory ? `a win-back after a lost deal (reason: ${reason.lossCategory.toLowerCase()})` : "a win-back after a lost deal";
      break;
    case "QUOTE_EXPIRED":
      why = date
        ? `their quote expired on ${date}; offer to refresh it if it is still useful, with no figure and no pressure`
        : "their quote has expired; offer to refresh it if it is still useful, with no figure and no pressure";
      break;
  }
  return `Why you are writing: a planned check-in, because ${why}. Say so in one short clause in their terms.`;
}
