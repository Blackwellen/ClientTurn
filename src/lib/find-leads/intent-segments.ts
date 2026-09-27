import { z } from "zod";
import {
  INTENT_CATALOGUE,
  INTENT_GROUP_LABELS,
  INTENT_TYPE_IDS,
  ROLE_FUNCTIONS,
  ROLE_FUNCTION_NEEDS,
  intentType,
  intentTypesInGroup,
  type IntentGroup,
  type IntentTypeId,
  type RoleFunction,
} from "./intent-catalogue.ts";

/**
 * Combination segments: buying signals combined with AND / OR and recency.
 *
 *   "Raised funds in the last 90 days AND hiring a marketing role"
 *   "New Head of Growth in the last 60 days"
 *
 * Pure and zod-validated, because the plan editor, the Search Agent and the
 * sourcing run all read it and the run spends money on it. A segment is a
 * *gate*: a prospect reaches READY only when its recorded evidence satisfies
 * the segment. It never invents evidence, and a condition naming a type with
 * no lawful source can never be satisfied.
 *
 * One level of logic on purpose. Each condition is "any of these types, in
 * this many days, optionally in this function"; the segment joins conditions
 * with ALL or ANY. That covers every example the product needs, and a person
 * can read it back in one sentence.
 */

export const SEGMENT_OPS = ["ALL", "ANY"] as const;
export type SegmentOp = (typeof SEGMENT_OPS)[number];

export const segmentConditionSchema = z.object({
  /** Any one of these types satisfies the condition. */
  types: z.array(z.enum(INTENT_TYPE_IDS)).min(1).max(15),
  /** How recent the evidence must be. */
  withinDays: z.number().int().min(1).max(365).default(90),
  /** For hiring and appointments: the function the role must be in. */
  roleFunction: z.enum(ROLE_FUNCTIONS).nullable().default(null),
});
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

export const intentSegmentSchema = z.object({
  version: z.literal(1).default(1),
  op: z.enum(SEGMENT_OPS).default("ALL"),
  conditions: z.array(segmentConditionSchema).min(1).max(6),
});
export type IntentSegment = z.infer<typeof intentSegmentSchema>;

export function parseSegment(value: unknown): IntentSegment | null {
  const parsed = intentSegmentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------- evaluation */

/** One recorded piece of evidence, as a segment reads it. */
export type SegmentEvidence = {
  intentType: IntentTypeId | null;
  roleFunction: RoleFunction | null;
  observedAt: string;
};

export type SegmentVerdict = {
  matched: boolean;
  conditions: { matched: boolean; evidence: SegmentEvidence | null }[];
};

function conditionMatch(condition: SegmentCondition, evidence: SegmentEvidence[], now: Date): SegmentEvidence | null {
  const types = new Set(condition.types);
  let best: SegmentEvidence | null = null;
  for (const item of evidence) {
    if (!item.intentType || !types.has(item.intentType)) continue;
    if (condition.roleFunction && item.roleFunction !== condition.roleFunction) continue;
    const time = Date.parse(item.observedAt);
    if (!Number.isFinite(time)) continue;
    const age = (now.getTime() - time) / 86_400_000;
    if (age < -1 || age > condition.withinDays) continue;
    if (!best || item.observedAt > best.observedAt) best = item;
  }
  return best;
}

export function evaluateSegment(
  segment: IntentSegment,
  evidence: SegmentEvidence[],
  now: Date = new Date(),
): SegmentVerdict {
  const conditions = segment.conditions.map((condition) => {
    const hit = conditionMatch(condition, evidence, now);
    return { matched: hit !== null, evidence: hit };
  });
  const matched =
    segment.op === "ALL" ? conditions.every((c) => c.matched) : conditions.some((c) => c.matched);
  return { matched, conditions };
}

/* ------------------------------------------------------------------ wants */

/** Every type a segment can be satisfied by, for the intent stage to fetch. */
export function segmentTypes(segment: IntentSegment | null): IntentTypeId[] {
  if (!segment) return [];
  return [...new Set(segment.conditions.flatMap((condition) => condition.types))];
}

/**
 * Types in a segment that no lawful source can ever evidence. A condition
 * made only of these can never match, which the editor says up front.
 */
export function unsatisfiableTypes(segment: IntentSegment): IntentTypeId[] {
  return segmentTypes(segment).filter((id) => intentType(id).sources.length === 0);
}

/* ---------------------------------------------------------------- wording */

function groupCovered(types: IntentTypeId[]): IntentGroup | null {
  const set = new Set(types);
  for (const group of Object.keys(INTENT_GROUP_LABELS) as IntentGroup[]) {
    const available = intentTypesInGroup(group).filter((entry) => entry.sources.length > 0);
    if (available.length > 1 && available.every((entry) => set.has(entry.id)) && set.size === available.length) {
      return group;
    }
  }
  return null;
}

const GROUP_PHRASE: Record<IntentGroup, string> = {
  FUNDING: "raised funds or changed ownership",
  PEOPLE: "a leadership or team change",
  HIRING: "hiring",
  GROWTH: "a growth announcement",
  TECHNOLOGY: "a technology change or issue",
  EVENTS: "a trigger event",
};

function lowerFirst(value: string): string {
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** One condition in plain English: "hiring for a marketing and growth role in the last 90 days". */
export function conditionSummary(condition: SegmentCondition): string {
  const group = groupCovered(condition.types);
  let what = group
    ? GROUP_PHRASE[group]
    : condition.types.map((id) => lowerFirst(intentType(id).label)).join(" or ");
  if (condition.roleFunction) {
    what += ` (${ROLE_FUNCTION_NEEDS[condition.roleFunction].label.toLowerCase()})`;
  }
  return `${what} in the last ${condition.withinDays} day${condition.withinDays === 1 ? "" : "s"}`;
}

/** The whole segment in one sentence, for the plan summary and the agent. */
export function segmentSummary(segment: IntentSegment | null): string {
  if (!segment || segment.conditions.length === 0) return "No combination";
  const joiner = segment.op === "ALL" ? " AND " : " OR ";
  const text = segment.conditions.map(conditionSummary).join(joiner);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------------------------------------------------------------- presets */

const available = (group: IntentGroup) =>
  INTENT_CATALOGUE.filter((entry) => entry.group === group && entry.sources.length > 0).map((entry) => entry.id);

/** Starting points offered in the editor. Each is an ordinary, editable segment. */
export const SEGMENT_PRESETS: { name: string; segment: IntentSegment }[] = [
  {
    name: "Raised funds and hiring marketing",
    segment: {
      version: 1,
      op: "ALL",
      conditions: [
        { types: available("FUNDING"), withinDays: 90, roleFunction: null },
        { types: ["HIRING_ROLE", "FIRST_HIRE_IN_FUNCTION"], withinDays: 90, roleFunction: "MARKETING" },
      ],
    },
  },
  {
    name: "New Head of Growth",
    segment: {
      version: 1,
      op: "ALL",
      conditions: [{ types: ["SENIOR_HIRE_HEAD_OF", "SENIOR_HIRE_VP", "SENIOR_HIRE_C_LEVEL"], withinDays: 60, roleFunction: "MARKETING" }],
    },
  },
  {
    name: "Rebrand or new website",
    segment: {
      version: 1,
      op: "ANY",
      conditions: [
        { types: ["REBRAND"], withinDays: 120, roleFunction: null },
        { types: ["SITE_TECHNICAL_ISSUE"], withinDays: 60, roleFunction: null },
      ],
    },
  },
  {
    name: "Growing and hiring engineers",
    segment: {
      version: 1,
      op: "ALL",
      conditions: [
        { types: ["HEADCOUNT_GROWTH", "HIRING_SPIKE", "TEAM_GROWTH", "NEW_OFFICE"], withinDays: 90, roleFunction: null },
        { types: ["HIRING_ROLE"], withinDays: 45, roleFunction: "ENGINEERING" },
      ],
    },
  },
];
