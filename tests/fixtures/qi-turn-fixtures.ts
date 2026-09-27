/**
 * Paired turn fixtures: the same lead state planned by the legacy strategy
 * (buildStrategyBlock) and by the engine (buildNbaStrategyBlock). Shared by
 * the token-budget measurement, the "same source of truth" gate and the
 * OFF / SHADOW / LIVE runtime tests, so they all measure the same turns.
 */

import type { StrategyInput } from "../../src/lib/agent/strategy.ts";
import type { KnownQuestion, QuestionRecord } from "../../src/lib/qualification/next-question.ts";
import {
  nextBestActionSchema,
  NBA_VERSION,
  type NextBestAction,
} from "../../src/lib/qualification-intelligence/types.ts";

const Q_TIMING = "7b0e3f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const Q_TEAM = "8c1f4a7b-2d3e-4f60-9b0c-1d2e3f4a5b6c";

export function question(id: string, text: string): QuestionRecord {
  return { id, questionText: text, position: 1, responseType: "text", required: true, serviceId: null, options: [] };
}

function known(id: string, text: string, dimension: KnownQuestion["dimension"], value: string, inferred = false): KnownQuestion {
  return { questionId: id, questionText: text, dimension, source: inferred ? "LEAD_FIELD" : "ANSWER", value, inferred, confidence: 1, required: true };
}

export function nbaFixture(overrides: Partial<NextBestAction> = {}): NextBestAction {
  return nextBestActionSchema.parse({
    current_goal: "B_BOOK_MEETING",
    intent_state: "MEDIUM",
    intent_score: 52,
    known_dimensions: [],
    unknown_required_dimensions: [],
    next_action: "ASK",
    question_intent: null,
    reason: "Fixture.",
    rule: "R9_ASK",
    expected_information_gain: 0.5,
    qualification_score: 40,
    qualification_completeness: 0.5,
    engine_verdict: "PENDING",
    confidence: 0.8,
    handover_reason: null,
    resume_at: null,
    suppress: false,
    model_call_required: true,
    question_value: null,
    alternatives: [],
    engine_version: NBA_VERSION,
    ...overrides,
  });
}

const base = (overrides: Partial<StrategyInput>): StrategyInput => ({
  mode: "QUALIFICATION",
  motion: "BOOK_MEETING_B2B",
  archetypeKey: "MSP",
  channel: "sms",
  selection: { question: null, stopReason: null, known: [] },
  latestMessage: null,
  hasApprovedInsight: false,
  bookingAvailable: true,
  ...overrides,
});

export type TurnFixture = { id: string; legacy: StrategyInput; nba: NextBestAction };

export const TURN_FIXTURES: TurnFixture[] = [
  {
    id: "msp-ask-timing",
    legacy: base({
      selection: {
        question: question(Q_TIMING, "When does your current IT support contract come up for renewal?"),
        stopReason: null,
        known: [
          known("a1", "What's not working with your IT at the moment?", "PROBLEM", "slow ticket response"),
          known("a2", "How many staff and devices would we be looking after?", "COMPANY_SIZE", "40 staff"),
          known("a3", "What's your postcode?", "LOCATION", "LS1 4AP", true),
        ],
      },
    }),
    nba: nbaFixture({
      known_dimensions: [
        { dimension: "PROBLEM", state: "CONFIRMED" },
        { dimension: "COMPANY_SIZE", state: "CONFIRMED" },
        { dimension: "LOCATION", state: "INFERRED" },
      ],
      unknown_required_dimensions: ["TIMING"],
      question_intent: {
        key: "TIMING.START_WINDOW",
        dimension: "TIMING",
        purpose: "DISCOVER",
        question_id: Q_TIMING,
        wording_family: "timing-renewal",
        rendering: "When does your current IT support contract come up for renewal?",
      },
    }),
  },
  {
    id: "saas-answer-and-ask",
    legacy: base({
      motion: "SAAS_SELF_SERVE",
      archetypeKey: "B2B_SAAS",
      mode: "GENERAL_ENQUIRY",
      latestMessage: "Does it integrate with HubSpot?",
      selection: {
        question: question(Q_TEAM, "How many people on your team would be using it?"),
        stopReason: null,
        known: [known("b1", "What would you mainly want the platform to handle?", "USE_CASE", "lead routing")],
      },
    }),
    nba: nbaFixture({
      current_goal: "D_SIGNUP_TRIAL",
      next_action: "ANSWER_AND_ASK",
      rule: "R5_LEAD_ASKED",
      known_dimensions: [{ dimension: "USE_CASE", state: "CONFIRMED" }],
      unknown_required_dimensions: ["TEAM_SIZE"],
      question_intent: {
        key: "TEAM_SIZE.USERS",
        dimension: "TEAM_SIZE",
        purpose: "DISCOVER",
        question_id: Q_TEAM,
        wording_family: "team-size-direct",
        rendering: "How many people on your team would be using it?",
      },
    }),
  },
  {
    id: "studio-threshold-met-book",
    legacy: base({
      motion: "DIRECT_B2B",
      archetypeKey: "CREATIVE_WEB_STUDIO",
      selection: {
        question: null,
        stopReason: "THRESHOLD_MET",
        known: [
          known("c1", "What does the project involve: a new site, a redesign, or something else?", "PROJECT_SCOPE", "new site"),
          known("c2", "What isn't your current site doing for you?", "PROBLEM", "no enquiries"),
          known("c3", "Is there a launch date you're working towards?", "TIMING", "March"),
          known("c4", "Do you have a budget range in mind for the build?", "BUDGET", "10-15k"),
        ],
      },
    }),
    nba: nbaFixture({
      next_action: "CTA_BOOK",
      rule: "R10_THRESHOLD_MET",
      intent_state: "HIGH",
      intent_score: 74,
      known_dimensions: [
        { dimension: "PROJECT_SCOPE", state: "CONFIRMED" },
        { dimension: "PROBLEM", state: "CONFIRMED" },
        { dimension: "TIMING", state: "CONFIRMED" },
        { dimension: "BUDGET", state: "CONFIRMED" },
      ],
      question_intent: null,
      qualification_completeness: 1,
    }),
  },
  {
    id: "enterprise-deep-known",
    legacy: base({
      motion: "ENTERPRISE",
      archetypeKey: "ENTERPRISE_SAAS",
      channel: "email",
      selection: {
        question: question(Q_TEAM, "Who else would be involved in choosing a platform like this?"),
        stopReason: null,
        known: [
          known("d1", "What's the business problem you're trying to solve?", "PROBLEM", "fragmented reporting across 4 sites"),
          known("d2", "Which systems would it need to connect to?", "USE_CASE", "SAP and Salesforce"),
          known("d3", "How many people would use it?", "TEAM_SIZE", "250"),
          known("d4", "What are you using for this today, if anything?", "CURRENT_SOLUTION", "spreadsheets"),
          known("d5", "When are you hoping to have something in place?", "TIMING", "Q2"),
          known("d6", "What security or compliance requirements apply?", "COMPLIANCE_REQUIREMENTS", "ISO 27001"),
        ],
      },
    }),
    nba: nbaFixture({
      current_goal: "E_HUMAN_CLOSER",
      intent_state: "HIGH",
      known_dimensions: [
        { dimension: "PROBLEM", state: "CONFIRMED" },
        { dimension: "USE_CASE", state: "CONFIRMED" },
        { dimension: "TEAM_SIZE", state: "CONFIRMED" },
        { dimension: "CURRENT_SOLUTION", state: "CONFIRMED" },
        { dimension: "TIMING", state: "CONFIRMED" },
        { dimension: "COMPLIANCE_REQUIREMENTS", state: "CONFIRMED" },
      ],
      unknown_required_dimensions: ["AUTHORITY"],
      question_intent: {
        key: "AUTHORITY.WHO_DECIDES",
        dimension: "AUTHORITY",
        purpose: "DISCOVER",
        question_id: Q_TEAM,
        wording_family: "authority-involved",
        rendering: "Who else would be involved in choosing a platform like this?",
      },
    }),
  },
  {
    id: "low-intent-inform",
    legacy: base({
      mode: "FOLLOW_UP",
      selection: {
        question: question(Q_TIMING, "When would you be looking to make a change?"),
        stopReason: null,
        known: [],
      },
    }),
    nba: nbaFixture({
      next_action: "INFORM",
      rule: "R11_LOW_INTENT",
      intent_state: "LOW",
      intent_score: 14,
      question_intent: null,
    }),
  },
];
