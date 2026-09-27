/**
 * Pre-send question QA (design 08 §16, §B.13). Pure.
 *
 * Thirteen deterministic checks run on every outbound qualification message
 * before it is sent. They compare the draft with the structured state the
 * turn was planned from (the NBA, the per-dimension fact status, the lead's
 * last message, what was asked before), never with a model's opinion of the
 * draft. A REJECT finding discards the draft and feeds a correction into the
 * single retry; a second failure hands over (the existing validator loop in
 * agent/orchestrator.ts). A WARN finding is recorded on the run and never
 * blocks.
 *
 * The one thing QA has to read from wording is *which dimension a question
 * sentence asks about*. That is `askedDimensions()`: an ordered rule table,
 * first match wins, deliberately separate from the configured-question mapper
 * in qualification/next-question.ts, because a draft sentence and a
 * configured question text are worded differently ("Which postcode is the
 * property in?" asks LOCATION, not PROPERTY_TYPE).
 *
 * Linked pairs (§10) are deliberately not implemented: two questions stay a
 * failure (§B.13, D10).
 *
 * Pure: relative `.ts` imports, no server-only, no Supabase.
 */

import { countQuestions } from "../agent/validate.ts";
import { evaluateLength } from "../agent/policy.ts";
import type { AgentChannel } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import type { QualificationResult } from "../qualification/engine.ts";
import {
  ALWAYS_MATERIAL_DIMENSIONS,
  BRIEF_DIMENSION_ALIASES,
  CTA_ACTIONS,
  MAX_ASKS_PER_INTENT,
  QI_DIMENSION_KEYS,
  UNMAPPED_DIMENSION,
  type CustomerType,
  type DimensionStatus,
  type FactDimension,
  type GoalKey,
  type IntentState,
  type NbaAction,
  type PricingModel,
  type QaCode,
  type QaFinding,
  type QiDimensionKey,
  type QuestionIntent,
  type QuestionPurpose,
} from "./types.ts";

/* =============================================================== inputs */

/** One dimension's derived status, as the NBA and the UI see it. */
export type DimensionView = {
  dimension: FactDimension;
  status: DimensionStatus;
  /** INFERRED material facts must be verified before they gate (§B.12). */
  material?: boolean;
  /** In the goal threshold or the offer's requiredDimensions. */
  required?: boolean;
  /** Past its validity window (§B.12): a VERIFY of it may re-ask the topic. */
  stale?: boolean;
};

/** The planned question, as the NBA carries it (a subset of NbaQuestionIntent). */
export type PlannedQuestion = {
  key: string;
  dimension: FactDimension;
  purpose: QuestionPurpose;
  /** The channel rendering; used to recognise a custom (UNMAPPED) question. */
  rendering?: string | null;
};

/** An outbound message earlier in the conversation, newest first. */
export type PriorAsk = {
  /** The dimension it asked, if it asked one. */
  dimension: FactDimension | null;
  /** Whether the lead has since answered that dimension. */
  answered: boolean;
};

export type QaContext = {
  channel: AgentChannel;
  stage: ConversationStage;
  intentState: IntentState;
  engineVerdict: QualificationResult;
  /** What the engine decided this turn. Null = the engine did not plan the turn (OFF). */
  nbaAction: NbaAction | null;
  plannedQuestion: PlannedQuestion | null;
  dimensions: DimensionView[];
  /** Library intent keys the workspace or offer forbids. */
  forbiddenIntents: readonly string[];
  /** The lead's message this turn replies to, if any. */
  inbound: string | null;
  /** From interpret(); derived from `inbound` when absent. */
  leadAskedQuestion?: boolean;
  /** The last outbound messages, newest first (only the first two are read). */
  recentOutbound?: PriorAsk[];
  customerType?: CustomerType | null;
  /**
   * A lead with several interests (interests.ts): the one light-touch
   * question the coordinator allowed about ANOTHER interest beside a
   * checkout or sign-up close. It counts as planned, and is checked against
   * that interest's own dimensions (companionDimensions), never this one's.
   */
  companionQuestion?: PlannedQuestion | null;
  companionDimensions?: DimensionView[];
  /** The planned intent's own applicability, when the library supplied one. */
  plannedIntent?: Pick<QuestionIntent, "appliesTo" | "stages" | "channels"> | null;
  /** Who this lead is, for `appliesTo`. Absent fields are not checked. */
  profile?: {
    archetypeKey?: string | null;
    motion?: string | null;
    goal?: GoalKey | null;
    pricingModel?: PricingModel | null;
  };
};

export type QaResult = {
  ok: boolean;
  findings: QaFinding[];
  /** The dimensions the draft's question sentences ask (null = unrecognised question). */
  asked: (FactDimension | null)[];
};

/* ======================================================= text analysis */

/** Splits a draft into sentences, keeping the terminal punctuation. */
export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const INTERROGATIVE_OPENING =
  /^(could you|can you|would you|will you|do you|did you|are you|is it|is there|have you|what|when|where|which|who|why|how)\b/i;

/** A sentence that asks something: ends with "?" or opens like a question. */
export function isQuestionSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (/\?\s*$/.test(s)) return true;
  // "Could you send your postcode." is still a question.
  return /^(could you|can you|would you|will you|do you|did you|are you|is it|is there|have you)\b/i.test(s);
}

export function questionSentences(text: string): string[] {
  return sentences(text).filter(isQuestionSentence);
}

/** Whether a lead's message asked us something. */
export function leadAsked(inbound: string | null | undefined): boolean {
  if (!inbound) return false;
  return sentences(inbound).some((s) => /\?/.test(s) || INTERROGATIVE_OPENING.test(s) && s.length > 12 && !/^(what|when)\s+(a|an)\b/i.test(s));
}

/**
 * Ordered detector: the first match wins, so specific rules precede general
 * ones (a postcode question is LOCATION even when it mentions the property;
 * "40 staff at the moment" is COMPANY_SIZE, not CURRENT_SOLUTION).
 */
const DETECT_RULES: { dimension: QiDimensionKey; pattern: RegExp }[] = [
  { dimension: "BUDGET", pattern: /\b(budget|spend|invest(ment)?|price range|afford|how much (are|were|would) you (looking|hoping|planning|expecting) to (spend|pay))\b/i },
  { dimension: "STAKEHOLDERS", pattern: /\b(stakeholders?|evaluat\w*)\b/i },
  { dimension: "DECISION_PROCESS", pattern: /\b(decision process|procurement|sign[- ]?off process|approval process|buying process)\b/i },
  { dimension: "AUTHORITY", pattern: /\b(decision[- ]?maker|decid\w*|authori[sz]\w*|sign (it )?off|anyone else involved|who else|involved in (choosing|the decision|deciding))\b/i },
  { dimension: "COMPLIANCE_REQUIREMENTS", pattern: /\b(complian\w*|security requirements?|gdpr|iso ?27001|soc ?2|cyber essentials)\b/i },
  { dimension: "SUCCESS_METRICS", pattern: /\b(measure|success look|kpis?|metrics?|what would success)\b/i },
  { dimension: "TECHNICAL_REQUIREMENTS", pattern: /\b(integrat\w*|tech(nology)? stack|which (tools|systems|software|platforms?) (do|does|are|would)|connect (it )?(to|with)|api)\b/i },
  { dimension: "IMPLEMENTATION_READINESS", pattern: /\b(implement\w*|roll(ing)? (it )?out|who would (set|run) (it|this) up|resource to (set up|launch))\b/i },
  { dimension: "PURCHASE_READINESS", pattern: /\b(ready to (buy|purchase|sign|go ahead|order)|place an order|go ahead with)\b/i },
  { dimension: "DISSATISFACTION", pattern: /\b(not happy|unhappy|frustrat\w*|what'?s not working|what isn'?t working|what'?s wrong with)\b/i },
  { dimension: "TEAM_SIZE", pattern: /\b(team size|how many (people|users|seats)|people on (your|the) team|seats)\b/i },
  { dimension: "COMPANY_SIZE", pattern: /\b(employees|headcount|company size|staff|people work)\b/i },
  { dimension: "CURRENT_SOLUTION", pattern: /\b(currently (use|using|handl\w*)|(using|use) at the moment|existing (provider|supplier|system|solution|agency)|current (provider|supplier|system|solution|agency|tool|setup)|(which|what) (agency|provider|supplier|system|tool|software) (are|do) you|who (looks after|handles|manages|does|runs) (your|the|this)|(using|use) (today|now|for this))\b/i },
  { dimension: "VOLUME", pattern: /\b(volumes?|per month|each month|a month|monthly|orders)\b/i },
  { dimension: "HIRING_NEED", pattern: /\b(hir(e|ing)|recruit\w*|roles? (are you|to fill))\b/i },
  { dimension: "LOCATION", pattern: /\b(postcode|post code|location|where (are you|is the|would the)|based)\b/i },
  { dimension: "PROPERTY_TYPE", pattern: /\b(property type|type of property|house|flat|bungalow|premises type)\b/i },
  { dimension: "AVAILABILITY", pattern: /\b(availability|(what|which) (days?|times?) (suit|work)|suit you better|free (on|next))\b/i },
  { dimension: "TIMING", pattern: /\b(when|timescale|timeline|timeframe|how soon|start date|deadline|get started|go live|launch)\b/i },
  { dimension: "OUTCOME", pattern: /\b((what|which) (outcome|result)s?|hoping to achieve|good result look)\b/i },
  { dimension: "PROJECT_SCOPE", pattern: /\b(scope|project (involve|size)|pages|deliverables?)\b/i },
  { dimension: "USE_CASE", pattern: /\b(use case|use it for|want it to do|looking to (use|achieve)|mainly want)\b/i },
  { dimension: "PRODUCT_INTEREST", pattern: /\b(which product|product (are you|were you))\b/i },
  { dimension: "SERVICE_NEEDED", pattern: /\b(which (of our )?services?|what service|services? (are you|do you need))\b/i },
  { dimension: "PROBLEM", pattern: /\b(problem|challenge|prompted|goal|pain|trying to (solve|fix)|looking into this|got you looking|looking at this)\b/i },
  { dimension: "SUITABILITY", pattern: /\b(suitab\w*|eligib\w*)\b/i },
];

/**
 * The clause a question actually asks. A leading subordinate clause sets the
 * scene and asks nothing ("Once the board has a budget in mind, would it help
 * to see a proposal?" asks about the proposal, not the budget).
 */
export function mainClause(sentence: string): string {
  const s = sentence.trim();
  const lead = /^(once|if|when|whenever|as soon as|after|before|while|since|now that)\b[^,]{3,120},\s*(.+)$/i.exec(s);
  return lead ? lead[2] : s;
}

/** The dimension one question sentence asks, or null when none is recognised. */
export function askedDimension(sentence: string): QiDimensionKey | null {
  const clause = mainClause(sentence);
  for (const rule of DETECT_RULES) if (rule.pattern.test(clause)) return rule.dimension;
  return null;
}

/** Every dimension a sentence mentions (for the single-focus check). */
export function mentionedDimensions(sentence: string): QiDimensionKey[] {
  return DETECT_RULES.filter((rule) => rule.pattern.test(sentence)).map((rule) => rule.dimension);
}

/** Dimensions a booking or checkout CTA may ask about without "qualifying". */
const CTA_NATURAL_DIMENSIONS: ReadonlySet<QiDimensionKey> = new Set(["AVAILABILITY"]);

const GENERIC_PATTERN =
  /\b(how can i help|how can we help|what can i do for you|anything else|is there anything|tell me (a bit )?more|any (other )?questions|what are you looking for|what do you need)\b/i;

/** Protected characteristics, as words (lead-score.ts holds the feature-name form). */
const INTRUSIVE_PATTERN =
  /\b(how old|your age|date of birth|gender|sexual|orientation|pregnan\w*|maternity|married|marital|single or|religio\w*|faith|ethnic\w*|race|nationality|health|medical|disab\w*|illness|diagnos\w*|politic\w*|trade union|criminal|conviction)\b/i;

/** Personal-finance wording: intrusive on a B2B conversation. */
const PERSONAL_FINANCE_PATTERN =
  /\b(personal (income|finances?|debt|savings)|household income|your (salary|wage|credit score|mortgage)|credit score|how much do you earn)\b/i;

const FORM_NUMBERING = /\b(q\s?\d|question\s?\d)\b|(^|\s)\d\)\s/i;
const ENUMERATED_OPTION = /(^|\s)(?:[a-e]\)|\(\s?[a-e]\s?\)|[a-e]\.\s)/gi;
const MARKDOWN = /(^|\n)\s*([-*•]\s|\d+\.\s|#+\s)|\*\*[^*]+\*\*|__[^_]+__/;

function optionCount(sentence: string): number {
  const lettered = (sentence.match(ENUMERATED_OPTION) ?? []).length;
  if (lettered) return lettered;
  // "A, B, C or D?" style lists after a colon.
  const afterColon = sentence.split(":")[1];
  if (!afterColon) return 0;
  return afterColon.split(/,|\bor\b|\//).map((s) => s.trim()).filter(Boolean).length;
}

/* ============================================================ helpers */

/** The dimension family of a library intent key ("BUDGET.RANGE" -> BUDGET). */
export function intentKeyDimension(key: string): QiDimensionKey | null {
  const family = key.split(".")[0] ?? "";
  if ((QI_DIMENSION_KEYS as readonly string[]).includes(family)) return family as QiDimensionKey;
  return BRIEF_DIMENSION_ALIASES[family] ?? null;
}

/** Dimensions no question may ask about, from the forbidden intent keys. */
export function forbiddenDimensions(forbidden: readonly string[]): Set<QiDimensionKey> {
  const out = new Set<QiDimensionKey>();
  for (const key of forbidden) {
    const dimension = intentKeyDimension(key);
    if (dimension) out.add(dimension);
  }
  return out;
}

const STAGE_ORDER: ConversationStage[] = ["NEW", "ENGAGED", "QUALIFYING", "OBJECTION", "CLOSING", "POST_BOOKING"];

const PROBLEM_DIMS: QiDimensionKey[] = ["PROBLEM", "USE_CASE", "OUTCOME", "DISSATISFACTION", "SERVICE_NEEDED", "PRODUCT_INTEREST", "PROJECT_SCOPE"];
const AUTHORITY_DIMS: QiDimensionKey[] = ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS"];

/** Base attributes for the six added dimensions (the catalogue holds the other 20). */
const ADDED_ATTRS: Record<string, { friction: number; prematurity: number }> = {
  OUTCOME: { friction: 0.2, prematurity: 0.05 },
  AVAILABILITY: { friction: 0.1, prematurity: 0.2 },
  DISSATISFACTION: { friction: 0.3, prematurity: 0.15 },
  TECHNICAL_REQUIREMENTS: { friction: 0.3, prematurity: 0.35 },
  IMPLEMENTATION_READINESS: { friction: 0.35, prematurity: 0.45 },
  PURCHASE_READINESS: { friction: 0.4, prematurity: 0.5 },
};

export function baseAttrs(dimension: FactDimension | null): { friction: number; prematurity: number } {
  if (!dimension || dimension === UNMAPPED_DIMENSION) return { friction: 0.2, prematurity: 0.1 };
  const catalogue = (QUALIFICATION_CATALOGUE as Record<string, { friction: number; prematurity: number } | undefined>)[dimension];
  return catalogue ?? ADDED_ATTRS[dimension] ?? { friction: 0.25, prematurity: 0.2 };
}

/**
 * Stage-adjusted prematurity, the same shape as next-question.ts
 * `adjustedPrematurity`: BUDGET stays >= 0.8 until a problem dimension is
 * known; authority-type stays >= 0.6 until the lead has engaged; everything
 * else halves once engaged.
 */
export function prematurityOf(
  dimension: FactDimension | null,
  stage: ConversationStage,
  known: ReadonlySet<string>,
): number {
  const base = baseAttrs(dimension).prematurity;
  const engaged = stage !== "NEW";
  if (dimension === "BUDGET") return PROBLEM_DIMS.some((d) => known.has(d)) ? base * 0.25 : Math.max(base, 0.8);
  if (dimension && AUTHORITY_DIMS.includes(dimension as QiDimensionKey)) return engaged ? base * 0.35 : Math.max(base, 0.6);
  return engaged ? base * 0.5 : base;
}

export function statusOf(dimensions: readonly DimensionView[], dimension: FactDimension | null): DimensionView | null {
  if (!dimension) return null;
  return dimensions.find((entry) => entry.dimension === dimension) ?? null;
}

/** Known for asking purposes: CONFIRMED, or INFERRED and not material. */
export function isKnownForAsking(view: DimensionView | null): boolean {
  if (!view) return false;
  if (view.status === "CONFIRMED") return true;
  if (view.status === "INFERRED") {
    const material = view.material ?? (ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(view.dimension);
    return !material;
  }
  return false;
}

function knownSet(dimensions: readonly DimensionView[]): Set<string> {
  return new Set(dimensions.filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED").map((d) => d.dimension));
}

/** Content words of a rendering, for recognising a custom question. */
function contentWords(text: string): string[] {
  const stop = new Set(["do", "you", "your", "the", "a", "an", "it", "is", "are", "for", "of", "to", "have", "already", "any", "what", "which", "how", "and", "or", "in", "on", "we", "our", "i"]);
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
}

/** Whether a question sentence is the planned question. */
export function matchesPlanned(sentence: string, detected: FactDimension | null, planned: PlannedQuestion | null): boolean {
  if (!planned) return false;
  if (planned.dimension !== UNMAPPED_DIMENSION) return detected === planned.dimension;
  // A custom question has no dimension: recognise it by its own words.
  if (detected && detected !== UNMAPPED_DIMENSION) return false;
  const words = contentWords(planned.rendering ?? "");
  if (words.length === 0) return detected === null;
  const draft = new Set(contentWords(sentence));
  const hits = words.filter((w) => draft.has(w)).length;
  return hits / words.length >= 0.5;
}

/** A dimension the draft is qualifying on (not a booking-slot question). */
function isQualifying(dimension: FactDimension | null): boolean {
  return dimension !== null && !CTA_NATURAL_DIMENSIONS.has(dimension as QiDimensionKey);
}

/** How many of the last two outbound messages asked this dimension and got no answer. */
export function unansweredPriorAsks(recent: readonly PriorAsk[] | undefined, dimension: FactDimension | null): number {
  if (!dimension) return 0;
  return (recent ?? []).slice(0, 2).filter((ask) => ask.dimension === dimension && !ask.answered).length;
}

function appliesToHolds(ctx: QaContext): string | null {
  const intent = ctx.plannedIntent;
  if (!intent) return null;
  const a = intent.appliesTo ?? {};
  const p = ctx.profile ?? {};
  if (a.archetypes?.length && p.archetypeKey && !a.archetypes.includes(p.archetypeKey)) return `not for archetype ${p.archetypeKey}`;
  if (a.motions?.length && p.motion && !(a.motions as readonly string[]).includes(p.motion)) return `not for motion ${p.motion}`;
  if (a.goals?.length && p.goal && !a.goals.includes(p.goal)) return `not for goal ${p.goal}`;
  if (a.pricingModels?.length && p.pricingModel && !a.pricingModels.includes(p.pricingModel)) return `not for pricing model ${p.pricingModel}`;
  if (a.customerType && ctx.customerType && ctx.customerType !== "BOTH" && a.customerType !== ctx.customerType) return `not for ${ctx.customerType}`;
  if (intent.stages?.length && !intent.stages.includes(ctx.stage)) return `not at stage ${ctx.stage}`;
  if (intent.channels?.length && !intent.channels.includes(ctx.channel)) return `not on ${ctx.channel}`;
  return null;
}

/* ================================================================ checks */

const CORRECTIONS: Record<QaCode, string> = {
  QA_UNPLANNED_QUESTION: "Ask only the one question in the strategy block, or no question at all.",
  QA_ASKS_KNOWN: "Do not ask about something already known; the strategy lists what is known.",
  QA_OFF_PROFILE: "That question does not fit this business or this stage. Ask only the planned question.",
  QA_FORBIDDEN_INTENT: "The business never asks that. Remove the question.",
  QA_PREMATURE: "That question is too early in this conversation. Remove it.",
  QA_INTRUSIVE: "Never ask about personal characteristics or personal finances. Remove the question.",
  QA_GENERIC: "Replace the generic question with the specific planned question.",
  STYLE_MULTIPLE_QUESTIONS: "Ask exactly one question. Drop the others.",
  QA_FORM_LIKE: "Write like a person, not a form: no numbered questions and no list of options.",
  TOO_LONG: "Shorten the reply to fit the channel.",
  QA_CHANNEL: "No bullet points, numbering, headings or bold on this channel. Plain sentences only.",
  QA_IGNORES_LEAD: "The lead asked something. Answer it (or say you'll find out) before anything else.",
  QA_QUESTION_FIRST: "Answer the lead's question first, then ask yours.",
  QA_SHOULD_CLOSE: "Do not ask a qualifying question now. Propose the next step instead.",
  QA_REPEAT: "That question was already asked and not answered. Do not ask it again.",
};

export function qaCorrection(code: QaCode): string {
  return CORRECTIONS[code];
}

function finding(code: QaCode, check: number, severity: QaFinding["severity"], detail: string): QaFinding {
  return { code, check, severity, detail };
}

/**
 * Runs the 13 checks on one draft. `ok` is false when any REJECT finding
 * exists. Only question-related checks look at question sentences; the
 * channel and length checks apply to every draft.
 */
export function runQuestionQa(draft: string, ctx: QaContext): QaResult {
  const findings: QaFinding[] = [];
  const text = draft.normalize("NFKC").trim();
  const allSentences = sentences(text);
  const questions = allSentences.filter(isQuestionSentence);
  const asked = questions.map((q) => askedDimension(q) as FactDimension | null);
  const planned = ctx.plannedQuestion;
  const action = ctx.nbaAction;
  const known = knownSet(ctx.dimensions);
  const forbidden = forbiddenDimensions(ctx.forbiddenIntents);
  const asksPlanned = questions.some((q, i) => matchesPlanned(q, asked[i], planned));
  const ctaCarriesQuestion = action === "CTA_BOOK" && planned !== null;

  for (const [index, question] of questions.entries()) {
    const dimension = asked[index];
    const isCompanion = matchesPlanned(question, dimension, ctx.companionQuestion ?? null);
    const isPlanned = matchesPlanned(question, dimension, planned) || isCompanion;
    const view = statusOf(isCompanion ? (ctx.companionDimensions ?? []) : ctx.dimensions, dimension);

    // 1 Necessary: a qualifying question the plan did not choose.
    if (action !== null && isQualifying(dimension) && !isPlanned) {
      const isCta = action && (CTA_ACTIONS as readonly string[]).includes(action);
      if (!isCta) {
        findings.push(finding("QA_UNPLANNED_QUESTION", 1, "REJECT", `Asks ${dimension}; the plan ${planned ? `asks ${planned.dimension}` : `is ${action} with no question`}.`));
      }
    }

    // 2 Already known (a VERIFY / CLARIFY of the planned dimension is the exception).
    if (dimension && isKnownForAsking(view) && !(isPlanned && planned && planned.purpose !== "DISCOVER")) {
      findings.push(finding("QA_ASKS_KNOWN", 2, "REJECT", `${dimension} is already ${view!.status.toLowerCase()}.`));
    }

    // 3-5 Fit: forbidden, off-profile, premature.
    if (dimension && forbidden.has(dimension as QiDimensionKey)) {
      findings.push(finding("QA_FORBIDDEN_INTENT", 4, "REJECT", `${dimension} is forbidden for this workspace or offer.`));
    }
    if (planned && isPlanned && ctx.forbiddenIntents.includes(planned.key)) {
      findings.push(finding("QA_FORBIDDEN_INTENT", 4, "REJECT", `${planned.key} is forbidden.`));
    }
    if (isPlanned) {
      const off = appliesToHolds(ctx);
      if (off) findings.push(finding("QA_OFF_PROFILE", 3, "REJECT", `The planned question is ${off}.`));
    }
    if (isQualifying(dimension) && prematurityOf(dimension, ctx.stage, known) > 0.6) {
      findings.push(finding("QA_PREMATURE", 5, "REJECT", `${dimension} is premature at ${ctx.stage}.`));
    }

    // 6 Intrusive.
    if (INTRUSIVE_PATTERN.test(question)) {
      findings.push(finding("QA_INTRUSIVE", 6, "REJECT", "Asks about a protected personal characteristic."));
    } else if ((ctx.customerType ?? "B2B") !== "B2C" && PERSONAL_FINANCE_PATTERN.test(question)) {
      findings.push(finding("QA_INTRUSIVE", 6, "REJECT", "Asks about personal finances in a business conversation."));
    }

    // 7 Generic, when a specific question was planned.
    if (planned && GENERIC_PATTERN.test(question)) {
      findings.push(finding("QA_GENERIC", 7, "REJECT", "A generic question in place of the planned one."));
    }

    // 8 Form-like (the options part).
    if ((ctx.channel === "sms" || ctx.channel === "whatsapp") && optionCount(question) >= 4) {
      findings.push(finding("QA_FORM_LIKE", 8, "REJECT", `${optionCount(question)} enumerated options on ${ctx.channel}.`));
    }

    // 12 Should close instead.
    if (action && (CTA_ACTIONS as readonly string[]).includes(action) && isQualifying(dimension) && !(ctaCarriesQuestion && isPlanned) && !isCompanion) {
      findings.push(finding("QA_SHOULD_CLOSE", 12, "REJECT", `The plan is ${action}; the draft qualifies on ${dimension}.`));
    }
    // A silent plan has no message at all: any question, recognised or not, pursues the lead.
    if (action && (action === "DISQUALIFY" || action === "NO_ACTION" || action === "WAIT")) {
      findings.push(finding("QA_SHOULD_CLOSE", 12, "REJECT", `The plan is ${action}; nothing may be asked.`));
    }

    // 13 No repetition: sticky re-ask is limited to one.
    const prior = unansweredPriorAsks(ctx.recentOutbound, dimension);
    if (prior >= MAX_ASKS_PER_INTENT) {
      findings.push(finding("QA_REPEAT", 13, "REJECT", `${dimension} was asked ${prior} times without an answer.`));
    } else if (prior === 1 && !isPlanned) {
      findings.push(finding("QA_REPEAT", 13, "REJECT", `${dimension} was just asked and not answered.`));
    } else if (prior === 1) {
      findings.push(finding("QA_REPEAT", 13, "WARN", `${dimension} re-asked once (the one permitted sticky re-ask).`));
    }
  }

  // 1 (warn) The plan asked, the draft did not.
  if (planned && (action === "ASK" || action === "ANSWER_AND_ASK") && !asksPlanned) {
    findings.push(finding("QA_UNPLANNED_QUESTION", 1, "WARN", `The planned ${planned.dimension} question was not asked.`));
  }

  // 8 Form-like: several questions, numbered questions.
  if (countQuestions(text) > 1) {
    findings.push(finding("STYLE_MULTIPLE_QUESTIONS", 8, "REJECT", `${countQuestions(text)} questions in one message.`));
  }
  if (FORM_NUMBERING.test(text)) {
    findings.push(finding("QA_FORM_LIKE", 8, "REJECT", "Numbered questions read like a form."));
  }

  // 9 Channel-natural.
  if (evaluateLength(text, ctx.channel).verdict === "REJECT") {
    findings.push(finding("TOO_LONG", 9, "REJECT", `Over the ${ctx.channel} hard limit.`));
  }
  if ((ctx.channel === "sms" || ctx.channel === "whatsapp" || ctx.channel === "messenger" || ctx.channel === "instagram") && MARKDOWN.test(text)) {
    findings.push(finding("QA_CHANNEL", 9, "REJECT", `Formatting on ${ctx.channel}.`));
  }

  // 10-11 Respond to what was said, and answer first.
  const theyAsked = ctx.leadAskedQuestion ?? leadAsked(ctx.inbound);
  if (theyAsked && questions.length > 0) {
    const firstQuestion = allSentences.findIndex(isQuestionSentence);
    const statements = allSentences.filter((s) => !isQuestionSentence(s));
    if (statements.length === 0) {
      findings.push(finding("QA_IGNORES_LEAD", 10, "REJECT", "The lead asked something and the draft only asks back."));
    } else if (firstQuestion === 0) {
      findings.push(finding("QA_QUESTION_FIRST", 11, "REJECT", "The draft asks before it answers."));
    }
  } else if (theyAsked && allSentences.length === 0) {
    findings.push(finding("QA_IGNORES_LEAD", 10, "REJECT", "Empty reply to a question."));
  }

  // De-duplicate identical code + severity pairs.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.code}:${f.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: !unique.some((f) => f.severity === "REJECT"), findings: unique, asked };
}

/** The REJECT findings, shaped for the validator's retry loop. */
export function qaFailures(result: QaResult): { code: QaCode; detail: string; correction: string }[] {
  return result.findings
    .filter((f) => f.severity === "REJECT")
    .map((f) => ({ code: f.code, detail: f.detail, correction: qaCorrection(f.code) }));
}

/** Where a stage sits, for "stageAtLeast" style checks. */
export function stageIndex(stage: ConversationStage): number {
  return STAGE_ORDER.indexOf(stage);
}
