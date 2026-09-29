/**
 * Deterministic intent-signal extraction (design 08 §B.3), `sig-1`.
 *
 * Turns what the system already holds lawfully about one lead into
 * lead_intent_signals rows:
 *
 *   source          what it reads                              signal source
 *   --------------  -----------------------------------------  -------------
 *   lead origin     created_via / relationship_type, the       FORM
 *                   form's conversion goal (inbound only)
 *   lead_touches    landing_url (converting page), repeat       TOUCH / FORM
 *                   submissions, the form's own answers
 *   inbound replies the binding deterministic classifier, the   REPLY
 *                   heuristic hints, objection matching and
 *                   the phrase lists below; reply speed
 *   classification  messages.reply_classification: the          CLASSIFICATION
 *                   deterministic layer, or the AI assist's      / AI_ASSIST
 *                   (with its confidence)
 *   bookings        a meeting made; a no-show                  BOOKING
 *   opportunities   a lost deal                                 OPPORTUNITY
 *   opt-out         leads.opted_out                             CLASSIFICATION
 *   Find Leads      a promoted prospect's live intent_events,   SOURCING
 *                   read-only through `contextSignalFromEvent`
 *
 * Nothing else is lawful or available (§D1): there is no site tracking, no
 * pixel and no open tracking, and none is inferred here.
 *
 * Every signal carries a plain-language `reason`, a capped verbatim
 * `evidence_excerpt` (personal data: DSAR-exported, removed on anonymisation),
 * a `source_ref` and a deterministic `dedupe_key`, so a retried job writes
 * nothing twice.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports.
 */

import { classifyDeterministic, classifyHeuristic } from "../agent/classification.ts";
import { matchObjection } from "../sales-library/objections.ts";
import { timelineDays } from "../scoring/answer-features.ts";
import {
  DEDUPE_KEY_MAX,
  SIGNAL_EXCERPT_MAX,
  SIGNAL_REASON_MAX,
  SIGNAL_RULES_VERSION,
  SIGNAL_TYPE_CATEGORY,
  SOURCE_REF_MAX,
  signalPolarity,
  type IntentSignal,
  type IntentSignalWrite,
  type SignalCategory,
  type SignalPolarity,
  type SignalSource,
  type SignalType,
} from "./types.ts";
import { decayParamsFor } from "./decay.ts";

const DAY_MS = 86_400_000;

/* ================================================================ text */

/** One signal found in a piece of text the lead wrote. */
export type TextSignalHit = {
  type: SignalType;
  /** 0..1 at observation. */
  strength: number;
  /** 0..1: how sure the rule is that the words mean this. */
  confidence: number;
  reason: string;
  /** Verbatim, capped at SIGNAL_EXCERPT_MAX. */
  excerpt: string;
  /** NOT_NOW: when they said to come back, ISO. */
  resumeAt: string | null;
  /** TIMEFRAME: the stated date, ISO date. */
  statedDate: string | null;
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** A negation just before the match flips it: "not ready to buy", "we don't need a demo". */
const NEGATION_BEFORE = /\b(not|never|no|don't|dont|do not|isn't|aren't|won't|wouldn't|can't|cannot|haven't|hasn't)\b[^.!?,;]{0,20}$/;

function firstMatch(text: string, pattern: RegExp, allowNegated = false): RegExpExecArray | null {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    if (allowNegated) return m;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (!NEGATION_BEFORE.test(before)) return m;
    if (m[0].length === 0) global.lastIndex += 1;
  }
  return null;
}

/** The sentence around a match, verbatim from the original text, capped. */
function sentenceAround(original: string, needle: string): string {
  const lower = original.toLowerCase().replace(/[‘’]/g, "'");
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) return original.trim().slice(0, SIGNAL_EXCERPT_MAX);
  const start = Math.max(
    0,
    ...[".", "!", "?", "\n"].map((c) => original.lastIndexOf(c, index - 1) + 1),
  );
  const ends = [".", "!", "?", "\n"].map((c) => original.indexOf(c, index + needle.length)).filter((i) => i >= 0);
  const end = ends.length > 0 ? Math.min(...ends) + 1 : original.length;
  return original.slice(start, end).trim().slice(0, SIGNAL_EXCERPT_MAX);
}

function quoteReason(label: string, excerpt: string): string {
  const snippet = excerpt.length > 90 ? `${excerpt.slice(0, 87)}...` : excerpt;
  return `${label}: "${snippet}"`.slice(0, SIGNAL_REASON_MAX);
}

type PhraseRule = { type: SignalType; pattern: RegExp; strength: number; confidence: number; label: string };

/**
 * The phrase rules, deliberately narrow: an unclear message produces no
 * signal rather than a guessed one. Order does not matter; each type is
 * reported once, at its first un-negated match.
 */
export const PHRASE_RULES: readonly PhraseRule[] = [
  {
    type: "BOOKING_REQUEST",
    pattern: /\b(book (a|an|in|me in|us in|a time)|schedule (a|an)|set up a (call|meeting|chat)|arrange a (call|meeting|visit|chat)|when can we (meet|talk|speak)|let'?s (talk|chat|meet|speak)|can we (meet|talk|speak|have a (call|chat))|happy to (meet|chat|jump on a call))\b/,
    strength: 0.9,
    confidence: 0.9,
    label: "Asked to book",
  },
  {
    type: "DEMO_REQUEST",
    pattern: /\b(demo|demonstration|walk ?through|show (me|us) (how|round|around))\b/,
    strength: 0.9,
    confidence: 0.9,
    label: "Asked for a demo",
  },
  {
    type: "CALLBACK_REQUEST",
    pattern: /\b(call me|give (me|us) a (call|ring|bell)|ring me|call (me |us )?back|phone me|can you (call|ring)|please call)\b/,
    strength: 0.9,
    confidence: 0.9,
    label: "Asked for a call back",
  },
  {
    type: "QUOTE_REQUEST",
    pattern: /\b(quote|quotation|estimate|proposal)\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Asked for a quote",
  },
  {
    type: "PRICING_REQUEST",
    pattern: /\b(price|prices|pricing|cost|costs|how much|rates?|fees?|charges?)\b/,
    strength: 0.75,
    confidence: 0.85,
    label: "Asked about price",
  },
  {
    type: "PURCHASE_REQUEST",
    pattern: /\b(i'?d like to (buy|order|purchase)|we'?d like to (buy|order|purchase)|want to (buy|order|purchase)|place an order|go ahead with|proceed with (the|your|this))\b/,
    strength: 0.9,
    confidence: 0.9,
    label: "Asked to buy",
  },
  {
    type: "TRIAL_OR_SIGNUP_REQUEST",
    pattern: /\b(free trial|start (a|the) trial|sign ?up|create an account|set up an account|get started)\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Asked to sign up or trial",
  },
  {
    type: "READY_TO_BUY",
    pattern: /\b(ready to (buy|go|sign|start|proceed|move forward|get going)|let'?s do (it|this)|where do (i|we) sign|send (me |us )?(the |an |your )?(invoice|contract|agreement|paperwork)|happy to proceed|we'?d like to proceed|want to proceed)\b/,
    strength: 0.95,
    confidence: 0.9,
    label: "Said they are ready to buy",
  },
  {
    type: "READY_TO_MEET",
    pattern: /\b((i'?m|we'?re|i am|we are) (free|available) (on|next|this|tomorrow|any)|any ?time (next|this) week|what times? (are|do) you|when are you (free|available)|what'?s your availability)\b/,
    strength: 0.8,
    confidence: 0.85,
    label: "Offered their availability",
  },
  {
    type: "IMPLEMENTATION_QUESTION",
    pattern: /\b(integrat(e|es|ion|ions)|implement(ation)?|onboarding|migrat(e|ion)|how long (does|would|will) (it|setup|set-up|onboarding|the project) take|connect (to|with) (our|my))\b/,
    strength: 0.7,
    confidence: 0.8,
    label: "Asked how it would work for them",
  },
  {
    type: "STATED_PROBLEM",
    pattern: /\b(we need|i need|we'?re struggling|struggling with|problem with|issues? with|looking for (help|someone|an? (agency|partner|provider|developer|studio|company|firm|consultant))|need (some )?help)\b/,
    strength: 0.7,
    confidence: 0.8,
    label: "Described a need",
  },
  {
    type: "URGENCY",
    pattern: /\b(asap|as soon as possible|urgent(ly)?|immediately|right away|straight away|this week)\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Said it is urgent",
  },
  {
    type: "DISSATISFACTION_CURRENT",
    pattern: /\b(unhappy with|not happy with|fed up|frustrat(ed|ing)|let (us |me )?down|disappointed (with|by)|poor (service|support|results|communication)|(current|existing) (agency|provider|supplier|developer|system|platform|software|partner) (is|are|has been|keeps|isn't|doesn't))\b/,
    strength: 0.8,
    confidence: 0.8,
    label: "Unhappy with their current provider",
  },
  {
    type: "REPLACEMENT_SEARCH",
    pattern: /\b(looking (for|to) (a )?(new|replace|switch|change)|switch(ing)? (from|away|provider|agency|supplier)|replac(e|ing) (our|my|the) (current|existing)|moving away from|alternative to|chang(e|ing) (our )?(provider|agency|supplier|developer))\b/,
    strength: 0.8,
    confidence: 0.8,
    label: "Looking to replace their current provider",
  },
  {
    type: "COMPETITOR_COMPARISON",
    pattern: /\b(comparing|compare (you|your|with)|other (quotes|agencies|providers|options|suppliers)|shopping around|getting (a few|some|other|several) quotes|versus)\b/,
    strength: 0.7,
    confidence: 0.8,
    label: "Comparing options",
  },
  {
    type: "NOT_INTERESTED",
    pattern: /\b(not interested|no thanks|no thank you|not for us|we'?ll pass|going to pass)\b/,
    strength: 0.9,
    confidence: 0.9,
    label: "Said they are not interested",
  },
  {
    type: "NO_NEED",
    pattern: /\b(don'?t need|do not need|no need (for|to)|no longer need|already (sorted|have (one|someone|a provider|an agency|a supplier)|found (one|someone))|all sorted|not needed|not required)\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Said they have no need",
  },
  {
    type: "NOT_NOW",
    pattern: /\b(not (right )?now|not ready( yet)?|not at the moment|not at this time|maybe later|not yet|later (in|this) (the )?year|next year|in a (few|couple of) (weeks|months)|get back to (me|us) (in|next|after|later)|circle back|check back (in|next|later)|too busy|after (christmas|the holidays|summer|new year|easter)|revisit (this )?(in|next|later))\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Asked to be contacted later",
  },
  {
    type: "WRONG_PERSON",
    pattern: /\b(wrong person|not the right person|not my (area|department|call|decision)|you (want|need) to (speak|talk) to|speak to (my|our) (colleague|manager|director|boss|partner))\b/,
    strength: 0.85,
    confidence: 0.85,
    label: "Said we have the wrong person",
  },
];

/** Refusal patterns are matched as written: "not interested" is itself the negation. */
const NEGATION_EXEMPT = new Set<SignalType>(["NOT_INTERESTED", "NO_NEED", "NOT_NOW", "WRONG_PERSON", "DISSATISFACTION_CURRENT"]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_PATTERN = /\b(in|by|from|before|after|around|start of|end of|early|late|mid)[ -]?(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The next occurrence of a named month (1st, or the 15th for "mid", the 25th for "end"/"late"). */
function nextMonthDate(monthWord: string, qualifier: string, now: Date): number {
  const month = MONTHS.indexOf(monthWord.slice(0, 3));
  const day = qualifier === "mid" ? 15 : qualifier === "end of" || qualifier === "late" ? 25 : 1;
  let year = now.getUTCFullYear();
  let candidate = Date.UTC(year, month, day);
  if (candidate < now.getTime()) {
    year += 1;
    candidate = Date.UTC(year, month, day);
  }
  return candidate;
}

/** A stated date in the text, ISO, or null. Relative wording is resolved against `now`. */
export function statedDateFrom(text: string, now: Date): string | null {
  const lower = normalise(text);
  const named = MONTH_PATTERN.exec(lower);
  if (named) return isoDate(nextMonthDate(named[2], named[1], now));
  const days = timelineDays(lower);
  if (days === null) return null;
  return isoDate(now.getTime() + days * DAY_MS);
}

/** When a NOT_NOW means to come back, ISO; default INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS (decay.ts). */
export function resumeAtFrom(text: string, now: Date): string | null {
  const lower = normalise(text);
  const n = /\bin (\d{1,2}|a|one|two|three|a few|a couple of) (week|month)s?\b/.exec(lower);
  if (n) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, "a few": 3, "a couple of": 2 };
    const count = /^\d+$/.test(n[1]) ? Number(n[1]) : (words[n[1]] ?? 1);
    return new Date(now.getTime() + count * (n[2] === "week" ? 7 : 30) * DAY_MS).toISOString();
  }
  if (/\bnext month\b/.test(lower)) return new Date(now.getTime() + 30 * DAY_MS).toISOString();
  if (/\bnext (quarter)\b/.test(lower)) return new Date(now.getTime() + 90 * DAY_MS).toISOString();
  if (/\bnext year|in the new year|after (christmas|the holidays|new year)\b/.test(lower)) {
    return new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 8)).toISOString();
  }
  if (/\bafter (summer)\b/.test(lower)) return new Date(nextMonthDate("september", "", now)).toISOString();
  if (/\bafter easter\b/.test(lower)) return new Date(nextMonthDate("may", "", now)).toISOString();
  const named = MONTH_PATTERN.exec(lower);
  if (named) return new Date(nextMonthDate(named[2], named[1], now)).toISOString();
  return null;
}

/** How long before a contract ends the reconnect is planned: time to compare before it renews. */
export const LOCK_IN_RECONNECT_LEAD_DAYS = 42;
const LOCK_IN_MIN_DAYS = 7;
const LOCK_IN_DEFERRAL = /\b(?:locked|tied) (?:in|into)\b|\b(?:until|till|til)\b/;
const LOCK_IN_END =
  /\b(?:until|till|til|ends?|ending|expires?|runs? (?:out|until|till)|renews?|is up|up)\s+(?:in\s+|on\s+|at\s+)?(?:the\s+)?(?:(early|mid|late|end of|start of)\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/;

/**
 * "We're tied into a contract until March": the lead cannot move until a
 * real date, so this is a dated NOT_NOW whose resume date is planned BEFORE
 * the contract ends (LOCK_IN_RECONNECT_LEAD_DAYS, at least a week away), so
 * they have time to compare. The re-engagement triggers plan the reconnect
 * from it (reengagement/triggers.ts planNotNowResume). It is never a
 * contract-terms question and never a hand-over (objections.ts LOCK_IN).
 * Null without a LOCK_IN phrase or without a date.
 */
export function lockInReconnectAt(text: string, now: Date): { endsAt: string; resumeAt: string; evidence: string } | null {
  const lock = matchObjection(text).find((match) => match.key === "LOCK_IN");
  if (!lock) return null;
  const lower = normalise(text);
  // A deferral only: "tied in" / "until March". "Our contract ends next
  // month because support is terrible" is a lead replacing a provider now,
  // never a wait.
  if (!LOCK_IN_DEFERRAL.test(lower)) return null;
  const named = LOCK_IN_END.exec(lower);
  let ends: number | null = named ? nextMonthDate(named[2], named[1] ?? "", now) : null;
  if (ends === null) {
    const stated = statedDateFrom(text, now);
    ends = stated ? Date.parse(stated) : null;
  }
  if (ends === null || !Number.isFinite(ends)) return null;
  // Already inside the comparison window: this is the moment to talk, not a wait.
  if (ends - now.getTime() <= LOCK_IN_RECONNECT_LEAD_DAYS * DAY_MS) return null;
  const resume = Math.max(now.getTime() + LOCK_IN_MIN_DAYS * DAY_MS, ends - LOCK_IN_RECONNECT_LEAD_DAYS * DAY_MS);
  return { endsAt: new Date(ends).toISOString(), resumeAt: new Date(resume).toISOString(), evidence: lock.matched };
}

/**
 * Every signal in one piece of text the lead wrote. Deterministic first:
 * a binding verdict (opt-out, wrong number, complaint, not a lead) returns
 * that one negative signal and nothing else, exactly as the agent runtime
 * treats it.
 */
export function extractTextSignals(text: string, now: Date): TextSignalHit[] {
  const original = (text ?? "").slice(0, 4000);
  const lower = normalise(original);
  if (!lower) return [];

  const hit = (
    type: SignalType,
    strength: number,
    confidence: number,
    label: string,
    needle: string,
    extra: Partial<Pick<TextSignalHit, "resumeAt" | "statedDate">> = {},
  ): TextSignalHit => {
    const excerpt = sentenceAround(original, needle);
    return {
      type,
      strength,
      confidence,
      reason: quoteReason(label, excerpt),
      excerpt,
      resumeAt: extra.resumeAt ?? null,
      statedDate: extra.statedDate ?? null,
    };
  };

  const binding = classifyDeterministic(original);
  if (binding?.binding) {
    const map: Partial<Record<string, [SignalType, string]>> = {
      UNSUBSCRIBE: ["UNSUBSCRIBE", "Asked us to stop contacting them"],
      WRONG_NUMBER: ["WRONG_PERSON", "Said we have the wrong person"],
      COMPLAINT: ["COMPLAINT", "Complained"],
      JOB_APPLICATION: ["NON_LEAD", "Not a buyer (a job application)"],
      SUPPLIER_OR_NON_LEAD: ["NON_LEAD", "Not a buyer (a supplier pitch)"],
    };
    const mapped = map[binding.intent];
    // EMERGENCY and HUMAN_REQUEST are handovers, not intent evidence.
    return mapped ? [hit(mapped[0], 1, 1, mapped[1], original.slice(0, 60))] : [];
  }

  const out = new Map<SignalType, TextSignalHit>();
  const add = (h: TextSignalHit) => {
    if (!out.has(h.type)) out.set(h.type, h);
  };

  for (const rule of PHRASE_RULES) {
    const m = firstMatch(lower, rule.pattern, NEGATION_EXEMPT.has(rule.type));
    if (!m) continue;
    if (rule.type === "NOT_NOW") {
      add(hit(rule.type, rule.strength, rule.confidence, rule.label, m[0], { resumeAt: resumeAtFrom(original, now) }));
    } else {
      add(hit(rule.type, rule.strength, rule.confidence, rule.label, m[0]));
    }
  }

  // The heuristic hints the agent already relies on.
  const heuristic = classifyHeuristic(original);
  if (heuristic?.intent === "BOOKING_REQUEST") add(hit("BOOKING_REQUEST", 0.9, 0.9, "Asked to book", original.slice(0, 60)));
  // The heuristic's NOT_INTERESTED phrases include "not right now" and "not
  // at the moment", which are deferrals: a NOT_NOW already read from the same
  // words is the lead's meaning, never a refusal on top of it (story R1: the
  // refusal made the lead NEGATIVE for a year and the March check-in was
  // never sent). An explicit refusal ("not interested") is a PHRASE_RULE.
  if (heuristic?.intent === "NOT_INTERESTED" && !out.has("NOT_NOW")) {
    add(hit("NOT_INTERESTED", 0.9, 0.9, "Said they are not interested", original.slice(0, 60)));
  }
  if (heuristic?.intent === "PRICE_ENQUIRY") add(hit("PRICING_REQUEST", 0.75, 0.85, "Asked about price", original.slice(0, 60)));
  if (heuristic?.intent === "AVAILABILITY_ENQUIRY") add(hit("READY_TO_MEET", 0.8, 0.85, "Asked about availability", original.slice(0, 60)));

  // Objections (sales-library/objections.ts): engagement, not refusal, except
  // the refusal keys.
  for (const objection of matchObjection(original)) {
    switch (objection.key) {
      case "NOT_INTERESTED":
        add(hit("NOT_INTERESTED", 0.9, 0.85, "Said they are not interested", objection.matched));
        break;
      case "NO_NEED":
        add(hit("NO_NEED", 0.85, 0.8, "Said they have no need", objection.matched));
        break;
      case "TIMING":
      case "TOO_BUSY":
      case "CALL_LATER":
        add(hit("NOT_NOW", 0.8, 0.8, "Asked to be contacted later", objection.matched, { resumeAt: resumeAtFrom(original, now) }));
        break;
      case "LOCK_IN": {
        // A dated lock-in: reconnect before the contract ends.
        const lock = lockInReconnectAt(original, now);
        if (lock) add(hit("NOT_NOW", 0.8, 0.8, "Tied into a contract: reconnect before it ends", objection.matched, { resumeAt: lock.resumeAt }));
        break;
      }
      case "COMPETITOR":
      case "EXISTING_PROVIDER":
      case "SWITCHING_COST":
        add(hit("COMPETITOR_COMPARISON", 0.6, 0.75, "Weighing us against another provider", objection.matched));
        break;
      case "PRICE":
      case "BUDGET":
        add(hit("PRICING_CONCERN_ENGAGED", 0.5, 0.75, "Engaged on price", objection.matched));
        break;
      default:
        break;
    }
  }

  // A stated timeframe, unless the message is a deferral (NOT_NOW carries its own date).
  if (!out.has("NOT_NOW") && !out.has("NOT_INTERESTED") && !out.has("NO_NEED")) {
    const stated = statedDateFrom(original, now);
    if (stated) {
      const days = Math.max(0, (Date.parse(stated) - now.getTime()) / DAY_MS);
      const strength = days <= 30 ? 0.8 : days <= 90 ? 0.6 : days <= 180 ? 0.4 : 0.2;
      add(hit("TIMEFRAME", strength, 0.8, `Gave a timeframe (${stated})`, original.slice(0, 60), { statedDate: stated }));
    }
  }

  // A question with nothing more specific is still information-seeking.
  if (lower.includes("?") && out.size === 0) {
    add(hit("GENERAL_QUESTION", 0.5, 0.8, "Asked a question", original.slice(0, 80)));
  }

  return [...out.values()];
}

/* ============================================================ builders */

export type SignalDraft = {
  leadId: string;
  serviceId?: string | null;
  type: SignalType;
  strength: number;
  confidence: number;
  source: SignalSource;
  sourceRef: string | null;
  observedAt: string;
  reason: string;
  excerpt?: string | null;
  statedDate?: string | null;
  resumeAt?: string | null;
  freshnessDays?: number | null;
  sourceExpiresAt?: string | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** The deterministic dedupe key: one signal per (lead, source, source event, type). */
export function signalDedupeKey(leadId: string, source: SignalSource, sourceRef: string | null, type: SignalType): string {
  return `${leadId}:${source}:${sourceRef ?? "-"}:${type}`.slice(0, DEDUPE_KEY_MAX);
}

/** A complete lead_intent_signals write (every column set; the zod defaults are not relied on). */
export function buildSignalWrite(d: SignalDraft): IntentSignalWrite {
  const observedAt = new Date(Date.parse(d.observedAt) || Date.now()).toISOString();
  const decay = decayParamsFor({
    type: d.type,
    observedAt,
    statedDate: d.statedDate ?? null,
    resumeAt: d.resumeAt ?? null,
    freshnessDays: d.freshnessDays ?? null,
    sourceExpiresAt: d.sourceExpiresAt ?? null,
  });
  const ref = d.sourceRef ? d.sourceRef.slice(0, SOURCE_REF_MAX) : null;
  return {
    lead_id: d.leadId,
    service_id: d.serviceId ?? null,
    category: SIGNAL_TYPE_CATEGORY[d.type],
    signal_type: d.type,
    polarity: signalPolarity(d.type),
    strength: clamp01(d.strength),
    confidence: clamp01(d.confidence),
    source: d.source,
    source_ref: ref,
    observed_at: observedAt,
    half_life_hours: decay.half_life_hours,
    flat_until: decay.flat_until,
    expires_at: decay.expires_at,
    resume_at: decay.resume_at,
    reason: (d.reason || d.type).slice(0, SIGNAL_REASON_MAX),
    evidence_excerpt: d.excerpt ? d.excerpt.slice(0, SIGNAL_EXCERPT_MAX) : null,
    dedupe_key: signalDedupeKey(d.leadId, d.source, ref, d.type),
    rule_version: SIGNAL_RULES_VERSION,
  };
}

/* ============================================================= sources */

export type LeadOriginInput = {
  leadId: string;
  serviceId: string | null;
  createdAt: string;
  createdVia: string | null;
  relationshipType: string | null;
  conversionGoalType: string | null;
  optedOut: boolean;
  /** When the opt-out was first seen; the lead's updated_at is an acceptable stand-in. */
  optedOutObservedAt: string | null;
};

export type TouchInput = {
  id: string;
  occurredAt: string;
  sourceType: string;
  landingUrl: string | null;
  /** lead_touches.answers: question label -> answer text. */
  answers: Record<string, unknown> | null;
  ingestOutcome: string | null;
};

export type InboundMessageInput = {
  id: string;
  body: string | null;
  createdAt: string;
  replyClassification: string | null;
  /** null or 1 = the deterministic layer; below 1 = the AI assist's own confidence. */
  replyConfidence: number | null;
  /** Our last outbound message before this one, for FAST_REPLY. */
  previousOutboundAt: string | null;
};

export type BookingInput = { id: string; status: string; createdAt: string; startsAt: string | null };

export type OpportunityInput = { id: string; outcome: string; closedAt: string | null; updatedAt: string; outcomeReason: string | null };

/** A Find Leads intent event for the prospect this lead was promoted from. Read-only. */
export type ContextEventInput = {
  id: string;
  /** intent_events.signal_type: a Find Leads SignalSourceKey (JOB_POSTING, TENDER_NOTICE, ...). */
  sourceKey: string;
  observedAt: string;
  expiresAt: string;
  confidence: number;
  scoreImpact: number;
  evidenceSummary: string | null;
  categoryName: string | null;
  freshnessDays: number | null;
  /** The find-leads catalogue type the event evidences (intent-evidence.ts parseIntentDedupeKey), when recorded. */
  intentType?: string | null;
};

export type LeadSignalInput = {
  origin: LeadOriginInput;
  touches: TouchInput[];
  inbound: InboundMessageInput[];
  bookings: BookingInput[];
  opportunities: OpportunityInput[];
  contextEvents: ContextEventInput[];
};

/** How a lead that contacted the business arrives (scoring/service.ts uses the same sets). */
const INBOUND_CREATED_VIA = new Set(["INBOUND", "API"]);
const INBOUND_RELATIONSHIPS = new Set(["THEY_CONTACTED_US", "REQUESTED_INFORMATION"]);
/** Touch types that are the person's own act, as opposed to an import. */
const LEAD_ORIGINATED_TOUCHES = new Set(["AD_FORM", "WEB_FORM", "SOCIAL_DM", "API", "CONNECTOR"]);

const GOAL_SIGNAL: Partial<Record<string, SignalType>> = {
  BOOK_DEMO: "DEMO_REQUEST",
  BOOK_APPOINTMENT: "BOOKING_REQUEST",
  BOOK_SITE_VISIT: "BOOKING_REQUEST",
  PHONE_CALL: "CALLBACK_REQUEST",
  REQUEST_QUOTE: "QUOTE_REQUEST",
  DIRECT_PURCHASE: "PURCHASE_REQUEST",
  DIRECT_SIGNUP: "TRIAL_OR_SIGNUP_REQUEST",
};

const PRICING_PAGE = /\/(pricing|prices|plans|cost|costs|packages)(\/|$|\?|#|-)/i;
const DEMO_PAGE = /\/(demo|book|booking|contact-sales|talk-to-sales|get-started|trial|schedule)(\/|$|\?|#|-)/i;

export function isInboundOrigin(origin: Pick<LeadOriginInput, "createdVia" | "relationshipType">): boolean {
  return INBOUND_CREATED_VIA.has(origin.createdVia ?? "") || INBOUND_RELATIONSHIPS.has(origin.relationshipType ?? "");
}

/** The lead contacted the business; the form's conversion goal is what they asked for. */
export function originSignals(origin: LeadOriginInput, touches: TouchInput[]): IntentSignalWrite[] {
  const out: IntentSignalWrite[] = [];
  const firstOwn = [...touches]
    .filter((t) => LEAD_ORIGINATED_TOUCHES.has(t.sourceType))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))[0];
  const inbound = isInboundOrigin(origin) || Boolean(firstOwn);
  if (!inbound) return out;

  const ref = firstOwn?.id ?? origin.leadId;
  const observedAt = firstOwn?.occurredAt ?? origin.createdAt;
  out.push(
    buildSignalWrite({
      leadId: origin.leadId,
      serviceId: origin.serviceId,
      type: "INBOUND_ENQUIRY",
      strength: 0.7,
      confidence: 1,
      source: "FORM",
      sourceRef: ref,
      observedAt,
      reason: "Contacted the business themselves",
    }),
  );
  // The conversion goal is what the lead asked for only when it came with
  // their own act: a form, a DM, the API or a connector (created INBOUND/API
  // or a lead-originated touch). A goal a person picked in the Add Lead
  // wizard is where the business routes the lead, not the lead's request.
  // Live voice QA 2026-09-29: both wizard-added test leads were stored
  // "Submitted a direct purchase form" (0.8), assessed PURCHASE_READY before
  // a word was said, and the calls skipped straight to "a colleague will send
  // the details". They still count as an inbound enquiry.
  const ownAct = INBOUND_CREATED_VIA.has(origin.createdVia ?? "") || Boolean(firstOwn);
  const goalType = ownAct && origin.conversionGoalType ? GOAL_SIGNAL[origin.conversionGoalType] : undefined;
  if (goalType) {
    out.push(
      buildSignalWrite({
        leadId: origin.leadId,
        serviceId: origin.serviceId,
        type: goalType,
        strength: 0.8,
        confidence: 0.9,
        source: "FORM",
        sourceRef: ref,
        observedAt,
        reason: `Submitted a ${origin.conversionGoalType!.toLowerCase().replace(/_/g, " ")} form`,
      }),
    );
  }
  return out;
}

/** Converting pages, repeat submissions and the words in the form's own answers. */
export function touchSignals(origin: LeadOriginInput, touches: TouchInput[], now: Date): IntentSignalWrite[] {
  const out: IntentSignalWrite[] = [];
  const own = [...touches]
    .filter((t) => LEAD_ORIGINATED_TOUCHES.has(t.sourceType))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.id < b.id ? -1 : 1));

  own.forEach((touch, index) => {
    const base = { leadId: origin.leadId, serviceId: origin.serviceId, sourceRef: touch.id, observedAt: touch.occurredAt };
    const url = touch.landingUrl ?? "";
    if (url && PRICING_PAGE.test(url)) {
      out.push(buildSignalWrite({ ...base, type: "CONVERTING_PAGE_PRICING", strength: 0.7, confidence: 0.9, source: "TOUCH", reason: "Enquired from a pricing page" }));
    }
    if (url && DEMO_PAGE.test(url)) {
      out.push(buildSignalWrite({ ...base, type: "CONVERTING_PAGE_DEMO", strength: 0.7, confidence: 0.9, source: "TOUCH", reason: "Enquired from a demo or booking page" }));
    }
    if (index > 0) {
      out.push(buildSignalWrite({ ...base, type: "REPEAT_SUBMISSION", strength: 0.7, confidence: 1, source: "TOUCH", reason: `Enquired again (${index + 1} submissions)` }));
    }

    // Form answers are the lead's own words. Only positive intent and a stated
    // timeframe are read from them: a form field such as "Do not call before
    // 6pm" is a preference, not an opt-out or a refusal.
    const text = Object.values(touch.answers ?? {})
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map(String)
      .join(". ")
      .slice(0, 2000);
    if (!text.trim()) return;
    for (const h of extractTextSignals(text, new Date(Date.parse(touch.occurredAt) || now.getTime()))) {
      if (signalPolarity(h.type) === "NEGATIVE") continue;
      out.push(
        buildSignalWrite({
          ...base,
          type: h.type,
          strength: h.strength,
          confidence: h.confidence,
          source: "FORM",
          reason: h.reason,
          excerpt: h.excerpt,
          statedDate: h.statedDate,
        }),
      );
    }
  });
  return out;
}

/** reply_classification -> signal (the deterministic layer or the AI assist). */
const CLASSIFICATION_SIGNAL: Partial<Record<string, { type: SignalType; strength: number; reason: string }>> = {
  BOOKING_INTENT: { type: "BOOKING_REQUEST", strength: 0.85, reason: "Reply classified as a booking request" },
  POSITIVE_INTEREST: { type: "INBOUND_ENQUIRY", strength: 0.6, reason: "Replied with interest" },
  NEUTRAL_QUESTION: { type: "GENERAL_QUESTION", strength: 0.5, reason: "Replied with a question" },
  NOT_NOW: { type: "NOT_NOW", strength: 0.8, reason: "Reply classified as not now" },
  NOT_INTERESTED: { type: "NOT_INTERESTED", strength: 0.9, reason: "Reply classified as not interested" },
  WRONG_PERSON: { type: "WRONG_PERSON", strength: 0.85, reason: "Reply classified as wrong person" },
  REFERRAL_TO_OTHER_PERSON: { type: "WRONG_PERSON", strength: 0.6, reason: "Referred us to someone else" },
  UNSUBSCRIBE: { type: "UNSUBSCRIBE", strength: 1, reason: "Reply classified as an opt-out" },
  COMPLAINT: { type: "COMPLAINT", strength: 1, reason: "Reply classified as a complaint" },
};

/** Below this the AI assist's classification is not stored as evidence at all. */
export const AI_CLASSIFICATION_MIN_CONFIDENCE = 0.6;
const FAST_REPLY_MS = 10 * 60_000;

/** Signals from the lead's inbound replies: their words, the classification, and reply speed. */
export function replySignals(origin: LeadOriginInput, inbound: InboundMessageInput[], now: Date): IntentSignalWrite[] {
  const out: IntentSignalWrite[] = [];
  for (const message of inbound) {
    const base = { leadId: origin.leadId, serviceId: origin.serviceId, sourceRef: message.id, observedAt: message.createdAt };
    const observed = new Date(Date.parse(message.createdAt) || now.getTime());
    const hits = extractTextSignals(message.body ?? "", observed);
    const seen = new Set<SignalType>();
    for (const h of hits) {
      seen.add(h.type);
      out.push(
        buildSignalWrite({
          ...base,
          type: h.type,
          strength: h.strength,
          confidence: h.confidence,
          source: "REPLY",
          reason: h.reason,
          excerpt: h.excerpt,
          statedDate: h.statedDate,
          resumeAt: h.resumeAt,
        }),
      );
    }

    const mapped = message.replyClassification ? CLASSIFICATION_SIGNAL[message.replyClassification] : undefined;
    if (mapped && !seen.has(mapped.type)) {
      const conf = message.replyConfidence;
      const ai = conf !== null && conf !== undefined && conf < 1;
      if (!ai || conf >= AI_CLASSIFICATION_MIN_CONFIDENCE) {
        out.push(
          buildSignalWrite({
            ...base,
            type: mapped.type,
            strength: mapped.strength,
            confidence: ai ? conf : 0.9,
            source: ai ? "AI_ASSIST" : "CLASSIFICATION",
            reason: mapped.reason,
            resumeAt: mapped.type === "NOT_NOW" ? resumeAtFrom(message.body ?? "", observed) : null,
          }),
        );
      }
    }

    if (message.previousOutboundAt) {
      const gap = Date.parse(message.createdAt) - Date.parse(message.previousOutboundAt);
      const negativeReply = hits.some((h) => signalPolarity(h.type) === "NEGATIVE");
      if (Number.isFinite(gap) && gap >= 0 && gap <= FAST_REPLY_MS && !negativeReply) {
        out.push(
          buildSignalWrite({
            ...base,
            type: "FAST_REPLY",
            strength: 0.6,
            confidence: 1,
            source: "REPLY",
            reason: `Replied within ${Math.max(1, Math.round(gap / 60_000))} minutes`,
          }),
        );
      }
    }
  }
  return out;
}

/** A meeting made is readiness to meet; a missed one is a (decaying) negative. */
export function bookingSignals(origin: LeadOriginInput, bookings: BookingInput[]): IntentSignalWrite[] {
  const out: IntentSignalWrite[] = [];
  for (const booking of bookings) {
    const base = { leadId: origin.leadId, serviceId: origin.serviceId, sourceRef: booking.id, source: "BOOKING" as const };
    if (booking.status === "scheduled" || booking.status === "completed") {
      out.push(buildSignalWrite({ ...base, type: "READY_TO_MEET", strength: 0.9, confidence: 1, observedAt: booking.createdAt, reason: "Booked a meeting" }));
    } else if (booking.status === "no_show") {
      out.push(
        buildSignalWrite({
          ...base,
          type: "NO_SHOW",
          strength: 0.8,
          confidence: 1,
          observedAt: booking.startsAt ?? booking.createdAt,
          reason: "Missed a booked meeting",
        }),
      );
    }
  }
  return out;
}

export function opportunitySignals(origin: LeadOriginInput, opportunities: OpportunityInput[]): IntentSignalWrite[] {
  return opportunities
    .filter((o) => o.outcome === "LOST")
    .map((o) =>
      buildSignalWrite({
        leadId: origin.leadId,
        serviceId: origin.serviceId,
        type: "OPPORTUNITY_LOST",
        strength: 0.8,
        confidence: 1,
        source: "OPPORTUNITY",
        sourceRef: o.id,
        observedAt: o.closedAt ?? o.updatedAt,
        reason: o.outcomeReason ? `Deal lost: ${o.outcomeReason}`.slice(0, SIGNAL_REASON_MAX) : "Deal marked lost",
      }),
    );
}

/** leads.opted_out mirrored as a signal (it never decays; intent rule 1). */
export function optOutSignals(origin: LeadOriginInput): IntentSignalWrite[] {
  if (!origin.optedOut) return [];
  return [
    buildSignalWrite({
      leadId: origin.leadId,
      serviceId: origin.serviceId,
      type: "UNSUBSCRIBE",
      strength: 1,
      confidence: 1,
      source: "CLASSIFICATION",
      sourceRef: `lead-optout:${origin.leadId}`,
      observedAt: origin.optedOutObservedAt ?? origin.createdAt,
      reason: "Opted out of contact",
    }),
  ];
}

/* ------------------------------------------------ Find Leads (read-only) */

const CONTEXT_KEYWORDS: [SignalType, RegExp][] = [
  ["FUNDING", /\b(fund(ing|ed|raise)?|raised|investment|investor|series [a-e]|seed round|grant)\b/i],
  ["TENDER", /\b(tender|procurement|rfp|rfq|contract notice|invitation to bid)\b/i],
  ["HIRING", /\b(hir(e|es|ed|ing)|recruit(ing|ment)?|job (posting|advert|ad)|vacanc(y|ies)|headcount)\b/i],
  ["JOB_CHANGE", /\b(appoint(ed|ment)|new (ceo|cto|cfo|cmo|director|head|vp|founder)|joined as|promot(ed|ion)|officer change)\b/i],
  ["TECH_CHANGE", /\b(migrat(e|ing|ion)|re-?platform|switch(ed|ing) to|adopt(ed|ing)|implement(ed|ing)|tech(nology)? stack|new (website|platform|crm|erp))\b/i],
];

/**
 * The find-leads intent catalogue type (find-leads/intent-catalogue.ts,
 * recovered from the event's dedupe key) carried into lead context. Checked
 * before the wording: the catalogue type is what the source evidenced.
 */
export const CONTEXT_BY_INTENT_TYPE: Readonly<Record<string, SignalType>> = {
  SEED_ROUND: "FUNDING",
  SERIES_A: "FUNDING",
  SERIES_B: "FUNDING",
  SERIES_C_PLUS: "FUNDING",
  CAPITAL_RAISED: "FUNDING",
  GRANT_AWARDED: "FUNDING",
  DEBT_FINANCE: "FUNDING",
  IPO_LISTING: "FUNDING",
  NEW_INVESTOR: "FUNDING",
  ACQUISITION_MERGER: "ACQUISITION",
  SENIOR_HIRE_C_LEVEL: "LEADERSHIP_HIRE",
  SENIOR_HIRE_VP: "LEADERSHIP_HIRE",
  SENIOR_HIRE_HEAD_OF: "LEADERSHIP_HIRE",
  LEADERSHIP_CHANGE: "LEADERSHIP_HIRE",
  NEW_DIRECTOR: "LEADERSHIP_HIRE",
  KEY_DEPARTURE: "KEY_DEPARTURE",
  PERSONAL_JOB_CHANGE: "JOB_CHANGE",
  TEAM_GROWTH: "HIRING",
  HIRING_ROLE: "HIRING",
  HIRING_SPIKE: "HIRING",
  FIRST_HIRE_IN_FUNCTION: "HIRING",
  NEW_OFFICE: "EXPANSION",
  REGION_EXPANSION: "EXPANSION",
  HEADCOUNT_GROWTH: "EXPANSION",
  PRODUCT_LAUNCH: "PRODUCT_LAUNCH",
  REBRAND: "REBRAND",
  WEBSITE_RELAUNCH: "WEBSITE_RELAUNCH",
  AWARD_ACCREDITATION: "AWARD",
  NEW_PARTNERSHIP: "PARTNERSHIP",
  TECH_ADOPTED: "TECH_CHANGE",
  TECH_REPLACED: "TECH_CHANGE",
  PLATFORM_OUTGROWN: "TECH_CHANGE",
  TENDER_PUBLISHED: "TENDER",
  REGULATORY_DEADLINE: "FILING_DEADLINE",
  CONTRACT_RENEWAL_WINDOW: "CONTRACT_RENEWAL",
  ACCOUNTS_GROWTH: "ACCOUNTS_GROWTH",
};

/** Fallback by the Find Leads source family when the wording says nothing. */
const CONTEXT_BY_SOURCE: Partial<Record<string, SignalType>> = {
  JOB_POSTING: "HIRING",
  TENDER_NOTICE: "TENDER",
};

/**
 * The narrow read-only adapter onto Find Leads' `intent_events` (design §D9):
 * one event -> one CONTEXT signal, or null when it does not map. Only the
 * permitted source families are accepted; first-party web, CRM activity, ad
 * engagement and bought datasets are not lead-level intent evidence here.
 */
export function contextSignalTypeFor(
  event: Pick<ContextEventInput, "sourceKey" | "categoryName" | "evidenceSummary"> & { intentType?: string | null },
): SignalType | null {
  const permitted = new Set(["COMPANY_WEBSITE", "COMPANY_REGISTRY", "TENDER_NOTICE", "PLANNING_DATA", "NEWS_FEED", "JOB_POSTING"]);
  if (!permitted.has(event.sourceKey)) return null;
  const byType = event.intentType ? CONTEXT_BY_INTENT_TYPE[event.intentType] : undefined;
  if (byType) return byType;
  const text = `${event.categoryName ?? ""} ${event.evidenceSummary ?? ""}`;
  for (const [type, pattern] of CONTEXT_KEYWORDS) if (pattern.test(text)) return type;
  return CONTEXT_BY_SOURCE[event.sourceKey] ?? null;
}

export function contextSignals(origin: LeadOriginInput, events: ContextEventInput[], now: Date): IntentSignalWrite[] {
  const out: IntentSignalWrite[] = [];
  for (const event of events) {
    if (Date.parse(event.expiresAt) <= now.getTime()) continue;
    if (Date.parse(event.expiresAt) <= Date.parse(event.observedAt)) continue;
    const type = contextSignalTypeFor(event);
    if (!type) continue;
    out.push(
      buildSignalWrite({
        leadId: origin.leadId,
        serviceId: origin.serviceId,
        type,
        // 25 is Find Leads' MAX_SCORE_IMPACT: one maxed category is full strength.
        strength: Math.max(0.3, Math.min(1, event.scoreImpact / 25)),
        confidence: event.confidence,
        source: "SOURCING",
        sourceRef: event.id,
        observedAt: event.observedAt,
        reason: `Find Leads: ${(event.categoryName ?? type.toLowerCase()).slice(0, 80)} (${event.sourceKey.toLowerCase().replace(/_/g, " ")})`,
        freshnessDays: event.freshnessDays,
        sourceExpiresAt: event.expiresAt,
      }),
    );
  }
  return out;
}

/* ================================================================ all */

/**
 * Every signal for one lead from every lawful source, deduplicated by
 * dedupe_key (first wins). Deterministic for the same input and `now`.
 */
export function extractLeadSignals(input: LeadSignalInput, now: Date): IntentSignalWrite[] {
  const all = [
    ...originSignals(input.origin, input.touches),
    ...touchSignals(input.origin, input.touches, now),
    ...replySignals(input.origin, input.inbound, now),
    ...bookingSignals(input.origin, input.bookings),
    ...opportunitySignals(input.origin, input.opportunities),
    ...optOutSignals(input.origin),
    ...contextSignals(input.origin, input.contextEvents, now),
  ];
  const byKey = new Map<string, IntentSignalWrite>();
  for (const s of all) if (!byKey.has(s.dedupe_key)) byKey.set(s.dedupe_key, s);
  return [...byKey.values()];
}

/**
 * One interpreted signal (interpret() output, §B.11) as a write. A2's
 * interpretation and the orchestrator write-back use this, so an interpreted
 * signal and an extracted one share one dedupe key per (message, type).
 */
export function interpretedSignalToWrite(input: {
  leadId: string;
  serviceId: string | null;
  messageId: string;
  observedAt: string;
  aiAssist: boolean;
  signal: {
    signal_type: SignalType;
    strength: number;
    confidence: number;
    reason: string;
    evidence_excerpt: string | null;
    resume_at: string | null;
    stated_date: string | null;
  };
}): IntentSignalWrite {
  return buildSignalWrite({
    leadId: input.leadId,
    serviceId: input.serviceId,
    type: input.signal.signal_type,
    strength: input.signal.strength,
    confidence: input.signal.confidence,
    source: input.aiAssist ? "AI_ASSIST" : "REPLY",
    sourceRef: input.messageId,
    observedAt: input.observedAt,
    reason: input.signal.reason,
    excerpt: input.signal.evidence_excerpt,
    statedDate: input.signal.stated_date,
    resumeAt: input.signal.resume_at,
  });
}

/** Stored row -> the engine's camelCase shape. */
export function signalFromRow(row: {
  id: string;
  lead_id: string;
  service_id: string | null;
  category: string;
  signal_type: string;
  polarity: string;
  strength: number | string;
  confidence: number | string;
  source: string;
  source_ref: string | null;
  observed_at: string;
  half_life_hours: number | null;
  flat_until: string | null;
  expires_at: string | null;
  resume_at: string | null;
  reason: string;
  evidence_excerpt: string | null;
  rule_version: string;
  retracted_at: string | null;
}): IntentSignal {
  return {
    id: row.id,
    leadId: row.lead_id,
    serviceId: row.service_id,
    category: row.category as SignalCategory,
    type: row.signal_type as SignalType,
    polarity: row.polarity as SignalPolarity,
    strength: Number(row.strength),
    confidence: Number(row.confidence),
    source: row.source as SignalSource,
    sourceRef: row.source_ref,
    observedAt: row.observed_at,
    halfLifeHours: row.half_life_hours,
    flatUntil: row.flat_until,
    expiresAt: row.expires_at,
    resumeAt: row.resume_at,
    reason: row.reason,
    evidenceExcerpt: row.evidence_excerpt,
    ruleVersion: row.rule_version,
    retractedAt: row.retracted_at,
  };
}
