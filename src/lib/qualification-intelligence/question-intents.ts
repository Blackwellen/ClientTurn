/**
 * The question-intent library (08 §B.7, brief §8), versioned `qi-1`.
 *
 * A question intent is *what we want to learn and why*, not a script. It
 * carries its dimension, prerequisites, the business types / offers / goals
 * / stages / channels it applies to, the answer type and deterministic
 * extractor, the lead-score features it feeds, follow-up branches, what an
 * answer can disqualify, its value attributes, a wording family (the
 * experiment unit), and channel renderings: default (an active conversation),
 * SMS / WhatsApp, email, and social (LinkedIn and the Meta inboxes).
 *
 * Renderings are templates the model may paraphrase, never re-plan: the NBA
 * fixes the intent, the model only words it (AGENT_RUNTIME "the model
 * proposes, code decides"). Every rendering asks exactly one question.
 *
 * Library intents come from three places:
 *   1. BASE_INTENTS: one discovery intent per dimension (26), B2B wording;
 *   2. SPECIFIC_INTENTS: hand-tuned B2B intents (MSP headcount and devices,
 *      contract renewal, the incumbent agency, ...);
 *   3. archetype wordings: every archetype question in the sales library
 *      that differs from the catalogue becomes `<DIMENSION>.<ARCHETYPE>`,
 *      scoped to that archetype. That is how each supported business type
 *      gets its own voice without a second copy of its questions.
 * VERIFY and CLARIFY intents are synthesised per dimension at run time.
 *
 * A configured question (qualification_questions) becomes an intent too:
 * the library intent it names (`question_intent_key`) with its own text as
 * the rendering, or a synthetic `custom:<question id>` intent (CD-6).
 *
 * Pure.
 */

import {
  AI_EXTRACTION_MIN_CONFIDENCE,
  ALWAYS_MATERIAL_DIMENSIONS,
  LIBRARY_INTENT_KEY_PATTERN,
  MAX_ASKS_PER_INTENT,
  QI_CHANNELS,
  QI_DIMENSION_KEYS,
  UNMAPPED_DIMENSION,
  customIntentKey,
  isCustomIntentKey,
  type AnswerType,
  type DimensionStatusEntry,
  type ExtractorKey,
  type FactDimension,
  type GoalKey,
  type IntentState,
  type Predicate,
  type QiDimensionKey,
  type QualificationFact,
  type QuestionIntent,
  type QuestionIntentAttrs,
  type QuestionIntentOverride,
  type QuestionPurpose,
} from "./types.ts";
import { stageAtLeast } from "./goals.ts";
import { REVENUE_NORMALISED_PREFIX } from "./extractors.ts";
import type { ResolvedOffer } from "./offer-profile.ts";
import { ARCHETYPES } from "../sales-library/archetypes.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import { MEDDPICC_ONLY_DIMENSIONS, PROBLEM_DIMENSIONS } from "../sales-library/motions.ts";
import type { AgentChannel } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { QuestionRecord } from "../qualification/next-question.ts";
import type { FeatureKey } from "../scoring/lead-score.ts";
import type { SalesMotion } from "../sales-library/types.ts";

/* ------------------------------------------------------------ constants */

const ALL_CHANNELS: AgentChannel[] = [...QI_CHANNELS];
const NOT_SMS: AgentChannel[] = ALL_CHANNELS.filter((c) => c !== "sms" && c !== "whatsapp");
const ASKING_STAGES: ConversationStage[] = ["NEW", "ENGAGED", "QUALIFYING", "OBJECTION", "CLOSING"];
const ENGAGED_ON: ConversationStage[] = ["ENGAGED", "QUALIFYING", "OBJECTION", "CLOSING"];

/**
 * Static salesProgression / intentRelevance per dimension (the two attributes
 * the sales-library catalogue does not carry). Progression: how directly an
 * answer moves the sale to its next step. Intent relevance: how much the
 * question itself builds or tests buying intent.
 */
const DYNAMIC_ATTRS: Record<QiDimensionKey, { salesProgression: number; intentRelevance: number }> = {
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

/** Default extractor and answer type per dimension. */
export const DIMENSION_EXTRACTOR: Record<QiDimensionKey, { extractor: ExtractorKey; answerType: AnswerType }> = {
  PROBLEM: { extractor: "FREE_TEXT", answerType: "text" },
  USE_CASE: { extractor: "FREE_TEXT", answerType: "text" },
  SERVICE_NEEDED: { extractor: "SERVICE_NAME", answerType: "single_choice" },
  PROJECT_SCOPE: { extractor: "FREE_TEXT", answerType: "text" },
  LOCATION: { extractor: "POSTCODE", answerType: "postcode" },
  PROPERTY_TYPE: { extractor: "FREE_TEXT", answerType: "text" },
  TIMING: { extractor: "TIMELINE", answerType: "timing" },
  TEAM_SIZE: { extractor: "COUNT", answerType: "count" },
  COMPANY_SIZE: { extractor: "COUNT", answerType: "count" },
  CURRENT_SOLUTION: { extractor: "PROVIDER_MENTION", answerType: "text" },
  AUTHORITY: { extractor: "ROLE_MENTION", answerType: "role" },
  BUDGET: { extractor: "MONEY", answerType: "money" },
  VOLUME: { extractor: "COUNT", answerType: "count" },
  PRODUCT_INTEREST: { extractor: "FREE_TEXT", answerType: "text" },
  SUITABILITY: { extractor: "FREE_TEXT", answerType: "text" },
  STAKEHOLDERS: { extractor: "ROLE_MENTION", answerType: "role" },
  SUCCESS_METRICS: { extractor: "FREE_TEXT", answerType: "text" },
  DECISION_PROCESS: { extractor: "FREE_TEXT", answerType: "text" },
  COMPLIANCE_REQUIREMENTS: { extractor: "FREE_TEXT", answerType: "text" },
  HIRING_NEED: { extractor: "FREE_TEXT", answerType: "text" },
  OUTCOME: { extractor: "FREE_TEXT", answerType: "text" },
  AVAILABILITY: { extractor: "DATE", answerType: "date" },
  DISSATISFACTION: { extractor: "DISSATISFACTION", answerType: "text" },
  TECHNICAL_REQUIREMENTS: { extractor: "FREE_TEXT", answerType: "text" },
  IMPLEMENTATION_READINESS: { extractor: "TIMELINE", answerType: "timing" },
  PURCHASE_READINESS: { extractor: "READINESS", answerType: "text" },
};

/** Lead-score features an answer to the dimension produces (answer-features.ts mapping). */
const DIMENSION_SCORING: Partial<Record<QiDimensionKey, { feature: FeatureKey; map: ExtractorKey }[]>> = {
  PROBLEM: [{ feature: "need_stated", map: "FREE_TEXT" }],
  USE_CASE: [{ feature: "need_stated", map: "FREE_TEXT" }],
  TIMING: [
    { feature: "timeline_days", map: "TIMELINE" },
    { feature: "urgent", map: "URGENCY" },
  ],
  BUDGET: [{ feature: "budget_confirmed", map: "MONEY" }],
  AUTHORITY: [{ feature: "authority_confirmed", map: "ROLE_MENTION" }],
  STAKEHOLDERS: [{ feature: "stakeholder_count", map: "COUNT" }],
  DECISION_PROCESS: [{ feature: "stakeholder_count", map: "COUNT" }],
};

/* ------------------------------------------------------------- the seeds */

type Seed = {
  key: string;
  dimension: QiDimensionKey;
  renderings: QuestionIntent["renderings"];
  purpose?: QuestionPurpose;
  appliesTo?: QuestionIntent["appliesTo"];
  stages?: ConversationStage[];
  channels?: AgentChannel[];
  prerequisites?: QuestionIntent["prerequisites"];
  branches?: QuestionIntent["branches"];
  disqualifies?: QuestionIntent["disqualifies"];
  extractor?: ExtractorKey;
  answerType?: AnswerType;
  attrs?: Partial<QuestionIntentAttrs>;
  wordingFamily?: string;
};

const ENTERPRISE_ONLY: SalesMotion[] = ["ENTERPRISE"];

/** One discovery intent per dimension, B2B-first wording. */
const BASE_SEEDS: Seed[] = [
  {
    key: "PROBLEM.PROMPT",
    dimension: "PROBLEM",
    renderings: {
      default: "What's prompted you to look at this now?",
      sms: "What made you look into this now?",
      email: "Could I ask what prompted you to look at this now?",
      social: "Curious, what prompted you to look at this now?",
    },
    branches: [{ when: { op: "known", dimension: "PROBLEM" }, next: "OUTCOME.GOOD_RESULT" }],
  },
  {
    key: "USE_CASE.MAIN_JOB",
    dimension: "USE_CASE",
    renderings: {
      default: "What would you mainly want it to do for you?",
      sms: "What would you mainly use it for?",
      email: "What would you mainly want it to handle for you?",
      social: "What would you mainly want it to do for you?",
    },
  },
  {
    key: "SERVICE_NEEDED.WHICH_SERVICE",
    dimension: "SERVICE_NEEDED",
    renderings: {
      default: "Which of our services are you looking for?",
      sms: "Which service do you need?",
      email: "Which of our services were you interested in?",
    },
  },
  {
    key: "PROJECT_SCOPE.WHAT_INVOLVED",
    dimension: "PROJECT_SCOPE",
    renderings: {
      default: "Roughly what does the project involve?",
      sms: "What does the project involve?",
      email: "Could you give me a rough idea of what the project involves?",
    },
  },
  {
    key: "LOCATION.POSTCODE",
    dimension: "LOCATION",
    renderings: {
      default: "What's the postcode where the work would be?",
      sms: "What's the postcode for the job?",
      email: "What's the postcode where the work would be?",
    },
  },
  {
    key: "PROPERTY_TYPE.KIND",
    dimension: "PROPERTY_TYPE",
    appliesTo: { motions: ["LOCAL_SERVICE", "HIGH_TICKET_B2C"] },
    renderings: { default: "What type of property is it?", sms: "What type of property is it?" },
  },
  {
    key: "TIMING.START_WINDOW",
    dimension: "TIMING",
    renderings: {
      default: "When are you hoping to have this in place?",
      sms: "When do you need this by?",
      email: "Is there a date you're hoping to have this in place by?",
      social: "Is there a timeframe you're working to?",
    },
    branches: [{ when: { op: "lte", dimension: "TIMING", value: 30 }, next: "CTA" }],
  },
  {
    key: "TEAM_SIZE.USERS",
    dimension: "TEAM_SIZE",
    renderings: {
      default: "How many people would be using it?",
      sms: "How many people would use it?",
      email: "Roughly how many people on the team would be using it?",
    },
  },
  {
    key: "COMPANY_SIZE.STAFF",
    dimension: "COMPANY_SIZE",
    appliesTo: { customerType: "B2B" },
    renderings: {
      default: "Roughly how many people work at the company?",
      sms: "How many staff are there?",
      email: "Roughly how many people work at the company?",
      social: "How big is the team there at the moment?",
    },
  },
  {
    key: "CURRENT_SOLUTION.TODAY",
    dimension: "CURRENT_SOLUTION",
    renderings: {
      default: "How are you handling this at the moment?",
      sms: "How are you handling it now?",
      email: "How are you handling this at the moment?",
      social: "How are you handling this today?",
    },
    branches: [{ when: { op: "equals", dimension: "CURRENT_SOLUTION", value: "EXTERNAL_PROVIDER" }, next: "DISSATISFACTION.WHAT_NOT_WORKING" }],
  },
  {
    key: "AUTHORITY.OTHERS_INVOLVED",
    dimension: "AUTHORITY",
    stages: ENGAGED_ON,
    prerequisites: { stageAtLeast: "ENGAGED" },
    renderings: {
      default: "Is anyone else involved in deciding on this?",
      sms: "Is anyone else involved in the decision?",
      email: "Will anyone else be involved in deciding on this?",
    },
  },
  {
    key: "BUDGET.RANGE",
    dimension: "BUDGET",
    stages: ENGAGED_ON,
    prerequisites: { stageAtLeast: "ENGAGED", intentNotIn: ["NO_DETECTED_INTENT", "NOT_NOW", "NEGATIVE"] },
    renderings: {
      default: "Do you have a budget range in mind for this?",
      sms: "Is there a budget range in mind?",
      email: "Do you have a budget range in mind, so we can suggest the right option?",
    },
  },
  {
    key: "VOLUME.MONTHLY",
    dimension: "VOLUME",
    channels: NOT_SMS,
    renderings: { default: "Roughly what volumes are we talking about each month?", email: "Roughly what volumes would you expect each month?" },
  },
  {
    key: "PRODUCT_INTEREST.WHICH",
    dimension: "PRODUCT_INTEREST",
    renderings: { default: "Which product were you looking at?", sms: "Which product caught your eye?" },
  },
  {
    key: "SUITABILITY.GOAL",
    dimension: "SUITABILITY",
    renderings: { default: "Can you tell me a little about what you're hoping to achieve?", sms: "What are you hoping to achieve?" },
  },
  {
    key: "STAKEHOLDERS.EVALUATION",
    dimension: "STAKEHOLDERS",
    appliesTo: { motions: ENTERPRISE_ONLY },
    stages: ENGAGED_ON,
    prerequisites: { stageAtLeast: "ENGAGED" },
    renderings: {
      default: "Who else would need to be involved in evaluating this?",
      email: "Who else on your side would need to be involved in evaluating this?",
    },
  },
  {
    key: "SUCCESS_METRICS.MEASURE",
    dimension: "SUCCESS_METRICS",
    appliesTo: { motions: ENTERPRISE_ONLY },
    stages: ENGAGED_ON,
    renderings: { default: "How would you measure whether this has worked?", email: "How would you measure whether this had worked?" },
  },
  {
    key: "DECISION_PROCESS.STEPS",
    dimension: "DECISION_PROCESS",
    appliesTo: { motions: ENTERPRISE_ONLY },
    stages: ["QUALIFYING", "OBJECTION", "CLOSING"],
    prerequisites: { stageAtLeast: "ENGAGED" },
    renderings: { default: "What does the decision process usually look like on your side?" },
  },
  {
    key: "COMPLIANCE_REQUIREMENTS.STANDARDS",
    dimension: "COMPLIANCE_REQUIREMENTS",
    appliesTo: { customerType: "B2B" },
    stages: ENGAGED_ON,
    channels: NOT_SMS,
    renderings: {
      default: "Are there any compliance or security requirements we'd need to meet?",
      email: "Are there any compliance or security standards we would need to meet?",
    },
  },
  {
    key: "HIRING_NEED.ROLES",
    dimension: "HIRING_NEED",
    renderings: { default: "Which roles are you looking to fill?", sms: "Which roles are you hiring for?" },
  },
  {
    key: "OUTCOME.GOOD_RESULT",
    dimension: "OUTCOME",
    renderings: {
      default: "What would a good result look like for you?",
      sms: "What would a good result look like?",
      email: "What would a good result look like for you in six months' time?",
      social: "What would a good outcome look like for you?",
    },
  },
  {
    key: "AVAILABILITY.DAYS",
    dimension: "AVAILABILITY",
    stages: ["QUALIFYING", "CLOSING"],
    renderings: { default: "What days usually suit you best for a call?", sms: "Which days suit you for a call?" },
  },
  {
    key: "DISSATISFACTION.WHAT_NOT_WORKING",
    dimension: "DISSATISFACTION",
    prerequisites: { knownAllOf: ["CURRENT_SOLUTION"] },
    stages: ENGAGED_ON,
    renderings: {
      default: "What's not working about how it's done now?",
      sms: "What's not working with the current setup?",
      email: "What's not working about the current setup?",
      social: "What's not working about how it's done now?",
    },
  },
  {
    key: "TECHNICAL_REQUIREMENTS.INTEGRATIONS",
    dimension: "TECHNICAL_REQUIREMENTS",
    appliesTo: { customerType: "B2B" },
    stages: ENGAGED_ON,
    renderings: {
      default: "Is there anything it would need to connect to or work with?",
      sms: "Does it need to work with any other systems?",
      email: "Are there any systems it would need to connect to or work with?",
    },
  },
  {
    key: "IMPLEMENTATION_READINESS.START_READY",
    dimension: "IMPLEMENTATION_READINESS",
    stages: ["QUALIFYING", "OBJECTION", "CLOSING"],
    prerequisites: { intentNotIn: ["NO_DETECTED_INTENT", "LOW", "NOT_NOW", "NEGATIVE"] },
    renderings: { default: "If it's a fit, how soon could your side get started?", sms: "How soon could you get started?" },
  },
  {
    key: "PURCHASE_READINESS.GO_AHEAD",
    dimension: "PURCHASE_READINESS",
    stages: ["QUALIFYING", "OBJECTION", "CLOSING"],
    prerequisites: { intentNotIn: ["NO_DETECTED_INTENT", "LOW", "EXPLORATORY", "NOT_NOW", "NEGATIVE"] },
    renderings: { default: "Are you ready to go ahead if it's the right fit?", sms: "Ready to go ahead if it fits?" },
  },
];

/** Hand-tuned B2B intents: the ICP (CLAUDE.md resolved conflict 5). */
const SPECIFIC_SEEDS: Seed[] = [
  {
    key: "COMPANY_SIZE.STAFF_AND_DEVICES",
    dimension: "COMPANY_SIZE",
    appliesTo: { archetypes: ["MSP", "CYBERSECURITY", "IT_CONSULTANCY"] },
    renderings: {
      default: "How many staff and devices would we be looking after?",
      sms: "How many staff and devices do you have?",
      email: "Roughly how many staff and devices would we be looking after?",
      social: "Roughly how many staff and devices would need looking after?",
    },
    disqualifies: { when: { op: "lt", dimension: "COMPANY_SIZE", value: 5 }, reason: "Fewer staff than managed support is priced for.", reviewInstead: true },
    wordingFamily: "SIZE.STAFF_AND_DEVICES",
  },
  {
    key: "CURRENT_SOLUTION.IT_PROVIDER",
    dimension: "CURRENT_SOLUTION",
    appliesTo: { archetypes: ["MSP", "CYBERSECURITY", "IT_CONSULTANCY", "TELECOM"] },
    renderings: {
      default: "Who looks after your IT today?",
      sms: "Who looks after your IT now?",
      email: "Who looks after your IT at the moment?",
    },
    branches: [{ when: { op: "equals", dimension: "CURRENT_SOLUTION", value: "EXTERNAL_PROVIDER" }, next: "TIMING.CONTRACT_RENEWAL" }],
  },
  {
    key: "TIMING.CONTRACT_RENEWAL",
    dimension: "TIMING",
    appliesTo: { archetypes: ["MSP", "TELECOM", "CYBERSECURITY", "ACCOUNTING", "MARKETING_AGENCY", "SEO_AGENCY"] },
    prerequisites: { knownAllOf: ["CURRENT_SOLUTION"] },
    renderings: {
      default: "When does your current arrangement come up for renewal?",
      sms: "When is your current contract up?",
      email: "When does your current contract come up for renewal?",
      social: "When does your current arrangement come up for renewal?",
    },
  },
  {
    key: "CURRENT_SOLUTION.INCUMBENT_AGENCY",
    dimension: "CURRENT_SOLUTION",
    appliesTo: { archetypes: ["MARKETING_AGENCY", "ADVERTISING_AGENCY", "SEO_AGENCY", "CREATIVE_WEB_STUDIO"] },
    renderings: {
      default: "Who's doing this for you today: in-house, another agency, or nobody yet?",
      sms: "Who handles this for you now?",
      email: "Is this handled in-house at the moment, by another agency, or not yet at all?",
      social: "Is this in-house at the moment, with an agency, or not started yet?",
    },
    branches: [{ when: { op: "equals", dimension: "CURRENT_SOLUTION", value: "EXTERNAL_PROVIDER" }, next: "DISSATISFACTION.WHAT_NOT_WORKING" }],
  },
  {
    key: "PROJECT_SCOPE.NEW_OR_REDESIGN",
    dimension: "PROJECT_SCOPE",
    appliesTo: { archetypes: ["CREATIVE_WEB_STUDIO"] },
    renderings: {
      default: "Is it a new site, a redesign, or something else?",
      sms: "New site or a redesign?",
      email: "Is this a new website, a redesign of the current one, or something else?",
    },
  },
  {
    key: "USE_CASE.WORKFLOW",
    dimension: "USE_CASE",
    appliesTo: { archetypes: ["B2B_SAAS", "PLG_SAAS", "HR_TECH", "FINTECH"] },
    renderings: {
      default: "Which part of your workflow would you want it to take over first?",
      sms: "What would you want it to handle first?",
      email: "Which part of your workflow would you want it to take over first?",
      social: "Which part of the workflow would you want it to handle first?",
    },
  },
  {
    key: "SERVICE_NEEDED.ACCOUNTS_TAX_PAYROLL",
    dimension: "SERVICE_NEEDED",
    appliesTo: { archetypes: ["ACCOUNTING", "BOOKKEEPING"] },
    renderings: {
      default: "Which do you need help with: accounts, tax, payroll, or advisory?",
      sms: "Accounts, tax, payroll or advisory?",
      email: "Which would you like help with: year-end accounts, tax, payroll, or advisory?",
    },
  },
  {
    key: "TIMING.YEAR_END",
    dimension: "TIMING",
    appliesTo: { archetypes: ["ACCOUNTING", "BOOKKEEPING"] },
    renderings: {
      default: "When is your next year end or filing deadline?",
      sms: "When's your next year end?",
      email: "When is your next year end or filing deadline?",
    },
  },
  {
    key: "VOLUME.FOR_WHOM_OR_BULK",
    dimension: "VOLUME",
    appliesTo: { archetypes: ["ECOMMERCE", "SUBSCRIPTION_ECOMMERCE", "MARKETPLACE"] },
    renderings: { default: "Is this for yourself, or are you buying in quantity?", sms: "For you, or buying in bulk?" },
    extractor: "COUNT",
  },
];

/* ------------------------------------------------------- intent builders */

/** A dimension's six value attributes: the catalogue's four plus progression and intent relevance. */
export function attrsFor(dimension: QiDimensionKey, override?: Partial<QuestionIntentAttrs>): QuestionIntentAttrs {
  const catalogue = QUALIFICATION_CATALOGUE[dimension];
  return {
    decisionRelevance: catalogue.decisionRelevance,
    informationGain: catalogue.informationGain,
    salesProgression: DYNAMIC_ATTRS[dimension].salesProgression,
    intentRelevance: DYNAMIC_ATTRS[dimension].intentRelevance,
    friction: catalogue.friction,
    prematurity: catalogue.prematurity,
    ...override,
  };
}

function fromSeed(seed: Seed): QuestionIntent {
  const defaults = DIMENSION_EXTRACTOR[seed.dimension];
  return {
    key: seed.key,
    dimension: seed.dimension,
    purpose: seed.purpose ?? "DISCOVER",
    prerequisites: seed.prerequisites ?? {},
    appliesTo: seed.appliesTo ?? {},
    stages: seed.stages ?? ASKING_STAGES,
    channels: seed.channels ?? ALL_CHANNELS,
    answerType: seed.answerType ?? defaults.answerType,
    extractor: seed.extractor ?? defaults.extractor,
    scoring: DIMENSION_SCORING[seed.dimension] ?? [],
    branches: seed.branches ?? [],
    ...(seed.disqualifies ? { disqualifies: seed.disqualifies } : {}),
    attrs: attrsFor(seed.dimension, seed.attrs),
    wordingFamily: seed.wordingFamily ?? seed.key,
    renderings: seed.renderings,
  };
}

/** Every archetype wording that differs from the catalogue, as a scoped intent. */
function archetypeSeeds(): Seed[] {
  const seeds: Seed[] = [];
  for (const archetype of ARCHETYPES) {
    for (const dimension of archetype.qualification) {
      const catalogue = QUALIFICATION_CATALOGUE[dimension.key];
      if (dimension.question === catalogue.question) continue;
      seeds.push({
        key: `${dimension.key}.${archetype.key}`,
        dimension: dimension.key,
        appliesTo: { archetypes: [archetype.key] },
        renderings: { default: dimension.question },
        wordingFamily: `${dimension.key}.${archetype.key}`,
        attrs: {
          informationGain: dimension.informationGain,
          decisionRelevance: dimension.decisionRelevance,
          friction: dimension.friction,
          prematurity: dimension.prematurity,
        },
        // Keep the base intent's gates for gated dimensions.
        ...(BASE_SEEDS.find((base) => base.dimension === dimension.key)?.prerequisites
          ? { prerequisites: BASE_SEEDS.find((base) => base.dimension === dimension.key)!.prerequisites }
          : {}),
        ...(BASE_SEEDS.find((base) => base.dimension === dimension.key)?.stages
          ? { stages: BASE_SEEDS.find((base) => base.dimension === dimension.key)!.stages }
          : {}),
      });
    }
  }
  return seeds;
}

/** The library, keyed by intent key. Built once; deterministic order. */
export const QUESTION_INTENTS: readonly QuestionIntent[] = (() => {
  const seen = new Set<string>();
  const out: QuestionIntent[] = [];
  for (const seed of [...BASE_SEEDS, ...SPECIFIC_SEEDS, ...archetypeSeeds()]) {
    if (seen.has(seed.key)) continue;
    seen.add(seed.key);
    out.push(fromSeed(seed));
  }
  return out;
})();

const BY_KEY = new Map(QUESTION_INTENTS.map((intent) => [intent.key, intent]));

export function intentByKey(key: string | null | undefined): QuestionIntent | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/** The generic discovery intent for a dimension. */
export function baseIntentFor(dimension: QiDimensionKey): QuestionIntent {
  const seed = BASE_SEEDS.find((entry) => entry.dimension === dimension)!;
  return BY_KEY.get(seed.key)!;
}

/* ------------------------------------------ service vocabulary (MI-2) */

/**
 * The options a business type's SERVICE_NEEDED question offers, with the
 * phrases a buyer uses for each. The question itself asks "accounts, tax,
 * payroll, or advisory?"; a lead who already wrote "our year end accounts and
 * corporation tax" has answered it, so the same vocabulary reads the answer
 * from any reply (extractors.ts SERVICE_NAME, `serviceTerms`).
 */
const SERVICE_TERMS: Record<string, { label: string; pattern: string }[]> = {
  "SERVICE_NEEDED.ACCOUNTS_TAX_PAYROLL": [
    { label: "accounts", pattern: "\\b(?:year[- ]?end|annual accounts|statutory accounts|company accounts|management accounts|(?:our|the|my) accounts|accounts (?:prep|preparation|filing))\\b" },
    { label: "tax", pattern: "\\b(?:corporation tax|vat(?: returns?)?|self[- ]assessment|tax returns?|tax planning|r&d (?:tax )?credits?|(?:our|the|my) tax)\\b" },
    { label: "payroll", pattern: "\\b(?:payroll|payslips?|pay slips?|auto[- ]enrol(?:l?ment)?|pensions? admin)\\b" },
    { label: "advisory", pattern: "\\b(?:advisory|business advice|cash ?flow|forecasting|forecasts?|fractional (?:cfo|fd)|virtual (?:cfo|fd))\\b" },
  ],
};

/** The service vocabulary for a business type: its SERVICE_NEEDED intents' options. */
export function serviceTermsFor(archetypeKey: string | null | undefined): { label: string; pattern: string }[] {
  if (!archetypeKey) return [];
  const out: { label: string; pattern: string }[] = [];
  for (const [key, terms] of Object.entries(SERVICE_TERMS)) {
    const intent = BY_KEY.get(key);
    if (intent && (!intent.appliesTo.archetypes || intent.appliesTo.archetypes.includes(archetypeKey))) out.push(...terms);
  }
  return out;
}

/* ----------------------------------------------- VERIFY / CLARIFY intents */

/**
 * VERIFY wording. `{value}` is filled with a value *shaped for the template*
 * (verifyPhrase), never the raw fact text: a stored "about 40 staff" in
 * "is it around {value} staff?" rendered "is it around about 40 staff
 * staff?" (defect MI-1). Templates that carry their own unit or hedge get the
 * bare number; everything else gets the lead's words with the hedge, a
 * leading conjunction and first-person pronouns turned round.
 */
const VERIFY_TEMPLATE: Partial<Record<QiDimensionKey, string>> = {
  COMPANY_SIZE: "Just to check, is it around {value} staff?",
  TEAM_SIZE: "Just to check, would it be around {value} people using it?",
  TIMING: "Last time you mentioned {value}; is that still the timing?",
  BUDGET: "Just to check, is the budget still around {value}?",
  AUTHORITY: "Just to check, are you the one who'd sign this off?",
  LOCATION: "Just to confirm, is the work at {value}?",
  CURRENT_SOLUTION: "Is {value} still looking after this for you?",
  SERVICE_NEEDED: "Just to check, it's {value} you're after?",
};

/** Hedges a lead puts round a value; the templates supply their own. */
const LEADING_HEDGE =
  /^(?:(?:around about|round about|about|around|roughly|approximately|approx\.?|circa|maybe|perhaps|probably|nearly|almost|just over|just under|over|under|up to|somewhere (?:around|between)|in the region of|~)\s+)+/i;
const TRAILING_HEDGE = /\s*(?:or so|-?ish|give or take|roughly|approx\.?|at a guess|i think|i guess)\s*$/i;
// Not "no": "no one" and "no budget yet" mean what they say.
const LEADING_JOINER = /^(?:and|but|so|because|although|though|also|plus|then|well|oh|yes|yeah|ok|okay|honestly|basically|really)\b[,\s]*/i;
const PRONOUN_SWAP: [RegExp, string][] = [
  [/\bwe're\b/gi, "you're"],
  [/\bwe've\b/gi, "you've"],
  [/\bwe'd\b/gi, "you'd"],
  [/\bi'm\b/gi, "you're"],
  [/\bi've\b/gi, "you've"],
  [/\bi'd\b/gi, "you'd"],
  [/\bour\b/gi, "your"],
  [/\bours\b/gi, "yours"],
  [/\bmy\b/gi, "your"],
  [/\bmyself\b/gi, "yourself"],
  [/\bourselves\b/gi, "yourselves"],
  [/\bme\b/gi, "you"],
  [/\bus\b/g, "you"],
  [/\bwe\b/gi, "you"],
  [/\bi\b/gi, "you"],
];

function cleanWords(value: string): string {
  let text = value.replace(/\s+/g, " ").trim().replace(/[.!?;,:]+$/, "").trim();
  for (let i = 0; i < 3; i += 1) {
    const before = text;
    text = text.replace(LEADING_JOINER, "").replace(LEADING_HEDGE, "").replace(TRAILING_HEDGE, "").trim();
    if (text === before) break;
  }
  for (const [re, to] of PRONOUN_SWAP) text = text.replace(re, to);
  // Sentence-case a leading capital ("Roof repair" -> "roof repair"); keep
  // acronyms and proper names ("SEO", "Google Ads").
  if (/^[A-Z][a-z]/.test(text) && !/\s[A-Z]/.test(text)) text = text.charAt(0).toLowerCase() + text.slice(1);
  return text;
}

function formatCount(n: number): string {
  return Number.isInteger(n) && n >= 1_000 ? n.toLocaleString("en-GB") : String(n);
}

/** A value that reads as a statement ("your IT support is awful"), not a noun phrase. */
const CLAUSE_VERB =
  /\b(?:is|are|was|were|isn't|aren't|wasn't|need|needs|want|wants|have|has|had|keep|keeps|kept|do|does|don't|doesn't|can|can't|could|won't|will|would|takes?|took|you're|you've|you'd|it's|they're|there's)\b/i;

/** Shorter labels for the check question where the catalogue's reads long. */
const VERIFY_LABEL: Partial<Record<QiDimensionKey, string>> = {
  PROBLEM: "problem",
  DISSATISFACTION: "issue with the current setup",
  USE_CASE: "main use",
};

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `£${Number((n / 1_000_000).toFixed(1)).toString()}m`;
  if (n >= 1_000) return `£${Number((n / 1_000).toFixed(1)).toString()}k`;
  return `£${n}`;
}

/** A plain number from a normalised count ("40"), or the first number in the words. */
function countIn(value: string, normalised: string | null | undefined): number | null {
  if (normalised && /^\d+(\.\d+)?$/.test(normalised)) return Number(normalised);
  const digits = /\d[\d,]*(\.\d+)?/.exec(value);
  return digits ? Number(digits[0].replace(/,/g, "")) : null;
}

/** Whether a normalised COMPANY_SIZE value is a turnover, not a headcount (MI-3). */
export function isRevenueValue(normalised: string | null | undefined): boolean {
  return !!normalised && normalised.startsWith(REVENUE_NORMALISED_PREFIX);
}

/**
 * The VERIFY question for a dimension and its live value, or null when the
 * value cannot be put into a natural check (the discovery question is asked
 * instead). Exactly one question, no doubled units, no "around about".
 */
export function verifyRendering(dimension: QiDimensionKey, value: string | null, normalised?: string | null): string | null {
  const raw = (value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!raw && dimension !== "AUTHORITY") return null;
  const fill = (template: string, phrase: string) => template.replace("{value}", phrase);
  const label = QUALIFICATION_CATALOGUE[dimension].label.toLowerCase().replace(/^the\s+/, "");

  switch (dimension) {
    case "AUTHORITY":
      return VERIFY_TEMPLATE.AUTHORITY!;
    case "COMPANY_SIZE": {
      if (isRevenueValue(normalised)) {
        const amount = Number(normalised!.slice(REVENUE_NORMALISED_PREFIX.length));
        return Number.isFinite(amount) ? `Just to check, is annual turnover around ${formatMoney(amount)}?` : null;
      }
      const n = countIn(raw, normalised);
      if (n === null) return null;
      if (n === 1) return "Just to check, is it just you at the company?";
      return fill(VERIFY_TEMPLATE.COMPANY_SIZE!, formatCount(n));
    }
    case "TEAM_SIZE": {
      const n = countIn(raw, normalised);
      if (n === null) return null;
      if (n === 1) return "Just to check, would it just be you using it?";
      return fill(VERIFY_TEMPLATE.TEAM_SIZE!, formatCount(n));
    }
    case "VOLUME":
    case "STAKEHOLDERS": {
      const words = cleanWords(raw);
      const n = countIn(raw, normalised);
      if (!words) return null;
      // Keep the lead's unit ("2,000 orders") but never a second hedge.
      return /\d/.test(words) && n !== null
        ? `Just to check I have the ${label} right: is it around ${words}?`
        : `Just to check I have the ${label} right: is it ${words}?`;
    }
    case "BUDGET": {
      const amount = /(?:£\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|grand)?|\b\d[\d,]*(?:\.\d+)?\s*(?:k|grand|pounds|gbp|quid))(?:\s*(?:a|per|\/)\s*(?:month|year|annum)|\s*pcm)?/i.exec(raw);
      if (amount) return fill(VERIFY_TEMPLATE.BUDGET!, amount[0].trim());
      const n = normalised && /^(?:gbp:)?\d+$/.test(normalised) ? Number(normalised.replace(/^gbp:/, "")) : null;
      if (n !== null) return fill(VERIFY_TEMPLATE.BUDGET!, formatMoney(n));
      const words = cleanWords(raw).replace(/^(?:(?:a|the|your)\s+)?budget\s+(?:of|is|was|around|about)?\s*/i, "");
      return words ? fill(VERIFY_TEMPLATE.BUDGET!, words) : null;
    }
    case "LOCATION": {
      const postcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.exec(raw);
      const words = postcode ? postcode[0].toUpperCase() : cleanWords(raw);
      return words ? fill(VERIFY_TEMPLATE.LOCATION!, words) : null;
    }
    case "CURRENT_SOLUTION": {
      const kind = (normalised ?? "").toUpperCase();
      if (kind === "IN_HOUSE") return "Just to check, is this still handled in-house?";
      if (kind === "NONE") return "Just to check, is nobody looking after this for you at the moment?";
      const words = cleanWords(raw).replace(/\bcurrent\s+/i, "");
      if (!words) return null;
      const subject = /^(your|the|a|an)\b/i.test(words) || /^[A-Z]/.test(words) ? words : `your ${words}`;
      return fill(VERIFY_TEMPLATE.CURRENT_SOLUTION!, subject);
    }
    case "SERVICE_NEEDED": {
      const words = cleanWords(raw).replace(/\s+you're after$/i, "");
      return words ? fill(VERIFY_TEMPLATE.SERVICE_NEEDED!, words) : null;
    }
    case "TIMING": {
      const words = cleanWords(raw).replace(/\s+(?:is|is still)\s+the timing$/i, "");
      return words ? fill(VERIFY_TEMPLATE.TIMING!, words) : null;
    }
    default: {
      const words = cleanWords(raw);
      if (!words) return null;
      // A statement reads as one: "is it still the case that your IT support
      // is awful?"; a noun phrase is checked against its label.
      if (CLAUSE_VERB.test(words) && words.split(/\s+/).length >= 3) return `Just to check, is it still the case that ${words}?`;
      return `Just to check I have the ${VERIFY_LABEL[dimension] ?? label} right: is it ${words}?`;
    }
  }
}

/** Collapses a word repeated back to back ("staff staff"), the last guard on templated text. */
function collapseRepeats(text: string): string {
  return text.replace(/\b([A-Za-z']+)(\s+\1\b)+/gi, "$1");
}

/** A VERIFY intent for an INFERRED material or stale fact (08 §B.12). */
export function verifyIntentFor(dimension: QiDimensionKey, value: string | null, normalised?: string | null): QuestionIntent {
  const base = baseIntentFor(dimension);
  const shaped = verifyRendering(dimension, value, normalised);
  const rendering = shaped ? collapseRepeats(shaped).slice(0, 300) : base.renderings.default;
  return {
    ...base,
    key: `${dimension}.VERIFY`,
    purpose: "VERIFY",
    prerequisites: {},
    branches: [],
    stages: ASKING_STAGES,
    channels: ALL_CHANNELS,
    // A yes/no check is cheaper than the discovery question.
    attrs: { ...base.attrs, friction: Math.max(0, base.attrs.friction - 0.1), prematurity: 0 },
    wordingFamily: `${dimension}.VERIFY`,
    renderings: { default: rendering },
  };
}

/** A CLARIFY intent for a CONFLICTING dimension: always asked before it can gate. */
export function clarifyIntentFor(dimension: QiDimensionKey, values: string[]): QuestionIntent {
  const base = baseIntentFor(dimension);
  const label = QUALIFICATION_CATALOGUE[dimension].label.toLowerCase();
  const [a, b] = values.map((v) => v.replace(/\s+/g, " ").trim().slice(0, 60));
  const rendering =
    a && b
      ? `I've got two different answers for the ${label}: is it ${a} or ${b}?`
      : `I've got two different answers for the ${label}; which is right?`;
  return {
    ...base,
    key: `${dimension}.CLARIFY`,
    purpose: "CLARIFY",
    prerequisites: {},
    branches: [],
    stages: ASKING_STAGES,
    channels: ALL_CHANNELS,
    attrs: { ...base.attrs, decisionRelevance: Math.max(base.attrs.decisionRelevance, 0.9), prematurity: 0 },
    wordingFamily: `${dimension}.CLARIFY`,
    renderings: { default: rendering },
  };
}

/* --------------------------------------------------- configured questions */

export type ConfiguredQuestion = QuestionRecord & {
  /** qualification_questions.dimension_key (0134). */
  dimensionKey?: string | null;
  /** qualification_questions.question_intent_key (0134). */
  intentKey?: string | null;
};

/**
 * A configured question as an intent (§B.7 "Relation to configured
 * questions"): its library intent with its own wording, or `custom:<id>`.
 * `inferredDimension` is the next-question.ts `inferDimension` result, used
 * when no dimension_key is stored.
 */
export function intentFromConfiguredQuestion(
  question: ConfiguredQuestion,
  inferredDimension: QiDimensionKey | null,
): QuestionIntent {
  const storedDimension = (QI_DIMENSION_KEYS as readonly string[]).includes(question.dimensionKey ?? "")
    ? (question.dimensionKey as QiDimensionKey)
    : null;
  const dimension: FactDimension = storedDimension ?? inferredDimension ?? UNMAPPED_DIMENSION;
  const library = question.intentKey && LIBRARY_INTENT_KEY_PATTERN.test(question.intentKey) ? intentByKey(question.intentKey) : null;
  const text = question.questionText.slice(0, 300);
  if (library) {
    return {
      ...library,
      dimension: storedDimension ?? library.dimension,
      renderings: { default: text },
      questionId: question.id,
      required: question.required,
    };
  }
  const dimensionAttrs =
    dimension === UNMAPPED_DIMENSION
      ? { decisionRelevance: question.required ? 0.75 : 0.5, informationGain: 0.6, salesProgression: 0.4, intentRelevance: 0.4, friction: 0.2, prematurity: 0.1 }
      : attrsFor(dimension);
  const extractor: ExtractorKey =
    question.responseType === "yes_no"
      ? "YES_NO"
      : question.responseType === "number"
        ? "NUMBER"
        : question.responseType === "postcode"
          ? "POSTCODE"
          : question.responseType === "single_choice" || question.responseType === "timing"
            ? "CHOICE"
            : "FREE_TEXT";
  return {
    key: customIntentKey(question.id),
    dimension,
    purpose: "DISCOVER",
    prerequisites: {},
    appliesTo: {},
    stages: ASKING_STAGES,
    channels: ALL_CHANNELS,
    answerType: question.responseType,
    extractor,
    scoring: dimension === UNMAPPED_DIMENSION ? [] : (DIMENSION_SCORING[dimension] ?? []),
    branches: [],
    attrs: dimensionAttrs,
    wordingFamily: customIntentKey(question.id),
    renderings: { default: text },
    questionId: question.id,
    required: question.required,
  };
}

/* ------------------------------------------------------------ predicates */

export type FactValue = { status: "CONFIRMED" | "INFERRED"; value: string; normalised: string | null };

export type PredicateContext = {
  values: ReadonlyMap<FactDimension, FactValue>;
  statuses?: ReadonlyMap<FactDimension, DimensionStatusEntry["status"]>;
  intentState?: IntentState | null;
};

function numberOf(value: FactValue | undefined): number | null {
  if (!value) return null;
  // A turnover filed under COMPANY_SIZE is not a number of people (MI-3):
  // a headcount rule neither passes nor fails on it.
  if (isRevenueValue(value.normalised)) return null;
  const source = value.normalised ?? value.value;
  const match = /-?\d+(\.\d+)?/.exec(source.replace(/,/g, ""));
  return match ? Number(match[0]) : null;
}

/** Evaluates a serialisable predicate (CD-17). Unknown values never satisfy a comparison. */
export function evaluatePredicate(predicate: Predicate, ctx: PredicateContext): boolean {
  switch (predicate.op) {
    case "known": {
      const status = ctx.statuses?.get(predicate.dimension);
      return status ? status !== "CONFLICTING" && status !== "UNKNOWN" : ctx.values.has(predicate.dimension);
    }
    case "unknown": {
      const status = ctx.statuses?.get(predicate.dimension);
      return status ? status === "UNKNOWN" : !ctx.values.has(predicate.dimension);
    }
    case "equals": {
      const value = ctx.values.get(predicate.dimension);
      if (!value) return false;
      const target = predicate.value.toLowerCase();
      return (value.normalised ?? "").toLowerCase() === target || value.value.toLowerCase() === target;
    }
    case "in": {
      const value = ctx.values.get(predicate.dimension);
      if (!value) return false;
      const targets = predicate.values.map((v) => v.toLowerCase());
      return targets.includes((value.normalised ?? "").toLowerCase()) || targets.includes(value.value.toLowerCase());
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const n = numberOf(ctx.values.get(predicate.dimension));
      if (n === null) return false;
      if (predicate.op === "lt") return n < predicate.value;
      if (predicate.op === "lte") return n <= predicate.value;
      if (predicate.op === "gt") return n > predicate.value;
      return n >= predicate.value;
    }
    case "intentIn":
      return ctx.intentState ? predicate.states.includes(ctx.intentState) : false;
    case "all":
      return predicate.of.every((p) => evaluatePredicate(p, ctx));
    case "any":
      return predicate.of.some((p) => evaluatePredicate(p, ctx));
    case "not":
      return !evaluatePredicate(predicate.of, ctx);
  }
}

/** Dimensions a predicate reads (to know which unknown dimension would decide it). */
export function predicateDimensions(predicate: Predicate): QiDimensionKey[] {
  switch (predicate.op) {
    case "intentIn":
      return [];
    case "all":
    case "any":
      return [...new Set(predicate.of.flatMap(predicateDimensions))];
    case "not":
      return predicateDimensions(predicate.of);
    default:
      return [predicate.dimension];
  }
}

/**
 * The live value per dimension from stored facts: not superseded, not
 * REJECTED / CONFLICTING, not expired; CONFIRMED beats INFERRED, then newest.
 * `includeAi = false` drops AI_ASSIST facts (the engine verdict never reads
 * them, CLAUDE.md resolved conflict 1).
 */
export function factValues(
  facts: readonly QualificationFact[],
  now: string,
  options: { includeAi?: boolean; confirmedOnly?: boolean } = {},
): Map<FactDimension, FactValue> {
  const at = Date.parse(now);
  const live = facts
    .filter((f) => !f.supersededAt && (f.state === "CONFIRMED" || f.state === "INFERRED"))
    .filter((f) => !f.validUntil || Date.parse(f.validUntil) > at)
    .filter((f) => options.includeAi !== false || f.source !== "AI_ASSIST")
    .filter((f) => !options.confirmedOnly || f.state === "CONFIRMED")
    .filter((f) => f.source !== "AI_ASSIST" || f.confidence >= AI_EXTRACTION_MIN_CONFIDENCE)
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "CONFIRMED" ? -1 : 1;
      return Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id);
    });
  const out = new Map<FactDimension, FactValue>();
  for (const fact of live) {
    if (out.has(fact.dimension)) continue;
    out.set(fact.dimension, { status: fact.state as "CONFIRMED" | "INFERRED", value: fact.value, normalised: fact.valueNormalised });
  }
  return out;
}

/* ------------------------------------------------------ candidate building */

export type CandidateContext = {
  resolved: ResolvedOffer;
  goal: GoalKey;
  stage: ConversationStage;
  channel: AgentChannel | null;
  intentState: IntentState;
  dimensions: readonly DimensionStatusEntry[];
  /** Live facts: VERIFY / CLARIFY wording and branch predicates read them. */
  facts?: readonly QualificationFact[];
  now?: string;
  configuredQuestions?: readonly ConfiguredQuestion[];
  /** The lead's service, for service-scoped configured questions. */
  serviceId?: string | null;
  /** Configured questions with an answer row (the engine's own record). */
  answeredQuestionIds?: readonly string[];
  /** QUALIFICATION_QUESTION overrides keyed by intent key (F9). */
  intentOverrides?: Readonly<Record<string, QuestionIntentOverride>>;
  askHistory?: readonly { key: string; asked: number; answered: boolean }[];
  /** next-question.ts inferDimension, injected to keep this module free of a cycle. */
  inferDimension?: (question: QuestionRecord) => QiDimensionKey | null;
};

export type CandidateExclusion = { key: string; reason: string };

function appliesToOffer(intent: QuestionIntent, ctx: CandidateContext): boolean {
  const a = intent.appliesTo;
  const archetypeKey = ctx.resolved.archetypeKey;
  if (a.archetypes && (!archetypeKey || !a.archetypes.includes(archetypeKey))) return false;
  if (a.sicPrefixes && a.sicPrefixes.length > 0) {
    const prefixes = ctx.resolved.archetype?.sic2026Prefixes ?? [];
    if (!prefixes.some((code) => a.sicPrefixes!.some((p) => code.startsWith(p)))) return false;
  }
  if (a.motions && !a.motions.includes(ctx.resolved.motion)) return false;
  if (a.goals && !a.goals.includes(ctx.goal)) return false;
  if (a.pricingModels && (!ctx.resolved.offer.pricingModel || !a.pricingModels.includes(ctx.resolved.offer.pricingModel))) return false;
  if (a.customerType) {
    const offerType = ctx.resolved.offer.customerType ?? "B2B";
    if (offerType !== "BOTH" && offerType !== a.customerType) return false;
  }
  return true;
}

function prerequisitesMet(intent: QuestionIntent, ctx: CandidateContext, known: ReadonlySet<FactDimension>): boolean {
  const p = intent.prerequisites;
  if (p.knownAllOf && !p.knownAllOf.every((d) => known.has(d))) return false;
  if (p.stageAtLeast && !stageAtLeast(ctx.stage, p.stageAtLeast)) return false;
  if (p.intentIn && !p.intentIn.includes(ctx.intentState)) return false;
  if (p.intentNotIn && p.intentNotIn.includes(ctx.intentState)) return false;
  // 08 §C.4: never BUDGET before a problem dimension is known.
  if (intent.dimension === "BUDGET" && !PROBLEM_DIMENSIONS.some((d) => known.has(d))) return false;
  return true;
}

/** Specificity: configured > adopted / required override > archetype-scoped > other scoped > base. */
function specificity(intent: QuestionIntent, ctx: CandidateContext): number {
  if (intent.questionId) return 5;
  if (ctx.resolved.adoptedIntents.includes(intent.key) || ctx.intentOverrides?.[intent.key]?.action === "REQUIRE") return 4;
  if (intent.appliesTo.archetypes) return 3;
  if (intent.appliesTo.motions || intent.appliesTo.goals || intent.appliesTo.pricingModels) return 2;
  return 1;
}

function applyOverride(intent: QuestionIntent, override: QuestionIntentOverride | undefined, serviceId: string | null): QuestionIntent | null {
  if (!override) return intent;
  if (override.serviceIds && (!serviceId || !override.serviceIds.includes(serviceId))) return intent;
  if (override.action === "FORBID") return null;
  if (override.action === "REWORD" && override.renderings) return { ...intent, renderings: { ...override.renderings } };
  if (override.action === "REQUIRE") return { ...intent, required: true, ...(override.renderings ? { renderings: { ...override.renderings } } : {}) };
  return intent;
}

function conflictingValues(facts: readonly QualificationFact[] | undefined, dimension: QiDimensionKey): string[] {
  const live = (facts ?? []).filter((f) => f.dimension === dimension && !f.supersededAt);
  const conflicting = [...new Set(live.filter((f) => f.state === "CONFLICTING").map((f) => f.value))];
  if (conflicting.length >= 2) return conflicting.slice(0, 2);
  const values = live.filter((f) => f.state === "CONFLICTING" || f.state === "CONFIRMED" || f.state === "INFERRED").map((f) => f.value);
  return [...new Set(values)].slice(0, 2);
}

/**
 * The candidate intents for this lead right now (NbaInput.candidates):
 * filtered by the offer's plan, appliesTo, stages, channel, prerequisites,
 * never-ask lists, forbidden intents and overrides, with CONFIRMED dimensions
 * removed, INFERRED material and stale ones turned into VERIFY intents, and
 * CONFLICTING ones into CLARIFY intents. One intent per dimension (the most
 * specific), plus unmapped configured questions. Deterministic order.
 */
export function buildCandidates(ctx: CandidateContext): { candidates: QuestionIntent[]; excluded: CandidateExclusion[] } {
  const excluded: CandidateExclusion[] = [];
  const statusOf = new Map<FactDimension, DimensionStatusEntry>();
  for (const entry of ctx.dimensions) statusOf.set(entry.dimension, entry);
  const known = new Set<FactDimension>();
  for (const entry of ctx.dimensions) if ((entry.status === "CONFIRMED" || entry.status === "INFERRED") && !entry.stale) known.add(entry.dimension);
  const values = ctx.facts ? factValues(ctx.facts, ctx.now ?? new Date().toISOString()) : new Map<FactDimension, FactValue>();
  const serviceId = ctx.serviceId ?? null;
  const answered = new Set(ctx.answeredQuestionIds ?? []);
  const exhausted = new Set(
    (ctx.askHistory ?? []).filter((h) => !h.answered && h.asked >= MAX_ASKS_PER_INTENT).map((h) => h.key),
  );
  const forbidden = new Set(ctx.resolved.forbiddenIntents);
  const onLocalService = ctx.resolved.motion === "LOCAL_SERVICE";

  // Configured questions that apply to this lead and are not answered yet.
  const configured = (ctx.configuredQuestions ?? [])
    .filter((q) => q.serviceId === null || q.serviceId === serviceId)
    .filter((q) => !answered.has(q.id))
    .map((q) => intentFromConfiguredQuestion(q, ctx.inferDimension ? ctx.inferDimension(q) : null));

  const scope = new Set<QiDimensionKey>([
    ...ctx.resolved.plan,
    ...ctx.resolved.requiredDimensions,
    ...ctx.resolved.gatingDimensions,
    ...ctx.resolved.adoptedIntents.map((k) => intentByKey(k)?.dimension).filter((d): d is QiDimensionKey => !!d && d !== UNMAPPED_DIMENSION),
  ]);
  for (const intent of configured) if (intent.dimension !== UNMAPPED_DIMENSION) scope.add(intent.dimension);
  // Branch targets of what is already known extend the plan (adaptive trees, §B.9).
  for (const intent of QUESTION_INTENTS) {
    if (intent.dimension === UNMAPPED_DIMENSION || !known.has(intent.dimension)) continue;
    if (!appliesToOffer(intent, ctx)) continue;
    for (const branch of intent.branches) {
      if (branch.next === "CTA" || branch.next === "ESCALATE") continue;
      const target = intentByKey(branch.next);
      if (target && target.dimension !== UNMAPPED_DIMENSION && evaluatePredicate(branch.when, { values, statuses: new Map([...statusOf].map(([k, v]) => [k, v.status])), intentState: ctx.intentState })) {
        scope.add(target.dimension);
      }
    }
  }

  const candidates: QuestionIntent[] = [];
  const pushIfAskable = (intent: QuestionIntent | null) => {
    if (!intent) return;
    if (exhausted.has(intent.key)) {
      excluded.push({ key: intent.key, reason: `asked ${MAX_ASKS_PER_INTENT} times without an answer` });
      return;
    }
    if (ctx.channel && !intent.channels.includes(ctx.channel)) {
      excluded.push({ key: intent.key, reason: `not asked on ${ctx.channel}` });
      return;
    }
    if (!intent.stages.includes(ctx.stage)) {
      excluded.push({ key: intent.key, reason: `not asked at stage ${ctx.stage}` });
      return;
    }
    candidates.push(intent);
  };

  for (const dimension of QI_DIMENSION_KEYS) {
    if (!scope.has(dimension)) continue;
    const entry = statusOf.get(dimension);
    const status = entry?.status ?? "UNKNOWN";
    const library = !configured.some((c) => c.dimension === dimension);
    if (library && ctx.resolved.neverAsk.includes(dimension)) {
      excluded.push({ key: dimension, reason: "never asked for this offer" });
      continue;
    }
    if (library && onLocalService && MEDDPICC_ONLY_DIMENSIONS.includes(dimension)) {
      excluded.push({ key: dimension, reason: "enterprise checklist dimension on a local service" });
      continue;
    }
    if (status === "CONFIRMED" && !entry?.stale) continue;
    if (status === "CONFLICTING") {
      pushIfAskable(clarifyIntentFor(dimension, conflictingValues(ctx.facts, dimension)));
      continue;
    }
    const live = values.get(dimension);
    // A turnover says how big the business is, but a rule on headcount still
    // needs the headcount: ask for it rather than "verify" a turnover (MI-3).
    const revenueForHeadcount = status === "INFERRED" && !!entry?.material && isRevenueValue(live?.normalised);
    if (!revenueForHeadcount && (entry?.stale || (status === "INFERRED" && entry?.material))) {
      pushIfAskable(verifyIntentFor(dimension, live?.value ?? null, live?.normalised ?? null));
      continue;
    }
    if (status === "INFERRED" && !revenueForHeadcount) continue;

    // UNKNOWN: the most specific askable discovery intent.
    const pool: QuestionIntent[] = [
      ...configured.filter((c) => c.dimension === dimension),
      ...QUESTION_INTENTS.filter((i) => i.dimension === dimension),
    ];
    const ranked = pool
      .map((intent) => applyOverride(intent, ctx.intentOverrides?.[intent.key], serviceId))
      .filter((intent): intent is QuestionIntent => {
        if (!intent) return false;
        if (!intent.questionId && forbidden.has(intent.key)) {
          excluded.push({ key: intent.key, reason: "forbidden by policy" });
          return false;
        }
        if (!intent.questionId && !appliesToOffer(intent, ctx)) return false;
        if (!prerequisitesMet(intent, ctx, known)) {
          excluded.push({ key: intent.key, reason: "prerequisites not met" });
          return false;
        }
        return true;
      })
      .sort((a, b) => specificity(b, ctx) - specificity(a, ctx) || a.key.localeCompare(b.key));
    // Forbidding by override removes the intent entirely.
    for (const intent of pool) {
      if (ctx.intentOverrides?.[intent.key]?.action === "FORBID") excluded.push({ key: intent.key, reason: "forbidden by override" });
    }
    const askable = ranked.filter((intent) => {
      if (exhausted.has(intent.key)) {
        excluded.push({ key: intent.key, reason: `asked ${MAX_ASKS_PER_INTENT} times without an answer` });
        return false;
      }
      return (!ctx.channel || intent.channels.includes(ctx.channel)) && intent.stages.includes(ctx.stage);
    });
    pushIfAskable(askable[0] ?? ranked[0] ?? null);
  }

  // Configured questions with no dimension still have to be asked (the engine needs them).
  for (const intent of configured) {
    if (intent.dimension !== UNMAPPED_DIMENSION) continue;
    const overridden = applyOverride(intent, ctx.intentOverrides?.[intent.key], serviceId);
    pushIfAskable(overridden);
  }

  return { candidates, excluded };
}

/** Whether a dimension is material (§B.12) given the offer: always-material, required, or a disqualifier's. */
export function isMaterialDimension(dimension: FactDimension, resolved: ResolvedOffer): boolean {
  if (dimension === UNMAPPED_DIMENSION) return false;
  return (
    (ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(dimension) ||
    resolved.requiredDimensions.includes(dimension) ||
    resolved.disqualifiers.some((d) => d.dimension === dimension)
  );
}

/* --------------------------------------------------------------- render */

/**
 * The rendering for a channel: SMS / WhatsApp -> sms, email -> email, the
 * social inboxes and LinkedIn -> social, anything else (an active
 * conversation) -> default. Placeholders are filled from approved workspace
 * data only; an unfilled placeholder falls back to the default wording.
 */
export function renderIntent(
  intent: QuestionIntent,
  channel: AgentChannel | null,
  vars: { service?: string | null; business?: string | null } = {},
): string {
  const r = intent.renderings;
  let text =
    channel === "sms" || channel === "whatsapp"
      ? (r.sms ?? r.default)
      : channel === "email"
        ? (r.email ?? r.default)
        : channel === "linkedin" || channel === "messenger" || channel === "instagram" || channel === "tiktok"
          ? (r.social ?? r.default)
          : r.default;
  if (/\{service\}/.test(text)) text = vars.service ? text.replace(/\{service\}/g, vars.service) : r.default;
  if (/\{business\}/.test(text)) text = vars.business ? text.replace(/\{business\}/g, vars.business) : r.default;
  return text.replace(/\{[a-z_]+\}/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** True for a library or custom key (convenience for callers holding strings). */
export function isKnownIntentKey(key: string): boolean {
  return BY_KEY.has(key) || isCustomIntentKey(key) || /\.(VERIFY|CLARIFY)$/.test(key);
}
