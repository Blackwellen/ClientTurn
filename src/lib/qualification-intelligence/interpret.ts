/**
 * Answer interpretation (08 §B.11, brief §14): one reply, many dimensions.
 *
 *   1. classifyDeterministic: a binding verdict (opt-out, wrong number,
 *      complaint, emergency, human request, non-lead) stops here. Only the
 *      matching negative signal is recorded; nothing is extracted.
 *   2. The current question: the configured question's deterministic matcher
 *      (next-question.ts matchAnswer) => a CONFIRMED ANSWER fact; or, for a
 *      planned library intent, its extractor.
 *   3. Every other dimension not already CONFIRMED: the deterministic
 *      extractors (extractors.ts) => REPLY facts, CONFIRMED when unambiguous
 *      and self-stated ("we've got 45 staff"), INFERRED otherwise.
 *   4. Signals (§B.3) and objections (sales-library matchObjection).
 *   5. Optional AI candidates (the `answer_extraction` task, run by the
 *      caller): accepted only when the AI assist is allowed, the dimension is
 *      not already read deterministically, `evidence_span` is a verbatim
 *      substring of the reply, the dimension's own extractor accepts the
 *      span, and confidence >= 0.85. They are INFERRED only, source AI_ASSIST
 *      (CD-8). The engine verdict never reads them: they are never matched
 *      against configured questions here, and qualify.ts drops AI_ASSIST
 *      facts before anything reaches qualification_answers.
 *
 * Output: the contract's `Interpretation` (snake_case, validated), written
 * back after every inbound reply (CD-15). `intent_delta` needs the intent
 * engine, so it is 0 here; `withIntentDelta` sets it after reassessment.
 *
 * Pure.
 */

import {
  AI_EXTRACTION_MIN_CONFIDENCE,
  FACT_VALUE_MAX,
  FACT_VALUE_NORMALISED_MAX,
  INTENT_THRESHOLDS,
  QI_DIMENSION_KEYS,
  SIGNAL_EXCERPT_MAX,
  SIGNAL_REASON_MAX,
  UNMAPPED_DIMENSION,
  customIntentKey,
  interpretationSchema,
  type AnswerCompleteness,
  type DimensionStatusEntry,
  type FactDimension,
  type Interpretation,
  type QiDimensionKey,
  type QuestionIntent,
  type RequestedAction,
  type SignalType,
} from "./types.ts";
import {
  clauseAround,
  extract,
  extractCounts,
  extractProductInterest,
  extractProjectScope,
  extractRevenue,
  extractUseCase,
  isDeflection,
  isQuestion,
  readinessAll,
  type Extraction,
  type ExtractorContext,
} from "./extractors.ts";
import { DIMENSION_EXTRACTOR } from "./question-intents.ts";
import { classifyDeterministic, isBotQuestion } from "../agent/classification.ts";
import { matchObjection } from "../sales-library/objections.ts";
import { detectBuyingSignal } from "../agent/closing.ts";
import { lockInReconnectAt } from "./signals.ts";
import { matchAnswer, type QuestionRecord } from "../qualification/next-question.ts";

export const INTERPRET_VERSION = "int-1";

/** One candidate from the AI assist (the caller's `answer_extraction` result). */
export type AiCandidate = {
  dimension: string;
  value: string;
  evidence_span: string;
  confidence: number;
};

export type InterpretState = {
  /** The inbound message (uuid). */
  messageId: string;
  now: string;
  /** The configured question put to the lead last turn (conversations.current_question_id). */
  currentQuestion?: QuestionRecord | null;
  /** Its dimension (dimension_key, or inferDimension). */
  currentQuestionDimension?: QiDimensionKey | null;
  /** Its question_intent_key when it adopts a library intent. */
  currentQuestionIntentKey?: string | null;
  /** The library intent the last NBA planned, when no configured question was asked. */
  currentIntent?: QuestionIntent | null;
  /** Current dimension status: CONFIRMED dimensions are not re-extracted incidentally. */
  dimensions?: readonly DimensionStatusEntry[];
  /** Extractor context: incumbent terms, service names, competitor names. */
  context?: ExtractorContext;
  /** aiAssistEnabled && allowAiInterpretation && tier (the caller decides; §B.11). */
  aiAssistAllowed?: boolean;
};

type Fact = Interpretation["facts"][number];
type Signal = Interpretation["signals"][number];

/* ------------------------------------------------------------ phrases */

const PHRASES: { type: SignalType; strength: number; pattern: RegExp; reason: string }[] = [
  { type: "DEMO_REQUEST", strength: 0.9, pattern: /\b(demo|demonstration|walk ?through|show me (how|round|around))\b/i, reason: "Asked for a demo" },
  {
    type: "BOOKING_REQUEST",
    strength: 0.9,
    pattern:
      /\b(book (a|an|in|me|us)?\s*(call|meeting|time|slot|chat|consultation|appointment|visit|site visit|survey|inspection|assessment)|book (someone|somebody|an? (engineer|surveyor|fitter|technician|visit))( in)?( to (come|pop|call|look|visit|survey|quote))?|(send|get) (someone|somebody|an? (engineer|surveyor|fitter|technician)) (out|round|over|to (come|look|visit))|(come|pop) (out|round|over|by) (and|to) (look|have a look|take a look|see|quote|survey|measure)|when can (you|someone|somebody) (come|pop|visit)|(arrange|schedule) (a|an) (visit|site visit|survey|inspection|assessment|appointment)|can we (have|set up|arrange|schedule|book) a (call|chat|meeting)|(set up|arrange|schedule) a (call|chat|meeting)|when (are you|is someone) free|are you free|(monday|tuesday|wednesday|thursday|friday) (at|morning|afternoon)|send (me|us|over) (a|the|your) (booking|calendar) link|(let'?s|can we) (meet|talk|chat) (on|this|next))\b/i,
    reason: "Asked to book a call or meeting",
  },
  { type: "CALLBACK_REQUEST", strength: 0.85, pattern: /\b(call me|give me a (call|ring|bell)|ring me|phone me|call (me )?back)\b/i, reason: "Asked for a call back" },
  { type: "QUOTE_REQUEST", strength: 0.8, pattern: /\b(quote|quotation|estimate|proposal)\b/i, reason: "Asked for a quote or proposal" },
  { type: "PRICING_REQUEST", strength: 0.7, pattern: /\b(price|prices|pricing|cost|costs|how much|rates|fees?|charge)\b/i, reason: "Asked about pricing" },
  { type: "PURCHASE_REQUEST", strength: 0.95, pattern: /\b(buy|purchase|place an order|order (it|one|some)|payment link|pay (for|now))\b/i, reason: "Asked to buy" },
  { type: "TRIAL_OR_SIGNUP_REQUEST", strength: 0.9, pattern: /\b(free trial|trial|sign ?up|create an account|start using)\b/i, reason: "Asked for a trial or signup" },
  {
    type: "IMPLEMENTATION_QUESTION",
    strength: 0.6,
    pattern: /\b(how long (does it|would it|to) (take|set up|implement|onboard|migrate|switch)|onboarding|migration|set ?up process|implementation)\b/i,
    reason: "Asked how implementation works",
  },
  { type: "COMPETITOR_COMPARISON", strength: 0.6, pattern: /\b(compared (to|with)|versus|vs\.?|other quotes|shopping around|cheaper elsewhere|another (company|provider|agency) (quoted|offered))\b/i, reason: "Comparing with alternatives" },
  { type: "STATED_PROBLEM", strength: 0.6, pattern: /\b(we need|we're looking for|we are looking for|problem with|issue with|struggling with|need help with|we want to)\b/i, reason: "Stated a need or problem" },
];

const NEGATIVE_PHRASES: { type: SignalType; pattern: RegExp; reason: string }[] = [
  { type: "NOT_INTERESTED", pattern: /\b(not interested|no thanks|no thank you|not for us|we'?re (fine|good|ok|okay) (thanks|thank you)|please don'?t (contact|chase)|leave (me|us) alone)\b/i, reason: "Said they are not interested" },
  { type: "NO_NEED", pattern: /\b(don'?t need (it|this|one|anything|that)|no need|already sorted|we'?re sorted|all sorted|got it covered|we'?re covered)\b/i, reason: "Said they have no need" },
  { type: "WRONG_PERSON", pattern: /\b(wrong person|not the right person|not my (area|department|responsibility)|i'?m not responsible for|no longer (work|working) (there|here))\b/i, reason: "Said they are the wrong person" },
];

const NOT_NOW =
  /\b(not (right )?now|not (until|till) (the )?(new year|next (week|month|quarter|year)|(early |late |mid[- ]?)?(spring|summer|autumn|winter)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)|maybe later|not (a priority|the right time)( (right )?now| at the moment)?|bad time|get back to (me|us) (in|after|next)|circle back|touch base (in|after|next)|revisit (this|it) (in|next|after)|try again (in|next)|check back (in|next))\b/i;
const NOT_AT_MOMENT_SHORT = /^\s*(not at the moment|not yet|not just now)[.!]?\s*$/i;
const INFO_ASK = /\b(send (me|us|over)? ?(some )?(info|information|details|a brochure|more details|your deck)|more information|any (info|literature))\b/i;
const HUMAN_ASK = /\b(speak to (a|someone|a real)|talk to (a|someone|a real) (person|human)|real person|a human)\b/i;

/* ------------------------------------------------------------ helpers */

const DAY_MS = 86_400_000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function statusOf(dimensions: readonly DimensionStatusEntry[] | undefined, dimension: FactDimension) {
  return dimensions?.find((entry) => entry.dimension === dimension)?.status ?? "UNKNOWN";
}

/**
 * What a count must be counting to answer each COUNT dimension. A reply to
 * "how many people would use it?" that says "we ship 2,000 orders a month"
 * has not answered it (defect: a count of anything was taken as the answer).
 */
const COUNT_UNITS_FOR: Partial<Record<QiDimensionKey, readonly NonNullable<Extraction["unit"]>[]>> = {
  COMPANY_SIZE: ["staff"],
  TEAM_SIZE: ["users"],
  VOLUME: ["items", "devices"],
};

function countOf(text: string, units: readonly NonNullable<Extraction["unit"]>[] | undefined): Extraction | null {
  return extractCounts(text).find((hit) => hit.unit !== undefined && (units ?? []).includes(hit.unit)) ?? null;
}

/**
 * COMPANY_SIZE from a reply: the headcount, with any turnover, revenue or ARR
 * the lead gave kept beside it as context ("about 8 staff; turnover around
 * 900k"). Company revenue is firmographic fit, so it belongs with company
 * size and never with BUDGET (defect MI-3). A turnover on its own is only an
 * INFERRED proxy for size: its normalised value is `revenue:gbp:<n>`, which
 * no headcount rule reads as a number of people.
 */
function companySize(text: string): Extraction | null {
  const heads = countOf(text, COUNT_UNITS_FOR.COMPANY_SIZE);
  const revenue = extractRevenue(text);
  if (heads && revenue) return { ...heads, value: `${heads.value}; ${revenue.value}` };
  if (heads) return heads;
  if (revenue) return { ...revenue, confidence: Math.min(revenue.confidence, 0.85) };
  return null;
}

/** Incidental extraction plan: which extractor reads which dimension from any reply. */
const INCIDENTAL: { dimension: QiDimensionKey; run: (text: string, ctx: ExtractorContext) => Extraction | null }[] = [
  { dimension: "COMPANY_SIZE", run: (text) => companySize(text) },
  { dimension: "TEAM_SIZE", run: (text) => countOf(text, COUNT_UNITS_FOR.TEAM_SIZE) },
  { dimension: "VOLUME", run: (text) => countOf(text, COUNT_UNITS_FOR.VOLUME) },
  { dimension: "PROJECT_SCOPE", run: (text) => extractProjectScope(text) },
  { dimension: "USE_CASE", run: (text) => extractUseCase(text) },
  { dimension: "PRODUCT_INTEREST", run: (text) => extractProductInterest(text) },
  { dimension: "CURRENT_SOLUTION", run: (text, ctx) => extract("PROVIDER_MENTION", text, ctx) },
  { dimension: "DISSATISFACTION", run: (text) => extract("DISSATISFACTION", text) },
  { dimension: "TIMING", run: (text, ctx) => extract("TIMELINE", text, ctx) },
  { dimension: "BUDGET", run: (text) => extract("MONEY", text) },
  { dimension: "LOCATION", run: (text) => extract("POSTCODE", text) },
  { dimension: "AUTHORITY", run: (text) => extract("ROLE_MENTION", text) },
  { dimension: "SERVICE_NEEDED", run: (text, ctx) => extract("SERVICE_NAME", text, ctx) },
  {
    dimension: "PURCHASE_READINESS",
    run: (text) => {
      const hit = extract("READINESS", text);
      return hit && hit.normalised !== "EXPLORING" ? hit : null;
    },
  },
];

/* ----------------------------------------------- the planned question */

/** Words that carry no answer on their own: function words and acknowledgements. */
const FILLER = new Set(
  (
    "the and but for with from that this these those they them their there here its it's it’s was were are has had have " +
    "been being our ours you your yours she her his him who what when where which how why will would could should can " +
    "just really very also mostly mainly quite about some any all into onto then than now well like get got " +
    "yes yeah yep sure fine okay thanks thank cheers great good sounds perfect brilliant lovely cool right hello hiya " +
    "we're we've we'd i'm i've i'd you're that's what's let's don't doesn't isn't"
  ).split(" "),
);

function contentWords(text: string): number {
  return (text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? []).filter((w) => w.length >= 3 && !FILLER.has(w)).length;
}

/**
 * Whether a free-text reply answers the planned FREE_TEXT question, or is
 * about something else. FREE_TEXT accepts any words, so without this every
 * reply was filed as the answer to whatever was asked last ("It's for a sales
 * team of 12 people" became the USE_CASE answer).
 *
 * The reply is read with every other reader first: other dimensions'
 * extractors, the request and negative phrases, readiness, questions the lead
 * asked. What those account for is removed. If nothing accounted for any of
 * it, the reply is the answer (a one-word "Payroll." is an answer). If some
 * of it was about something else, what is left must still say something
 * (two or more content words).
 */
function answersFreeText(text: string, dimension: FactDimension, ctx: ExtractorContext): boolean {
  // A reply that is only a question back ("what do you mean?") answers nothing.
  const statements = text
    .split(/(?<=[.!?\n])\s+/)
    .filter((sentence) => !sentence.trim().endsWith("?"))
    .join(" ");
  if (contentWords(statements) === 0) return false;

  let rest = statements;
  let explained = statements.length < text.trim().length;
  const strip = (evidence: string | null | undefined) => {
    if (!evidence) return;
    const at = rest.toLowerCase().indexOf(evidence.toLowerCase());
    if (at < 0) return;
    rest = `${rest.slice(0, at)} ${rest.slice(at + evidence.length)}`;
    explained = true;
  };
  for (const { dimension: other, run } of INCIDENTAL) {
    if (other === dimension) continue;
    strip(run(rest, ctx)?.evidence);
  }
  for (const re of [...PHRASES.map((p) => p.pattern), ...NEGATIVE_PHRASES.map((p) => p.pattern), NOT_NOW, NOT_AT_MOMENT_SHORT, INFO_ASK, HUMAN_ASK]) {
    strip(re.exec(rest)?.[0]);
  }
  for (const { evidence } of readinessAll(rest)) strip(evidence);
  const left = contentWords(rest);
  return explained ? left >= 2 : left >= 1;
}

/**
 * The deterministic reading of a reply as the answer to the planned intent,
 * or null when it does not answer that dimension (defect: a reply was filed
 * under the planned intent even when it was about something else).
 */
function plannedAnswer(intent: QuestionIntent, text: string, ctx: ExtractorContext): Extraction | null {
  if (intent.extractor === "FREE_TEXT") {
    const hit = extract("FREE_TEXT", text, ctx);
    return hit && answersFreeText(text, intent.dimension, ctx) ? hit : null;
  }
  if (intent.extractor === "COUNT") {
    const units = intent.dimension === UNMAPPED_DIMENSION ? undefined : COUNT_UNITS_FOR[intent.dimension];
    if (!units) return extract("COUNT", text, ctx);
    const counted = countOf(text, units);
    if (counted) {
      if (intent.dimension !== "COMPANY_SIZE") return counted;
      const revenue = extractRevenue(text);
      return revenue ? { ...counted, value: `${counted.value}; ${revenue.value}` } : counted;
    }
    // "Our turnover is 900k" does not answer "how many staff?": the number is
    // money. The incidental pass files it as company-size context (MI-3).
    if (extractRevenue(text)) return null;
    // A bare number in a short reply ("about 12", "twelve") answers the count
    // just asked, unless the reply counts something else.
    if (extractCounts(text).length > 0 || text.trim().split(/\s+/).length > 6) return null;
    const bare = extract("NUMBER", text, ctx);
    return bare ? { ...bare, confidence: 0.85, selfStated: true } : null;
  }
  return extract(intent.extractor, text, ctx);
}

/** The deterministic validator each dimension applies to an AI candidate's span. */
function validatesForDimension(dimension: QiDimensionKey, span: string, ctx: ExtractorContext): boolean {
  const extractor = DIMENSION_EXTRACTOR[dimension].extractor;
  if (extractor === "FREE_TEXT") return span.trim().length >= 3 && !isDeflection(span);
  if (extractor === "SERVICE_NAME" && !(ctx.serviceNames ?? []).length) return span.trim().length >= 3;
  return extract(extractor, span, ctx) !== null;
}

function factFrom(
  dimension: FactDimension,
  hit: Extraction,
  source: Fact["source"],
  extra: Partial<Pick<Fact, "question_id" | "question_intent_key">> = {},
): Fact {
  const confirmed = source !== "AI_ASSIST" && hit.selfStated && hit.confidence >= 0.9;
  return {
    dimension,
    value: clip(hit.value || hit.evidence, FACT_VALUE_MAX) || clip(hit.normalised, FACT_VALUE_MAX),
    value_normalised: clip(hit.normalised, FACT_VALUE_NORMALISED_MAX) || null,
    state: confirmed ? "CONFIRMED" : "INFERRED",
    source,
    confidence: Math.min(1, Math.max(0, hit.confidence)),
    question_id: extra.question_id ?? null,
    question_intent_key: extra.question_intent_key ?? null,
    evidence_span: null,
  };
}

/* ----------------------------------------------------------- interpret */

/**
 * Interprets one inbound reply. Deterministic for the same reply, state and
 * AI candidates. Never throws on a well-formed state: the output is validated
 * against `interpretationSchema` and clipped to its limits.
 */
export function interpret(reply: string, state: InterpretState, aiCandidates?: readonly AiCandidate[] | null): Interpretation {
  const text = (reply ?? "").slice(0, 4000);
  const now = Date.parse(state.now);
  const ctx: ExtractorContext = { ...(state.context ?? {}), now: state.now };
  const facts: Fact[] = [];
  const signals: Signal[] = [];
  const seenSignal = new Set<SignalType>();
  const addSignal = (
    type: SignalType,
    strength: number,
    reason: string,
    evidence: string | null,
    extra: { resume_at?: string | null; stated_date?: string | null; confidence?: number } = {},
  ) => {
    if (seenSignal.has(type) || signals.length >= 20) return;
    seenSignal.add(type);
    signals.push({
      signal_type: type,
      strength: Math.min(1, Math.max(0, strength)),
      confidence: extra.confidence ?? 0.9,
      reason: clip(reason, SIGNAL_REASON_MAX),
      evidence_excerpt: evidence ? clip(evidence, SIGNAL_EXCERPT_MAX) : null,
      resume_at: extra.resume_at ?? null,
      stated_date: extra.stated_date ?? null,
    });
  };

  const base = {
    message_id: state.messageId,
    answered_question_id: null as string | null,
    answered_intent_key: null as string | null,
    completeness: "NONE" as AnswerCompleteness,
    lead_asked_question: false,
    requested_action: null as RequestedAction | null,
    intent_delta: 0,
    close_instead: false,
    ai_assist_used: false,
    version: INTERPRET_VERSION,
  };

  // 1. Binding deterministic verdicts stop interpretation.
  const binding = classifyDeterministic(text);
  if (binding?.binding) {
    const excerpt = clip(text, SIGNAL_EXCERPT_MAX);
    let requested: RequestedAction | null = null;
    switch (binding.intent) {
      case "UNSUBSCRIBE":
        addSignal("UNSUBSCRIBE", 1, "Asked not to be contacted", excerpt, { confidence: 1 });
        requested = "STOP";
        break;
      case "WRONG_NUMBER":
        addSignal("WRONG_PERSON", 1, "Said it is the wrong number or person", excerpt, { confidence: 1 });
        break;
      case "COMPLAINT":
        addSignal("COMPLAINT", 1, "Raised a complaint", excerpt, { confidence: 1 });
        requested = "HUMAN";
        break;
      case "HUMAN_REQUEST":
      case "EMERGENCY":
        requested = "HUMAN";
        break;
      case "JOB_APPLICATION":
      case "SUPPLIER_OR_NON_LEAD":
        addSignal("NON_LEAD", 1, "Not a sales enquiry", excerpt, { confidence: 1 });
        break;
      default:
        break;
    }
    return interpretationSchema.parse({ ...base, completeness: "NONE", facts: [], signals, objections: [], requested_action: requested });
  }

  // 2. The current question.
  let answeredQuestionId: string | null = null;
  let answeredIntentKey: string | null = null;
  let currentDimension: FactDimension | null = null;
  let completeness: AnswerCompleteness = "NONE";
  if (state.currentQuestion) {
    const question = state.currentQuestion;
    currentDimension = state.currentQuestionDimension ?? UNMAPPED_DIMENSION;
    const matched = matchAnswer(question, text);
    const intentKey = state.currentQuestionIntentKey ?? customIntentKey(question.id);
    if (matched.value) {
      answeredQuestionId = question.id;
      answeredIntentKey = intentKey;
      completeness = "FULL";
      facts.push({
        dimension: currentDimension,
        value: clip(question.responseType === "text" ? matched.text : matched.value, FACT_VALUE_MAX),
        value_normalised: clip(matched.value.toLowerCase(), FACT_VALUE_NORMALISED_MAX),
        state: "CONFIRMED",
        source: "ANSWER",
        confidence: 1,
        question_id: question.id,
        question_intent_key: intentKey,
        evidence_span: null,
      });
    }
  } else if (state.currentIntent && state.currentIntent.dimension !== UNMAPPED_DIMENSION) {
    const intent = state.currentIntent;
    currentDimension = intent.dimension;
    const hit = plannedAnswer(intent, text, ctx);
    if (hit) {
      answeredIntentKey = intent.key;
      answeredQuestionId = intent.questionId ?? null;
      completeness = hit.confidence >= 0.85 || intent.extractor === "FREE_TEXT" ? "FULL" : "PARTIAL";
      // A direct answer to the question just asked, in the lead's own words
      // and accepted by the deterministic reader, is what the lead told us:
      // CONFIRMED. Asking them to verify what they just said is the defect
      // this closes. (AI-only candidates stay INFERRED: step 5, CD-8.)
      facts.push({
        ...factFrom(intent.dimension, { ...hit, selfStated: true }, "ANSWER", {
          question_id: intent.questionId ?? null,
          question_intent_key: intent.key,
        }),
        state: "CONFIRMED",
      });
    }
  }

  // 3. Every other dimension not already confirmed.
  for (const { dimension, run } of INCIDENTAL) {
    if (facts.some((f) => f.dimension === dimension)) continue;
    if (dimension !== currentDimension && statusOf(state.dimensions, dimension) === "CONFIRMED") continue;
    const hit = run(text, ctx);
    if (!hit) continue;
    facts.push(factFrom(dimension, hit, dimension === currentDimension ? "ANSWER" : "REPLY"));
    if (dimension === currentDimension && completeness === "NONE") completeness = "PARTIAL";
  }
  // PROBLEM from a stated need or dissatisfaction, when not already known.
  if (!facts.some((f) => f.dimension === "PROBLEM") && statusOf(state.dimensions, "PROBLEM") !== "CONFIRMED") {
    const need = /\b(we need|we're looking for|we are looking for|problem with|issue with|struggling with|need help with)\b/i.exec(text);
    const dissatisfied = facts.find((f) => f.dimension === "DISSATISFACTION");
    const clause = need ? clauseAround(text, need.index, need[0].length) : dissatisfied?.value;
    // "We need a new website" states what they want made (PROJECT_SCOPE),
    // and "we need something to route leads to the right rep" what they want
    // the product to do (USE_CASE): neither is a problem, so no PROBLEM is
    // inferred from that clause.
    const scope = need ? (extractProjectScope(clause ?? "") ?? extractUseCase(clause ?? "")) : null;
    if (clause && clause.length >= 5 && !scope) {
      facts.push({
        dimension: "PROBLEM",
        value: clip(clause, FACT_VALUE_MAX),
        value_normalised: clip(clause.toLowerCase(), FACT_VALUE_NORMALISED_MAX),
        state: "INFERRED",
        source: currentDimension === "PROBLEM" ? "ANSWER" : "REPLY",
        confidence: 0.8,
        question_id: null,
        question_intent_key: null,
        evidence_span: null,
      });
    }
  }
  if (completeness === "NONE" && (state.currentQuestion || state.currentIntent) && isDeflection(text)) completeness = "DEFLECTED";

  // 4. Signals and objections.
  for (const phrase of PHRASES) {
    const match = phrase.pattern.exec(text);
    if (match) addSignal(phrase.type, phrase.strength, phrase.reason, clauseAround(text, match.index, match[0].length) || match[0]);
  }
  const hardNegatives = NEGATIVE_PHRASES.map((p) => ({ p, match: p.pattern.exec(text) })).filter((entry) => entry.match);
  for (const { p, match } of hardNegatives) addSignal(p.type, 1, p.reason, match![0]);

  const notNow = NOT_NOW.exec(text) ?? NOT_AT_MOMENT_SHORT.exec(text);
  if (notNow && hardNegatives.length === 0) {
    const later = extract("TIMELINE", text, ctx);
    const days = later ? Number(later.normalised) : INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS;
    const resume = now + Math.max(7, Number.isFinite(days) ? days : INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS) * DAY_MS;
    addSignal("NOT_NOW", 0.9, "Asked to be contacted later", notNow[0], { resume_at: iso(resume) });
  }
  // "Tied into a contract until March": a dated NOT_NOW, resumed BEFORE the
  // contract ends so they have time to compare (signals.ts lockInReconnectAt).
  const lockIn = !notNow && hardNegatives.length === 0 ? lockInReconnectAt(text, new Date(now)) : null;
  if (lockIn) addSignal("NOT_NOW", 0.85, "Tied into a contract: reconnect before it ends", lockIn.evidence, { resume_at: lockIn.resumeAt });
  const deferred = Boolean(notNow) || lockIn !== null;

  const urgency = extract("URGENCY", text);
  if (urgency && !deferred) {
    addSignal("URGENCY", urgency.normalised === "HIGH" ? 0.8 : 0.6, urgency.normalised === "HIGH" ? "Said it is urgent" : "A deadline is close", urgency.evidence);
  }
  const timing = facts.find((f) => f.dimension === "TIMING");
  const timeline = extract("TIMELINE", text, ctx);
  if (timing && timeline?.statedDate && !deferred) {
    addSignal("TIMEFRAME", 0.6, `Gave a timeframe: ${timeline.evidence}`, timeline.evidence, { stated_date: timeline.statedDate });
  }
  if (facts.some((f) => f.dimension === "DISSATISFACTION")) {
    const dissatisfaction = extract("DISSATISFACTION", text);
    addSignal("DISSATISFACTION_CURRENT", 0.7, "Unhappy with the current setup", dissatisfaction?.evidence ?? null);
    addSignal("STATED_PROBLEM", 0.6, "Stated a problem", dissatisfaction?.evidence ?? null);
  }
  for (const { level, evidence } of readinessAll(text)) {
    if (level === "REPLACING") addSignal("REPLACEMENT_SEARCH", 0.75, "Looking to replace the current provider", evidence);
    if (level === "READY_TO_BUY") addSignal("READY_TO_BUY", 0.9, "Said they are ready to go ahead", evidence);
    if (level === "READY_TO_MEET") addSignal("READY_TO_MEET", 0.8, "Said they are happy to talk", evidence);
  }

  const objections = matchObjection(text)
    .map((m) => m.key)
    .filter((key, i, all) => all.indexOf(key) === i)
    .slice(0, 10);
  if (objections.includes("PRICE") && !objections.includes("NOT_INTERESTED") && hardNegatives.length === 0) {
    addSignal("PRICING_CONCERN_ENGAGED", 0.5, "Raised price while still engaged", null);
  }

  const leadAskedQuestion = isQuestion(text);
  if (leadAskedQuestion && signals.every((s) => !["PRICING_REQUEST", "BOOKING_REQUEST", "DEMO_REQUEST", "IMPLEMENTATION_QUESTION", "PURCHASE_REQUEST", "TRIAL_OR_SIGNUP_REQUEST", "QUOTE_REQUEST"].includes(s.signal_type))) {
    addSignal("GENERAL_QUESTION", 0.4, "Asked a question", clip(text, SIGNAL_EXCERPT_MAX));
  }

  // What they asked us to do, strongest first.
  const has = (type: SignalType) => seenSignal.has(type);
  let requested: RequestedAction | null = null;
  // "Am I talking to a real person?" asks what they are talking to; only an
  // explicit ask for a person is a request for one (owner decision 2026-09-27).
  if (HUMAN_ASK.test(text) && (!isBotQuestion(text) || classifyDeterministic(text)?.intent === "HUMAN_REQUEST")) requested = "HUMAN";
  else if (has("PURCHASE_REQUEST") || has("READY_TO_BUY")) requested = "BUY";
  else if (has("TRIAL_OR_SIGNUP_REQUEST")) requested = "SIGNUP";
  else if (has("BOOKING_REQUEST") || has("DEMO_REQUEST")) requested = "BOOK";
  else if (has("CALLBACK_REQUEST")) requested = "CALLBACK";
  else if (has("PRICING_REQUEST") || has("QUOTE_REQUEST")) requested = "PRICE";
  else if (has("NOT_NOW")) requested = "LATER";
  else if (INFO_ASK.test(text)) requested = "INFO";
  if (hardNegatives.length > 0 && requested !== "HUMAN") requested = null;

  // 5. AI candidates: INFERRED only, verbatim, validated, >= 0.85.
  const aiAllowed = state.aiAssistAllowed === true && Array.isArray(aiCandidates);
  if (aiAllowed) {
    for (const candidate of aiCandidates ?? []) {
      if (facts.length >= 26) break;
      if (!(QI_DIMENSION_KEYS as readonly string[]).includes(candidate.dimension)) continue;
      const dimension = candidate.dimension as QiDimensionKey;
      if (facts.some((f) => f.dimension === dimension)) continue;
      if (statusOf(state.dimensions, dimension) === "CONFIRMED") continue;
      if (typeof candidate.confidence !== "number" || !(candidate.confidence >= AI_EXTRACTION_MIN_CONFIDENCE)) continue;
      const span = typeof candidate.evidence_span === "string" ? candidate.evidence_span : "";
      if (span.trim().length === 0 || span.length > SIGNAL_EXCERPT_MAX || !text.includes(span)) continue;
      if (typeof candidate.value !== "string" || !candidate.value.trim()) continue;
      if (!validatesForDimension(dimension, span, ctx)) continue;
      facts.push({
        dimension,
        value: clip(candidate.value, FACT_VALUE_MAX),
        value_normalised: clip(candidate.value.toLowerCase(), FACT_VALUE_NORMALISED_MAX) || null,
        state: "INFERRED",
        source: "AI_ASSIST",
        confidence: Math.min(1, candidate.confidence),
        question_id: null,
        question_intent_key: null,
        evidence_span: span,
      });
    }
  }

  // A clear buying signal ("what's the next step?", closing.ts) closes too:
  // a ready lead is never over-qualified. Never on a refusal or a deferral.
  const closeInstead =
    requested === "BOOK" ||
    requested === "CALLBACK" ||
    requested === "BUY" ||
    requested === "SIGNUP" ||
    has("READY_TO_MEET") ||
    (detectBuyingSignal(text) && hardNegatives.length === 0 && !deferred);

  return interpretationSchema.parse({
    ...base,
    answered_question_id: answeredQuestionId,
    answered_intent_key: answeredIntentKey,
    completeness,
    facts: facts.slice(0, 26),
    signals,
    objections,
    lead_asked_question: leadAskedQuestion,
    requested_action: requested,
    close_instead: closeInstead,
    ai_assist_used: aiAllowed,
  });
}

/* ------------------------------------------------------------ form answers */

/** A form answer read as a remembered fact (next-question.ts MemoryFact shape). */
export type FormAnswerFact = {
  dimension: QiDimensionKey | null;
  questionId: string | null;
  value: string;
  confidence: number;
  source: "FORM";
  /** The form's own label, for the audit trail. */
  label: string;
  /**
   * CONFIRMED: the label is the configured question itself, or the value
   * corroborates the label's dimension (formValueCorroborates). INFERRED: the
   * same dimension by label only.
   */
  state: "CONFIRMED" | "INFERRED";
};

/**
 * Whether a form value corroborates the dimension its label was mapped to:
 * the dimension's own structured extractor reads it ("Postcode" -> "LS6 2AB"
 * parses as a postcode; "Team size" -> "12 users" parses as a count of
 * users). The value is the lead's own entry; what was uncertain is only the
 * label-to-dimension mapping, and a structured match settles it. Free-text
 * dimensions can never be corroborated this way and stay INFERRED.
 */
export function formValueCorroborates(dimension: FactDimension | null, value: string, ctx: ExtractorContext = {}): boolean {
  if (!dimension || dimension === UNMAPPED_DIMENSION) return false;
  const extractor = DIMENSION_EXTRACTOR[dimension].extractor;
  if (extractor === "FREE_TEXT" || extractor === "CHOICE") return false;
  if (extractor === "COUNT") return countOf(value, COUNT_UNITS_FOR[dimension] ?? ["staff", "users", "devices", "items"]) !== null;
  return extract(extractor, value, ctx) !== null;
}

function normaliseLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Defect F3: ad-form and web-form answers live in `lead_touches.answers`
 * (question label -> answer text) and were never read, so the agent could ask
 * what the lead had already told us on the form.
 *
 * A form answer answers a configured question when its label *is* that
 * question (normalised text equality) => CONFIRMED, confidence 1; or when the
 * label maps to the same library dimension => INFERRED, confidence 0.85. In
 * both cases the value must pass the question's own deterministic matcher, so
 * a form answer can never produce a value the question could not accept. A
 * label that maps to a dimension with no configured question still becomes a
 * dimension fact (it counts toward the threshold; it never reaches the engine).
 *
 * Touches newest first: the most recent form wins.
 */
export function formAnswersToFacts(
  touches: readonly { answers: Record<string, unknown> | null | undefined }[],
  questions: readonly (QuestionRecord & { dimensionKey?: string | null })[],
  inferLabelDimension: (label: string) => QiDimensionKey | null,
): FormAnswerFact[] {
  const out: FormAnswerFact[] = [];
  const answeredQuestion = new Set<string>();
  const seenDimension = new Set<QiDimensionKey>();
  const dimensionOf = (q: QuestionRecord & { dimensionKey?: string | null }): QiDimensionKey | null =>
    (QI_DIMENSION_KEYS as readonly string[]).includes(q.dimensionKey ?? "") ? (q.dimensionKey as QiDimensionKey) : inferLabelDimension(q.questionText);

  for (const touch of touches) {
    const answers = touch.answers && typeof touch.answers === "object" ? touch.answers : {};
    for (const [rawLabel, rawValue] of Object.entries(answers).slice(0, 50)) {
      if (typeof rawValue !== "string" && typeof rawValue !== "number") continue;
      const value = String(rawValue).trim();
      if (!value) continue;
      const label = rawLabel.slice(0, 200);
      const labelNorm = normaliseLabel(label);
      const labelDimension = inferLabelDimension(label);
      let matchedAny = false;

      for (const question of questions) {
        if (answeredQuestion.has(question.id)) continue;
        const exact = normaliseLabel(question.questionText) === labelNorm;
        const questionDimension = dimensionOf(question);
        const sameDimension = !exact && labelDimension !== null && questionDimension === labelDimension;
        if (!exact && !sameDimension) continue;
        const matched = matchAnswer(question, value);
        if (!matched.value) continue;
        answeredQuestion.add(question.id);
        matchedAny = true;
        const corroborated = exact || formValueCorroborates(questionDimension, value);
        out.push({
          dimension: questionDimension,
          questionId: question.id,
          value: clip(matched.value, FACT_VALUE_MAX),
          confidence: exact ? 1 : corroborated ? 0.95 : 0.85,
          source: "FORM",
          label,
          state: corroborated ? "CONFIRMED" : "INFERRED",
        });
        if (questionDimension) seenDimension.add(questionDimension);
      }

      if (!matchedAny && labelDimension && !seenDimension.has(labelDimension)) {
        seenDimension.add(labelDimension);
        const corroborated = formValueCorroborates(labelDimension, value);
        out.push({
          dimension: labelDimension,
          questionId: null,
          value: clip(value, FACT_VALUE_MAX),
          confidence: corroborated ? 0.95 : 0.85,
          source: "FORM",
          label,
          state: corroborated ? "CONFIRMED" : "INFERRED",
        });
      }
    }
  }
  return out;
}

/** Sets `intent_delta` once the caller has reassessed intent with the new signals. */
export function withIntentDelta(interpretation: Interpretation, scoreBefore: number, scoreAfter: number): Interpretation {
  const delta = Math.max(-100, Math.min(100, Math.round(scoreAfter - scoreBefore)));
  return { ...interpretation, intent_delta: delta };
}

/** The dimensions an interpretation filled, by state (for logs and the "why"). */
export function interpretedDimensions(interpretation: Interpretation): { confirmed: FactDimension[]; inferred: FactDimension[] } {
  return {
    confirmed: interpretation.facts.filter((f) => f.state === "CONFIRMED").map((f) => f.dimension),
    inferred: interpretation.facts.filter((f) => f.state === "INFERRED").map((f) => f.dimension),
  };
}
