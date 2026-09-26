/**
 * The handoff pack (brief §58, Phase 3.4).
 *
 * Pure: no Supabase, no `server-only`, relative imports with `.ts`, so every
 * rule is asserted by tests/handoff-brief.test.ts.
 *
 * Two artefacts:
 *
 *   1. **The Lead Brief** (`buildLeadBrief`). Deterministic. Every field is
 *      copied or derived from a stored fact -- the lead, its touches, its
 *      current score and tags, the qualification answers (known vs inferred),
 *      the objections the library matches in the lead's own words, the
 *      message excerpts that support each answer, the promises the business
 *      has made, the next step the lead asked for, the recommended approach
 *      (method router + motion), what is still unanswered, and the meeting.
 *   2. **The 30-second brief**. One model call over the *structured brief
 *      only* -- never the raw transcript -- then `validateQuickBrief`, which
 *      rejects any number, date or capitalised name that is not present in
 *      the brief. On any failure the deterministic `deterministicQuickBrief`
 *      is used instead. A person reading it must be able to trust that
 *      nothing in it was invented.
 */

import { chooseMethod, internalApproachLabel, type MethodDecision } from "../sales-library/method-router.ts";
import { matchObjection } from "../sales-library/objections.ts";
import type { DealSizeBand, SalesMotion } from "../sales-library/types.ts";
import { SALES_MOTIONS } from "../sales-library/types.ts";

/* ----------------------------------------------------------------- input */

export type BriefMessage = {
  direction: "inbound" | "outbound";
  body: string;
  at: string;
  channel: string;
};

export type BriefAnswer = {
  question: string;
  value: string;
  /** `form`/`reply`/`manual`/`ai_assist` from qualification_answers.source. */
  source: string;
  /** True when inferred from the lead's details rather than stated by them. */
  inferred: boolean;
};

export type BriefTouch = {
  occurredAt: string;
  sourceType: string;
  provider: string;
  campaign: string | null;
  form: string | null;
};

export type BriefInput = {
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    status: string;
    qualificationState: string;
    service: string | null;
    createdAt: string;
  };
  /** Empty when `lead_touches` is not available on this database. */
  touches: BriefTouch[];
  score: { total: number; grade: string; why: string; confidence: number } | null;
  tags: { tag: string; reason: string }[];
  answers: BriefAnswer[];
  /** Configured question texts, in order. Unanswered = these minus answers. */
  questions: string[];
  /** Oldest first. Excerpts come from here; it is never sent to a model. */
  messages: BriefMessage[];
  meeting: {
    startsAt: string | null;
    status: string;
    provider: string;
    location: string | null;
  } | null;
  opportunity: { stage: string; outcome: string; value: number | null; currency: string } | null;
  sales: {
    motion: string | null;
    archetypeKey: string | null;
    dealSizeBand: DealSizeBand | null;
    hasApprovedInsight: boolean;
  };
  handover: { reason: string; detail: string | null; channel: string | null };
};

/* ---------------------------------------------------------------- output */

export type Excerpt = { text: string; at: string };

export type LeadBrief = {
  version: 1;
  lead: {
    name: string;
    company: string | null;
    status: string;
    qualification: string;
    service: string | null;
  };
  source: {
    first: BriefTouch | null;
    last: BriefTouch | null;
    touchCount: number;
  };
  score: { total: number; grade: string; why: string } | null;
  tags: string[];
  answers: {
    question: string;
    value: string;
    known: boolean;
    /** The lead's own words that contain the value, when found. */
    evidence: Excerpt | null;
  }[];
  objections: { key: string; matched: string; evidence: Excerpt; handoverRequired: boolean }[];
  /** Commitments found in the business's own sent messages. */
  promises: Excerpt[];
  nextStep: string;
  approach: {
    method: string;
    /**
     * The method in plain words plus its evidence grade, for the workspace's
     * own salesperson. Absent on briefs stored before it existed.
     */
    label?: string;
    questionStyle: string;
    closeTarget: string;
    motion: string | null;
    reason: string;
  } | null;
  unanswered: string[];
  meeting: { startsAt: string | null; status: string; provider: string; location: string | null } | null;
  opportunity: { stage: string; outcome: string; value: number | null; currency: string } | null;
  handover: { reason: string; detail: string | null };
};

/* --------------------------------------------------------------- helpers */

const EXCERPT_MAX = 160;

function excerptAround(body: string, needle: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= EXCERPT_MAX) return text;
  const index = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (index < 0) return `${text.slice(0, EXCERPT_MAX - 1)}…`;
  const start = Math.max(0, index - 50);
  const slice = text.slice(start, start + EXCERPT_MAX - 2);
  return `${start > 0 ? "…" : ""}${slice}${start + EXCERPT_MAX - 2 < text.length ? "…" : ""}`;
}

/** The most recent inbound message containing `value` (case-insensitive). */
function evidenceFor(messages: BriefMessage[], value: string): Excerpt | null {
  const needle = value.trim().toLowerCase();
  if (needle.length < 2) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.direction === "inbound" && message.body.toLowerCase().includes(needle)) {
      return { text: excerptAround(message.body, value), at: message.at };
    }
  }
  return null;
}

/**
 * Outbound sentences that bind the business to doing something. There is no
 * separate commitment log to read, so the business's own sent messages are
 * the record: first-person future ("I'll", "we will", "someone will") and
 * explicit sends ("here is the link").
 */
const PROMISE_PATTERN =
  /\b(?:i(?:'ll| will)|we(?:'ll| will)|someone (?:from the team )?will|the team will|i can confirm|here(?:'s| is) (?:the|your) (?:link|booking link|checkout))\b[^.!?\n]{0,140}[.!?]?/gi;

export function promisesIn(messages: BriefMessage[]): Excerpt[] {
  const found: Excerpt[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.direction !== "outbound") continue;
    for (const match of message.body.matchAll(PROMISE_PATTERN)) {
      const text = match[0].replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX);
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ text, at: message.at });
    }
  }
  return found.slice(-5);
}

const BOOKING_ASK = /\b(?:book|booking|call|meeting|meet|chat|appointment|demo|slot|availability|diary)\b/i;
const PRICE_ASK = /\b(?:price|pricing|cost|quote|how much|budget|rates?)\b/i;
const BUY_ASK = /\b(?:buy|purchase|sign up|signup|checkout|pay|order|subscribe|trial)\b/i;
const PERSON_ASK = /\b(?:speak to|talk to|call me|ring me|a (?:real )?person|a human|someone)\b/i;

/** What the lead asked for last, in plain words. Deterministic keyword rules. */
function requestedNextStep(input: BriefInput): string {
  if (input.meeting && (input.meeting.status === "scheduled" || input.meeting.status === "pending")) {
    return input.meeting.status === "pending"
      ? "Confirm the meeting time the lead requested."
      : "Prepare for the booked meeting.";
  }
  const lastInbound = [...input.messages].reverse().find((m) => m.direction === "inbound");
  const text = lastInbound?.body ?? "";
  if (PERSON_ASK.test(text)) return "The lead asked to speak to a person.";
  if (BUY_ASK.test(text)) return "The lead asked how to buy or sign up.";
  if (PRICE_ASK.test(text)) return "The lead asked about price.";
  if (BOOKING_ASK.test(text)) return "The lead asked to book a call.";
  if (input.handover.reason === "COMPLAINT") return "Respond to the lead's complaint.";
  return "Reply to the lead's latest message.";
}

function name(input: BriefInput["lead"]): string {
  return [input.firstName, input.lastName].filter(Boolean).join(" ") || "This lead";
}

function asMotion(value: string | null): SalesMotion | null {
  return value && (SALES_MOTIONS as readonly string[]).includes(value) ? (value as SalesMotion) : null;
}

/* ------------------------------------------------------------ the brief */

export function buildLeadBrief(input: BriefInput): LeadBrief {
  const inbound = input.messages.filter((m) => m.direction === "inbound");

  const answers = input.answers.map((answer) => ({
    question: answer.question,
    value: answer.value,
    known: !answer.inferred,
    evidence: answer.inferred ? null : evidenceFor(input.messages, answer.value),
  }));

  // Objections are matched in the lead's own words only, primary first, one
  // entry per playbook, each with the message that triggered it.
  const objections: LeadBrief["objections"] = [];
  const seenObjection = new Set<string>();
  for (let i = inbound.length - 1; i >= 0; i -= 1) {
    for (const match of matchObjection(inbound[i].body)) {
      if (seenObjection.has(match.key)) continue;
      seenObjection.add(match.key);
      objections.push({
        key: match.key,
        matched: match.matched,
        evidence: { text: excerptAround(inbound[i].body, match.matched), at: inbound[i].at },
        handoverRequired: match.handoverRequired,
      });
    }
  }

  const answeredQuestions = new Set(input.answers.map((a) => a.question.trim().toLowerCase()));
  const unanswered = input.questions.filter((q) => !answeredQuestions.has(q.trim().toLowerCase()));

  const motion = asMotion(input.sales.motion);
  let approach: LeadBrief["approach"] = null;
  if (motion) {
    const decision: MethodDecision = chooseMethod({
      motion,
      archetypeKey: input.sales.archetypeKey,
      dealSizeBand: input.sales.dealSizeBand ?? "SMALL",
      direction: "INBOUND",
      channel: input.handover.channel,
      stage: input.meeting ? "POST_BOOKING" : objections.length > 0 ? "OBJECTION" : "QUALIFYING",
      hasApprovedInsight: input.sales.hasApprovedInsight,
    });
    approach = {
      method: decision.method,
      label: internalApproachLabel(decision.method),
      questionStyle: decision.questionStyle,
      closeTarget: decision.closeTarget,
      motion,
      reason: decision.reason,
    };
  }

  const touches = [...input.touches].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    version: 1,
    lead: {
      name: name(input.lead),
      company: input.lead.company,
      status: input.lead.status,
      qualification: input.lead.qualificationState,
      service: input.lead.service,
    },
    source: {
      first: touches[0] ?? null,
      last: touches.length > 1 ? touches[touches.length - 1] : null,
      touchCount: touches.length,
    },
    score: input.score
      ? { total: Math.round(input.score.total), grade: input.score.grade, why: input.score.why }
      : null,
    tags: input.tags.map((t) => t.tag),
    answers,
    objections: objections.slice(0, 5),
    promises: promisesIn(input.messages),
    nextStep: requestedNextStep(input),
    approach,
    unanswered,
    meeting: input.meeting,
    opportunity: input.opportunity,
    handover: { reason: input.handover.reason, detail: input.handover.detail },
  };
}

/** Plain words for the approach, never the bare method code. */
function approachLabel(approach: NonNullable<LeadBrief["approach"]>): string {
  if (approach.label) return approach.label;
  const known = ["TRANSACTIONAL", "SIMPLE_QUALIFICATION", "PLG", "SPIN", "CHALLENGER_INSIGHT", "MEDDPICC"] as const;
  const method = known.find((value) => value === approach.method);
  return method ? internalApproachLabel(method) : "one direct question at a time";
}

/* --------------------------------------------------- 30-second brief */

/**
 * What the model is given: the structured brief as compact labelled lines.
 * No transcript, no excerpt longer than the brief already holds.
 */
export function renderBriefForModel(brief: LeadBrief): string {
  const lines = [
    `Lead: ${brief.lead.name}${brief.lead.company ? ` (${brief.lead.company})` : ""}`,
    `Status: ${brief.lead.status}; qualification: ${brief.lead.qualification}`,
    brief.lead.service ? `Service: ${brief.lead.service}` : null,
    brief.source.first
      ? `Source: ${brief.source.first.sourceType} via ${brief.source.first.provider}${
          brief.source.first.campaign ? `, campaign ${brief.source.first.campaign}` : ""
        }`
      : null,
    brief.score ? `Score: ${brief.score.total} (grade ${brief.score.grade}). ${brief.score.why}` : null,
    brief.tags.length ? `Tags: ${brief.tags.join(", ")}` : null,
    ...brief.answers.map((a) => `${a.known ? "Answered" : "Inferred"}: ${a.question} = ${a.value}`),
    ...brief.objections.map((o) => `Objection: ${o.key} ("${o.matched}")`),
    ...brief.promises.map((p) => `Promised: ${p.text}`),
    `Next step: ${brief.nextStep}`,
    brief.approach
      ? `Suggested approach (internal planning heuristic): ${approachLabel(brief.approach)}; close target ${brief.approach.closeTarget}`
      : null,
    brief.unanswered.length ? `Unanswered: ${brief.unanswered.join("; ")}` : null,
    brief.meeting ? `Meeting: ${brief.meeting.status}${brief.meeting.startsAt ? ` at ${brief.meeting.startsAt}` : ""}` : null,
    brief.opportunity ? `Opportunity: ${brief.opportunity.stage}, ${brief.opportunity.outcome}` : null,
    `Handover reason: ${brief.handover.reason}${brief.handover.detail ? `. ${brief.handover.detail}` : ""}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Every string value in the brief, flattened: the universe of allowed facts. */
function briefText(brief: LeadBrief): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(brief);
  return parts.join("\n");
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|yesterday|tonight";

/** Words that may start a sentence or name the product without being a fact. */
const ALLOWED_CAPITALISED = new Set(
  [
    "the", "a", "an", "they", "he", "she", "their", "lead", "leads", "no", "not", "next", "ask", "asked",
    "offer", "confirm", "reply", "prepare", "send", "book", "call", "meeting", "score", "grade", "source",
    "qualified", "qualification", "objection", "objections", "status", "open", "won", "lost", "i", "we",
    "it", "is", "has", "have", "wants", "want", "needs", "said", "says", "interested", "follow", "check",
    "unanswered", "still", "also", "then", "approach", "use", "lead's", "handover", "reason", "clientturn",
    "promised", "sms", "email", "whatsapp", "linkedin", "messenger", "instagram", "b2b", "uk", "ai",
    "spin", "meddpicc", "plg", "and", "or", "but", "if", "on", "in", "at", "for", "with", "about",
  ],
);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token containment: "5" is not in "2025", "Al" is not in "qualification". */
function containsToken(universe: string, token: string, kind: "number" | "word"): boolean {
  const edge = kind === "number" ? "0-9" : "a-z0-9";
  return new RegExp(`(^|[^${edge}])${escapeRegex(token)}($|[^${edge}])`, "im").test(universe);
}

export type QuickBriefCheck = { ok: true } | { ok: false; violations: string[] };

/**
 * Rejects a model-written 30-second brief that introduces anything the
 * structured brief does not contain:
 *
 *   * any number (digits, including prices, percentages, counts, times);
 *   * any date word (a month or weekday) not present in the brief;
 *   * any capitalised word mid-sentence (a likely name) not present in the brief.
 *
 * Deliberately strict: a false rejection costs a deterministic summary, while
 * a false acceptance puts an invented fact in front of the person about to
 * speak to the customer.
 */
export function validateQuickBrief(text: string, brief: LeadBrief): QuickBriefCheck {
  const universe = briefText(brief).toLowerCase();
  const violations: string[] = [];
  const body = text.normalize("NFKC");

  for (const match of body.matchAll(/\d[\d,.:/-]*/g)) {
    const token = match[0].replace(/[.,:/-]+$/, "");
    if (!containsToken(universe, token.toLowerCase(), "number")) violations.push(`number "${token}"`);
  }

  for (const match of body.matchAll(new RegExp(`\\b(?:${MONTHS}|${WEEKDAYS})\\b`, "gi"))) {
    // "may" is also a verb; only a capitalised May is treated as the month.
    if (match[0].toLowerCase() === "may" && match[0] !== "May") continue;
    if (!containsToken(universe, match[0].toLowerCase(), "word")) violations.push(`date "${match[0]}"`);
  }

  // Capitalised words that are not the first word of a sentence.
  for (const match of body.matchAll(/(?<![.!?:]\s|^|\n)\b([A-Z][a-zA-Z'’-]+)/g)) {
    const word = match[1];
    const lower = word.toLowerCase();
    if (ALLOWED_CAPITALISED.has(lower)) continue;
    if (!containsToken(universe, lower, "word")) violations.push(`name "${word}"`);
  }

  return violations.length > 0 ? { ok: false, violations: [...new Set(violations)] } : { ok: true };
}

/** The fallback: a short, factual summary built only from the brief. */
export function deterministicQuickBrief(brief: LeadBrief): string {
  const who = `${brief.lead.name}${brief.lead.company ? ` from ${brief.lead.company}` : ""}`;
  const about = brief.lead.service ? ` about ${brief.lead.service}` : "";
  const known = brief.answers.filter((a) => a.known).slice(0, 3);
  const sentences = [
    `${who} enquired${about}; qualification is ${brief.lead.qualification.toLowerCase().replace(/_/g, " ")}.`,
    known.length ? `They told us: ${known.map((a) => `${a.question} ${a.value}`).join("; ")}.` : null,
    brief.objections.length
      ? `Raised: ${brief.objections.map((o) => o.key.toLowerCase().replace(/_/g, " ")).join(", ")}.`
      : null,
    brief.nextStep,
    brief.approach ? `Suggested approach: ${brief.approach.reason}` : null,
  ];
  return sentences.filter(Boolean).join(" ").slice(0, 700);
}

/**
 * Chooses the quick brief to store: the model's text when it passes
 * validation, otherwise the deterministic one. Returns which was used.
 */
export function chooseQuickBrief(
  candidate: string | null | undefined,
  brief: LeadBrief,
): { text: string; source: "model" | "deterministic"; violations: string[] } {
  const trimmed = (candidate ?? "").trim();
  if (!trimmed) return { text: deterministicQuickBrief(brief), source: "deterministic", violations: [] };
  const check = validateQuickBrief(trimmed, brief);
  if (check.ok) return { text: trimmed.slice(0, 900), source: "model", violations: [] };
  return { text: deterministicQuickBrief(brief), source: "deterministic", violations: check.violations };
}

/** Plain text for a CRM note: the quick brief, then the key structured facts. */
export function renderBriefNote(brief: LeadBrief, quick: string): string {
  const lines = [
    "ClientTurn handoff brief",
    "",
    quick,
    "",
    ...brief.answers.map((a) => `- ${a.known ? "" : "(inferred) "}${a.question}: ${a.value}`),
    ...(brief.objections.length ? [`- Objections: ${brief.objections.map((o) => o.key).join(", ")}`] : []),
    ...(brief.unanswered.length ? [`- Still unknown: ${brief.unanswered.join("; ")}`] : []),
    `- Next step: ${brief.nextStep}`,
    ...(brief.approach
      ? [`- Suggested approach (internal planning heuristic): ${approachLabel(brief.approach)}. ${brief.approach.reason}`]
      : []),
    `- Handover reason: ${brief.handover.reason}`,
  ];
  return lines.join("\n");
}
