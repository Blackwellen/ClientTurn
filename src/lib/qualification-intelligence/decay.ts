/**
 * Intent signal decay (design 08 §B.5).
 *
 *   strength(t) = s0 * 0.5 ^ (age / halfLife)
 *
 * where `age` is measured from `flat_until` when the signal is held flat
 * (TIMEFRAME until the stated date + 7 d, NOT_NOW until `resume_at`), and from
 * `observed_at` otherwise. A signal is ignored after
 * INTENT_THRESHOLDS.IGNORE_AFTER_HALF_LIVES half-lives, after its hard stop
 * (`expires_at`), or once retracted. `half_life_hours = null` never decays
 * (UNSUBSCRIBE, COMPLAINT).
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports.
 */

import {
  CONTEXT_SIGNAL_TYPES,
  INTENT_THRESHOLDS,
  type IntentSignal,
  type SignalType,
} from "./types.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DAY_H = 24;

export type DecayRule = {
  /** null = does not decay. */
  halfLifeHours: number | null;
  /** Hard stop after observation (or after the flat window), in hours. null = none. */
  hardStopHours: number | null;
  /** How the flat window is set, if the type has one. */
  flat?: "TIMEFRAME" | "NOT_NOW";
};

/**
 * The half-life table (§B.5). Types the design does not list take the row of
 * their nearest sibling, noted inline.
 */
export const DECAY_RULES: Record<SignalType, DecayRule> = {
  // Explicit requests to act: 5 d / 30 d.
  BOOKING_REQUEST: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  DEMO_REQUEST: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  CALLBACK_REQUEST: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  PURCHASE_REQUEST: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  TRIAL_OR_SIGNUP_REQUEST: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  // READY_TO_BUY sits with the purchase requests it is equivalent to.
  READY_TO_BUY: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  // Quote / pricing / ready to meet: 10 d / 45 d.
  QUOTE_REQUEST: { halfLifeHours: 10 * DAY_H, hardStopHours: 45 * DAY_H },
  PRICING_REQUEST: { halfLifeHours: 10 * DAY_H, hardStopHours: 45 * DAY_H },
  READY_TO_MEET: { halfLifeHours: 10 * DAY_H, hardStopHours: 45 * DAY_H },
  // Engaged on price is a pricing conversation.
  PRICING_CONCERN_ENGAGED: { halfLifeHours: 10 * DAY_H, hardStopHours: 45 * DAY_H },
  // Enquiry / problem / implementation: 14 d / 60 d.
  INBOUND_ENQUIRY: { halfLifeHours: 14 * DAY_H, hardStopHours: 60 * DAY_H },
  STATED_PROBLEM: { halfLifeHours: 14 * DAY_H, hardStopHours: 60 * DAY_H },
  IMPLEMENTATION_QUESTION: { halfLifeHours: 14 * DAY_H, hardStopHours: 60 * DAY_H },
  GENERAL_QUESTION: { halfLifeHours: 14 * DAY_H, hardStopHours: 60 * DAY_H },
  URGENCY: { halfLifeHours: 7 * DAY_H, hardStopHours: 30 * DAY_H },
  // Flat until the stated date + 7 d, then 7 d; hard stop at date + 30 d.
  TIMEFRAME: { halfLifeHours: 7 * DAY_H, hardStopHours: 30 * DAY_H, flat: "TIMEFRAME" },
  DISSATISFACTION_CURRENT: { halfLifeHours: 30 * DAY_H, hardStopHours: 120 * DAY_H },
  REPLACEMENT_SEARCH: { halfLifeHours: 30 * DAY_H, hardStopHours: 120 * DAY_H },
  COMPETITOR_COMPARISON: { halfLifeHours: 30 * DAY_H, hardStopHours: 120 * DAY_H },
  // Behavioural: 3 d / 14 d.
  CONVERTING_PAGE_PRICING: { halfLifeHours: 3 * DAY_H, hardStopHours: 14 * DAY_H },
  CONVERTING_PAGE_DEMO: { halfLifeHours: 3 * DAY_H, hardStopHours: 14 * DAY_H },
  REPEAT_SUBMISSION: { halfLifeHours: 3 * DAY_H, hardStopHours: 14 * DAY_H },
  FAST_REPLY: { halfLifeHours: 3 * DAY_H, hardStopHours: 14 * DAY_H },
  BOOKING_LINK_OPENED: { halfLifeHours: 3 * DAY_H, hardStopHours: 14 * DAY_H },
  // Opening a quote again and again is weighing it up: it lasts like a
  // purchase request, not like a page view.
  QUOTE_VIEWED_REPEATEDLY: { halfLifeHours: 5 * DAY_H, hardStopHours: 30 * DAY_H },
  // CONTEXT: freshness_days / 2, stop at the event's expires_at. These are the
  // fallbacks when the category's freshness is unknown (30 d freshness).
  FUNDING: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  HIRING: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  JOB_CHANGE: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  TECH_CHANGE: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  TENDER: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  EXPANSION: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  LEADERSHIP_HIRE: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  KEY_DEPARTURE: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  ACQUISITION: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  REBRAND: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  WEBSITE_RELAUNCH: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  PRODUCT_LAUNCH: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  AWARD: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  PARTNERSHIP: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  FILING_DEADLINE: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  ACCOUNTS_GROWTH: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  CONTRACT_RENEWAL: { halfLifeHours: 15 * DAY_H, hardStopHours: 30 * DAY_H },
  // Refusals: 90 d / 365 d.
  NOT_INTERESTED: { halfLifeHours: 90 * DAY_H, hardStopHours: 365 * DAY_H },
  NO_NEED: { halfLifeHours: 90 * DAY_H, hardStopHours: 365 * DAY_H },
  WRONG_PERSON: { halfLifeHours: 90 * DAY_H, hardStopHours: 365 * DAY_H },
  NON_LEAD: { halfLifeHours: 90 * DAY_H, hardStopHours: 365 * DAY_H },
  OPPORTUNITY_LOST: { halfLifeHours: 90 * DAY_H, hardStopHours: 365 * DAY_H },
  // A missed meeting cools quickly: an ordinary re-engagement lifts it.
  NO_SHOW: { halfLifeHours: 14 * DAY_H, hardStopHours: 60 * DAY_H },
  // Flat until resume_at (default +60 d), hard stop at resume_at.
  NOT_NOW: { halfLifeHours: null, hardStopHours: null, flat: "NOT_NOW" },
  // Never decays; lifted only by a new explicit inbound (intent.ts rule 1).
  UNSUBSCRIBE: { halfLifeHours: null, hardStopHours: null },
  COMPLAINT: { halfLifeHours: null, hardStopHours: null },
};

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/* ------------------------------------------------------- write-side params */

export type DecayParams = {
  half_life_hours: number | null;
  flat_until: string | null;
  expires_at: string | null;
  resume_at: string | null;
};

export type DecayParamsInput = {
  type: SignalType;
  observedAt: string;
  /** TIMEFRAME: the stated date (ISO date or datetime). */
  statedDate?: string | null;
  /** NOT_NOW: when the lead said to come back. Default: +60 d. */
  resumeAt?: string | null;
  /** CONTEXT: the Find Leads category's freshness window, days. */
  freshnessDays?: number | null;
  /** CONTEXT: the source event's own expiry. */
  sourceExpiresAt?: string | null;
};

/**
 * The decay columns for a new signal (lead_intent_signals.half_life_hours,
 * flat_until, expires_at, resume_at). Every value satisfies the table CHECKs:
 * `expires_at > observed_at`, and `resume_at` only for NOT_NOW.
 */
export function decayParamsFor(input: DecayParamsInput): DecayParams {
  const rule = DECAY_RULES[input.type];
  const observed = parse(input.observedAt) ?? Date.now();
  // Anything the table stores after observed_at must be strictly after it.
  const after = (ms: number) => Math.max(ms, observed + HOUR_MS);

  if (rule.flat === "NOT_NOW") {
    const resume = after(parse(input.resumeAt) ?? observed + INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS * DAY_MS);
    return { half_life_hours: null, flat_until: toIso(resume), expires_at: toIso(resume), resume_at: toIso(resume) };
  }

  if (rule.flat === "TIMEFRAME") {
    const stated = parse(input.statedDate);
    if (stated !== null) {
      const flatUntil = after(stated + 7 * DAY_MS);
      return {
        half_life_hours: rule.halfLifeHours,
        flat_until: toIso(flatUntil),
        expires_at: toIso(after(stated + 30 * DAY_MS)),
        resume_at: null,
      };
    }
    // No date: an ordinary 7 d decay.
    return {
      half_life_hours: rule.halfLifeHours,
      flat_until: null,
      expires_at: rule.hardStopHours === null ? null : toIso(after(observed + rule.hardStopHours * HOUR_MS)),
      resume_at: null,
    };
  }

  const category = input.type;
  if ((CONTEXT_SIGNAL_TYPES as readonly string[]).includes(category)) {
    const freshness = input.freshnessDays && input.freshnessDays > 0 ? input.freshnessDays : null;
    const halfLife = freshness ? Math.max(1, Math.round((freshness / 2) * DAY_H)) : rule.halfLifeHours;
    const sourceStop = parse(input.sourceExpiresAt);
    const stop = sourceStop ?? (freshness ? observed + freshness * DAY_MS : observed + (rule.hardStopHours ?? 0) * HOUR_MS);
    return { half_life_hours: halfLife, flat_until: null, expires_at: toIso(after(stop)), resume_at: null };
  }

  return {
    half_life_hours: rule.halfLifeHours,
    flat_until: null,
    expires_at: rule.hardStopHours === null ? null : toIso(after(observed + rule.hardStopHours * HOUR_MS)),
    resume_at: null,
  };
}

/* -------------------------------------------------------------- read side */

type DecaySubject = Pick<
  IntentSignal,
  "type" | "strength" | "observedAt" | "halfLifeHours" | "flatUntil" | "expiresAt" | "retractedAt"
>;

/** When decay starts: the end of the flat window, else observation. */
function decayStart(signal: DecaySubject): number {
  const observed = parse(signal.observedAt) ?? 0;
  const flat = parse(signal.flatUntil);
  return flat !== null && flat > observed ? flat : observed;
}

/** 0..1 multiplier on the signal's strength at `now`. */
export function decayFactor(signal: DecaySubject, now: Date | string): number {
  const at = typeof now === "string" ? (parse(now) ?? Date.now()) : now.getTime();
  if (signal.retractedAt && (parse(signal.retractedAt) ?? Infinity) <= at) return 0;
  const expires = parse(signal.expiresAt);
  if (expires !== null && at >= expires) return 0;
  const observed = parse(signal.observedAt) ?? at;
  // A signal "from the future" (clock skew) counts at full strength.
  if (at <= observed) return 1;
  const start = decayStart(signal);
  if (at <= start) return 1;
  if (signal.halfLifeHours === null || signal.halfLifeHours <= 0) return 1;
  const halfLives = (at - start) / (signal.halfLifeHours * HOUR_MS);
  if (halfLives >= INTENT_THRESHOLDS.IGNORE_AFTER_HALF_LIVES) return 0;
  return Math.pow(0.5, halfLives);
}

/** strength x decay factor, 0..1. */
export function decayedStrength(signal: DecaySubject, now: Date | string): number {
  return Math.max(0, Math.min(1, signal.strength)) * decayFactor(signal, now);
}

/** Still counts at all. */
export function isLive(signal: DecaySubject, now: Date | string): boolean {
  return decayFactor(signal, now) > 0;
}

/**
 * The next instant after `now` at which the assessment of these signals can
 * change: a flat window ending, a hard stop, the ignore cut-off, or the next
 * half-life of a decaying live signal (so a quiet lead is re-assessed as its
 * intent fades, which is what "silence" means here). Also the recency
 * component's own 7 d half-life for the newest positive.
 *
 * Never sooner than `minHours` from now (default 1 h), so a lead cannot be
 * swept in a tight loop. null when nothing will ever change on its own.
 */
export function nextDecayBoundary(
  signals: readonly DecaySubject[],
  now: Date | string,
  opts: { minHours?: number; newestPositiveObservedAt?: string | null } = {},
): string | null {
  const at = typeof now === "string" ? (parse(now) ?? Date.now()) : now.getTime();
  const floor = at + (opts.minHours ?? 1) * HOUR_MS;
  let best: number | null = null;
  const consider = (ms: number | null) => {
    if (ms === null || !Number.isFinite(ms) || ms <= at) return;
    const t = Math.max(ms, floor);
    if (best === null || t < best) best = t;
  };

  for (const signal of signals) {
    if (!isLive(signal, new Date(at))) continue;
    consider(parse(signal.flatUntil));
    consider(parse(signal.expiresAt));
    if (signal.halfLifeHours && signal.halfLifeHours > 0) {
      const start = decayStart(signal);
      const hl = signal.halfLifeHours * HOUR_MS;
      consider(start + INTENT_THRESHOLDS.IGNORE_AFTER_HALF_LIVES * hl);
      if (at >= start) consider(start + Math.ceil((at - start) / hl + 1e-9) * hl);
      else consider(start + hl);
    }
  }

  const newest = parse(opts.newestPositiveObservedAt ?? null);
  if (newest !== null) {
    const hl = INTENT_THRESHOLDS.RECENCY_HALF_LIFE_DAYS * DAY_MS;
    const cutoff = newest + INTENT_THRESHOLDS.IGNORE_AFTER_HALF_LIVES * hl;
    if (at < cutoff) consider(newest + Math.ceil((at - newest) / hl + 1e-9) * hl);
  }

  return best === null ? null : toIso(best);
}

/** Recency multiplier of an instant: 0.5 ^ (ageDays / 7), 0 after 4 half-lives. */
export function recencyFactor(observedAt: string, now: Date | string): number {
  const at = typeof now === "string" ? (parse(now) ?? Date.now()) : now.getTime();
  const observed = parse(observedAt);
  if (observed === null) return 0;
  if (at <= observed) return 1;
  const halfLives = (at - observed) / (INTENT_THRESHOLDS.RECENCY_HALF_LIFE_DAYS * DAY_MS);
  if (halfLives >= INTENT_THRESHOLDS.IGNORE_AFTER_HALF_LIVES) return 0;
  return Math.pow(0.5, halfLives);
}
