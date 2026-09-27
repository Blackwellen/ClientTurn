/**
 * Adaptive question selection (design doc 04 §3, brief §§32–35).
 *
 * Replaces "first unanswered question by position". The deterministic engine
 * (engine.ts) is still the judge of every answer: this module only decides
 * WHICH question is worth asking next, and when to stop asking.
 *
 *   1. Mark what is already known. A configured question is known when
 *        - an answer row with a matched value exists (ANSWER), or
 *        - a lead field answers it: postcode, service, enrichment (LEAD_FIELD), or
 *        - an accepted memory fact with confidence >= 0.8 answers it (FACT).
 *      A known question is NEVER returned. LEAD_FIELD and FACT answers are
 *      labelled `inferred`, and an inferred value only counts when it passes the
 *      same deterministic matcher a typed reply would (`matchAnswer`), so an
 *      inference can never produce a value the question could not accept.
 *   2. Score what is left with the Qualification Intelligence value function
 *      (qualification-intelligence/question-value.ts, `qv-1`):
 *        decisionRelevance + informationGain·(1 − pKnown) + salesProgression
 *          + intentRelevance − friction − repetitionRisk − prematurity − pKnown
 *      using the library dimension each question maps to. Budget is premature
 *      until the problem is stated; authority is premature until the lead has
 *      engaged. A question already asked twice without an answer is dropped:
 *      the sticky re-ask is limited to one.
 *   3. Stop when the motion's decision threshold is met: enough is known to
 *      take the next commercial step. Optional questions are then dropped.
 *      Required questions are never dropped, because the engine cannot reach a
 *      verdict (and booking cannot open) while one is unanswered.
 *   4. The workspace's qualification depth moves that stopping point
 *      (`candidatesForDepth`):
 *        LIGHT     before the threshold, only questions that fill a missing
 *                  threshold dimension (or are required); after it, required only.
 *        STANDARD  the rule in 3.
 *        THOROUGH  no threshold stop: every applicable question is asked.
 *      Without a motion there is no threshold, so every depth behaves as STANDARD.
 *
 * Pure: no server-only, no Supabase. Imported by tests with explicit `.ts`.
 */

import type { Question } from "./engine.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import { isDecisionThresholdMet, missingForThreshold, MOTIONS } from "../sales-library/motions.ts";
import { adjustedPrematurity, questionValue } from "../qualification-intelligence/question-value.ts";
import { MAX_ASKS_PER_INTENT, type IntentState } from "../qualification-intelligence/types.ts";
import { archetypeFor, qualificationPlan } from "../sales-library/archetypes.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { QualificationDepth } from "../settings/ai-selling.ts";
import type {
  QualificationDimension,
  QualificationDimensionKey,
  SalesMotion,
} from "../sales-library/types.ts";

// ------------------------------------------------------------------ shapes

/** A configured question as loaded for a turn (moved from jobs/handlers/qualify.ts). */
export type QuestionRecord = Omit<Question, "options"> & {
  questionText: string;
  position: number;
  options: { value: string; label: string }[];
};

export type KnownSource = "ANSWER" | "LEAD_FIELD" | "FACT";

export type KnownQuestion = {
  questionId: string;
  questionText: string;
  dimension: QualificationDimensionKey | null;
  source: KnownSource;
  /** The matched value, as the engine would store it. */
  value: string;
  /** True for LEAD_FIELD and FACT: not something the lead said in reply to it. */
  inferred: boolean;
  confidence: number;
  required: boolean;
  /**
   * For FACT: where the fact came from (lead_qualification_facts.source, e.g.
   * FORM for an ad-form answer, MANUAL, ENRICHMENT). Drives the provenance an
   * inferred answer is recorded with (qualify.ts recordInferredAnswers).
   */
  factSource?: string;
};

/** What the lead record already says, keyed by the dimension it answers. */
export type LeadFieldValues = Partial<Record<QualificationDimensionKey, string | null>>;

/**
 * A remembered fact about the lead (an accepted extraction, an enrichment
 * value). Anything under MIN_FACT_CONFIDENCE is ignored outright.
 */
export type MemoryFact = {
  dimension?: QualificationDimensionKey | null;
  questionId?: string | null;
  value: string;
  confidence: number;
  source: string;
};

export type StopReason = "THRESHOLD_MET" | "NO_QUESTIONS_LEFT";

export type ScoredCandidate = {
  questionId: string;
  dimension: QualificationDimensionKey | null;
  required: boolean;
  position: number;
  value: number;
  components: {
    informationGain: number;
    decisionRelevance: number;
    commercialValue: number;
    friction: number;
    prematurity: number;
    /** Always 0 since qv-1: threshold and required weight moved into the terms below. */
    bonus: number;
    salesProgression: number;
    intentRelevance: number;
    repetitionRisk: number;
    pKnown: number;
  };
};

export type NextQuestionInput = {
  questions: QuestionRecord[];
  answers: { questionId: string; answerValue: string | null }[];
  serviceId: string | null;
  leadFields?: LeadFieldValues;
  facts?: MemoryFact[];
  /** Explicit question → library dimension mapping; wins over inference. */
  dimensionMap?: Record<string, QualificationDimensionKey>;
  /** Null: no threshold stop (the configured questions remain the plan). */
  motion?: SalesMotion | null;
  archetypeKey?: string | null;
  stage?: ConversationStage;
  /** The question asked last turn. Still unknown ⇒ asked again, not reshuffled. */
  currentQuestionId?: string | null;
  /**
   * The workspace's qualification depth (Settings -> AI & selling). Absent =
   * STANDARD, the behaviour described at the top of this file.
   */
  depth?: QualificationDepth | null;
  /**
   * How often each configured question has been put to the lead, and whether
   * it was answered. A question asked MAX_ASKS_PER_INTENT (2) times without an
   * answer is not asked again (08 §B.8: the sticky re-ask is limited to one).
   */
  askHistory?: { questionId: string; asked: number; answered?: boolean }[];
  /** The lead's intent state when an assessment exists (the intentRelevance term). */
  intentState?: IntentState | null;
  /** False before the lead's first reply: open questions cost more then. */
  leadHasReplied?: boolean;
};

export type NextQuestionResult = {
  question: QuestionRecord | null;
  /** Set exactly when `question` is null. */
  stopReason: StopReason | null;
  /** Applicable questions already known, answered or inferred. */
  known: KnownQuestion[];
  /** The subset of `known` that was inferred and has no answer row yet. */
  inferred: KnownQuestion[];
  /** Every dimension known, including lead fields with no configured question. */
  knownDimensions: QualificationDimensionKey[];
  thresholdMet: boolean;
  missingForThreshold: QualificationDimensionKey[];
  /** Questions still worth asking after the threshold rule, best first. */
  ranked: ScoredCandidate[];
  /** Applicable required questions with no known value. */
  outstandingRequired: number;
};

// ------------------------------------------------------------------ policy

export const MIN_FACT_CONFIDENCE = 0.8;

/** A question that maps to no library dimension still has to be ranked. */
const UNMAPPED = {
  informationGain: 0.6,
  commercialValue: 0.5,
  friction: 0.2,
  prematurity: 0.1,
  salesProgression: 0.4,
  intentRelevance: 0.4,
};

// --------------------------------------------------------------- matching

/**
 * Deterministic answer matching (moved from jobs/handlers/qualify.ts). Nothing
 * is guessed: a reply that does not match a configured option returns a null
 * value, which the engine turns into REVIEW rather than a decision.
 */
export function matchAnswer(
  question: QuestionRecord,
  reply: string,
): { value: string | null; text: string } {
  const text = reply.trim();
  const normalised = text.toLowerCase().replace(/[.!?]+$/, "").trim();

  if (question.responseType === "yes_no") {
    if (["yes", "y", "yeah", "yep", "correct", "1"].includes(normalised)) {
      return { value: "yes", text };
    }
    if (["no", "n", "nope", "nah", "0"].includes(normalised)) {
      return { value: "no", text };
    }
    return { value: null, text };
  }

  if (question.responseType === "number") {
    const digits = normalised.replace(/[^\d.]/g, "");
    return {
      value: digits && Number.isFinite(Number(digits)) ? digits : null,
      text,
    };
  }

  if (question.responseType === "postcode") {
    const match = text.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    return { value: match ? match[0].replace(/\s+/g, " ") : null, text };
  }

  if (question.responseType === "text") {
    return { value: text || null, text };
  }

  // single_choice and timing: exact value, exact label, or a numbered pick.
  const exact = question.options.find(
    (option) =>
      option.value.toLowerCase() === normalised || option.label.toLowerCase() === normalised,
  );
  if (exact) return { value: exact.value, text };

  const index = Number(normalised);
  if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
    return { value: question.options[index - 1].value, text };
  }

  return { value: null, text };
}

/** The outbound wording of a question, with numbered options when it has them. */
export function questionPrompt(question: QuestionRecord): string {
  if (question.options.length === 0) return question.questionText;
  const choices = question.options
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join("\n");
  return `${question.questionText}\n${choices}`;
}

// ------------------------------------------------------ dimension mapping

/**
 * Ordered: the first matching rule wins, so the specific ones come first
 * ("who else decides" is AUTHORITY before "who" could mean anything else).
 */
const DIMENSION_RULES: { dimension: QualificationDimensionKey; pattern: RegExp }[] = [
  { dimension: "BUDGET", pattern: /\b(budget|spend|invest(ment)?|price range|afford)\b/i },
  { dimension: "STAKEHOLDERS", pattern: /\b(stakeholders?|evaluat\w*)\b/i },
  { dimension: "DECISION_PROCESS", pattern: /\b(decision process|procurement|sign[- ]?off process|approval process)\b/i },
  { dimension: "AUTHORITY", pattern: /\b(decision[- ]?maker|decid\w*|authori[sz]\w*|sign (it )?off|anyone else involved|who else)\b/i },
  { dimension: "COMPLIANCE_REQUIREMENTS", pattern: /\b(complian\w*|security requirements?|gdpr|iso ?27001|soc ?2)\b/i },
  { dimension: "SUCCESS_METRICS", pattern: /\b(measure|success look|kpis?|metrics?)\b/i },
  { dimension: "CURRENT_SOLUTION", pattern: /\b(currently (use|using|handl\w*)|at the moment|existing (provider|supplier|system|solution|agency)|current (provider|supplier|system|solution|agency|tool))\b/i },
  { dimension: "TEAM_SIZE", pattern: /\b(team size|how many (people|users|seats)|users?\b.*\bhow many|seats)\b/i },
  { dimension: "COMPANY_SIZE", pattern: /\b(employees|headcount|company size|staff|people work)\b/i },
  { dimension: "VOLUME", pattern: /\b(volumes?|per month|each month|monthly|orders)\b/i },
  { dimension: "HIRING_NEED", pattern: /\b(hir(e|ing)|recruit\w*|roles? (are you|to fill))\b/i },
  { dimension: "PROPERTY_TYPE", pattern: /\b(property|house|flat|bungalow|premises type)\b/i },
  { dimension: "LOCATION", pattern: /\b(postcode|post code|location|where (are you|is the|would the)|based)\b/i },
  { dimension: "TIMING", pattern: /\b(when|timescale|timeline|timeframe|how soon|start date|deadline)\b/i },
  { dimension: "PROJECT_SCOPE", pattern: /\b(scope|project (involve|size)|pages|deliverables?)\b/i },
  { dimension: "USE_CASE", pattern: /\b(use case|use it for|want it to do|looking to (use|achieve))\b/i },
  { dimension: "PRODUCT_INTEREST", pattern: /\b(which product|product (are you|were you))\b/i },
  { dimension: "SERVICE_NEEDED", pattern: /\b(which (of our )?services?|what service|services? (are you|do you need))\b/i },
  { dimension: "DISSATISFACTION", pattern: /\b(not working|unhappy|frustrat\w*|dissatisf\w*|how has (your|the) current)\b/i },
  { dimension: "TECHNICAL_REQUIREMENTS", pattern: /\b(integrat\w*|connect to|plug into|work with (any|your)|tech stack)\b/i },
  { dimension: "AVAILABILITY", pattern: /\b(days (usually )?suit|availability|free for a call)\b/i },
  { dimension: "IMPLEMENTATION_READINESS", pattern: /\b(get started|onboard\w*|implementation|roll ?out)\b/i },
  { dimension: "PURCHASE_READINESS", pattern: /\b(ready to (go ahead|buy|proceed)|go ahead if)\b/i },
  { dimension: "OUTCOME", pattern: /\b(good result|outcome|what would success)\b/i },
  { dimension: "PROBLEM", pattern: /\b(problem|challenge|prompted|goal|pain|trying to (solve|fix))\b/i },
  { dimension: "SUITABILITY", pattern: /\b(suitab\w*|eligib\w*)\b/i },
];

/**
 * The library dimension a configured question most likely asks about. The
 * response type is the strongest signal (a postcode question is LOCATION
 * whatever its wording), then the wording. Null when nothing matches: the
 * question is still asked, ranked on neutral attributes.
 */
export function inferDimension(question: QuestionRecord): QualificationDimensionKey | null {
  if (question.responseType === "postcode") return "LOCATION";
  for (const rule of DIMENSION_RULES) {
    if (rule.pattern.test(question.questionText)) return rule.dimension;
  }
  if (question.responseType === "timing") return "TIMING";
  return null;
}

// ------------------------------------------------------------- selection

/** Static progression / intent relevance per dimension (question-intents.ts DYNAMIC_ATTRS). */
const DYNAMIC: Record<QualificationDimensionKey, { salesProgression: number; intentRelevance: number }> = {
  PROBLEM: { salesProgression: 0.6, intentRelevance: 0.8 },
  USE_CASE: { salesProgression: 0.6, intentRelevance: 0.8 },
  SERVICE_NEEDED: { salesProgression: 0.7, intentRelevance: 0.6 },
  PROJECT_SCOPE: { salesProgression: 0.6, intentRelevance: 0.6 },
  LOCATION: { salesProgression: 0.6, intentRelevance: 0.3 },
  PROPERTY_TYPE: { salesProgression: 0.4, intentRelevance: 0.3 },
  TIMING: { salesProgression: 0.7, intentRelevance: 0.7 },
  TEAM_SIZE: { salesProgression: 0.5, intentRelevance: 0.3 },
  COMPANY_SIZE: { salesProgression: 0.5, intentRelevance: 0.3 },
  CURRENT_SOLUTION: { salesProgression: 0.5, intentRelevance: 0.6 },
  AUTHORITY: { salesProgression: 0.5, intentRelevance: 0.4 },
  BUDGET: { salesProgression: 0.6, intentRelevance: 0.5 },
  VOLUME: { salesProgression: 0.4, intentRelevance: 0.3 },
  PRODUCT_INTEREST: { salesProgression: 0.8, intentRelevance: 0.7 },
  SUITABILITY: { salesProgression: 0.6, intentRelevance: 0.6 },
  STAKEHOLDERS: { salesProgression: 0.5, intentRelevance: 0.3 },
  SUCCESS_METRICS: { salesProgression: 0.4, intentRelevance: 0.5 },
  DECISION_PROCESS: { salesProgression: 0.5, intentRelevance: 0.3 },
  COMPLIANCE_REQUIREMENTS: { salesProgression: 0.4, intentRelevance: 0.2 },
  HIRING_NEED: { salesProgression: 0.7, intentRelevance: 0.8 },
  OUTCOME: { salesProgression: 0.5, intentRelevance: 0.8 },
  AVAILABILITY: { salesProgression: 0.8, intentRelevance: 0.4 },
  DISSATISFACTION: { salesProgression: 0.5, intentRelevance: 0.8 },
  TECHNICAL_REQUIREMENTS: { salesProgression: 0.4, intentRelevance: 0.3 },
  IMPLEMENTATION_READINESS: { salesProgression: 0.6, intentRelevance: 0.6 },
  PURCHASE_READINESS: { salesProgression: 0.9, intentRelevance: 0.7 },
};

function attributesFor(
  dimension: QualificationDimensionKey | null,
  plan: Map<QualificationDimensionKey, QualificationDimension>,
  required: boolean,
) {
  if (!dimension) {
    return { ...UNMAPPED, decisionRelevance: required ? 0.75 : 0.5 };
  }
  const tuned = plan.get(dimension);
  const base = tuned ?? { key: dimension, ...QUALIFICATION_CATALOGUE[dimension] };
  return {
    informationGain: base.informationGain,
    decisionRelevance: base.decisionRelevance,
    commercialValue: base.commercialValue,
    friction: base.friction,
    prematurity: base.prematurity,
    ...DYNAMIC[dimension],
  };
}

// Moved to qualification-intelligence/question-value.ts; re-exported so every
// existing import keeps working.
export { adjustedPrematurity };

function planFor(archetypeKey: string | null | undefined, motion: SalesMotion | null) {
  const archetype = archetypeFor(archetypeKey);
  const map = new Map<QualificationDimensionKey, QualificationDimension>();
  if (!archetype) return map;
  const effectiveMotion = motion ?? archetype.defaultMotions[0] ?? null;
  const dimensions = effectiveMotion ? qualificationPlan(archetype, effectiveMotion) : archetype.qualification;
  for (const dimension of dimensions) map.set(dimension.key, dimension);
  return map;
}

function inferValue(
  question: QuestionRecord,
  dimension: QualificationDimensionKey | null,
  leadFields: LeadFieldValues,
  facts: MemoryFact[],
): { source: KnownSource; value: string; confidence: number; factSource?: string } | null {
  if (dimension) {
    const field = leadFields[dimension];
    if (typeof field === "string" && field.trim()) {
      const matched = matchAnswer(question, field);
      if (matched.value) return { source: "LEAD_FIELD", value: matched.value, confidence: 1 };
    }
  }

  const candidates = facts
    .filter(
      (fact) =>
        Number.isFinite(fact.confidence) &&
        fact.confidence >= MIN_FACT_CONFIDENCE &&
        typeof fact.value === "string" &&
        fact.value.trim() !== "" &&
        (fact.questionId === question.id || (dimension !== null && fact.dimension === dimension)),
    )
    // Highest confidence first; ties by value so the choice is stable.
    .sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value));

  for (const fact of candidates) {
    const matched = matchAnswer(question, fact.value);
    if (matched.value) {
      return { source: "FACT", value: matched.value, confidence: fact.confidence, factSource: fact.source };
    }
  }
  return null;
}

/** Unknown all-of dimensions, plus the whole any-of group while none of it is known. */
export function thresholdTargets(
  motion: SalesMotion,
  known: ReadonlySet<QualificationDimensionKey>,
): QualificationDimensionKey[] {
  const { allOf, anyOf } = MOTIONS[motion].decisionThreshold;
  const targets = allOf.filter((key) => !known.has(key));
  if (anyOf.length > 0 && !anyOf.some((key) => known.has(key))) targets.push(...anyOf);
  return targets;
}

/**
 * Which unknown questions are still worth asking at this depth (step 4 above).
 * Required questions always survive: the engine cannot decide without them.
 */
export function candidatesForDepth<T extends { question: { required: boolean }; dimension: QualificationDimensionKey | null }>(
  unknown: T[],
  input: {
    depth: QualificationDepth;
    hasMotion: boolean;
    thresholdMet: boolean;
    missing: readonly QualificationDimensionKey[];
  },
): T[] {
  if (!input.hasMotion || input.depth === "THOROUGH") return unknown;
  // Once the threshold is met only the engine's required questions survive.
  if (input.thresholdMet) return unknown.filter((entry) => entry.question.required);
  if (input.depth === "LIGHT") {
    const focused = unknown.filter(
      (entry) => entry.question.required || (entry.dimension !== null && input.missing.includes(entry.dimension)),
    );
    // No configured question maps to a missing dimension: fall back to the
    // whole list rather than stopping short of the threshold.
    return focused.length > 0 ? focused : unknown;
  }
  return unknown;
}

/**
 * Picks the next question worth asking, or says why none is. Deterministic:
 * the same input always yields the same question, ranking and stop reason.
 */
export function selectNextQuestion(input: NextQuestionInput): NextQuestionResult {
  const leadFields = input.leadFields ?? {};
  const facts = input.facts ?? [];
  const motion = input.motion ?? null;
  const stage: ConversationStage = input.stage ?? "NEW";
  const plan = planFor(input.archetypeKey, motion);

  const answerById = new Map(input.answers.map((answer) => [answer.questionId, answer]));

  const applicable = input.questions
    .filter((question) => question.serviceId === null || question.serviceId === input.serviceId)
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  const known: KnownQuestion[] = [];
  const unknown: { question: QuestionRecord; dimension: QualificationDimensionKey | null }[] = [];

  for (const question of applicable) {
    const dimension = input.dimensionMap?.[question.id] ?? inferDimension(question);
    const answer = answerById.get(question.id);

    if (answer && answer.answerValue !== null && answer.answerValue !== "") {
      known.push({
        questionId: question.id,
        questionText: question.questionText,
        dimension,
        source: "ANSWER",
        value: answer.answerValue,
        inferred: false,
        confidence: 1,
        required: question.required,
      });
      continue;
    }

    // An answer row with no matched value is a reply that could not be read.
    // Inferring over it would contradict what the lead actually wrote.
    const inferred = answer ? null : inferValue(question, dimension, leadFields, facts);
    if (inferred) {
      known.push({
        questionId: question.id,
        questionText: question.questionText,
        dimension,
        source: inferred.source,
        value: inferred.value,
        inferred: true,
        confidence: inferred.confidence,
        required: question.required,
        ...(inferred.factSource ? { factSource: inferred.factSource } : {}),
      });
      continue;
    }

    unknown.push({ question, dimension });
  }

  // Known dimensions: from known questions, and from lead fields / facts even
  // where no configured question asks about them. The threshold is about what
  // the business knows, not about which questions happen to be configured.
  const knownDims = new Set<QualificationDimensionKey>();
  for (const entry of known) if (entry.dimension) knownDims.add(entry.dimension);
  for (const [key, value] of Object.entries(leadFields) as [QualificationDimensionKey, string | null | undefined][]) {
    if (typeof value === "string" && value.trim()) knownDims.add(key);
  }
  for (const fact of facts) {
    if (fact.dimension && fact.confidence >= MIN_FACT_CONFIDENCE && fact.value?.trim()) {
      knownDims.add(fact.dimension);
    }
  }

  const thresholdMet = motion ? isDecisionThresholdMet(motion, knownDims) : false;
  const missing = motion ? missingForThreshold(motion, knownDims) : [];
  const outstandingRequired = unknown.filter((entry) => entry.question.required).length;

  // Sticky re-ask is limited to one (08 §B.8): a question put to the lead
  // MAX_ASKS_PER_INTENT times without an answer is not asked a third time.
  const asks = new Map((input.askHistory ?? []).map((entry) => [entry.questionId, entry]));
  const exhausted = (questionId: string) => {
    const entry = asks.get(questionId);
    return !!entry && entry.answered !== true && entry.asked >= MAX_ASKS_PER_INTENT;
  };
  const askable = unknown.filter((entry) => !exhausted(entry.question.id));

  const candidates = candidatesForDepth(askable, {
    depth: input.depth ?? "STANDARD",
    hasMotion: motion !== null,
    thresholdMet,
    // Every dimension that could still close the threshold: all of an
    // unmet any-of group, not only the first one `missingForThreshold` names.
    missing: motion ? thresholdTargets(motion, knownDims) : [],
  });

  const valueContext = {
    stage,
    intentState: input.intentState ?? null,
    channel: null,
    known: knownDims,
    thresholdMissing: missing,
    leadHasReplied: input.leadHasReplied,
    askHistory: (input.askHistory ?? []).map((entry) => ({
      key: entry.questionId,
      asked: entry.asked,
      answered: entry.answered === true,
    })),
  };
  const ranked: ScoredCandidate[] = candidates
    .map(({ question, dimension }) => {
      const attrs = attributesFor(dimension, plan, question.required);
      const terms = questionValue(
        {
          key: question.id,
          dimension: dimension ?? "UNMAPPED",
          purpose: "DISCOVER",
          answerType: question.responseType,
          attrs,
          required: question.required,
        },
        valueContext,
      );
      return {
        questionId: question.id,
        dimension,
        required: question.required,
        position: question.position,
        value: terms.total,
        components: {
          informationGain: terms.informationGain,
          decisionRelevance: terms.decisionRelevance,
          commercialValue: attrs.commercialValue,
          friction: terms.friction,
          prematurity: terms.prematurity,
          bonus: 0,
          salesProgression: terms.salesProgression,
          intentRelevance: terms.intentRelevance,
          repetitionRisk: terms.repetitionRisk,
          pKnown: terms.pKnown,
        },
      };
    })
    .sort(
      (a, b) =>
        b.value - a.value || a.position - b.position || a.questionId.localeCompare(b.questionId),
    );

  const byId = new Map(applicable.map((question) => [question.id, question]));

  // Sticky: a question already put to the lead and still unanswered is asked
  // again rather than swapped for another because a weight moved.
  const sticky =
    input.currentQuestionId && ranked.some((entry) => entry.questionId === input.currentQuestionId)
      ? input.currentQuestionId
      : null;
  const chosenId = sticky ?? ranked[0]?.questionId ?? null;
  const question = chosenId ? (byId.get(chosenId) ?? null) : null;

  const answeredIds = new Set(
    input.answers.filter((answer) => answer.answerValue !== null).map((answer) => answer.questionId),
  );

  return {
    question,
    stopReason: question ? null : thresholdMet ? "THRESHOLD_MET" : "NO_QUESTIONS_LEFT",
    known,
    inferred: known.filter((entry) => entry.inferred && !answeredIds.has(entry.questionId)),
    knownDimensions: [...knownDims].sort(),
    thresholdMet,
    missingForThreshold: missing,
    ranked,
    outstandingRequired,
  };
}

/**
 * The old signature, kept so existing imports keep working. It now runs the
 * adaptive selection with only what the old callers knew: the answered ids.
 */
export function nextQuestion(
  questions: QuestionRecord[],
  answeredIds: Set<string>,
  serviceId: string | null,
): QuestionRecord | null {
  return selectNextQuestion({
    questions,
    answers: [...answeredIds].map((questionId) => ({ questionId, answerValue: "answered" })),
    serviceId,
  }).question;
}
