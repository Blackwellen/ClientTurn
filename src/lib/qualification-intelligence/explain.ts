/**
 * Qualification intelligence: the read model and the explanations (design
 * §B.17 Lead Detail, §B.19 Copilot / service operations).
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports. The Lead page,
 * the registry operations (and so Copilot, MCP and the API) and the tests all
 * read an assessment through these functions, so "why this question?" reads
 * the same sentence everywhere.
 *
 * Owned by the surfaces (A4). It builds only on the frozen contract in
 * `types.ts`; nothing here decides anything. Overrides produce a new, fully
 * validated assessment write, which the database function
 * `record_lead_assessment()` stores like any other.
 */

import {
  ASKING_ACTIONS,
  CTA_ACTIONS,
  DIMENSION_STATUSES,
  GOAL_KEYS,
  GOAL_LABEL,
  INTENT_SCORE_COMPONENTS,
  INTENT_STATES,
  INTENT_THRESHOLDS,
  NBA_ACTION_NEEDS_MODEL,
  NBA_ACTIONS,
  NBA_HANDOVER_REASONS,
  NBA_RULES,
  QIE_ENGINE_VERSION,
  QI_ENGINE_MODES,
  QUESTION_VALUE_FLOORS,
  SIGNAL_RULES_VERSION,
  SIGNAL_TYPE_CATEGORY,
  dimensionStatusEntrySchema,
  intentCategoryScoresSchema,
  intentEvidenceItemSchema,
  intentSignalWriteSchema,
  leadAssessmentWriteSchema,
  nextBestActionSchema,
  signalPolarity,
  type AssessmentEngineMode,
  type DimensionStatus,
  type DimensionStatusEntry,
  type FactDimension,
  type FactSource,
  type FactState,
  type GoalKey,
  type IntentCategoryScores,
  type IntentEvidenceItem,
  type IntentScoreComponent,
  type IntentSignalWrite,
  type IntentState,
  type LeadAssessmentWrite,
  type NbaAction,
  type NbaRule,
  type NextBestAction,
  type QiEngineMode,
  type QualificationFact,
  type QuestionPurpose,
  type SignalSource,
  type SignalType,
} from "./types.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import { deriveDimensionStatuses } from "./facts.ts";
import type { HandoverReason } from "../agent/types.ts";

/* ================================================================== copy */

function humanise(code: string): string {
  const text = code.replace(/[._:]/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Labels for the six dimensions the design adds, until the catalogue carries them. */
const ADDED_DIMENSION_LABEL: Record<string, string> = {
  OUTCOME: "Desired outcome",
  AVAILABILITY: "Availability",
  DISSATISFACTION: "Dissatisfaction with the current option",
  TECHNICAL_REQUIREMENTS: "Technical or integration requirements",
  IMPLEMENTATION_READINESS: "Readiness to implement",
  PURCHASE_READINESS: "Readiness to buy",
  UNMAPPED: "Custom question",
};

export function dimensionLabel(dimension: string): string {
  const entry = (QUALIFICATION_CATALOGUE as Record<string, { label?: string } | undefined>)[dimension];
  return entry?.label ?? ADDED_DIMENSION_LABEL[dimension] ?? humanise(dimension);
}

export const INTENT_STATE_COPY: Record<IntentState, { label: string; description: string }> = {
  NO_DETECTED_INTENT: { label: "No intent yet", description: "Nothing the lead has said or done shows buying intent yet." },
  LOW: { label: "Low intent", description: "Some interest, but weak or old." },
  EXPLORATORY: { label: "Exploring", description: "Asking questions or describing a problem, not yet ready to act." },
  MEDIUM: { label: "Medium intent", description: "Real interest from recent, consistent signals." },
  HIGH: { label: "High intent", description: "Strong, recent and consistent signals of buying intent." },
  BOOKING_READY: { label: "Ready to book", description: "The lead asked for a meeting, demo or callback." },
  PURCHASE_READY: { label: "Ready to buy", description: "The lead asked to buy, sign up or start a trial." },
  NOT_NOW: { label: "Not now", description: "The lead said to come back later. Follow-up waits until then." },
  NEGATIVE: { label: "Not interested", description: "The lead said no, or asked not to be contacted." },
};

/** The nine families the Lead page groups actions into. */
export const NBA_FAMILIES = ["Ask", "Answer", "Follow up", "Book", "Checkout", "Escalate", "Nurture", "Disqualify", "Wait"] as const;
export type NbaFamily = (typeof NBA_FAMILIES)[number];

export const NBA_ACTION_COPY: Record<NbaAction, { label: string; family: NbaFamily; description: string }> = {
  ASK: { label: "Ask a question", family: "Ask", description: "Ask the one question worth most right now." },
  ANSWER: { label: "Answer their question", family: "Answer", description: "Answer what the lead asked, and ask nothing more." },
  ANSWER_AND_ASK: {
    label: "Answer, then ask",
    family: "Answer",
    description: "Answer what the lead asked first, then ask one question.",
  },
  INFORM: { label: "Follow up with value", family: "Follow up", description: "Share something useful with a soft next step." },
  CTA_BOOK: { label: "Offer a meeting", family: "Book", description: "Move to booking; nothing more needs asking first." },
  CTA_CHECKOUT: { label: "Offer checkout", family: "Checkout", description: "Send the approved checkout link." },
  CTA_SIGNUP: { label: "Offer sign-up", family: "Checkout", description: "Send the approved sign-up or trial link." },
  ESCALATE: { label: "Hand to a person", family: "Escalate", description: "A person on the team should take this lead now." },
  WAIT: { label: "Wait", family: "Wait", description: "Send nothing until the lead's stated time." },
  NURTURE: { label: "Nurture", family: "Nurture", description: "Keep in touch, remembering what is already known." },
  DISQUALIFY: { label: "Disqualify", family: "Disqualify", description: "The lead does not fit; stop pursuing it." },
  NO_ACTION: { label: "Stop follow-up", family: "Wait", description: "Send nothing: the lead is not to be pursued." },
};

export const NBA_RULE_COPY: Record<NbaRule, string> = {
  R1_BINDING_VERDICT: "A binding reply (an opt-out, a complaint or a request for a person) decides.",
  R2_NEGATIVE_OR_SUPPRESSED: "The lead is not interested, suppressed or opted out, so nothing is pursued.",
  R3_DISQUALIFIED: "A confirmed fact or the rules disqualify the lead.",
  R4_ESCALATE: "Something here needs a person: value, confidence, or an objection that always hands over.",
  R5_LEAD_ASKED: "The lead asked a question, so it is answered first.",
  R6_NOT_NOW: "The lead said not now, so follow-up waits.",
  R7_BOOKING_READY: "The lead is ready to book, so booking is not slowed down.",
  R8_PURCHASE_READY: "The lead is ready to buy, so the direct close is offered.",
  R9_ASK: "One question is worth asking before the next step.",
  R10_THRESHOLD_MET: "Enough is known for the goal's next step.",
  R11_LOW_INTENT: "Intent is low, so value comes before questions.",
  R12_FALLBACK: "No rule fitted, so a person is asked to decide.",
};

export const DIMENSION_STATUS_COPY: Record<DimensionStatus, { label: string; description: string }> = {
  CONFIRMED: { label: "Confirmed", description: "The lead said so, or a person set it." },
  INFERRED: { label: "Inferred", description: "Worked out from a form, a field or a mention. Never mistaken for an answer." },
  UNKNOWN: { label: "Unknown", description: "Not known yet. Unknown is not a negative." },
  CONFLICTING: { label: "Conflicting", description: "Two live values disagree. It is clarified before it can count." },
};

export const INTENT_COMPONENT_COPY: Record<IntentScoreComponent, { label: string; description: string }> = {
  EXPLICIT: { label: "Explicit requests", description: "What the lead asked for: a meeting, a price, a trial." },
  BEHAVIOURAL: { label: "Behaviour and context", description: "First-party behaviour and permitted context signals." },
  CONVERSATIONAL: { label: "Conversation", description: "Urgency, timeframe, dissatisfaction, readiness." },
  RECENCY: { label: "Recency", description: "How recent the newest positive signal is." },
  CONSISTENCY: { label: "Consistency", description: "Whether anything negative contradicts the positives." },
};

export const SIGNAL_SOURCE_COPY: Record<SignalSource, string> = {
  FORM: "Form",
  REPLY: "Reply",
  CLASSIFICATION: "Reply classification",
  BOOKING: "Booking",
  OPPORTUNITY: "Opportunity",
  TOUCH: "Source touch",
  ENRICHMENT: "Enrichment",
  SOURCING: "Find Leads",
  MANUAL: "Set by a person",
  AI_ASSIST: "AI assist",
};

export const FACT_SOURCE_COPY: Record<FactSource, string> = {
  ANSWER: "Answer",
  FORM: "Form",
  LEAD_FIELD: "Lead record",
  ENRICHMENT: "Enrichment",
  REPLY: "Mentioned in a reply",
  AI_ASSIST: "AI assist",
  CRM: "CRM",
  MANUAL: "Set by a person",
};

export const QUESTION_PURPOSE_COPY: Record<QuestionPurpose, string> = {
  DISCOVER: "to find out something not yet known",
  VERIFY: "to check an inferred value before it is relied on",
  CLARIFY: "to resolve two answers that disagree",
  DISQUALIFY_CHECK: "to check a fact that could rule the lead out",
};

export const ENGINE_MODE_COPY: Record<QiEngineMode, { label: string; description: string }> = {
  OFF: { label: "Off", description: "No assessment is made. The assistant uses its existing question order." },
  SHADOW: {
    label: "Shadow",
    description: "Assessments are made and shown, and compared with the existing question order, but the assistant does not act on them yet.",
  },
  LIVE: { label: "Live", description: "The next best action is what the assistant acts on." },
};

export function signalTypeLabel(type: string): string {
  return humanise(type);
}

export function goalLabel(goal: string): string {
  return (GOAL_KEYS as readonly string[]).includes(goal) ? GOAL_LABEL[goal as GoalKey] : humanise(goal);
}

/* ============================================================ search sets */

/** "Strong intent" for list filters and `lead.search`. */
export const STRONG_INTENT_STATES = ["HIGH", "BOOKING_READY", "PURCHASE_READY"] as const satisfies readonly IntentState[];

/** Completeness strictly below this is "incomplete qualification". */
export const INCOMPLETE_BELOW = 1;

/* ============================================================ assessment */

export type AssessmentRow = {
  id: string;
  lead_id: string;
  intent_state: string;
  intent_score: number;
  intent_categories: unknown;
  intent_evidence: unknown;
  intent_contradictions: unknown;
  intent_confidence: number | string;
  valid_until: string | null;
  goal: string;
  qualification_completeness: number | string;
  dimension_status: unknown;
  nba: unknown;
  engine_version: string;
  engine_mode: string;
  legacy_decision?: unknown;
  trigger_event: string;
  created_at: string;
};

export type LegacyDecision = NonNullable<LeadAssessmentWrite["legacy_decision"]>;

export type AssessmentView = {
  id: string;
  leadId: string;
  intentState: IntentState;
  intentScore: number;
  categories: IntentCategoryScores;
  evidence: IntentEvidenceItem[];
  contradictions: IntentEvidenceItem[];
  confidence: number;
  validUntil: string | null;
  goal: GoalKey;
  completeness: number;
  dimensions: DimensionStatusEntry[];
  /** Null when the stored NBA does not parse (never guessed at). */
  nba: NextBestAction | null;
  engineVersion: string;
  engineMode: AssessmentEngineMode;
  legacyDecision: LegacyDecision | null;
  triggerEvent: string;
  createdAt: string;
  /** Set when the trigger was a person's override. */
  manualOverride: "INTENT" | "NBA" | null;
};

const EMPTY_CATEGORIES: IntentCategoryScores = { EXPLICIT: 0, BEHAVIOURAL: 0, CONVERSATIONAL: 0, RECENCY: 0, CONSISTENCY: 0 };

function arrayOf<T>(raw: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

const legacySchema = leadAssessmentWriteSchema.shape.legacy_decision;

export const INTENT_OVERRIDE_TRIGGER = "manual.intent_override";
export const NBA_OVERRIDE_TRIGGER = "manual.nba_override";

/**
 * A stored assessment row, read defensively: a malformed piece is dropped (or
 * the NBA reported as null), never repaired into something the engine did not
 * say. Returns null only when the core columns are not a known state.
 */
export function parseAssessmentRow(row: AssessmentRow): AssessmentView | null {
  if (!(INTENT_STATES as readonly string[]).includes(row.intent_state)) return null;
  if (!(GOAL_KEYS as readonly string[]).includes(row.goal)) return null;
  const categories = intentCategoryScoresSchema.safeParse(row.intent_categories);
  const nba = nextBestActionSchema.safeParse(row.nba);
  const legacy = legacySchema.safeParse(row.legacy_decision ?? null);
  return {
    id: row.id,
    leadId: row.lead_id,
    intentState: row.intent_state as IntentState,
    intentScore: Math.max(0, Math.min(100, Math.round(Number(row.intent_score) || 0))),
    categories: categories.success ? categories.data : EMPTY_CATEGORIES,
    evidence: arrayOf(row.intent_evidence, (item) => {
      const parsed = intentEvidenceItemSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    }),
    contradictions: arrayOf(row.intent_contradictions, (item) => {
      const parsed = intentEvidenceItemSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    }),
    confidence: clamp01(Number(row.intent_confidence)),
    validUntil: row.valid_until,
    goal: row.goal as GoalKey,
    completeness: clamp01(Number(row.qualification_completeness)),
    dimensions: arrayOf(row.dimension_status, (item) => {
      const parsed = dimensionStatusEntrySchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    }),
    nba: nba.success ? nba.data : null,
    engineVersion: row.engine_version,
    engineMode: row.engine_mode === "LIVE" ? "LIVE" : "SHADOW",
    legacyDecision: legacy.success ? legacy.data : null,
    triggerEvent: row.trigger_event,
    createdAt: row.created_at,
    manualOverride: row.trigger_event.startsWith(INTENT_OVERRIDE_TRIGGER)
      ? "INTENT"
      : row.trigger_event.startsWith(NBA_OVERRIDE_TRIGGER)
        ? "NBA"
        : null,
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/* ================================================================= facts */

export type FactRow = {
  id: string;
  lead_id: string;
  service_id: string | null;
  dimension: string;
  value: string;
  value_normalised: string | null;
  state: string;
  source: string;
  source_ref: string | null;
  question_id: string | null;
  question_intent_key: string | null;
  confidence: number | string;
  observed_at: string;
  valid_until: string | null;
  verified_at: string | null;
  set_by: string | null;
  superseded_at: string | null;
};

export function toFact(row: FactRow): QualificationFact {
  return {
    id: row.id,
    leadId: row.lead_id,
    serviceId: row.service_id,
    dimension: row.dimension as FactDimension,
    value: row.value,
    valueNormalised: row.value_normalised,
    state: row.state as FactState,
    source: row.source as FactSource,
    sourceRef: row.source_ref,
    questionId: row.question_id,
    questionIntentKey: row.question_intent_key,
    confidence: clamp01(Number(row.confidence)),
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    verifiedAt: row.verified_at,
    setBy: row.set_by,
    supersededAt: row.superseded_at,
  };
}

export type DimensionBoardItem = {
  dimension: FactDimension;
  label: string;
  status: DimensionStatus;
  required: boolean;
  material: boolean;
  stale: boolean;
  /** The live facts behind the status (CONFLICTING has two or more). */
  facts: QualificationFact[];
};

export type DimensionBoard = Record<DimensionStatus, DimensionBoardItem[]>;

/**
 * The status of each dimension from live facts alone, used when there is no
 * assessment yet (engine off, or not assessed). The fact store's own rules
 * (facts.ts `deriveDimensionStatuses`) decide, so the page and the engine can
 * never disagree about what CONFLICTING or stale means. The engine's stored
 * `dimension_status` wins whenever an assessment exists.
 */
export function deriveDimensionStatus(facts: QualificationFact[], now: Date = new Date()): DimensionStatusEntry[] {
  return deriveDimensionStatuses(facts, now);
}

/** The four columns of the Lead page's Qualification section. */
export function dimensionBoard(dimensions: DimensionStatusEntry[], facts: QualificationFact[]): DimensionBoard {
  const board: DimensionBoard = { CONFIRMED: [], INFERRED: [], UNKNOWN: [], CONFLICTING: [] };
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  for (const entry of dimensions) {
    const own = entry.fact_ids.map((id) => byId.get(id)).filter((f): f is QualificationFact => Boolean(f));
    board[entry.status].push({
      dimension: entry.dimension,
      label: dimensionLabel(entry.dimension),
      status: entry.status,
      required: entry.required,
      material: entry.material,
      stale: entry.stale,
      facts: own.length > 0 ? own : facts.filter((f) => f.dimension === entry.dimension && !f.supersededAt && f.state !== "REJECTED"),
    });
  }
  // Required first, then alphabetical: what matters is at the top of each column.
  for (const status of DIMENSION_STATUSES) {
    board[status].sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label));
  }
  return board;
}

/* ====================================================== why this question */

export type ValueTermExplanation = {
  term: keyof NonNullable<NextBestAction["question_value"]>;
  label: string;
  value: number;
  /** "+" raises the question's value, "-" lowers it. */
  direction: "+" | "-";
  sentence: string;
};

const TERM_COPY: Record<Exclude<keyof NonNullable<NextBestAction["question_value"]>, "total">, { label: string; direction: "+" | "-"; say: string }> = {
  decisionRelevance: { label: "Decision relevance", direction: "+", say: "how much the answer bears on the next decision" },
  informationGain: { label: "Information gain", direction: "+", say: "how much we would learn that is not already known" },
  salesProgression: { label: "Sales progression", direction: "+", say: "whether answering moves the sale to its next step" },
  intentRelevance: { label: "Fit with intent", direction: "+", say: "how well it suits how ready the lead is" },
  friction: { label: "Friction", direction: "-", say: "how much effort it asks of the lead" },
  repetitionRisk: { label: "Repetition risk", direction: "-", say: "the risk of repeating a question already asked" },
  prematurity: { label: "Too early", direction: "-", say: "whether it is too early in the conversation to ask" },
  pKnown: { label: "Probably known", direction: "-", say: "how likely it is we already know the answer" },
};

function degree(value: number): string {
  if (value >= 0.7) return "High";
  if (value >= 0.4) return "Moderate";
  if (value > 0) return "Low";
  return "No";
}

/** The value terms of the chosen question, in words (§B.8 / CD-13). */
export function explainQuestionValue(value: NextBestAction["question_value"]): ValueTermExplanation[] {
  if (!value) return [];
  return (Object.keys(TERM_COPY) as (keyof typeof TERM_COPY)[]).map((term) => {
    const copy = TERM_COPY[term];
    const v = Number(value[term]) || 0;
    return {
      term,
      label: copy.label,
      value: Math.round(v * 100) / 100,
      direction: copy.direction,
      sentence: `${degree(v)} ${copy.say}${copy.direction === "-" && v > 0 ? " (counts against it)" : ""}.`,
    };
  });
}

export type WhyThisQuestion = {
  intentKey: string;
  dimension: FactDimension;
  dimensionLabel: string;
  purpose: string;
  rendering: string;
  total: number;
  askFloor: number;
  terms: ValueTermExplanation[];
  summary: string;
};

export function whyThisQuestion(nba: NextBestAction | null): WhyThisQuestion | null {
  if (!nba?.question_intent) return null;
  const q = nba.question_intent;
  const total = Math.round((nba.question_value?.total ?? 0) * 100) / 100;
  const terms = explainQuestionValue(nba.question_value);
  const strongest = [...terms].filter((t) => t.direction === "+").sort((a, b) => b.value - a.value)[0];
  const drag = [...terms].filter((t) => t.direction === "-").sort((a, b) => b.value - a.value)[0];
  const parts = [
    `Asked ${QUESTION_PURPOSE_COPY[q.purpose]}: ${dimensionLabel(q.dimension).toLowerCase()}.`,
    nba.question_value
      ? `Its value is ${total} against a floor of ${QUESTION_VALUE_FLOORS.ASK}${strongest ? `, mostly from ${strongest.label.toLowerCase()}` : ""}${drag && drag.value > 0 ? `, less ${drag.label.toLowerCase()}` : ""}.`
      : "",
  ].filter(Boolean);
  return {
    intentKey: q.key,
    dimension: q.dimension,
    dimensionLabel: dimensionLabel(q.dimension),
    purpose: QUESTION_PURPOSE_COPY[q.purpose],
    rendering: q.rendering,
    total,
    askFloor: QUESTION_VALUE_FLOORS.ASK,
    terms,
    summary: parts.join(" "),
  };
}

/* ======================================================= unknowns / status */

export type Unknowns = {
  required: { dimension: string; label: string }[];
  conflicting: { dimension: string; label: string }[];
  toVerify: { dimension: string; label: string }[];
  stale: { dimension: string; label: string }[];
  completeness: number | null;
};

/** "What do we still need?" from an assessment, or from facts alone. */
export function qualificationUnknowns(view: AssessmentView | null, derived: DimensionStatusEntry[] = []): Unknowns {
  const dimensions = view?.dimensions ?? derived;
  const pick = (entries: DimensionStatusEntry[]) =>
    entries.map((e) => ({ dimension: e.dimension, label: dimensionLabel(e.dimension) }));
  const required = new Set<string>(view?.nba?.unknown_required_dimensions ?? []);
  for (const e of dimensions) if (e.required && e.status === "UNKNOWN") required.add(e.dimension);
  return {
    required: [...required].map((dimension) => ({ dimension, label: dimensionLabel(dimension) })),
    conflicting: pick(dimensions.filter((e) => e.status === "CONFLICTING")),
    toVerify: pick(dimensions.filter((e) => e.status === "INFERRED" && e.material)),
    stale: pick(dimensions.filter((e) => e.stale)),
    completeness: view ? view.completeness : null,
  };
}

export type QualificationStatusSummary = {
  verdict: string;
  qualified: boolean;
  assessed: boolean;
  intentState: IntentState | null;
  intentScore: number | null;
  completeness: number | null;
  nextAction: NbaAction | null;
  goal: GoalKey | null;
  headline: string;
};

const VERDICT_WORDS: Record<string, string> = {
  QUALIFIED: "Qualified by your rules",
  NOT_QUALIFIED: "Not qualified by your rules",
  REVIEW: "Waiting for a person to review",
  PENDING: "Not decided yet: a required question is unanswered",
};

/**
 * "Is this lead qualified?" The deterministic engine's verdict is the answer
 * (CLAUDE.md resolved conflict 1); intent, completeness and the next action are
 * context around it, never a second verdict.
 */
export function qualificationStatus(verdict: string, view: AssessmentView | null): QualificationStatusSummary {
  const parts = [VERDICT_WORDS[verdict] ?? humanise(verdict)];
  if (view) {
    parts.push(`${Math.round(view.completeness * 100)}% of the required picture is known`);
    parts.push(INTENT_STATE_COPY[view.intentState].label.toLowerCase());
    if (view.nba) parts.push(`next: ${NBA_ACTION_COPY[view.nba.next_action].label.toLowerCase()}`);
  } else {
    parts.push("not assessed yet");
  }
  return {
    verdict,
    qualified: verdict === "QUALIFIED",
    assessed: Boolean(view),
    intentState: view?.intentState ?? null,
    intentScore: view?.intentScore ?? null,
    completeness: view?.completeness ?? null,
    nextAction: view?.nba?.next_action ?? null,
    goal: view?.goal ?? null,
    headline: `${parts.join("; ")}.`,
  };
}

/* ============================================================== overrides */

export type OverrideResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Manual intent states that are also recorded as evidence, so they survive reassessment. */
export const INTENT_OVERRIDE_SIGNAL: Partial<Record<IntentState, SignalType>> = {
  NEGATIVE: "NOT_INTERESTED",
  NOT_NOW: "NOT_NOW",
  BOOKING_READY: "BOOKING_REQUEST",
  PURCHASE_READY: "PURCHASE_REQUEST",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** §B.5 decay for the four manual evidence types: half-life and hard stop. */
const MANUAL_SIGNAL_DECAY: Record<string, { halfLifeHours: number; hardStopDays: number }> = {
  NOT_INTERESTED: { halfLifeHours: 90 * 24, hardStopDays: 365 },
  NOT_NOW: { halfLifeHours: 7 * 24, hardStopDays: INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS },
  BOOKING_REQUEST: { halfLifeHours: 5 * 24, hardStopDays: 30 },
  PURCHASE_REQUEST: { halfLifeHours: 5 * 24, hardStopDays: 30 },
};

export const OVERRIDE_REASON_MIN = 3;
export const OVERRIDE_REASON_MAX = 200;

/**
 * The evidence row an intent override writes, when the state has one. A
 * person's "they said not now, back in March" is a NOT_NOW signal with that
 * resume date, so the next reassessment reaches the same state on its own.
 */
export function manualIntentSignal(input: {
  leadId: string;
  state: IntentState;
  reason: string;
  until: string | null;
  now: Date;
  correlationId: string;
}): IntentSignalWrite | null {
  const type = INTENT_OVERRIDE_SIGNAL[input.state];
  if (!type) return null;
  const decay = MANUAL_SIGNAL_DECAY[type];
  const observed = input.now.toISOString();
  const defaultStop = new Date(input.now.getTime() + decay.hardStopDays * DAY).toISOString();
  const resume = type === "NOT_NOW" ? (input.until ?? defaultStop) : null;
  const expires = type === "NOT_NOW" ? resume : (input.until ?? defaultStop);
  return intentSignalWriteSchema.parse({
    lead_id: input.leadId,
    service_id: null,
    category: SIGNAL_TYPE_CATEGORY[type],
    signal_type: type,
    polarity: signalPolarity(type),
    strength: 1,
    confidence: 1,
    source: "MANUAL",
    source_ref: `manual:${input.correlationId}`.slice(0, 200),
    observed_at: observed,
    half_life_hours: decay.halfLifeHours,
    flat_until: type === "NOT_NOW" ? resume : null,
    expires_at: expires,
    resume_at: resume,
    reason: `Set by a person: ${input.reason}`.slice(0, 200),
    evidence_excerpt: null,
    dedupe_key: `manual:${input.correlationId}:${type}`.slice(0, 200),
    rule_version: SIGNAL_RULES_VERSION,
  });
}

/** Keeps a manual state's score inside that state's band of the §B.4 table. */
export function scoreForState(state: IntentState, score: number): number {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  switch (state) {
    case "NEGATIVE":
      return Math.min(s, INTENT_THRESHOLDS.NEGATIVE_CAP);
    case "NOT_NOW":
      return Math.min(s, INTENT_THRESHOLDS.NOT_NOW_CAP);
    case "HIGH":
    case "BOOKING_READY":
    case "PURCHASE_READY":
      return Math.max(s, INTENT_THRESHOLDS.HIGH);
    case "MEDIUM":
      return Math.min(Math.max(s, INTENT_THRESHOLDS.MEDIUM), INTENT_THRESHOLDS.HIGH - 1);
    case "EXPLORATORY":
      return Math.min(Math.max(s, INTENT_THRESHOLDS.EXPLORATORY_MIN), INTENT_THRESHOLDS.MEDIUM - 1);
    case "LOW":
      return Math.min(Math.max(s, INTENT_THRESHOLDS.LOW_MIN), INTENT_THRESHOLDS.MEDIUM - 1);
    case "NO_DETECTED_INTENT":
      return Math.min(s, INTENT_THRESHOLDS.LOW_MIN - 1);
  }
}

function writeFrom(view: AssessmentView, nba: NextBestAction, patch: Partial<LeadAssessmentWrite>): LeadAssessmentWrite {
  return {
    intent_state: nba.intent_state,
    intent_score: nba.intent_score,
    intent_categories: view.categories,
    intent_evidence: view.evidence.slice(0, 40),
    intent_contradictions: view.contradictions.slice(0, 20),
    intent_confidence: view.confidence,
    valid_until: view.validUntil,
    goal: view.goal,
    qualification_completeness: view.completeness,
    dimension_status: view.dimensions.slice(0, 30),
    nba,
    engine_version: QIE_ENGINE_VERSION,
    engine_mode: view.engineMode,
    legacy_decision: view.engineMode === "SHADOW" ? view.legacyDecision : null,
    trigger_event: view.triggerEvent,
    ...patch,
  };
}

function validated(write: LeadAssessmentWrite): OverrideResult<LeadAssessmentWrite> {
  const parsed = leadAssessmentWriteSchema.safeParse(write);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "That override is not consistent with the assessment." };
  }
  return { ok: true, value: parsed.data };
}

function reasonLine(prefix: string, reason: string): string {
  return `${prefix}: ${reason.trim()}`.slice(0, 400);
}

/**
 * A new assessment carrying a person's intent state. The NBA is brought into
 * line with it the way the rules would: a NEGATIVE lead is never asked or
 * pitched (it stops), and NOT_NOW waits until the stated date.
 */
export function overrideIntent(
  view: AssessmentView,
  input: { state: IntentState; reason: string; until: string | null; triggerEvent: string },
): OverrideResult<LeadAssessmentWrite> {
  if (!view.nba) return { ok: false, message: "The current assessment has no readable next action. Re-run qualification first." };
  const score = scoreForState(input.state, view.intentScore);
  let nba: NextBestAction = {
    ...view.nba,
    intent_state: input.state,
    intent_score: score,
    reason: reasonLine(`Intent set to ${INTENT_STATE_COPY[input.state].label.toLowerCase()} by a person`, input.reason),
  };
  const pursues =
    (ASKING_ACTIONS as readonly string[]).includes(nba.next_action) || (CTA_ACTIONS as readonly string[]).includes(nba.next_action);
  if (input.state === "NEGATIVE" && pursues) {
    nba = { ...nba, next_action: "NO_ACTION", rule: "R2_NEGATIVE_OR_SUPPRESSED", question_intent: null, question_value: null, handover_reason: null, resume_at: null, model_call_required: false };
  }
  if (input.state === "NOT_NOW") {
    const resume = input.until ?? null;
    nba = { ...nba, next_action: "WAIT", rule: "R6_NOT_NOW", question_intent: null, question_value: null, handover_reason: null, resume_at: resume, suppress: false, model_call_required: false };
  }
  return validated(
    writeFrom(view, nba, {
      intent_state: input.state,
      intent_score: score,
      valid_until: input.until ?? view.validUntil,
      trigger_event: input.triggerEvent,
    }),
  );
}

/** The actions a person may set the NBA to. ASK needs a planned question, so it is the engine's alone. */
export const NBA_OVERRIDE_ACTIONS = [
  "INFORM",
  "CTA_BOOK",
  "CTA_CHECKOUT",
  "CTA_SIGNUP",
  "ESCALATE",
  "WAIT",
  "NURTURE",
  "DISQUALIFY",
  "NO_ACTION",
] as const satisfies readonly NbaAction[];
export type NbaOverrideAction = (typeof NBA_OVERRIDE_ACTIONS)[number];

export function overrideNextBestAction(
  view: AssessmentView,
  input: {
    action: NbaOverrideAction;
    reason: string;
    until: string | null;
    handoverReason: HandoverReason | null;
    triggerEvent: string;
  },
): OverrideResult<LeadAssessmentWrite> {
  if (!view.nba) return { ok: false, message: "The current assessment has no readable next action. Re-run qualification first." };
  if (view.intentState === "NEGATIVE" && (CTA_ACTIONS as readonly string[]).includes(input.action)) {
    return { ok: false, message: "This lead is not interested. Change its intent first if that is no longer true." };
  }
  if (input.action === "ESCALATE" && input.handoverReason && !(NBA_HANDOVER_REASONS as readonly string[]).includes(input.handoverReason)) {
    return { ok: false, message: "That hand-over reason is not one the next best action uses." };
  }
  const previous = view.nba;
  const alternatives = [
    { action: previous.next_action, intent: previous.question_intent?.key ?? null, value: previous.question_value?.total ?? 0 },
    ...previous.alternatives,
  ].slice(0, 5);
  const nba: NextBestAction = {
    ...previous,
    next_action: input.action,
    reason: reasonLine(`Set to "${NBA_ACTION_COPY[input.action].label}" by a person`, input.reason),
    question_intent: null,
    question_value: null,
    expected_information_gain: 0,
    handover_reason: input.action === "ESCALATE" ? (input.handoverReason ?? "POLICY") : null,
    resume_at: input.action === "WAIT" ? input.until : null,
    suppress: false,
    model_call_required: NBA_ACTION_NEEDS_MODEL[input.action],
    alternatives,
  };
  return validated(
    writeFrom(view, nba, {
      valid_until: input.until ?? view.validUntil,
      trigger_event: input.triggerEvent,
    }),
  );
}

/* ================================================================= facts */

export const FACT_ACTIONS = ["CONFIRM", "REJECT", "SET"] as const;
export type FactAction = (typeof FACT_ACTIONS)[number];
// Writing a person's value is the fact store's job (service.ts
// `confirmQualificationFact` / `rejectQualificationFact`), through its merge
// rules, so there is one path by which a fact enters the store.

/* ========================================================== audit history */

/** Registry operations whose audit rows form a lead's qualification history. */
export const QUALIFICATION_AUDIT_ACTIONS = [
  "qualification.requalify",
  "qualification.set_fact",
  "qualification.override_intent",
  "qualification.override_nba",
] as const;

export type OverrideHistoryRow = {
  id: string;
  at: string;
  action: string;
  label: string;
  actor: string | null;
  caller: string | null;
  detail: string | null;
};

const HISTORY_LABEL: Record<string, string> = {
  "qualification.requalify": "Qualification re-run",
  "qualification.set_fact": "Fact changed",
  "qualification.override_intent": "Intent overridden",
  "qualification.override_nba": "Next action overridden",
};

/** One audit row, read into the Lead page's override history. */
export function historyRow(row: {
  id: string;
  action: string;
  created_at: string;
  actor: string | null;
  metadata: unknown;
}): OverrideHistoryRow {
  const meta = (row.metadata ?? {}) as { caller?: unknown; after?: Record<string, unknown> | null };
  const after = meta.after ?? {};
  const bits = [
    typeof after.dimension === "string" ? dimensionLabel(after.dimension) : null,
    typeof after.fact_action === "string" ? humanise(after.fact_action) : null,
    typeof after.value === "string" ? `"${after.value}"` : null,
    typeof after.intent_state === "string" && (INTENT_STATES as readonly string[]).includes(after.intent_state)
      ? INTENT_STATE_COPY[after.intent_state as IntentState].label
      : null,
    typeof after.next_action === "string" && (NBA_ACTIONS as readonly string[]).includes(after.next_action)
      ? NBA_ACTION_COPY[after.next_action as NbaAction].label
      : null,
    typeof after.reason === "string" ? after.reason : null,
  ].filter(Boolean);
  return {
    id: row.id,
    at: row.created_at,
    action: row.action,
    label: HISTORY_LABEL[row.action] ?? humanise(row.action),
    actor: row.actor,
    caller: typeof meta.caller === "string" ? meta.caller : null,
    detail: bits.length > 0 ? bits.join(" · ") : null,
  };
}

/* ========================================================= engine mode */

export function isEngineMode(value: unknown): value is QiEngineMode {
  return typeof value === "string" && (QI_ENGINE_MODES as readonly string[]).includes(value);
}

/** NBA rules list, re-exported for the rule legend. */
export { NBA_RULES, INTENT_SCORE_COMPONENTS, INTENT_STATES };
