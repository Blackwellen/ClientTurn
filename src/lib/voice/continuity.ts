/**
 * Post-call continuity (voice phase P3, brief §6). Pure.
 *
 * A call is one more turn of the same conversation, so what happened on it
 * must be in front of the text assistant on its next turn. Three paths carry
 * it, all existing:
 *
 *   1. the lead's words go through the QI extractors (post-call.ts ->
 *      writeQualificationSignals -> lead.score reassessment), so the facts and
 *      the next-best-action the text turn reads already include the call;
 *   2. the lead's `next_action` is set from the call's disposition;
 *   3. this note is merged into the lead's opportunity memory
 *      (opportunities/memory.ts), which the text turn renders into its
 *      context ("Other facts", "We committed to", "Objections raised"). The
 *      memory's own refresh keeps earlier facts, commitments and objections,
 *      so the note survives the next text refresh.
 *
 * Only what was said and decided goes in: never the model's reasoning.
 */

import { OBJECTIONS } from "../sales-library/objections.ts";
import { OBJECTION_KEYS, type ObjectionKey } from "../sales-library/types.ts";
import { emptyMemory, type OpportunityMemory } from "../opportunities/memory.ts";

export type CallMemoryNote = {
  at: string;
  route: string;
  disposition: string;
  summary: string | null;
  nextStep: string | null;
  objectionKeys: string[];
};

const LIST_MAX = 5;
const ITEM_MAX = 140;

const ROUTE_WORDS: Record<string, string> = {
  QUALIFICATION: "qualification call",
  BOOKING_CLOSE: "booking call",
  DIRECT_CLOSE: "sales call",
  NURTURE: "check-in call",
  REACTIVATION: "follow-up call",
  RETURN_CALL: "call they made to us",
  INBOUND: "call they made to us",
};

function cap(text: string, max = ITEM_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "recently";
}

export function buildCallMemoryNote(input: {
  endedAt: string;
  route: string;
  disposition: string;
  summary: string | null;
  nextStep: string | null;
  objectionKeys: readonly string[];
}): CallMemoryNote {
  return {
    at: input.endedAt,
    route: input.route,
    disposition: input.disposition,
    summary: input.summary?.trim() ? cap(input.summary, 400) : null,
    nextStep: input.nextStep?.trim() ? cap(input.nextStep) : null,
    objectionKeys: [...new Set(input.objectionKeys)].slice(0, LIST_MAX),
  };
}

function isLibraryKey(key: string): key is ObjectionKey {
  return (OBJECTION_KEYS as readonly string[]).includes(key);
}

/**
 * The memory with the call folded in: a dated "Phone call" fact, the agreed
 * next step as a commitment, and each objection by its library label.
 * Latest wins and each list stays at five, as the memory's own merge does.
 */
export function mergeCallIntoMemory(memory: OpportunityMemory | null, note: CallMemoryNote, now: Date): OpportunityMemory {
  const base = memory ?? emptyMemory(now);
  const route = ROUTE_WORDS[note.route] ?? "phone call";
  const fact = cap(`Phone ${route} on ${day(note.at)}: ${note.summary ?? note.disposition.toLowerCase().replace(/_/g, " ")}`);
  const push = (list: readonly string[], item: string | null): string[] => {
    if (!item) return [...list];
    const next = [...list.filter((x) => x.toLowerCase() !== item.toLowerCase()), item];
    return next.slice(-LIST_MAX);
  };
  const objections = [...base.objections];
  for (const key of note.objectionKeys) {
    if (objections.some((o) => o.key === key)) continue;
    objections.push({ key, label: isLibraryKey(key) ? OBJECTIONS[key].label : key.replace(/^custom:/, "") });
  }
  return {
    ...base,
    updatedAt: now.toISOString(),
    facts: push(base.facts, fact),
    commitments: push(base.commitments, note.nextStep ? cap(`From the call: ${note.nextStep}`) : null),
    objections: objections.slice(-LIST_MAX),
    nextAction: note.nextStep ?? base.nextAction,
  };
}
