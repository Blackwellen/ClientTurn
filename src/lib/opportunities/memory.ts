/**
 * Opportunity-level memory (brief §48). Pure: no Supabase, no `server-only`.
 *
 * One small structured record per opportunity, stored on
 * `opportunities.memory` (0131) and given to the agent as a compact block, so
 * a long conversation is carried by what it established rather than by its
 * raw history. Everything here is derived deterministically:
 *
 *   * qualification answers, bucketed by the library dimension their question
 *     maps to (next-question.ts `inferDimension`);
 *   * objections matched in the lead's own messages (sales-library);
 *   * commitments found in the business's own sent messages (handoff brief's
 *     promise pattern);
 *   * stakeholders from AUTHORITY / STAKEHOLDERS answers and plain mentions of
 *     a role in the lead's messages ("I need to check with my director");
 *   * the conversation summary, kept short.
 *
 * Nothing is inferred by a model and nothing is invented: an empty bucket is
 * simply absent. Bounded: every list keeps its latest few entries, every entry
 * is capped, so the stored record and the rendered block stay small.
 */

import { matchObjection, OBJECTIONS } from "../sales-library/objections.ts";
import { promisesIn, type BriefMessage } from "../handoff/brief.ts";
import type { QualificationDimensionKey } from "../sales-library/types.ts";

export const MEMORY_VERSION = 1;
const LIST_MAX = 5;
const ITEM_CHARS = 140;
const SUMMARY_CHARS = 300;
/** The rendered block is kept under this many characters (~150 tokens). */
export const MEMORY_RENDER_CHARS = 600;

export type OpportunityMemory = {
  version: 1;
  updatedAt: string;
  facts: string[];
  goals: string[];
  pains: string[];
  requirements: string[];
  objections: { key: string; label: string }[];
  budgetSignals: string[];
  timeframe: string | null;
  stakeholders: string[];
  commitments: string[];
  nextAction: string | null;
  openQuestions: string[];
  productsDiscussed: string[];
  summary: string | null;
};

export type MemoryAnswer = {
  question: string;
  value: string;
  dimension: QualificationDimensionKey | null;
};

export type MemoryInput = {
  answers: MemoryAnswer[];
  /** Configured questions not yet answered, in asking order. */
  unanswered: string[];
  /** Oldest first. */
  messages: BriefMessage[];
  service: string | null;
  summary: string | null;
  /** Kept across refreshes so an objection or promise outside the window survives. */
  previous?: OpportunityMemory | null;
  now: Date;
};

const BUCKET: Partial<Record<QualificationDimensionKey, keyof OpportunityMemory>> = {
  PROBLEM: "pains",
  USE_CASE: "goals",
  SUCCESS_METRICS: "goals",
  PROJECT_SCOPE: "requirements",
  COMPLIANCE_REQUIREMENTS: "requirements",
  TEAM_SIZE: "requirements",
  VOLUME: "requirements",
  HIRING_NEED: "requirements",
  BUDGET: "budgetSignals",
  AUTHORITY: "stakeholders",
  STAKEHOLDERS: "stakeholders",
  DECISION_PROCESS: "stakeholders",
  SERVICE_NEEDED: "productsDiscussed",
  PRODUCT_INTEREST: "productsDiscussed",
};

/** A role the lead mentions deferring to. Plain words, no names captured. */
const ROLE_MENTION =
  /\b(?:my|our|the)\s+(boss|manager|director|md|managing director|ceo|cto|cfo|coo|founder|co-?founder|partner|business partner|owner|board|finance (?:team|director)|it (?:team|manager)|procurement(?: team)?|marketing (?:team|director|manager)|head of [a-z]+)\b/gi;
const PRICE_ASK = /\b(?:price|pricing|cost|quote|how much|rates?)\b/i;
const BOOKING_ASK = /\b(?:book|booking|call|meeting|demo|appointment|availability)\b/i;
const PERSON_ASK = /\b(?:speak to|talk to|a (?:real )?person|a human)\b/i;

function cap(text: string, max = ITEM_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Latest-wins, case-insensitive de-duplication, capped to LIST_MAX. */
function mergeList(previous: readonly string[] | undefined, next: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...next.slice().reverse(), ...(previous ?? []).slice().reverse()]) {
    const item = cap(value);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, LIST_MAX).reverse();
}

export function emptyMemory(now: Date): OpportunityMemory {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    facts: [],
    goals: [],
    pains: [],
    requirements: [],
    objections: [],
    budgetSignals: [],
    timeframe: null,
    stakeholders: [],
    commitments: [],
    nextAction: null,
    openQuestions: [],
    productsDiscussed: [],
    summary: null,
  };
}

/** Reads whatever the jsonb holds; anything malformed is an empty memory. */
export function parseMemory(raw: unknown, now: Date = new Date()): OpportunityMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, LIST_MAX) : [];
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    ...emptyMemory(now),
    updatedAt: text(r.updatedAt) ?? now.toISOString(),
    facts: list(r.facts),
    goals: list(r.goals),
    pains: list(r.pains),
    requirements: list(r.requirements),
    objections: Array.isArray(r.objections)
      ? r.objections
          .filter((o): o is { key: string; label: string } =>
            Boolean(o && typeof (o as { key?: unknown }).key === "string" && typeof (o as { label?: unknown }).label === "string"),
          )
          .slice(0, LIST_MAX)
      : [],
    budgetSignals: list(r.budgetSignals),
    timeframe: text(r.timeframe),
    stakeholders: list(r.stakeholders),
    commitments: list(r.commitments),
    nextAction: text(r.nextAction),
    openQuestions: list(r.openQuestions),
    productsDiscussed: list(r.productsDiscussed),
    summary: text(r.summary),
  };
}

export function deriveOpportunityMemory(input: MemoryInput): OpportunityMemory {
  const prev = input.previous ?? null;
  const buckets: Record<string, string[]> = {
    facts: [],
    goals: [],
    pains: [],
    requirements: [],
    budgetSignals: [],
    stakeholders: [],
    productsDiscussed: [],
  };
  let timeframe: string | null = null;

  for (const answer of input.answers) {
    const value = answer.value.trim();
    if (!value) continue;
    if (answer.dimension === "TIMING") {
      timeframe = cap(value);
      continue;
    }
    const bucket = answer.dimension ? BUCKET[answer.dimension] : undefined;
    const line = bucket === "stakeholders" || bucket === "budgetSignals" ? `${answer.question}: ${value}` : value;
    if (bucket && bucket in buckets) buckets[bucket].push(line);
    else buckets.facts.push(`${answer.question}: ${value}`);
  }
  if (input.service) buckets.productsDiscussed.unshift(input.service);

  const inbound = input.messages.filter((message) => message.direction === "inbound");
  const objections: { key: string; label: string }[] = [];
  for (const message of inbound) {
    const match = matchObjection(message.body)[0];
    if (match && !objections.some((o) => o.key === match.key)) {
      objections.push({ key: match.key, label: OBJECTIONS[match.key].label });
    }
    for (const role of message.body.matchAll(ROLE_MENTION)) {
      buckets.stakeholders.push(`${role[1].toLowerCase()} (mentioned by the lead)`);
    }
    if (PRICE_ASK.test(message.body)) buckets.budgetSignals.push("Asked about price");
  }

  const mergedObjections = [...(prev?.objections ?? [])];
  for (const objection of objections) {
    if (!mergedObjections.some((o) => o.key === objection.key)) mergedObjections.push(objection);
  }

  const lastInbound = inbound[inbound.length - 1]?.body ?? "";
  const nextAction = PERSON_ASK.test(lastInbound)
    ? "They asked to speak to a person."
    : BOOKING_ASK.test(lastInbound)
      ? "Offer a time for the call they asked about."
      : PRICE_ASK.test(lastInbound)
        ? "Answer the price question from published prices, or hand to a person."
        : input.unanswered[0]
          ? `Learn: ${cap(input.unanswered[0], 100)}`
          : null;

  return {
    version: 1,
    updatedAt: input.now.toISOString(),
    facts: mergeList(prev?.facts, buckets.facts),
    goals: mergeList(prev?.goals, buckets.goals),
    pains: mergeList(prev?.pains, buckets.pains),
    requirements: mergeList(prev?.requirements, buckets.requirements),
    objections: mergedObjections.slice(-LIST_MAX),
    budgetSignals: mergeList(prev?.budgetSignals, buckets.budgetSignals),
    timeframe: timeframe ?? prev?.timeframe ?? null,
    stakeholders: mergeList(prev?.stakeholders, buckets.stakeholders),
    commitments: mergeList(prev?.commitments, promisesIn(input.messages).map((p) => p.text)),
    nextAction,
    openQuestions: input.unanswered.slice(0, LIST_MAX).map((q) => cap(q, 100)),
    productsDiscussed: mergeList(prev?.productsDiscussed, buckets.productsDiscussed),
    summary: input.summary ? cap(input.summary, SUMMARY_CHARS) : (prev?.summary ?? null),
  };
}

/**
 * The compact block for the agent's volatile context. Omits the summary (the
 * context already carries it) and empty buckets; drops trailing lines to stay
 * under MEMORY_RENDER_CHARS.
 */
export function renderOpportunityMemory(memory: OpportunityMemory | null): string | null {
  if (!memory) return null;
  const line = (label: string, values: readonly string[]) => (values.length ? `${label}: ${values.join("; ")}` : null);
  const lines = [
    line("Goals", memory.goals),
    line("Pains", memory.pains),
    line("Requirements", memory.requirements),
    memory.timeframe ? `Timeframe: ${memory.timeframe}` : null,
    line("Budget signals", memory.budgetSignals),
    line("People involved", memory.stakeholders),
    line("Objections raised", memory.objections.map((o) => o.label)),
    line("We committed to", memory.commitments),
    line("Discussed", memory.productsDiscussed),
    line("Other facts", memory.facts),
    line("Still unknown", memory.openQuestions),
    memory.nextAction ? `Next action: ${memory.nextAction}` : null,
  ].filter((value): value is string => Boolean(value));
  if (lines.length === 0) return null;
  const out = ["OPPORTUNITY MEMORY (what this conversation has established; do not re-ask known things)"];
  for (const value of lines) {
    if ([...out, value].join("\n").length > MEMORY_RENDER_CHARS) break;
    out.push(value);
  }
  return out.length > 1 ? out.join("\n") : null;
}
