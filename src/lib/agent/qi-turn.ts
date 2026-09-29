/**
 * The qualification engine inside one agent turn: the pure half (design 08
 * Wave 2, CD-14, §B.16). Pure: relative `.ts` imports, no server-only.
 *
 * The orchestrator asks the engine for the turn's NBA (after interpret() has
 * written the reply back, CD-15), then, by engine mode:
 *
 *   OFF     nothing here runs; the turn is exactly the legacy turn.
 *   SHADOW  the NBA is computed and stored beside the legacy decision, the
 *           difference is recorded (`shadowDiffers`), and the turn acts on
 *           the legacy decision. No behaviour changes.
 *   LIVE    the turn acts on the NBA: `planFor()` says whether a message is
 *           needed at all, and if one is, the model is handed the NBA
 *           strategy block (strategy.ts) instead of the full plan.
 *
 * Whatever the mode, `decision_json.qi = { nba, interpretation, accounting }`
 * (agentRunQiSchema) records what the engine decided and what it cost.
 */

import { extract } from "../qualification-intelligence/extractors.ts";
import {
  agentRunQiSchema,
  interpretationSchema,
  NBA_ACTION_NEEDS_MODEL,
  QIE_ENGINE_VERSION,
  type AgentRunQi,
  type Interpretation,
  type NbaAction,
  type NextBestAction,
  type QaCode,
  type QiEngineMode,
  type TurnAccounting,
} from "../qualification-intelligence/types.ts";
import type { QaContext, PriorAsk, DimensionView, PlannedQuestion } from "../qualification-intelligence/qa.ts";
import { askedDimension, questionSentences } from "../qualification-intelligence/qa.ts";
import type { AgentEventType, AgentChannel } from "./types.ts";
import {
  baseIntentFor,
  clarifyIntentFor,
  intentByKey,
  verifyIntentFor,
} from "../qualification-intelligence/question-intents.ts";
import { QI_DIMENSION_KEYS, type QiDimensionKey, type QuestionIntent } from "../qualification-intelligence/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";

/* ================================================================ the turn */

/**
 * Everything the orchestrator needs from the engine for one turn, built by
 * qi-runtime.ts (server) after interpret() has written the reply back.
 */
export type QiTurn = {
  mode: Exclude<QiEngineMode, "OFF">;
  nba: NextBestAction;
  /** The interpretation of the inbound reply that triggered the turn. */
  interpretation: Interpretation | null;
  dimensions: DimensionView[];
  forbiddenIntents: string[];
  /** The last outbound questions, newest first (from messages.features). */
  recentOutbound: PriorAsk[];
  stage: ConversationStage;
  /** Tokens the AI assist spent inside interpret() this turn. */
  interpretationTokens: number;
  customerType: QaContext["customerType"];
  offerId: string | null;
  /** 1-based position the next question would take in the conversation. */
  questionPosition: number;
  /** A running QUESTION_STRATEGY experiment arm, when one applies. */
  experiment: { id: string; arm: string; wordingFamily: string | null } | null;
  /**
   * What booking needs known for this lead (nba.ts gateDimensions: the
   * motion's booking gate, the offer's required dimensions, disqualifier
   * dimensions) and the workspace's required dimensions alone.
   */
  bookingGate?: { gateDimensions: QiDimensionKey[]; requiredDimensions: QiDimensionKey[] };
  /**
   * A lead with several interests (08 §B.20): which offer this turn's move is
   * for, the one light touch on another, and the record for decision_json.
   * Absent for a lead with one interest (the turn is exactly as before).
   */
  interests?: InterestTurn;
};

/** The coordinated turn for a lead with several interests (interests.ts). */
export type InterestTurn = {
  primary: {
    serviceId: string;
    serviceName: string;
    goal: string;
    /** The motion this offer sells on (the direct-close gate reads it). */
    motion: string;
    checkoutLinkId: string | null;
    /** The meeting type for this offer's service, when it differs from the lead's. */
    meetingType: { id: string; name: string; calendarIntegrationId: string | null } | null;
  };
  /** The companion's planned question, for pre-send QA, with that interest's own dimensions. */
  companion: { serviceId: string; kind: string; question: PlannedQuestion | null; dimensions: DimensionView[] } | null;
  /** Lines the NBA strategy block adds (interestStrategyLines). */
  strategyLines: string[];
  /** decision_json.interests. */
  record: Record<string, unknown>;
};

/* ======================================================= booking readiness */

/**
 * Whether the engine's booking-readiness is enough to create a booking (or a
 * pending booking request) for a lead whose lifecycle is not yet QUALIFIED.
 *
 * Decided on principle (brief: "booking-ready users aren't over-qualified"):
 * yes, when the engine has done the qualifying that booking needs. All of:
 *   - the NBA is CTA_BOOK with no gating question left to ask;
 *   - the goal is B (book a meeting) or E (a person closes: the booked
 *     meeting is the hand-off, owner decision 2026-09-27);
 *   - every gating dimension (motion gate, offer-required, disqualifier
 *     dimensions) is known, and none conflicts;
 *   - none of the workspace's required dimensions is still unknown;
 *   - the deterministic verdict is not NOT_QUALIFIED or REVIEW, the NBA does
 *     not suppress, and the intent is not NEGATIVE or NOT_NOW.
 * The tool gate (policy.ts) adds the lifecycle exclusions (REVIEW,
 * NOT_QUALIFIED, HANDED_OVER, SUPPRESSED, WON, LOST) and still requires
 * confirmed availability. Pure; decided from rules over facts, never the model.
 */
export function engineBookingReadiness(
  nba: NextBestAction | null | undefined,
  gate: QiTurn["bookingGate"] | null | undefined,
): { ready: boolean; reason: string } {
  if (!nba) return { ready: false, reason: "The engine did not plan this turn." };
  if (nba.next_action !== "CTA_BOOK") return { ready: false, reason: `The plan is ${nba.next_action}, not a booking.` };
  if (nba.question_intent) return { ready: false, reason: "A gating question is still to be asked." };
  if (nba.current_goal !== "B_BOOK_MEETING" && nba.current_goal !== "E_HUMAN_CLOSER") {
    return { ready: false, reason: `The goal is ${nba.current_goal}.` };
  }
  if (nba.assist_reason === "QUALIFICATION_REVIEW") {
    return { ready: false, reason: "A person is reviewing the qualification." };
  }
  if (nba.engine_verdict === "NOT_QUALIFIED" || nba.engine_verdict === "REVIEW") {
    return { ready: false, reason: `The qualification rules returned ${nba.engine_verdict}.` };
  }
  if (nba.suppress || nba.intent_state === "NEGATIVE" || nba.intent_state === "NOT_NOW") {
    return { ready: false, reason: "The lead is not to be pursued." };
  }
  if (!gate) return { ready: false, reason: "The booking gate is not known for this turn." };
  const state = new Map(nba.known_dimensions.map((d) => [d.dimension as string, d.state]));
  const missing = gate.gateDimensions.filter((d) => {
    const s = state.get(d);
    return s !== "CONFIRMED" && s !== "INFERRED";
  });
  if (missing.length > 0) return { ready: false, reason: `Still unknown for booking: ${missing.join(", ")}.` };
  const unknownRequired = gate.requiredDimensions.filter((d) => nba.unknown_required_dimensions.includes(d));
  if (unknownRequired.length > 0) return { ready: false, reason: `Required and unknown: ${unknownRequired.join(", ")}.` };
  return { ready: true, reason: "Booking-ready: the gate is met and nothing disqualifies." };
}

/* ================================================== disqualify follow-through */

/**
 * What a DISQUALIFY does beyond sending nothing. Suppression stays a
 * confirmed human or registry action (the suppress_contact gate is not
 * loosened): an offer disqualifier marked `suppress: true` stops every
 * follow-up and campaign send, and hands the conversation to a person with a
 * request to confirm the suppression. The handover moves ownership, which the
 * run gate reads, so the lead gets no further AI turn (no model or AI-assist
 * spend) and no outreach until a person decides. No acknowledgement is sent:
 * the lead is not told anything.
 */
export function disqualifyFollowThrough(nba: NextBestAction): {
  stopFollowUp: boolean;
  askPersonToSuppress: boolean;
  sendAcknowledgement: false;
} {
  const disqualify = nba.next_action === "DISQUALIFY";
  return { stopFollowUp: disqualify, askPersonToSuppress: disqualify && nba.suppress, sendAcknowledgement: false };
}

/* ============================================================ asked intent */

/**
 * The question intent an earlier message asked, from the key its features
 * recorded, so interpret() reads the reply as the answer to it. Library keys
 * resolve directly; a VERIFY or CLARIFY key ("COMPANY_SIZE.VERIFY") is built
 * per lead and so resolves to its dimension's verify/clarify intent.
 */
export function askedIntentFor(key: string | null | undefined): QuestionIntent | null {
  if (!key) return null;
  const known = intentByKey(key);
  if (known) return known;
  const [family, kind] = key.split(".");
  if (!(QI_DIMENSION_KEYS as readonly string[]).includes(family)) return null;
  const dimension = family as QiDimensionKey;
  if (kind === "VERIFY") return verifyIntentFor(dimension, null);
  if (kind === "CLARIFY") return clarifyIntentFor(dimension, []);
  return baseIntentFor(dimension);
}

/**
 * The question a message the engine did not plan asks: a follow-up step's
 * template. The engine's ask history (repetition risk, the one sticky
 * re-ask, "never ask what we already asked") is read from
 * messages.features.questionIntent, so a follow-up that asks "what's your
 * timeline?" must record that TIMING was asked, or the agent can ask it again
 * straight after. The first question sentence is mapped to its dimension by
 * the same detector pre-send QA uses, and recorded as that dimension's base
 * library intent. A question no dimension recognises ("still interested?")
 * records nothing: it is not a qualification ask.
 */
export function templateQuestionFeatures(body: string): { questionIntent: string; dimension: QiDimensionKey } | null {
  const question = questionSentences(body ?? "")[0];
  if (!question) return null;
  const dimension = askedDimension(question);
  if (!dimension) return null;
  return { questionIntent: baseIntentFor(dimension).key, dimension };
}

/* ================================================================ triggers */

/** Events that carry a message the lead sent: the agent is replying. */
const REPLY_TRIGGERS: ReadonlySet<AgentEventType> = new Set<AgentEventType>([
  "INBOUND_SMS",
  "INBOUND_WHATSAPP",
  "INBOUND_EMAIL",
  "INBOUND_MESSENGER",
  "INBOUND_INSTAGRAM",
  "INBOUND_TIKTOK",
  "INBOUND_LINKEDIN",
  "REACTIVATION_REPLY",
  "QUALIFICATION_ANSWER",
  "FORM_SUBMISSION",
]);

/**
 * Whether the turn answers something the lead just sent (story I3). A reply
 * is owed whatever `automation_active` says; any other trigger is the agent
 * reaching out, which the follow-up switch governs.
 */
export function isReplyTrigger(eventType: AgentEventType): boolean {
  return REPLY_TRIGGERS.has(eventType);
}

/* ================================================================== plan */

/** What a LIVE turn does with the NBA. */
export type NbaTurnPlan =
  /** Nothing is sent. The model is not called. */
  | { kind: "SILENT"; action: NbaAction; stopFollowUp: boolean; suppress: boolean; resumeAt: string | null }
  /** A person takes it (a last resort only); a fixed acknowledgement, no model call. */
  | { kind: "ESCALATE"; action: NbaAction }
  /** Booking in manual mode: ask the preferred day and time, no model call. */
  | { kind: "ASK_PREFERRED_TIME"; action: NbaAction }
  /** A message is needed: the model composes it from the NBA block. */
  | { kind: "COMPOSE"; action: NbaAction };

/**
 * The LIVE plan for an NBA. Zero-token decisions (§B.16) never reach the
 * model: WAIT, NO_ACTION and DISQUALIFY send nothing; ESCALATE sends the
 * templated acknowledgement. A booking CTA with no calendar and no link asks
 * for a preferred time deterministically (story H3).
 */
export function planFor(nba: NextBestAction, booking: { manual: boolean }): NbaTurnPlan {
  const action = nba.next_action;
  switch (action) {
    case "WAIT":
      return { kind: "SILENT", action, stopFollowUp: false, suppress: false, resumeAt: nba.resume_at };
    case "NO_ACTION":
      return { kind: "SILENT", action, stopFollowUp: nba.intent_state === "NEGATIVE" || nba.suppress, suppress: nba.suppress, resumeAt: null };
    case "DISQUALIFY":
      return { kind: "SILENT", action, stopFollowUp: true, suppress: nba.suppress, resumeAt: null };
    case "ESCALATE":
      return { kind: "ESCALATE", action };
    case "CTA_BOOK":
      return booking.manual && !nba.question_intent ? { kind: "ASK_PREFERRED_TIME", action } : { kind: "COMPOSE", action };
    default:
      return { kind: "COMPOSE", action };
  }
}

/** Whether this plan needs a model call (NBA_ACTION_NEEDS_MODEL after the overrides above). */
export function planNeedsModel(plan: NbaTurnPlan): boolean {
  return plan.kind === "COMPOSE" && NBA_ACTION_NEEDS_MODEL[plan.action];
}

/* ================================================================ shadow */

/** The legacy turn's decision, reduced to what the NBA can be compared with. */
export type LegacyDecision = {
  nextQuestionId: string | null;
  /** The agent mode (lifecycle.ts) the legacy turn ran in. */
  agentMode: string;
  /** True when the legacy strategy stopped qualifying (threshold / no question). */
  stoppedQualifying: boolean;
};

/**
 * Whether the NBA would have done something different from the legacy turn.
 * Compared on the move and the question, never on wording.
 */
export function shadowDiffers(nba: NextBestAction, legacy: LegacyDecision): boolean {
  const nbaAsks = nba.next_action === "ASK" || nba.next_action === "ANSWER_AND_ASK";
  const legacyAsks = legacy.nextQuestionId !== null;
  if (nbaAsks !== legacyAsks) return true;
  if (nbaAsks && (nba.question_intent?.question_id ?? null) !== legacy.nextQuestionId) return true;
  const nbaSilent = nba.next_action === "WAIT" || nba.next_action === "NO_ACTION" || nba.next_action === "DISQUALIFY";
  const legacySilent = legacy.agentMode === "NO_RESPONSE" || legacy.agentMode === "CLOSED" || legacy.agentMode === "HUMAN_HANDOVER";
  if (nbaSilent !== legacySilent) return true;
  const nbaCloses = nba.next_action === "CTA_BOOK" || nba.next_action === "CTA_CHECKOUT" || nba.next_action === "CTA_SIGNUP";
  if (nbaCloses && !legacy.stoppedQualifying && legacy.agentMode !== "BOOKING_ASSISTANCE") return true;
  return false;
}

/** The legacy_decision stored on a SHADOW assessment (≤300-char note). */
export function legacyDecisionRecord(nba: NextBestAction, legacy: LegacyDecision) {
  const differs = shadowDiffers(nba, legacy);
  return {
    next_question_id: legacy.nextQuestionId,
    agent_mode: legacy.agentMode.slice(0, 40),
    differs,
    note: differs
      ? `NBA ${nba.next_action}${nba.question_intent ? ` ${nba.question_intent.key}` : ""} vs legacy ${legacy.agentMode}${legacy.nextQuestionId ? " asking a configured question" : ""}`.slice(0, 300)
      : null,
  };
}

/* ============================================================ QA context */

/** The QA / grade context for a draft planned by this NBA. */
export function qaContextFromNba(input: {
  nba: NextBestAction;
  channel: AgentChannel;
  stage: ConversationStage;
  dimensions: DimensionView[];
  forbiddenIntents: readonly string[];
  inbound: string | null;
  interpretation: Interpretation | null;
  recentOutbound: PriorAsk[];
  customerType?: QaContext["customerType"];
  /** Several interests: the one light-touch question on another interest (interests.ts). */
  companion?: InterestTurn["companion"] | null;
  /** The strategy asked an objection's clarifying question in place of the planned one (strategy.ts). */
  objectionClarify?: boolean;
}): QaContext {
  const q = input.nba.question_intent;
  return {
    companionQuestion: input.companion?.question ?? null,
    companionDimensions: input.companion?.dimensions ?? [],
    channel: input.channel,
    stage: input.stage,
    intentState: input.nba.intent_state,
    engineVerdict: input.nba.engine_verdict,
    nbaAction: input.nba.next_action,
    plannedQuestion: q ? { key: q.key, dimension: q.dimension, purpose: q.purpose, rendering: q.rendering } : null,
    dimensions: input.dimensions,
    forbiddenIntents: input.forbiddenIntents,
    inbound: input.inbound,
    leadAskedQuestion: input.interpretation?.lead_asked_question,
    recentOutbound: input.recentOutbound,
    customerType: input.customerType ?? "B2B",
    objectionClarify: input.objectionClarify === true,
  };
}

/* ============================================================ accounting */

export function buildTurnAccounting(input: {
  mode: QiEngineMode;
  nba: NextBestAction;
  modelCalled: boolean;
  shadowDiffers: boolean | null;
  strategyBlockTokens: number;
  interpretationTokens: number;
  qaFindings: QaCode[];
  questionGrade: number | null;
}): TurnAccounting {
  const avoided = input.mode === "LIVE" && !input.modelCalled && !NBA_ACTION_NEEDS_MODEL[input.nba.next_action];
  return {
    engine_mode: input.mode,
    nba_action: input.nba.next_action,
    nba_rule: input.nba.rule,
    question_intent: input.nba.question_intent?.key ?? null,
    model_called: input.modelCalled,
    // A call the NBA made unnecessary. A CTA_BOOK answered by the fixed
    // preferred-time question also counts: the NBA chose a move with no
    // wording left for a model to decide.
    model_call_avoided: avoided || (input.mode === "LIVE" && !input.modelCalled && input.nba.next_action === "CTA_BOOK"),
    shadow_differs: input.mode === "SHADOW" ? input.shadowDiffers : null,
    strategy_block_tokens: Math.min(2000, Math.max(0, Math.round(input.strategyBlockTokens))),
    interpretation_tokens: Math.max(0, Math.round(input.interpretationTokens)),
    qa_findings: [...new Set(input.qaFindings)].slice(0, 15),
    question_grade: input.questionGrade,
    engine_version: QIE_ENGINE_VERSION,
  };
}

/**
 * `decision_json.qi`, validated against the contract before it is written.
 * An invalid record is dropped (and the caller logs it) rather than stored
 * half-formed: the read model trusts every stored row.
 */
export function runQiRecord(input: { nba: NextBestAction; interpretation: Interpretation | null; accounting: TurnAccounting }): AgentRunQi | null {
  const parsed = agentRunQiSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/* ================================================= tokens-per-action model */

export type RunAccountingRow = {
  /** decision_json.qi.accounting, when the engine ran. */
  accounting: TurnAccounting | null;
  inputTokens: number;
  outputTokens: number;
};

export type TokensByAction = {
  action: NbaAction | "ENGINE_OFF";
  turns: number;
  modelCalls: number;
  callsAvoided: number;
  inputTokens: number;
  outputTokens: number;
  meanInputTokensPerTurn: number;
};

/**
 * Tokens per turn by NBA action, and model calls avoided (design 08 §B.16,
 * §C.5 "token cost measured"). Reads the run's own token columns; never
 * re-estimates.
 */
export function tokensByAction(rows: readonly RunAccountingRow[]): TokensByAction[] {
  const map = new Map<string, TokensByAction>();
  for (const row of rows) {
    const key = row.accounting?.nba_action ?? "ENGINE_OFF";
    const entry = map.get(key) ?? {
      action: key as TokensByAction["action"],
      turns: 0,
      modelCalls: 0,
      callsAvoided: 0,
      inputTokens: 0,
      outputTokens: 0,
      meanInputTokensPerTurn: 0,
    };
    entry.turns += 1;
    entry.modelCalls += row.accounting ? (row.accounting.model_called ? 1 : 0) : row.inputTokens > 0 ? 1 : 0;
    entry.callsAvoided += row.accounting?.model_call_avoided ? 1 : 0;
    entry.inputTokens += row.inputTokens;
    entry.outputTokens += row.outputTokens;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, meanInputTokensPerTurn: e.turns ? Math.round(e.inputTokens / e.turns) : 0 }))
    .sort((a, b) => b.turns - a.turns || a.action.localeCompare(b.action));
}

/* ======================================================== verify answers */

/**
 * A "yes" to a VERIFY question confirms the value that was inferred (design
 * 08 §B.12): "Just to check, is it around 40 staff?" -> "Yes that's right"
 * makes COMPANY_SIZE = 40 CONFIRMED, with the lead's own reply as its source.
 * interpret() reads replies dimension by dimension and does not know which
 * value a VERIFY question showed, so the turn adds this one fact itself. A
 * "no" confirms nothing: the dimension stays open, and the plan moves on.
 */
export function withVerifiedAnswer(
  interpretation: Interpretation,
  reply: string,
  asked: QuestionIntent | null,
  liveFacts: readonly { dimension: string; state: string; value: string; valueNormalised: string | null; supersededAt: string | null }[],
): Interpretation {
  if (!asked || asked.purpose !== "VERIFY" || asked.dimension === "UNMAPPED") return interpretation;
  if (interpretation.facts.some((f) => f.dimension === asked.dimension && f.state === "CONFIRMED")) return interpretation;
  const affirmative = extract("YES_NO", reply);
  if (!affirmative || affirmative.normalised !== "yes") return interpretation;
  const inferred = liveFacts.find((f) => f.dimension === asked.dimension && f.state === "INFERRED" && f.supersededAt === null);
  if (!inferred) return interpretation;
  const next = {
    ...interpretation,
    answered_intent_key: interpretation.answered_intent_key ?? asked.key,
    completeness: interpretation.completeness === "NONE" ? ("FULL" as const) : interpretation.completeness,
    facts: [
      ...interpretation.facts.filter((f) => f.dimension !== asked.dimension),
      {
        dimension: asked.dimension,
        value: inferred.value.slice(0, 500),
        value_normalised: inferred.valueNormalised,
        state: "CONFIRMED" as const,
        source: "ANSWER" as const,
        confidence: affirmative.confidence,
        question_id: asked.questionId ?? null,
        question_intent_key: null,
        evidence_span: null,
      },
    ].slice(0, 26),
  };
  const parsed = interpretationSchema.safeParse(next);
  return parsed.success ? parsed.data : interpretation;
}
