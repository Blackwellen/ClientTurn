import "server-only";

/**
 * The agent orchestrator.
 *
 * One turn, start to finish, with a hard step ceiling and no free-running
 * loop. The shape is deliberately linear:
 *
 *   assemble context -> run gate -> claim turn -> deterministic classification
 *   -> (model proposal) -> policy validation -> tools -> compose -> validate
 *   -> send/draft/queue -> persist -> log -> release turn
 *
 * The model appears in exactly one place in that list, and everything before
 * and after it is deterministic. A model that returns nothing usable, or is
 * unavailable entirely, degrades the turn to a deterministic next question, a
 * clarification or (last) a handover -- never to silence, and never to a
 * guess.
 *
 * Hand-over policy (owner decision 2026-09-27, ./handover-policy.ts): the AI
 * carries the conversation and completes the sale whenever it lawfully and
 * safely can. A person takes the conversation only for a last resort; for
 * everything else a person is asked to do one thing in the background
 * (`raiseAssist`, an ASSIST_REQUEST) and the turn carries on.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runTask } from "@/lib/ai/model-router";
import { applyQualification, recordInferredAnswers } from "@/lib/jobs/handlers/qualify";
import { loadLead, queueNotification } from "@/lib/jobs/handlers/shared";
import { emitAutomationEvent } from "@/lib/automation/events";
import {
  assembleContext,
  allowedUrls,
  publishedPriceStrings,
  refreshQualification,
  renderContextBlock,
  renderStableBlock,
  type AgentContext,
} from "./context";
import {
  buildNbaStrategyBlock,
  buildStrategyBlock,
  estimateTokens,
  leadDirection,
  type NbaBookingRoute,
  type Strategy,
} from "./strategy";
import {
  buildTurnAccounting,
  disqualifyFollowThrough,
  engineBookingReadiness,
  isReplyTrigger,
  planFor,
  qaContextFromNba,
  runQiRecord,
  shadowDiffers,
  type LegacyDecision,
  type QiTurn,
} from "./qi-turn";
import { prepareQiTurn, recordQiDisposition } from "./qi-runtime";
import { withInterestFocus } from "./interest-focus";
import { runQuestionQa, qaFailures } from "@/lib/qualification-intelligence/qa";
import { gradeQuestion } from "@/lib/qualification-intelligence/grade";
import type { NextBestAction, QaCode } from "@/lib/qualification-intelligence/types";
import { evaluateSend } from "@/lib/jobs/send-core";
import { leadState } from "@/lib/jobs/handlers/shared";
import type { StopReason as SendStopReason } from "@/lib/automation/scheduler";
import { parsePreferredTime, preferredTimeQuestion } from "./availability/preferred-time";
import { planBookingRoute } from "@/lib/bookings/confirmation";
import { buildMessageFeatures } from "@/lib/learning/features";
import { logWriteError } from "@/lib/supabase/write-result";
import {
  closeRun,
  openRun,
  recordExtractions,
  recordSkippedRun,
  type AgentRunHandle,
  type ExtractionRecord,
} from "./audit";
import {
  classifyDeterministic,
  classifyHeuristic,
  detectInjectionAttempt,
  isBotQuestion,
} from "./classification";
import { modeIsSilent, resolveMode } from "./lifecycle";
import { evaluateRunGate, evaluateSendGate } from "./policy";
import { correctionPrompt, validateResponse, type ValidationFacts } from "./validate";
import { isCallOnlyRequest } from "./closing";
import { reengagementReasonLine, reengagementReasonOf } from "@/lib/reengagement/triggers";
import { nextComposeStep } from "./compose-policy";
import { fixHumanStyle } from "./human-style";
import { parseChannelPreference, shouldAskChannelPreference } from "./channel-preference";
import { markChannelPreferenceAsked, readChannelPreference, recordChannelPreference } from "./channel-preference-store";
import { objectionRaisedBefore } from "./strategy";
import { customIntentKey, QIE_ENGINE_VERSION, UNMAPPED_DIMENSION } from "@/lib/qualification-intelligence/types";
import { inferDimension, questionPrompt, type QuestionRecord } from "@/lib/qualification/next-question";
import {
  assistAfterBooking,
  assistLine,
  clarifyingQuestion,
  policyOnAnswer,
  policyOnCompose,
  policyOnDecision,
  policyOnMessage,
  discountGuidance,
  disclosureGuidance,
  type ClarificationState,
  type PolicyDecision,
} from "./handover-policy";
import { matchObjection } from "@/lib/sales-library/objections";
import type { TaskSkippedReason } from "@/lib/ai/model-router";
import type { SpendStage } from "@/lib/ai/budget";
import {
  abandonedSettingsOf,
  checkoutGate,
  checkoutMessage,
  DISABLED_AUTHORITY,
  toMinor,
  type CheckoutLink,
} from "@/lib/commercial/authority";
import { motionAllowsDirectClose } from "@/lib/opportunities/stages";
import { trackCheckoutLink } from "@/lib/payments/attempts";
import { loadAttemptForNudge, db as paymentsDb } from "@/lib/payments/store";
import { checkoutNudgeOf, checkoutNudgeSendKey } from "@/lib/payments/nudge-event";
import { nudgeGuidance } from "@/lib/payments/abandoned";
import { advanceLeadOpportunitySafely, latestLeadOpportunity } from "@/lib/opportunities/service";
import {
  applySuppression,
  createBooking,
  draftMessage,
  getCalendarAvailability,
  proposeCheckout,
  recordQualificationAnswer,
  recordReplyClassification,
  requestAssist,
  requestHumanHandover,
  sendBookingLink,
  sendMessage,
  stopFollowUp,
  updateLeadFields,
  calculateQuoteForLead,
  draftQuote,
  proposeDiscount,
  requestQuoteApproval,
  sendQuoteToLead,
  type HandoverSummary,
  type QuoteToolAccess,
  type ToolContext,
} from "./tools";
import { loadQuoteTurn, type QuoteTurnData } from "./quote-turn";
import {
  detectQuoteRequest,
  emptyQuotePathState,
  markAsked,
  matchCatalogueItems,
  planConcession,
  planQuoteStep,
  quoteFallbackText,
  quoteFigures,
  quoteIsTheClose,
  quoteStrategyBlock,
  quoteStrategyLines,
  quoteToolGate,
  readQuoteInputs,
  validationFactsFor,
  type QuoteCalculationView,
  type QuoteFigures,
  type QuoteMessageKind,
  type QuotePathState,
  type QuoteValidationFacts,
} from "./quote-flow";
import { agentQuoteRequestId } from "@/lib/commercial/locks";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { aiMay } from "@/lib/commercial/ai-permissions";
import { competitorRules } from "@/lib/sales-library/competitors";
import { getMetaChannelCapability } from "@/lib/social/meta-capability-query";
import { instagramReplyGate, META_APPROVAL_TRIGGER } from "./meta-gate";
import { maybeRefreshSummary } from "./summary";
import { matchOfferedSlot, type Slot } from "./availability/slots";
import { bookingFailureRoute, bookingReplyText } from "@/lib/bookings/confirmation";
import {
  AGENT_TURN_LOCK_SECONDS,
  agentDecisionSchema,
  confidenceDecision,
  isExtractableField,
  MAX_AGENT_STEPS,
  replyClassificationFor,
  type AgentChannel,
  type AgentDecision,
  type AgentEvent,
  type AgentOutcome,
  type AssistReason,
  type HandoverReason,
  type LeadIntent,
} from "./types";

export type TurnResult = {
  outcome: AgentOutcome;
  runId: string | null;
  detail: string;
};

const skipped = (detail: string): TurnResult => ({
  outcome: "NO_ACTION",
  runId: null,
  detail,
});

/**
 * Runs one agent turn for a normalised event. Never throws for ordinary
 * refusals -- a refusal is a logged outcome, not an exception -- and rethrows
 * only genuine infrastructure failures so the job queue can retry them.
 */
export async function runAgentTurn(event: AgentEvent): Promise<TurnResult> {
  const context = await assembleContext({
    businessId: event.businessId,
    leadId: event.leadId,
    conversationId: event.conversationId,
    channel: event.channel ?? "sms",
  });

  if (!context) return skipped("The lead or workspace no longer exists.");

  const channel = event.channel ?? context.conversation.channel;

  // ---- gate 1: may the agent act at all? -------------------------------
  const gate = evaluateRunGate({
    agentMode: context.business.agent.mode,
    aiAssistEnabled: context.business.aiAssistEnabled,
    subscriptionActive: context.business.subscriptionActive,
    businessStatus: context.business.status,
    channel,
    allowedChannels: context.business.agent.channels,
    conversationOwner: context.conversation.owner,
    lifecycle: context.lifecycle,
    leadOptedOut: context.lead.opted_out,
    humanTakeover: context.lead.human_takeover,
    isTestLead: context.lead.is_test,
  });

  if (!gate.allowed) {
    await recordSkippedRun({
      event,
      agentMode: context.business.agent.mode,
      channel,
      code: gate.code,
      detail: gate.detail,
    });
    return skipped(gate.detail);
  }

  // ---- deterministic classification ------------------------------------
  // Runs before the model and outranks it. A binding verdict short-circuits
  // the whole turn: no model call, no negotiation.
  const latestMessage = event.text?.trim() || null;
  const deterministic = latestMessage ? classifyDeterministic(latestMessage) : null;
  const heuristic = latestMessage ? classifyHeuristic(latestMessage) : null;
  const injection = latestMessage ? detectInjectionAttempt(latestMessage) : null;

  // "Can you give me a call?" is a warm close, not a hand-over (elite-closer
  // brief): when a booking route exists the turn offers bookable call times
  // through the ordinary booking flow. The classifier still reads it as
  // HUMAN_REQUEST (so a workspace with the agent off still hears about it),
  // and an explicit ask for a person, or no way to book, still hands over.
  const callClose =
    deterministic?.intent === "HUMAN_REQUEST" && isCallOnlyRequest(latestMessage) && nbaBookingRoute(context) !== "TEAM_FOLLOW_UP";
  const binding = callClose ? null : deterministic;

  const provisionalIntent: LeadIntent = callClose
    ? "BOOKING_REQUEST"
    : binding?.intent ?? heuristic?.intent ?? (event.eventType === "LEAD_CREATED" ? "SERVICE_ENQUIRY" : "UNKNOWN");

  // Contact-channel preference (0147): read for the turn; a call request
  // records "phone"; an answer to the one-time question is parsed and stored.
  const preference = await readChannelPreference(context.business.businessId, context.lead.id);
  if (callClose && preference.preference !== "phone") {
    await recordChannelPreference(context.business.businessId, context.lead.id, "phone");
    preference.preference = "phone";
  } else if (!preference.preference && preference.askedAt && latestMessage) {
    const answered = parseChannelPreference(latestMessage, channel);
    if (answered) {
      await recordChannelPreference(context.business.businessId, context.lead.id, answered);
      preference.preference = answered;
    }
  }
  context.sales.channelPreference = preference;

  const mode = resolveMode({
    lifecycle: context.lifecycle,
    eventType: event.eventType,
    intent: provisionalIntent,
    hasOutstandingQuestions: context.qualification.outstanding > 0,
    bookingEnabled: Boolean(context.booking.bookingUrl) || context.booking.availabilityQueryable,
  });

  // ---- open the run ----------------------------------------------------
  const run = await openRun({
    event,
    mode,
    agentMode: context.business.agent.mode,
    lifecycle: context.lifecycle,
    qualificationState: context.lead.qualification_state,
  });

  if (!run) return skipped("This event has already been handled.");

  // ---- the plan for this turn ------------------------------------------
  // Deterministic, from the sales library. Recorded on the run (method and
  // reason) whichever way the turn ends, and rendered for the model.
  const strategy = strategyFor(context, mode, channel, latestMessage);
  run.strategy = strategy.record;
  if (strategy.record.channelPreferenceAsked) {
    await markChannelPreferenceAsked(context.business.businessId, context.lead.id);
  }

  // ---- claim the conversation turn -------------------------------------
  // Two inbound messages arriving together must not produce two replies.
  const turnSeq = await claimTurn(context.conversation.conversationId);
  if (turnSeq === null) {
    await closeRun(run, {
      status: "SKIPPED",
      outcome: "NO_ACTION",
      intent: provisionalIntent,
      decision: { skipped: "Another turn holds this conversation." },
    });
    return skipped("Another turn is already running on this conversation.");
  }

  // The engine's record is read when the run closes, whichever branch ends
  // the turn (CD-14): decision_json.qi = { nba, interpretation, accounting }.
  const stats = newTurnStats(estimateTokens(strategy.text));
  run.qi = () => qiRunRecord(stats);

  try {
    const turnInput: ExecuteInput = {
      event,
      context,
      run,
      mode,
      channel,
      latestMessage,
      binding,
      heuristic,
      injection,
      strategy,
      stats,
    };
    // Voice P3 (§71): a call request may become an AI call now. When it does,
    // the reply is one fixed line and the call is the turn's one move.
    if (callClose && latestMessage) {
      const called = await callTheLeadInstead(turnInput);
      if (called) return called;
    }
    return await executeTurn(turnInput);
  } finally {
    await releaseTurn(context.conversation.conversationId, turnSeq);
  }
}

/**
 * Voice P3 (brief §71, voice/channel-orchestration.ts rule V1): the lead
 * asked on a text channel for a call. The deterministic channel choice
 * (consent, the owner's "Phone leads" permission, entitlement, intent,
 * calling hours) decides whether the AI calls now; the call itself goes
 * through every voice gate. Null = the turn goes on as before (it offers
 * bookable call times).
 */
async function callTheLeadInstead(input: ExecuteInput): Promise<TurnResult | null> {
  const { context, run } = input;
  const { planCallFromText } = await import("@/lib/voice/text-to-call");
  const planned = await planCallFromText({
    businessId: context.business.businessId,
    leadId: context.lead.id,
    channel: input.channel,
    message: input.latestMessage ?? "",
  });
  if (!planned.queued) return null;
  const delivered = await deliverFixed(input, planned.line, `voice-call-ack:${planned.callId}`);
  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome,
    intent: "BOOKING_REQUEST",
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: { mode: input.mode, action: "VOICE_CALL", voiceCallId: planned.callId, channelRule: planned.decision.rule, scheduledFor: planned.scheduledFor },
  });
  return { outcome: delivered.outcome, runId: run.id, detail: "They asked for a call: the AI voice agent is calling them." };
}

// --------------------------------------------------------------- the turn

type ExecuteInput = {
  event: AgentEvent;
  context: AgentContext;
  run: AgentRunHandle;
  mode: ReturnType<typeof resolveMode>;
  channel: AgentChannel;
  latestMessage: string | null;
  binding: ReturnType<typeof classifyDeterministic>;
  heuristic: ReturnType<typeof classifyHeuristic>;
  injection: string | null;
  strategy: Strategy;
  /**
   * Lines the hand-over policy adds to whatever strategy block the turn ends
   * up with (a discount ask, "are you a bot?"). Kept apart because the
   * strategy is rebuilt after qualification and for the engine's NBA.
   */
  guidance?: string[];
  /** Per-turn tallies for the engine's accounting, shared by every branch. */
  stats: TurnStats;
  /**
   * The quote in play this turn (quote-flow.ts): the figures the validator
   * admits, and the quote's private link when the reply carries it.
   */
  quote?: { validation: QuoteValidationFacts; extraUrls: string[] };
  /** The quote step owns the turn's one question, so the engine's question QA does not apply. */
  skipQuestionQa?: boolean;
  /** What the assistant may do with quotes this turn (quoteToolGate inputs). */
  quoteAccess?: QuoteToolAccess;
};

/**
 * What the turn did, for decision_json.qi.accounting. Mutated as the turn
 * runs; read once, when the run closes.
 */
type TurnStats = {
  /** The engine's view of the turn; null = engine OFF (no qi record). */
  qi: QiTurn | null;
  modelCalls: number;
  strategyTokens: number;
  qaFindings: QaCode[];
  questionGrade: number | null;
  shadowDiffers: boolean | null;
};

function newTurnStats(strategyTokens: number): TurnStats {
  return { qi: null, modelCalls: 0, strategyTokens, qaFindings: [], questionGrade: null, shadowDiffers: null };
}

function qiRunRecord(stats: TurnStats): Record<string, unknown> | null {
  const qi = stats.qi;
  if (!qi) return null;
  const record = runQiRecord({
    nba: qi.nba,
    interpretation: qi.interpretation,
    accounting: buildTurnAccounting({
      mode: qi.mode,
      nba: qi.nba,
      modelCalled: stats.modelCalls > 0,
      shadowDiffers: stats.shadowDiffers,
      strategyBlockTokens: stats.strategyTokens,
      interpretationTokens: qi.interpretationTokens,
      qaFindings: stats.qaFindings,
      questionGrade: stats.questionGrade,
    }),
  });
  if (!record) console.error("[agent] decision_json.qi failed its schema; not stored", { action: qi.nba.next_action });
  return record as Record<string, unknown> | null;
}

/**
 * Story I3: predicts what the send guard (send-core.ts) will do with the
 * reply this turn is about to queue, so a reply that would only be stopped is
 * never composed and the run records the true result. A reply to the lead's
 * own message is `agent` origin (not bound by the follow-up switch); any
 * other trigger is the agent reaching out, which `automation_active` governs.
 */
function predictAgentSend(context: AgentContext, event: AgentEvent): SendStopReason | null {
  const decision = evaluateSend({
    lead: leadState(context.lead),
    channel: {
      subscriptionActive: context.business.subscriptionActive,
      integrationHealthy: true,
      contactSuppressed: !context.leadContext.contactable,
    },
    // Quiet hours reschedule, they never stop: the send gate handles them.
    quietHours: { ...context.business.quietHours, enabled: false },
    origin: "agent",
  });
  if (decision.action === "abort") return decision.reason;
  if (!isReplyTrigger(event.eventType) && !context.lead.automation_active) return "paused";
  return null;
}

function strategyInput(
  context: AgentContext,
  mode: ReturnType<typeof resolveMode>,
  channel: AgentChannel,
  latestMessage: string | null,
) {
  return {
    mode,
    motion: context.sales.motion,
    archetypeKey: context.sales.archetypeKey,
    channel,
    selection: {
      question: context.qualification.nextQuestion,
      stopReason: context.qualification.stopReason,
      known: context.qualification.known,
    },
    latestMessage,
    hasApprovedInsight: context.offer.hasApprovedClaims,
    bookingAvailable: Boolean(context.booking.bookingUrl) || context.booking.availabilityQueryable,
    manualBooking: manualBooking(context),
    preferredMethods: context.sales.preferences?.preferredMethods,
    direction: leadDirection(context.lead),
    stakeholderCount: context.opportunityMemory?.stakeholders.length ?? 0,
    // Elite-closer brief: the business's own objections, the reframe on a
    // repeated objection, the call close, the motion's close route and the
    // one-time channel question.
    workspaceObjections: context.sales.objections,
    objectionSeenBefore: objectionRaisedBefore(latestMessage, priorLeadMessages(context, latestMessage)),
    callRequested: isCallOnlyRequest(latestMessage) && nbaBookingRoute(context) !== "TEAM_FOLLOW_UP",
    bookingRoute: nbaBookingRoute(context),
    askChannelPreference: shouldAskChannelPreference({
      mode,
      inboundCount: context.conversation.recentMessages.filter((message) => message.role === "lead").length,
      alreadyAsked: Boolean(context.sales.channelPreference?.askedAt),
      preference: context.sales.channelPreference?.preference ?? null,
      // The strategy adds the line only on a turn that asks nothing else.
      turnHasQuestion: false,
      channel,
    }),
  };
}

/** The lead's earlier messages in the window, without the one being answered. */
function priorLeadMessages(context: AgentContext, latestMessage: string | null): string[] {
  return context.conversation.recentMessages
    .filter((message) => message.role === "lead" && message.body.trim() !== (latestMessage ?? "").trim())
    .map((message) => message.body);
}

function strategyFor(
  context: AgentContext,
  mode: ReturnType<typeof resolveMode>,
  channel: AgentChannel,
  latestMessage: string | null,
): Strategy {
  return buildStrategyBlock(strategyInput(context, mode, channel, latestMessage));
}

// ------------------------------------------------------ booking routes

/**
 * Manual booking mode (story H3, docs/revenue-engine/00 §6): no calendar can
 * be read and no booking link is configured, so a booking is a PENDING
 * request for the time the lead asks for, confirmed or declined by a person.
 * Calendly never books this way (the lead books on Calendly).
 */
function manualBooking(context: AgentContext): boolean {
  return (
    !context.booking.availabilityQueryable &&
    !context.booking.bookingUrl &&
    !context.booking.liveBooking &&
    planBookingRoute({ bookingMode: context.business.bookingMode, calendarUsable: false }) === "pending"
  );
}

function nbaBookingRoute(context: AgentContext): NbaBookingRoute {
  if (context.booking.availabilityQueryable) return "SLOTS";
  if (context.booking.bookingUrl) return "LINK";
  return manualBooking(context) ? "ASK_PREFERRED_TIME" : "TEAM_FOLLOW_UP";
}

/** This turn is about booking: the lead asked, or the engine decided to close. */
function bookingIsThePlan(input: ExecuteInput): boolean {
  return input.mode === "BOOKING_ASSISTANCE" || input.strategy.record.nbaAction === "CTA_BOOK";
}

async function readAvailability(input: ExecuteInput) {
  const { context } = input;
  return getCalendarAvailability(toolContext(input, null), {
    date: null,
    dayPart: null,
    timezone: context.business.timezone,
    availability: {
      bookingMode: context.business.bookingMode,
      businessHours: context.booking.businessHours,
      appointmentDurationMinutes: context.booking.appointmentDurationMinutes,
      bookingBufferMinutes: context.booking.bookingBufferMinutes,
      calendarIntegrationId: context.booking.meetingType?.calendarIntegrationId ?? null,
    },
  });
}

// --------------------------------------------------- engine-planned turns

/**
 * Engine LIVE: acts on an NBA that needs no composed message. Returns null
 * when a message is needed (the caller hands the model the NBA strategy).
 * Zero-token decisions never reach the model (design 08 §B.16).
 */
async function actOnNba(input: ExecuteInput, qi: QiTurn): Promise<TurnResult | null> {
  const { context, run } = input;
  const plan = planFor(qi.nba, { manual: manualBooking(context) });
  const intent = input.heuristic?.intent ?? "UNKNOWN";

  switch (plan.kind) {
    case "COMPOSE":
      return null;
    case "ESCALATE":
      return handover(input, qi.nba.handover_reason ?? "NO_NEXT_QUESTION", qi.nba.reason);
    case "ASK_PREFERRED_TIME":
      // Recorded now, on the turn the engine planned the booking, and read
      // back when the lead answers: the pending request is then created on
      // the engine's readiness even if the lifecycle is not yet QUALIFIED.
      return askPreferredTime(input, 1, engineBookingReadiness(qi.nba, qi.bookingGate).ready);
    case "SILENT": {
      const tools = toolContext(input, null);
      if (plan.stopFollowUp) {
        await stopFollowUp(tools, { reason: plan.action === "DISQUALIFY" ? "not_qualified" : "no_interest" });
      }
      // An offer disqualifier marked suppress: a person confirms the
      // suppression (never the agent), and the handover stops every further
      // AI turn and all outreach until they do. Nothing is sent to the lead.
      if (disqualifyFollowThrough(qi.nba).askPersonToSuppress) {
        await askPersonToConfirmSuppression(input, qi.nba);
      }
      await recordQiDisposition({ context, nba: qi.nba });
      await maybeRefreshSummary(context, run.id);
      await closeRun(run, {
        status: "COMPLETED",
        outcome: plan.action === "DISQUALIFY" ? "QUALIFICATION_UPDATED" : "NO_ACTION",
        intent,
        replyClassification: replyClassificationFor(intent),
        decision: {
          mode: input.mode,
          nba: plan.action,
          rule: qi.nba.rule,
          resumeAt: plan.resumeAt,
          suppressionConfirmationRequested: disqualifyFollowThrough(qi.nba).askPersonToSuppress,
        },
      });
      return {
        outcome: plan.action === "DISQUALIFY" ? "QUALIFICATION_UPDATED" : "NO_ACTION",
        runId: run.id,
        detail: qi.nba.reason,
      };
    }
  }
}

/** The QA and grading context for a draft of this turn. */
/** The engine (LIVE) planned an explicit VERIFY of a fact that has gone stale. */
function verifiesStaleFact(qi: QiTurn | null | undefined): boolean {
  const planned = qi?.mode === "LIVE" ? qi.nba.question_intent : null;
  if (!planned || planned.purpose !== "VERIFY") return false;
  return qi!.dimensions.some((entry) => entry.dimension === planned.dimension && entry.stale === true);
}

function qaContextFor(input: ExecuteInput, qi: QiTurn) {
  return qaContextFromNba({
    nba: qi.nba,
    channel: input.channel,
    stage: qi.stage,
    dimensions: qi.dimensions,
    forbiddenIntents: qi.forbiddenIntents,
    inbound: input.latestMessage,
    interpretation: qi.interpretation,
    recentOutbound: qi.recentOutbound,
    customerType: qi.customerType,
    companion: qi.interests?.companion ?? null,
  });
}

/** MessageFeatures v2 question fields, on a message the engine planned (LIVE). */
/**
 * MessageFeatures v2 question fields for the reply being sent. Written on
 * every message that asks a question, whatever the engine mode, because the
 * engine's ask history (repetition risk, the one sticky re-ask) is read from
 * them. Engine LIVE: the NBA's question intent and state. Otherwise: the
 * configured question the legacy plan asked, as its `custom:<id>` intent.
 */
function questionFeatures(input: ExecuteInput, decision: AgentDecision) {
  const qi = input.stats.qi;
  if (!qi || qi.mode !== "LIVE") {
    const legacyAsks =
      decision.proposed_action === "ASK_NEXT_QUESTION" || decision.proposed_action === "ANSWER_AND_ASK";
    const question = input.context.qualification.nextQuestion;
    if (!legacyAsks || !question || question.id !== input.strategy.record.nextQuestionId) return null;
    return {
      questionIntent: customIntentKey(question.id),
      dimension: inferDimension(question) ?? UNMAPPED_DIMENSION,
      wordingFamily: null,
      questionPosition: null,
      intentState: qi?.nba.intent_state ?? null,
      goal: qi?.nba.current_goal ?? null,
      offerId: input.context.lead.service_id ?? null,
      nbaAction: null,
      strategyVersion: null,
    };
  }
  const q = qi.nba.question_intent;
  const asks = qi.nba.next_action === "ASK" || qi.nba.next_action === "ANSWER_AND_ASK" || (qi.nba.next_action === "CTA_BOOK" && q !== null);
  return {
    questionIntent: asks ? (q?.key ?? null) : null,
    dimension: asks ? (q?.dimension ?? null) : null,
    wordingFamily: asks ? (qi.experiment?.wordingFamily ?? q?.wording_family ?? null) : null,
    questionPosition: asks ? qi.questionPosition : null,
    intentState: qi.nba.intent_state,
    goal: qi.nba.current_goal,
    offerId: qi.offerId,
    nbaAction: qi.nba.next_action,
    strategyVersion: QIE_ENGINE_VERSION,
  };
}

// ------------------------------------------- manual booking (story H3)

/**
 * Asks the lead which day and time suits them: one question, fixed wording,
 * no model call. Recorded as BOOKING_OPTIONS_SENT with `preferredTimeAsked`
 * so the next reply is parsed as their answer. The second attempt gives an
 * example; after it, a person takes over.
 */
async function askPreferredTime(input: ExecuteInput, attempt: 1 | 2, engineBookingReady = false): Promise<TurnResult> {
  const { context, run } = input;
  const body = preferredTimeQuestion(context.leadContext.firstName, attempt);
  const delivered = await deliverFixed(input, body, `agent-preferred-time:${run.id}`);

  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome === "FAILED" || delivered.outcome === "NO_ACTION" ? delivered.outcome : "BOOKING_OPTIONS_SENT",
    intent: input.heuristic?.intent ?? "BOOKING_REQUEST",
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: { mode: input.mode, action: "ASK_PREFERRED_TIME", preferredTimeAsked: attempt, offeredSlots: [], engineBookingReady },
  });

  return {
    outcome: delivered.outcome === "FAILED" || delivered.outcome === "NO_ACTION" ? delivered.outcome : "BOOKING_OPTIONS_SENT",
    runId: run.id,
    detail: attempt === 1 ? "Asked for a preferred day and time." : "Asked once more for a day and time.",
  };
}

/**
 * The attempt number when the previous turn on this conversation asked for a
 * preferred time and the lead is now answering it; null otherwise. Only the
 * latest earlier run counts, and only for 72 hours.
 */
async function loadPreferredTimeAsk(
  conversationId: string | null,
  currentRunId: string,
): Promise<{ attempt: 1 | 2; engineBookingReady: boolean } | null> {
  if (!conversationId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("id, decision_json, created_at")
    .eq("conversation_id", conversationId)
    .neq("id", currentRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - Date.parse(data.created_at) > 72 * 60 * 60 * 1000) return null;
  const asked = (data.decision_json ?? {}) as { preferredTimeAsked?: unknown; engineBookingReady?: unknown };
  if (asked.preferredTimeAsked !== 1 && asked.preferredTimeAsked !== 2) return null;
  return { attempt: asked.preferredTimeAsked, engineBookingReady: asked.engineBookingReady === true };
}

/**
 * The lead answered "which day and time?". A concrete time is held as a
 * pending booking (createBooking's manual route) and the lead is told it is
 * requested, never booked. Anything else is asked once more, then handed over.
 */
async function handlePreferredTimeReply(
  input: ExecuteInput,
  asked: { attempt: 1 | 2; engineBookingReady: boolean },
): Promise<TurnResult> {
  const { attempt, engineBookingReady } = asked;
  const { context } = input;
  const parsed = parsePreferredTime(input.latestMessage ?? "", {
    now: new Date(),
    timezone: context.business.timezone,
    durationMinutes: context.booking.appointmentDurationMinutes,
  });
  if (parsed.kind === "slot") {
    // The time is the lead's own words, parsed by rules, and the booking it
    // creates is PENDING until a person confirms it: that is the availability
    // create_booking is armed with in manual mode (decision Q1).
    return confirmBooking(input, { confidence: 1 }, parsed.slot, { engineBookingReady });
  }
  if (attempt >= 2) {
    // Asked twice, still unreadable: the last resort (handover-policy.ts).
    return handover(input, "POLICY", "The lead's preferred day and time could not be read after asking twice.", {
      trigger: "REPEATED_CLARIFICATION_FAILURE",
    });
  }
  return askPreferredTime(input, 2, engineBookingReady);
}

/**
 * Sends a fixed, deterministic line through the same send gate as a composed
 * reply (draft under SUGGEST_ONLY, queue in quiet hours, deny when blocked).
 */
async function deliverFixed(
  input: ExecuteInput,
  body: string,
  sendKey: string,
): Promise<{ outcome: AgentOutcome; errorCode: string | null }> {
  const { context } = input;
  const gate = evaluateSendGate({
    agentMode: context.business.agent.mode,
    channel: input.channel,
    contactSuppressed: !context.leadContext.contactable,
    hasDestination: Boolean(context.leadContext.contactable),
    providerHealthy: true,
    lastInboundAt: context.leadContext.lastInboundAt,
    socialConnectionState: context.leadContext.socialConnectionState,
    quietHours: context.business.quietHours,
    now: new Date(),
  });
  const tools = toolContext(input, null);
  if (gate.decision === "DENY") return { outcome: "NO_ACTION", errorCode: gate.code };
  if (gate.decision === "DRAFT") {
    const drafted = await draftMessage(tools, { body, sendKey });
    return { outcome: drafted.ok ? "MESSAGE_DRAFTED" : "FAILED", errorCode: null };
  }
  const sent = await sendMessage(tools, {
    body,
    sendKey,
    runAt: gate.decision === "QUEUE" ? gate.runAt : undefined,
  });
  return { outcome: sent.ok ? (gate.decision === "QUEUE" ? "MESSAGE_QUEUED" : "MESSAGE_SENT") : "FAILED", errorCode: null };
}

async function executeTurn(initial: ExecuteInput): Promise<TurnResult> {
  // Reassigned once, if this turn records an answer before the model call.
  let input = initial;
  const { run, event } = input;
  let context = input.context;

  const tools = toolContext(input, null);

  // Reply classification is persisted regardless of what the turn does with
  // it, because follow-up and reactivation analytics read it.
  if (event.eventId && input.latestMessage) {
    const intent = input.binding?.intent ?? input.heuristic?.intent ?? "UNKNOWN";
    await recordReplyClassification(tools, {
      messageId: event.eventId,
      classification: replyClassificationFor(intent),
      confidence: input.binding ? 1 : 0.5,
    });
  }

  // ---- binding deterministic outcomes ----------------------------------
  if (input.binding) {
    return handleBindingVerdict(input, input.binding.intent);
  }

  // ---- Instagram without Meta approval (meta-gate.ts) -------------------
  // After the binding verdicts, so an opt-out or a complaint is still
  // recorded; before anything is composed, because a reply Meta will refuse
  // is a queued message that can only fail. The hand-over says why and asks a
  // person to reply from the Instagram app. Nothing is sent: the
  // acknowledgement would go through the same refused channel.
  if (input.channel === "instagram") {
    const instagram = instagramReplyGate(
      input.channel,
      await getMetaChannelCapability(context.business.businessId, "instagram").catch(() => null),
    );
    if (instagram.blocked) {
      return handover(input, "POLICY", instagram.detail, { acknowledged: true, trigger: META_APPROVAL_TRIGGER });
    }
  }

  // ---- abandoned-checkout nudge (the direct-sale loop) -----------------
  // A FOLLOW_UP_DUE turn queued by the checkout.nudge job. Its own branch:
  // the model writes the reminder, the same validator checks it with the
  // same tracked link, and the send guard decides at send time.
  const checkoutNudge = checkoutNudgeOf(event);
  if (checkoutNudge) return nudgeTheCheckout(input, checkoutNudge);

  if (modeIsSilent(input.mode)) {
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "NO_ACTION",
      intent: input.heuristic?.intent ?? "UNKNOWN",
      decision: { mode: input.mode, reason: "MODE_IS_SILENT" },
    });
    return { outcome: "NO_ACTION", runId: run.id, detail: "Nothing to say in this mode." };
  }

  // ---- last resorts in the lead's own words (handover-policy.ts) ---------
  // Decided here, before the model, rather than hoping the model proposes it:
  // a data-rights request, a discount or price concession outside the
  // approved offer, and a legal or contract question (objection library)
  // hand over. A security or procurement step is a background assist and the
  // conversation carries on. Objection playbooks are only matched when the
  // turn is handling an objection, as before: "our contract ends in March" is
  // not a contract question.
  // What the previous turn left for this one: a clarification in progress, or
  // an out-of-policy discount ask the assistant already answered.
  const previousTurn = await loadPreviousTurn(context.conversation.conversationId, run.id);
  const previousClarification = previousTurn.clarification;

  const onMessage = policyOnMessage({
    text: input.latestMessage,
    bindingIntent: null,
    objectionKeys:
      input.strategy.objection && input.latestMessage ? matchObjection(input.latestMessage).map((match) => match.key) : [],
    commercial: commercialPolicy(context),
    previousDiscountDemand: previousTurn.discountDemand,
    botQuestion: input.latestMessage ? isBotQuestion(input.latestMessage) : false,
  });
  if (onMessage.kind === "HANDOVER") return handoverFor(input, onMessage);
  if (onMessage.kind === "CONTINUE") {
    // A discount ask is answered within the approved maximum; an ask beyond
    // it is remembered, so insisting next turn hands over. "Are you a bot?"
    // is answered honestly, and the conversation carries on.
    const guidance: string[] = [];
    if (onMessage.discount) {
      guidance.push(discountGuidance(onMessage.discount));
      if (!onMessage.discount.withinPolicy) run.marks = { ...(run.marks ?? {}), discountDemand: true };
    }
    if (onMessage.disclose) guidance.push(disclosureGuidance(context.workspace.businessName));
    if (guidance.length) input = { ...input, guidance };
  }

  // ---- a planned re-engagement check-in: say why we are writing ----------
  // The trigger queued the reason as structured facts (the lead's own resume
  // date, the date they gave, the missed meeting, the loss reason). One line
  // on whatever plan the turn ends up with, legacy or engine.
  const reengagement = event.eventType === "FOLLOW_UP_DUE" ? reengagementReasonOf(event.payload) : null;
  if (reengagement) {
    input = { ...input, guidance: [...(input.guidance ?? []), reengagementReasonLine(reengagement)] };
    run.marks = { ...(run.marks ?? {}), reengagement: reengagement.trigger };
  }

  // ---- story I3: would the reply even be sent? --------------------------
  // Predicted before any model call, so a reply the send guard would only
  // stop is never composed (or paid for), and the run records NO_ACTION with
  // the reason instead of claiming MESSAGE_SENT.
  const stopped = predictAgentSend(context, event);
  if (stopped) {
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "NO_ACTION",
      intent: input.heuristic?.intent ?? "UNKNOWN",
      errorCode: `STOPPED_${stopped.toUpperCase()}`,
      decision: { mode: input.mode, blocked: stopped },
    });
    return { outcome: "NO_ACTION", runId: run.id, detail: `The reply would be stopped by the send guard (${stopped}).` };
  }

  if (onMessage.kind === "CONTINUE" && onMessage.assist) {
    await raiseAssist(input, onMessage.assist, onMessage.detail ?? "A colleague provides this in the background.");
  }

  // ---- story H3: the lead is answering "which day and time?" -------------
  // Manual booking mode has no offered slots; the lead's own stated time is
  // parsed deterministically and held as a pending booking for a person to
  // confirm. Checked before anything else reads the reply as an answer.
  if (input.latestMessage) {
    const asked = await loadPreferredTimeAsk(context.conversation.conversationId, run.id);
    if (asked !== null) return handlePreferredTimeReply(input, asked);
  }

  // ---- record what this reply answers, before the model call ------------
  // Deterministic: the reply is matched against the question put to the lead
  // last turn, and inferred answers (lead details) are recorded too. Done
  // before generation so the model is handed the question that comes NEXT,
  // not the one the lead has just answered.
  let qualificationChanged = false;
  if (context.qualification.inferred.length > 0) {
    qualificationChanged =
      (await recordInferredAnswers(context.business.businessId, context.lead.id, context.qualification.inferred)) > 0;
  }
  // Whether the reply was a usable answer to the question just asked: the
  // deterministic matcher refuses a value outside the configured options
  // (VALUE_NOT_ACCEPTED), which is an unusable answer to clarify, never a
  // reason to hand over on its own.
  const askedQuestion = context.qualification.currentQuestion;
  let answerMatched: boolean | null = null;
  if (input.latestMessage && askedQuestion) {
    const stored = await recordQualificationAnswer(tools, {
      question: askedQuestion,
      reply: input.latestMessage,
      value: input.latestMessage,
    });
    qualificationChanged = qualificationChanged || stored.ok;
    answerMatched = stored.ok ? true : stored.code === "VALUE_NOT_ACCEPTED" ? false : null;
  }


  let qualificationResult: string | null = null;
  let qualificationReasons: { code: string; questionId?: string }[] = [];
  let engineStop: "NOT_QUALIFIED" | null = null;
  if (qualificationChanged) {
    const refreshed = (await loadLead(context.lead.id)) ?? context.lead;
    const { output } = await applyQualification(context.business, refreshed);
    qualificationResult = output.result;
    qualificationReasons = output.reasons.map((reason) => ({ code: reason.code, questionId: reason.questionId }));

    // The engine, not the model, decides the verdict. A REVIEW is recorded
    // and (below, once the qualification engine has recorded the turn)
    // flagged for a person while the conversation carries on; only a
    // workspace that opted in to hand-over on review stops here.
    if (output.result === "NOT_QUALIFIED") {
      engineStop = "NOT_QUALIFIED";
    } else {
      // Re-read the picture and re-plan: the next question has moved on.
      const lead = { ...refreshed, qualification_state: output.result };
      context = {
        ...context,
        lead,
        qualification: await refreshQualification(context, lead, input.mode),
      };
      const strategy = strategyFor(context, input.mode, input.channel, input.latestMessage);
      run.strategy = strategy.record;
      input.stats.strategyTokens = estimateTokens(strategy.text);
      input = { ...input, context, strategy };
    }
  }

  // ---- the qualification engine (design 08, Wave 2) ----------------------
  // interpret() writes the reply back (facts and signals, source_ref = the
  // inbound message, CD-15), the lead is re-assessed and the NBA computed.
  // OFF: null, and the turn below is the legacy turn unchanged. SHADOW: the
  // NBA is stored beside the legacy decision and nothing changes. LIVE: the
  // turn acts on the NBA. A failure inside the engine is logged and the turn
  // continues on the legacy path; it never costs the lead their reply.
  const legacy: LegacyDecision = {
    nextQuestionId: input.strategy.record.nextQuestionId,
    agentMode: input.mode,
    stoppedQualifying: input.strategy.record.stopReason !== null,
  };
  const qi = await prepareQiTurn({
    context,
    event,
    latestMessage: input.latestMessage,
    channel: input.channel,
    stage: input.strategy.record.stage,
    legacy,
    engineVerdict: qualificationResult,
  });
  input.stats.qi = qi;
  if (qi?.mode === "SHADOW") input.stats.shadowDiffers = shadowDiffers(qi.nba, legacy);

  // ---- the answer and the verdict (handover-policy.ts) -------------------
  // An unusable answer is asked again in other words (twice at most, then a
  // person); a REVIEW verdict is flagged for a person in the background.
  if (engineStop !== "NOT_QUALIFIED") {
    const onAnswer = policyOnAnswer({
      text: input.latestMessage,
      answer:
        askedQuestion && answerMatched !== null
          ? { questionId: askedQuestion.id, matched: answerMatched, structured: askedQuestion.responseType !== "text" }
          : null,
      verdict: qualificationResult
        ? { result: qualificationResult as "PENDING" | "QUALIFIED" | "NOT_QUALIFIED" | "REVIEW", reasons: qualificationReasons }
        : null,
      handoverOnReview: context.business.agent.handoverOnReview,
      previousClarification,
    });
    if (onAnswer.kind === "HANDOVER") return handoverFor(input, onAnswer);
    if (onAnswer.kind === "CLARIFY") return clarify(input, onAnswer, askedQuestion);
    if (onAnswer.assist) {
      await raiseAssist(input, onAnswer.assist, onAnswer.detail ?? "Qualification needs a person to check.");
    }
  }
  if (engineStop === "NOT_QUALIFIED") {
    await stopFollowUp(tools, { reason: "not_qualified" });
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "QUALIFICATION_UPDATED",
      intent: input.heuristic?.intent ?? "UNKNOWN",
      replyClassification: replyClassificationFor(input.heuristic?.intent ?? "UNKNOWN"),
      qualificationAfter: qualificationResult,
      decision: { qualification: qualificationResult },
    });
    return {
      outcome: "QUALIFICATION_UPDATED",
      runId: run.id,
      detail: "The lead did not meet the workspace's rules.",
    };
  }

  if (qi?.mode === "LIVE" && qi.interests) {
    // Several interests (08 §B.20): this turn sells ONE offer. Its motion,
    // its checkout link and its meeting type apply to the gates below.
    context = withInterestFocus(context, qi.interests);
    input = { ...input, context };
    run.marks = { ...(run.marks ?? {}), interests: qi.interests.record };
  }
  if (qi?.mode === "LIVE") {
    const acted = await actOnNba(input, qi);
    if (acted) return acted;
    // The NBA carried on past something a person should see (a REVIEW, a
    // specialist step, a ready buyer's order details): ask them in the
    // background. The strategy block tells the model what to say about it.
    if (qi.nba.assist_reason) await raiseAssist(input, qi.nba.assist_reason, qi.nba.reason);
    // A message is needed: the model is handed the NBA's plan, not the full one.
    const strategy = buildNbaStrategyBlock(strategyInput(context, input.mode, input.channel, input.latestMessage), qi.nba, {
      booking: nbaBookingRoute(context),
      interestLines: qi.interests?.strategyLines,
    });
    run.strategy = strategy.record;
    input.stats.strategyTokens = estimateTokens(strategy.text);
    input = { ...input, strategy };
    if (strategy.record.channelPreferenceAsked) {
      await markChannelPreferenceAsked(context.business.businessId, context.lead.id);
    }
  }

  // ---- quote-to-cash (brief §7, §13-14, §72-74) --------------------------
  // A lead asking for a quote or a price for configured catalogue items is
  // taken down one path: collect the inputs, draft, then approval or send.
  // One move per turn, for the interest the turn is about. A quote they
  // already have is answered from, discounted within policy, or chased to
  // its next step. Nothing here runs unless the lead's words, a quote in
  // progress or a live quote make it relevant (quote-turn.ts).
  const quoteData = await loadQuoteTurn({
    context,
    runId: run.id,
    latestMessage: input.latestMessage,
    serviceId: qi?.interests?.primary.serviceId ?? context.lead.service_id ?? null,
    nbaAction: qi?.mode === "LIVE" ? qi.nba.next_action : null,
  }).catch((error) => {
    console.error("[agent] quote turn could not be loaded", { runId: run.id, error });
    return null;
  });
  if (quoteData) {
    input = { ...input, quoteAccess: quoteData.access };
    const legacyDiscountLine = onMessage.kind === "CONTINUE" && onMessage.discount ? discountGuidance(onMessage.discount) : null;
    const quoted = await quoteTheLead(input, quoteData, legacyDiscountLine);
    if (quoted && "result" in quoted) return quoted.result;
    if (quoted && "guidance" in quoted) input = { ...input, guidance: [...(input.guidance ?? []), ...quoted.guidance] };
  }

  // ---- slots before the model, when booking is the plan -------------------
  // The model can only name a time it has been shown. When this turn is about
  // booking and a calendar can be read, the real slots are fetched first and
  // put in front of the model, so its one call can offer them.
  let prefetched: { labels: string[]; slots: Slot[] } | null = null;
  if (bookingIsThePlan(input) && context.booking.availabilityQueryable && !context.booking.liveBooking) {
    const early = await readAvailability(input);
    if (early.ok && early.data.slots.length > 0) prefetched = { labels: early.data.labels, slots: early.data.slots };
  }

  // ---- the model proposes ----------------------------------------------
  const proposal = await proposeDecision(input, null, prefetched?.labels ?? []);
  let decision = proposal.decision;

  if (!decision) {
    // The budget manager decided a person should answer this live
    // conversation (Phase 4): say so, rather than calling it low confidence.
    if (proposal.skippedReason === "BUDGET_HUMAN") {
      return handover(
        input,
        "BUDGET_EXCEEDED",
        "The assistant's spend limit for this conversation was reached, so a person should reply.",
        { trigger: "BUDGET_EXCEEDED" },
      );
    }
    // The model was unavailable or returned nothing usable. Never a guess:
    // carry on deterministically with the next configured question when
    // there is one the lead has not just been asked; a person only when
    // there is no way to continue.
    const next = context.qualification.nextQuestion;
    if (next && next.id !== askedQuestion?.id) return askQuestionFixed(input, next);
    return handover(input, "LOW_CONFIDENCE", "The assistant could not interpret this reply and had no question to continue with.", {
      trigger: "MODEL_UNAVAILABLE",
    });
  }

  // A binding verdict has already returned above, so the model's intent is
  // the only one still in play here. Risk tolerance (Settings -> AI &
  // selling) can only raise the clarify floor; a reply the model could not
  // read is clarified, and a hand-over the model proposes is honoured only
  // for a last resort (handover-policy.ts).
  const onDecision = policyOnDecision({
    proposedAction: decision.proposed_action,
    handoverReason: decision.handover_reason,
    confidence: decision.confidence,
    riskTolerance: context.sales.preferences?.riskTolerance,
    previousClarification,
  });
  if (onDecision.kind === "HANDOVER") return handoverFor(input, onDecision);
  if (onDecision.kind === "CLARIFY") return clarify(input, onDecision, null);

  if (decision.proposed_action === "REQUEST_HANDOVER") {
    // Not a last resort: a colleague confirms the detail in the background
    // and the conversation carries on.
    const assist = onDecision.assist ?? "CONFIRM_DETAIL";
    await raiseAssist(input, assist, decision.handover_reason ? `The assistant asked a colleague to help (${decision.handover_reason}).` : "The assistant asked a colleague to help.");
    const carried = await carryOnAfterAssist(input, decision, prefetched?.labels ?? []);
    if (!carried) return deliverAssistLine(input, assist, decision);
    decision = carried;
  }

  const intent = decision.intent;

  // ---- accept extractions ----------------------------------------------
  await applyExtractions(input, decision);

  // ---- direct close (Phase 3.2, decision Q2) ----------------------------
  if (decision.proposed_action === "PROPOSE_CHECKOUT") {
    return proposeTheCheckout(input, decision);
  }

  // (The qualification answer was recorded before the model call.)

  // ---- is the lead confirming a time we already offered? ---------------
  // Checked before anything else booking-related, and decided by string
  // matching against slots this runtime offered on an earlier turn -- never by
  // asking the model which one it thinks they meant. That is what makes
  // arming create_booking safe at all.
  const offered = await loadOfferedSlots(context.conversation.conversationId);
  if (offered.slots.length > 0 && input.latestMessage) {
    const chosen = matchOfferedSlot(input.latestMessage, offered.slots);
    if (chosen) return confirmBooking(input, decision, chosen, { engineBookingReady: offered.engineBookingReady });
  }

  // ---- availability, if the model asked for it -------------------------
  let confirmedSlots: string[] = [];
  let offeredSlots: Slot[] = [];
  if (
    (decision.proposed_action === "CHECK_AVAILABILITY" || decision.proposed_action === "SEND_BOOKING_OPTIONS") &&
    context.lifecycle === "REVIEW"
  ) {
    // The rules have not cleared this lead (REVIEW), so no time is offered
    // that the booking gate would then refuse. A person confirms the next
    // step in the background; the conversation stays with the assistant.
    await raiseAssist(input, "QUALIFICATION_REVIEW", "The lead wants to book while qualification is under review.");
    return deliverAssistLine(input, "QUALIFICATION_REVIEW", decision);
  }
  if (
    decision.proposed_action === "CHECK_AVAILABILITY" ||
    decision.proposed_action === "SEND_BOOKING_OPTIONS"
  ) {
    const availability = prefetched
      ? ({ ok: true as const, data: { slots: prefetched.slots, labels: prefetched.labels, provider: "prefetched" } })
      : await readAvailability(input);
    if (availability.ok && availability.data.slots.length > 0) {
      // `labels` are the human strings the reply may quote. The raw slots are
      // objects, and letting them reach the validator would compare a message
      // against "[object Object]" and pass anything.
      confirmedSlots = availability.data.labels;
      offeredSlots = availability.data.slots;
      // The model must see the times it offers. When they were not in front
      // of it on the first call, it is asked once more with them.
      if (!prefetched) {
        const withSlots = await proposeDecision(input, null, confirmedSlots, "slots");
        if (withSlots.decision?.message) decision = withSlots.decision;
      }
    } else if (availability.ok) {
      // The calendar answered, and the answer was "nothing free". That is a
      // real fact and earns a real reply, not a fallback link.
      return offerNothingAvailable(input, decision);
    } else if (context.booking.bookingUrl) {
      // No live calendar, but a link exists: that is the configured booking
      // method for this workspace, so use it rather than stalling.
      return sendTheBookingLink(input, decision);
    } else if (manualBooking(context)) {
      // Story H3: no calendar and no link is manual booking mode, not a
      // failure. Ask for the lead's preferred time and hold it as pending.
      return askPreferredTime(input, 1);
    } else {
      return handover(input, "PROVIDER_FAILURE", "Booking could not be arranged automatically.", { trigger: "PROVIDER_FAILURE" });
    }
  }

  // ---- compose and validate --------------------------------------------
  const composed = await composeValidated(input, decision, confirmedSlots);
  if (!composed) {
    return handover(input, "OUT_OF_SCOPE", "A safe reply could not be composed.", { trigger: "VALIDATOR_REJECTED" });
  }

  // ---- decide how the message leaves -----------------------------------
  const sendGate = evaluateSendGate({
    agentMode: context.business.agent.mode,
    channel: input.channel,
    contactSuppressed: !context.leadContext.contactable,
    hasDestination: Boolean(context.leadContext.contactable),
    providerHealthy: true,
    // Only consulted on Messenger and Instagram, where Meta will not deliver a
    // reply more than 24 hours after the person last wrote.
    lastInboundAt: context.leadContext.lastInboundAt,
    // Only consulted on TikTok and LinkedIn, where the permission to send is
    // the accepted connection and the recipient can withdraw it at any time
    // without sending anything the runtime would otherwise see.
    socialConnectionState: context.leadContext.socialConnectionState,
    quietHours: context.business.quietHours,
    now: new Date(),
  });

  const sendKey = `agent:${run.id}`;
  let outcome: AgentOutcome;

  if (sendGate.decision === "DENY") {
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "NO_ACTION",
      intent,
      intentConfidence: decision.confidence,
      errorCode: sendGate.code,
      decision: { blocked: sendGate.detail },
    });
    return { outcome: "NO_ACTION", runId: run.id, detail: sendGate.detail };
  }

  if (sendGate.decision === "DRAFT") {
    const drafted = await draftMessage(tools, { body: composed, sendKey });
    outcome = drafted.ok ? "MESSAGE_DRAFTED" : "FAILED";
  } else {
    const sent = await sendMessage(tools, {
      body: composed,
      sendKey,
      runAt: sendGate.decision === "QUEUE" ? sendGate.runAt : undefined,
      // §61: what this reply was, for workspace-level learning.
      features: buildMessageFeatures({
        family: "AGENT_REPLY",
        body: composed,
        channel: input.channel,
        sendAt: sendGate.decision === "QUEUE" ? sendGate.runAt : new Date(),
        timeZone: context.business.timezone,
        archetype: input.strategy.record.archetypeKey,
        motion: input.strategy.record.motion,
        method: input.strategy.record.method,
        experimentId: input.stats.qi?.mode === "LIVE" ? (input.stats.qi.experiment?.id ?? null) : null,
        arm: input.stats.qi?.mode === "LIVE" ? (input.stats.qi.experiment?.arm ?? null) : null,
        question: questionFeatures(input, decision),
      }),
    });
    outcome = sent.ok
      ? offeredSlots.length > 0
        ? // The lead has been shown real times, so the next inbound message
          // may be a confirmation. loadOfferedSlots() finds this run by
          // exactly this outcome.
          "BOOKING_OPTIONS_SENT"
        : sendGate.decision === "QUEUE"
          ? "MESSAGE_QUEUED"
          : "MESSAGE_SENT"
      : "FAILED";
  }

  // ---- advance the conversation pointer --------------------------------
  // The pointer names the question the strategy told the model to ask, so the
  // next reply is matched against exactly that. Once there is nothing left to
  // ask it is cleared, so a later reply cannot be recorded against a question
  // the conversation has moved past.
  if (context.conversation.conversationId) {
    const nbaAsks = input.strategy.record.nbaAction === "ASK" || input.strategy.record.nbaAction === "ANSWER_AND_ASK";
    const modelAsks =
      decision.proposed_action === "ASK_NEXT_QUESTION" || decision.proposed_action === "ANSWER_AND_ASK";
    // Engine LIVE: the NBA chose to ask, and QA held the draft to that question.
    const asked =
      (input.strategy.record.nbaAction ? nbaAsks : modelAsks) && input.strategy.record.nextQuestionId
        ? input.strategy.record.nextQuestionId
        : null;
    const clear = !asked && !context.qualification.nextQuestion && context.conversation.currentQuestionId;
    if (asked || clear) {
      const admin = createAdminClient();
      logWriteError(
        await admin
          .from("conversations")
          .update({ current_question_id: asked })
          .eq("id", context.conversation.conversationId)
          .eq("business_id", context.business.businessId),
        "agent: set current question",
        { businessId: context.business.businessId, conversationId: context.conversation.conversationId },
      );
    }
  }

  await maybeRefreshSummary(context, run.id);

  await closeRun(run, {
    status: outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome,
    intent,
    intentConfidence: decision.confidence,
    replyClassification: replyClassificationFor(intent),
    lifecycleAfter: context.lifecycle,
    qualificationAfter: qualificationResult,
    decision: {
      mode: input.mode,
      action: decision.proposed_action,
      reasoningCode: decision.reasoning_code,
      injectionAttempt: input.injection,
      // Recorded so the next turn matches a confirmation against exactly what
      // was offered, rather than re-querying and possibly drifting.
      offeredSlots,
      // The engine's booking-readiness on the turn the times were offered.
      engineBookingReady:
        offeredSlots.length > 0 && input.stats.qi?.mode === "LIVE"
          ? engineBookingReadiness(input.stats.qi.nba, input.stats.qi.bookingGate).ready
          : false,
    },
  });

  return { outcome, runId: run.id, detail: sendGate.decision };
}

// ------------------------------------------------------- binding verdicts

/**
 * The deterministic outcomes. Each of these is a product rule, not a
 * judgement: the model is not consulted and cannot override any of them.
 */
async function handleBindingVerdict(
  input: ExecuteInput,
  intent: LeadIntent,
): Promise<TurnResult> {
  const { run, context } = input;
  const tools = toolContext(input, null);

  switch (intent) {
    case "UNSUBSCRIBE": {
      // Suppression first, then stop everything queued. Order matters: a
      // crash between the two leaves the contact suppressed, which the send
      // guard already honours, rather than merely un-scheduled.
      await applySuppression({ ...tools, facts: { ...tools.facts, optOutRecognised: true } }, {
        reason: "opt_out",
        scope: "all",
      });
      await stopFollowUp(tools, { reason: "opted_out" });
      await closeConversation(context, "CLOSED");
      await queueNotification({
        businessId: context.business.businessId,
        type: "lead_attention",
        severity: "warning",
        title: "A lead opted out",
        entityType: "lead",
        entityId: context.lead.id,
        linkUrl: `/app/leads/${context.lead.id}`,
        dedupeKey: `opt_out:${context.lead.id}`,
      });
      await closeRun(run, {
        status: "SUPPRESSED",
        outcome: "SUPPRESSED",
        intent,
        intentConfidence: 1,
        replyClassification: "UNSUBSCRIBE",
        decision: { rule: "OPT_OUT_IS_ABSOLUTE" },
      });
      return { outcome: "SUPPRESSED", runId: run.id, detail: "The contact opted out." };
    }

    case "WRONG_NUMBER": {
      // Suppress the endpoint that was reached, not the person. Another
      // channel may still be a legitimate route to a real enquiry.
      await applySuppression({ ...tools, facts: { ...tools.facts, optOutRecognised: true } }, {
        reason: "wrong_number",
        scope: input.channel,
      });
      await stopFollowUp(tools, { reason: "wrong_number" });
      await closeConversation(context, "CLOSED");
      await closeRun(run, {
        status: "SUPPRESSED",
        outcome: "SUPPRESSED",
        intent,
        intentConfidence: 1,
        replyClassification: "WRONG_NUMBER",
        decision: { rule: "WRONG_NUMBER_SUPPRESSES_ENDPOINT", channel: input.channel },
      });
      return { outcome: "SUPPRESSED", runId: run.id, detail: "Wrong number recorded." };
    }

    case "COMPLAINT":
      return handover(input, "COMPLAINT", "The lead raised a complaint.");
    case "EMERGENCY":
      return handover(input, "EMERGENCY", "The lead described an emergency.");
    case "HUMAN_REQUEST":
      return handover(input, "HUMAN_REQUESTED", "The lead asked for a person.");
    case "JOB_APPLICATION":
    case "SUPPLIER_OR_NON_LEAD": {
      // Not a customer enquiry. Stop the sequence and leave it for a person
      // to dispose of; no sales reply goes out.
      await stopFollowUp(tools, { reason: "not_a_lead" });
      await closeRun(run, {
        status: "COMPLETED",
        outcome: "NO_ACTION",
        intent,
        intentConfidence: 1,
        replyClassification: replyClassificationFor(intent),
        decision: { rule: "NOT_A_CUSTOMER_ENQUIRY" },
      });
      return { outcome: "NO_ACTION", runId: run.id, detail: "Not a customer enquiry." };
    }
    default:
      return handover(input, "OUT_OF_SCOPE", "An unhandled deterministic verdict.");
  }
}

async function closeConversation(
  context: AgentContext,
  owner: "CLOSED" | "HANDED_OVER",
): Promise<void> {
  if (!context.conversation.conversationId) return;
  const admin = createAdminClient();
  await admin
    .from("conversations")
    .update({
      owner,
      owner_changed_at: new Date().toISOString(),
      state: owner === "CLOSED" ? "closed" : "handover",
      current_question_id: null,
    })
    .eq("id", context.conversation.conversationId)
    .eq("business_id", context.business.businessId);
}

// -------------------------------------------------------------- handover

async function handover(
  input: ExecuteInput,
  reason: HandoverReason,
  detail: string,
  options: { acknowledged?: boolean; trigger?: string } = {},
): Promise<TurnResult> {
  const { context, run } = input;
  const tools = toolContext(input, null);

  const summary: HandoverSummary = {
    intent: input.binding?.intent ?? input.heuristic?.intent ?? "UNKNOWN",
    service: context.leadContext.serviceName,
    qualificationStatus: context.lead.qualification_state,
    keyAnswers: context.qualification.answered.slice(0, 6),
    bookingIntent:
      input.heuristic?.intent === "BOOKING_REQUEST" ||
      input.heuristic?.intent === "BOOKING_CHANGE",
    unresolvedIssue: detail,
    sentiment:
      reason === "COMPLAINT" ? "negative" : reason === "HUMAN_REQUESTED" ? "neutral" : "neutral",
    summary: buildHandoverNarrative(context, detail),
  };

  await requestHumanHandover(tools, { reason, summary });

  // A short, honest acknowledgement -- not a sales reply. Composed
  // deterministically so nothing about it can be hallucinated, and only sent
  // when the workspace is in AUTO_REPLY.
  //
  // `agent_handover`, not `agent`: the takeover above is already set by the
  // time the worker evaluates this, and an ordinary agent message is refused
  // under a takeover. Opt-out, suppression and quiet hours still bind. Skipped
  // when the caller has already told the lead a person is coming.
  if (
    !options.acknowledged &&
    context.business.agent.mode === "AUTO_REPLY" &&
    context.leadContext.contactable
  ) {
    await sendMessage(tools, {
      body: acknowledgementFor(reason),
      sendKey: `agent-handover:${run.id}`,
      origin: "agent_handover",
    });
  }

  await emitAutomationEvent({
    businessId: context.business.businessId,
    leadId: context.lead.id,
    eventType: "lead.human_takeover",
    payload: { reason },
  });

  await closeRun(run, {
    status: "HANDED_OVER",
    outcome: "HANDOVER_CREATED",
    intent: summary.intent as LeadIntent,
    replyClassification: replyClassificationFor(summary.intent as LeadIntent),
    lifecycleAfter: "HANDED_OVER",
    decision: { reason, trigger: options.trigger ?? null, injectionAttempt: input.injection },
  });

  return { outcome: "HANDOVER_CREATED", runId: run.id, detail };
}

/** A last-resort hand-over decided by the policy (handover-policy.ts). */
function handoverFor(input: ExecuteInput, decision: Extract<PolicyDecision, { kind: "HANDOVER" }>): Promise<TurnResult> {
  return handover(input, decision.reason, decision.detail, { trigger: decision.trigger });
}

/**
 * An ASSIST_REQUEST: a person confirms one fact or does one task in the
 * background, is notified, and the conversation stays with the assistant.
 * Idempotent per reason within a turn. Never throws: an assist that could not
 * be recorded costs a notification, never the lead's reply.
 */
async function raiseAssist(input: ExecuteInput, reason: AssistReason, detail: string): Promise<void> {
  const { context, run } = input;
  run.assists = run.assists ?? [];
  if (run.assists.includes(reason)) return;
  run.assists.push(reason);
  const summary: HandoverSummary = {
    intent: input.binding?.intent ?? input.heuristic?.intent ?? "UNKNOWN",
    service: context.leadContext.serviceName,
    qualificationStatus: context.lead.qualification_state,
    keyAnswers: context.qualification.answered.slice(0, 6),
    bookingIntent: input.heuristic?.intent === "BOOKING_REQUEST" || input.heuristic?.intent === "BOOKING_CHANGE",
    unresolvedIssue: detail.slice(0, 500),
    sentiment: "neutral",
    summary: buildHandoverNarrative(context, detail),
  };
  try {
    await requestAssist(toolContext(input, null), { reason, summary });
  } catch (error) {
    console.error("[agent] assist request failed", { runId: run.id, reason, error: error instanceof Error ? error.message : error });
  }
}

/** The workspace's direct-close authority, as the hand-over policy reads it. */
function commercialPolicy(context: AgentContext): { enabled: boolean; maxDiscountPercent: number } | null {
  const authority = context.commerce?.authority;
  if (!authority) return null;
  return { enabled: authority.enabled, maxDiscountPercent: authority.max_discount_percent ?? 0 };
}

/**
 * What the latest earlier run on this conversation left, within 72 hours:
 * the clarification it made (the chain the hand-over policy counts; a turn in
 * between that was not a clarification resets it) and whether it answered an
 * out-of-policy discount ask (insisting now hands over).
 */
async function loadPreviousTurn(
  conversationId: string | null,
  currentRunId: string,
): Promise<{ clarification: ClarificationState; discountDemand: boolean }> {
  const none = { clarification: null, discountDemand: false };
  if (!conversationId) return none;
  const { data } = await createAdminClient()
    .from("conversation_agent_runs")
    .select("id, decision_json, created_at")
    .eq("conversation_id", conversationId)
    .neq("id", currentRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return none;
  if (Date.now() - Date.parse(data.created_at) > 72 * 60 * 60 * 1000) return none;
  const decision = (data.decision_json ?? {}) as { clarification?: { point?: unknown; attempt?: unknown }; discountDemand?: unknown };
  const c = decision.clarification;
  return {
    clarification:
      c && typeof c.point === "string" && typeof c.attempt === "number" ? { point: c.point, attempt: c.attempt } : null,
    discountDemand: decision.discountDemand === true,
  };
}

/**
 * One clarifying question, fixed wording, no model call (handover-policy.ts
 * clarifyingQuestion). The conversation pointer is left on the question
 * being clarified, so the next reply is matched against it again. Recorded
 * as `decision_json.clarification`, which the next turn reads to count.
 */
async function clarify(
  input: ExecuteInput,
  decision: Extract<PolicyDecision, { kind: "CLARIFY" }>,
  question: QuestionRecord | null,
): Promise<TurnResult> {
  const { context, run } = input;
  const body = clarifyingQuestion({
    question:
      decision.point === "reply" || !question
        ? null
        : {
            questionText: question.questionText,
            responseType: question.responseType,
            options: question.options.map((option) => ({ label: option.label ?? option.value, value: option.value })),
          },
    attempt: decision.attempt,
    firstName: context.leadContext.firstName,
  });
  const delivered = await deliverFixed(input, body, `agent-clarify:${run.id}`);
  const intent = input.heuristic?.intent ?? "UNKNOWN";
  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome,
    intent,
    replyClassification: replyClassificationFor(intent),
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: {
      mode: input.mode,
      action: "CLARIFY",
      clarification: { point: decision.point, attempt: decision.attempt },
    },
  });
  return { outcome: delivered.outcome, runId: run.id, detail: `Asked the lead to clarify (${decision.attempt} of 2).` };
}

/**
 * The model's reply could not be used (no model output): ask the next
 * configured question verbatim, and point the conversation at it so the
 * answer is matched. Zero-token, deterministic.
 */
async function askQuestionFixed(input: ExecuteInput, question: QuestionRecord): Promise<TurnResult> {
  const { context, run } = input;
  const delivered = await deliverFixed(input, questionPrompt(question), `agent-question:${run.id}`);
  if (context.conversation.conversationId && (delivered.outcome === "MESSAGE_SENT" || delivered.outcome === "MESSAGE_QUEUED")) {
    logWriteError(
      await createAdminClient()
        .from("conversations")
        .update({ current_question_id: question.id })
        .eq("id", context.conversation.conversationId)
        .eq("business_id", context.business.businessId),
      "agent: set current question (fixed)",
      { businessId: context.business.businessId, conversationId: context.conversation.conversationId },
    );
  }
  const intent = input.heuristic?.intent ?? "UNKNOWN";
  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome,
    intent,
    replyClassification: replyClassificationFor(intent),
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: { mode: input.mode, action: "ASK_FIXED_QUESTION", questionId: question.id, reason: "MODEL_UNAVAILABLE" },
  });
  return { outcome: delivered.outcome, runId: run.id, detail: "Asked the next configured question (no model output)." };
}

/** The correction the model gets when it proposed a hand-over that is not a last resort. */
const CARRY_ON_CORRECTION =
  "Do not hand this conversation over. A colleague has been asked to confirm the detail you cannot answer. " +
  "Write the reply yourself: answer what you can from the offer card, say in one short clause that a colleague " +
  "will confirm that detail (promise no time, price or outcome), then carry on with the plan.";

/**
 * After an assist, the conversation carries on: the model's own words when it
 * wrote any, otherwise one more proposal with the carry-on correction. Null
 * when there is still nothing usable to send.
 */
async function carryOnAfterAssist(input: ExecuteInput, decision: AgentDecision, confirmedSlots: string[]): Promise<AgentDecision | null> {
  if (decision.message?.trim()) return { ...decision, proposed_action: "REPLY" };
  const again = await proposeDecision(input, CARRY_ON_CORRECTION, confirmedSlots, "assist");
  const next = again.decision;
  if (!next?.message?.trim()) return null;
  const onAgain = policyOnDecision({
    proposedAction: next.proposed_action,
    handoverReason: next.handover_reason,
    confidence: next.confidence,
    riskTolerance: input.context.sales.preferences?.riskTolerance,
    previousClarification: null,
  });
  if (onAgain.kind !== "CONTINUE") return null;
  return next.proposed_action === "REQUEST_HANDOVER" ? { ...next, proposed_action: "REPLY" } : next;
}

/**
 * The fixed line for an assist when the model has nothing usable to say:
 * it promises a colleague, never a time, a price or an outcome. The
 * conversation stays with the assistant.
 */
async function deliverAssistLine(input: ExecuteInput, reason: AssistReason, decision: Confident | null): Promise<TurnResult> {
  const { context, run } = input;
  const delivered = await deliverFixed(input, assistLine(reason, context.leadContext.firstName), `agent-assist:${run.id}`);
  const intent = input.heuristic?.intent ?? "UNKNOWN";
  await maybeRefreshSummary(context, run.id);
  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome,
    intent,
    intentConfidence: decision?.confidence,
    replyClassification: replyClassificationFor(intent),
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: { mode: input.mode, action: "ASSIST_AND_CONTINUE", assist: reason },
  });
  return { outcome: delivered.outcome, runId: run.id, detail: `A colleague was asked to help (${reason}); the assistant carries on.` };
}

/**
 * The engine disqualified the lead on an offer rule marked `suppress`.
 * Suppression is a confirmed human or registry action, never the agent's, so
 * a person is asked to confirm it: the conversation is handed over (which the
 * run gate reads, so no further AI turn runs and nothing more is spent) and
 * the team is notified through the handover's attention flag. Unlike
 * handover(), nothing is sent to the lead.
 */
async function askPersonToConfirmSuppression(input: ExecuteInput, nba: NextBestAction): Promise<void> {
  const { context } = input;
  const tools = toolContext(input, null);
  const detail =
    `The qualification engine disqualified this lead (${nba.reason}) on a rule marked to suppress. ` +
    "Follow-up and campaign sends are stopped and the assistant will not reply. Please confirm whether to suppress this contact.";
  const summary: HandoverSummary = {
    intent: input.binding?.intent ?? input.heuristic?.intent ?? "UNKNOWN",
    service: context.leadContext.serviceName,
    qualificationStatus: context.lead.qualification_state,
    keyAnswers: context.qualification.answered.slice(0, 6),
    bookingIntent: false,
    unresolvedIssue: detail,
    sentiment: "neutral",
    summary: buildHandoverNarrative(context, detail),
  };
  const handed = await requestHumanHandover(tools, { reason: "POLICY", summary });
  if (handed.ok) {
    await emitAutomationEvent({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      eventType: "lead.human_takeover",
      payload: { reason: "confirm_suppression" },
    });
  }
}

function acknowledgementFor(reason: HandoverReason): string {
  if (reason === "COMPLAINT") {
    return "I'm sorry you've had that experience. I'll pass this straight to the team so someone can look into it.";
  }
  if (reason === "EMERGENCY") {
    return "Thanks for letting us know. I'll get someone from the team onto this as a priority. If anyone is in danger, please call the emergency services first.";
  }
  if (reason === "HUMAN_REQUESTED") {
    return "Of course. I'll get someone from the team to pick this up.";
  }
  return "Thanks. I'll get someone from the team to pick this up.";
}

function buildHandoverNarrative(context: AgentContext, detail: string): string {
  const parts = [
    `${context.leadContext.firstName ?? "This lead"} enquired about ${
      context.leadContext.serviceName ?? "an unspecified service"
    }.`,
    context.qualification.answered.length
      ? `Answered so far: ${context.qualification.answered
          .map((answer) => `${answer.question} = ${answer.value}`)
          .join("; ")}.`
      : "No qualification answers recorded yet.",
    detail,
  ];
  return parts.join(" ").slice(0, 1000);
}

// -------------------------------------------------------------- booking

async function sendTheBookingLink(
  input: ExecuteInput,
  decision: AgentDecision,
): Promise<TurnResult> {
  const { context, run } = input;
  const tools = toolContext(input, decision.confidence);

  const lead = context.leadContext.firstName ? `Thanks ${context.leadContext.firstName}. ` : "";
  const body = `${lead}You can pick a time that suits you here:`;

  const sent = await sendBookingLink(tools, { body, sendKey: `agent-booking:${run.id}` });

  await closeRun(run, {
    status: sent.ok ? "COMPLETED" : "FAILED",
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    intent: decision.intent,
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    decision: { action: "SEND_BOOKING_LINK", reasoningCode: decision.reasoning_code },
  });

  return {
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    runId: run.id,
    detail: sent.ok ? "Booking link sent." : "Could not send the booking link.",
  };
}

// ---------------------------------------------------------- direct close

/**
 * The model proposed a checkout. Deterministic from here: the commercial gate
 * (enabled, motion, approved link, value ceiling, contactability), then the
 * validator over the exact text that will be sent (words + the approved URL),
 * then the propose_checkout tool. Anything the gate refuses goes to a person
 * as READY_TO_BUY -- a lead who wants to buy is never left without an answer.
 */
async function proposeTheCheckout(input: ExecuteInput, decision: AgentDecision): Promise<TurnResult> {
  const { context, run } = input;
  const authority = context.commerce?.authority ?? DISABLED_AUTHORITY;
  const opportunity = await latestLeadOpportunity(context.business.businessId, context.lead.id);

  const gate = checkoutGate({
    authority,
    motionAllowsDirectClose: motionAllowsDirectClose(context.sales.motion),
    linkId: decision.checkout_link_id,
    opportunityValueMinor: opportunity?.outcome === "OPEN" ? toMinor(opportunity.value) : null,
    contactable: context.leadContext.contactable,
  });

  if (!gate.allowed) {
    // The assistant may not send this link (direct close off, the motion, an
    // unapproved link, the value ceiling). A colleague sends the details in
    // the background and the conversation stays with the assistant.
    await raiseAssist(input, "SEND_ORDER_DETAILS", `The lead looks ready to buy. ${gate.detail}`);
    return deliverAssistLine(input, "SEND_ORDER_DETAILS", decision);
  }

  // The direct-sale loop: the link carries this send's opaque tracking token
  // (payments/tracking.ts), added BEFORE composing so the validator checks the
  // exact text that goes out. Untracked when 0143 is not applied.
  const sendKey = `agent-checkout:${run.id}`;
  const link = await trackCheckoutLink({ sendKey, link: gate.link });

  const body = await composeValidated(input, decision, [], link);
  if (!body) {
    return handover(
      input,
      "READY_TO_BUY",
      "The lead looks ready to buy, but a safe checkout message could not be composed.",
      { trigger: "VALIDATOR_REJECTED" },
    );
  }

  const sent = await proposeCheckout(toolContext(input, decision.confidence), {
    body,
    sendKey,
    link,
    // Several interests: the checkout moves THAT offer's opportunity, on
    // THAT offer's motion (the context is already focused on it).
    serviceId: input.stats.qi?.interests?.primary.serviceId ?? null,
    motion: input.stats.qi?.interests ? input.context.sales.motion : null,
  });

  if (!sent.ok) {
    return handover(input, "TOOL_FAILURE", "The checkout link could not be sent.", { trigger: "PROVIDER_FAILURE" });
  }

  await closeRun(run, {
    status: "COMPLETED",
    outcome: "MESSAGE_SENT",
    intent: decision.intent,
    intentConfidence: decision.confidence,
    replyClassification: replyClassificationFor(decision.intent),
    lifecycleAfter: context.lifecycle,
    decision: {
      action: "PROPOSE_CHECKOUT",
      checkoutLinkId: gate.link.id,
      reasoningCode: decision.reasoning_code,
    },
  });

  return { outcome: "MESSAGE_SENT", runId: run.id, detail: "Checkout link sent." };
}

// ---------------------------------------------------- checkout nudge

/**
 * One abandoned-checkout reminder (payments/abandoned.ts). Re-reads the
 * attempt first: paid, expired, a different lead, an already-sent nudge or a
 * link no longer approved ends the turn with nothing sent. The model writes
 * the words with the nudge guidance; `composeValidated` checks them with the
 * same tracked link the lead already has (and only its approved price text).
 * A reminder that cannot be composed safely is skipped, not handed over: a
 * reminder is optional, and the lead has the link already.
 */
async function nudgeTheCheckout(
  input: ExecuteInput,
  nudge: { attemptId: string; nudge: number },
): Promise<TurnResult> {
  const { context, run } = input;
  const done = async (detail: string): Promise<TurnResult> => {
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "NO_ACTION",
      intent: "UNKNOWN",
      decision: { action: "CHECKOUT_NUDGE", attemptId: nudge.attemptId, nudge: nudge.nudge, skipped: detail },
    });
    return { outcome: "NO_ACTION", runId: run.id, detail };
  };

  const attempt = await loadAttemptForNudge(nudge.attemptId).catch(() => null);
  if (!attempt || attempt.business_id !== context.business.businessId || attempt.lead_id !== context.lead.id) {
    return done("The checkout attempt is gone.");
  }
  if (attempt.status === "PAID" || attempt.status === "EXPIRED") return done(`The checkout is ${attempt.status.toLowerCase()}.`);
  if (nudge.nudge <= attempt.nudges_sent) return done("That reminder was already sent.");

  const authority = context.commerce?.authority ?? DISABLED_AUTHORITY;
  const approved = authority.enabled
    ? authority.approved_checkout_links.find((candidate) => candidate.id === attempt.link_id)
    : undefined;
  if (!approved || !attempt.sent_url.startsWith("https://")) return done("The checkout link is no longer approved.");
  const link = { ...approved, tracked_url: attempt.sent_url };
  const settings = abandonedSettingsOf(authority);

  const guided: ExecuteInput = {
    ...input,
    guidance: [
      ...(input.guidance ?? []),
      ...nudgeGuidance({
        nudge: nudge.nudge,
        maxNudges: settings.max_nudges,
        product: approved.product,
        priceText: approved.price_text,
        hoursSinceSent: (Date.now() - new Date(attempt.sent_at).getTime()) / 3_600_000,
      }),
    ],
  };

  const proposal = await proposeDecision(guided, null);
  if (!proposal.decision?.message) {
    return done(proposal.skippedReason ? `No model call: ${proposal.skippedReason}.` : "No reminder was composed.");
  }

  const body = await composeValidated(guided, proposal.decision, [], link);
  if (!body) return done("No reminder passed the validator.");

  const sent = await sendMessage(toolContext(input, proposal.decision.confidence), {
    body: checkoutMessage(body, link),
    sendKey: checkoutNudgeSendKey(attempt.id, nudge.nudge),
    subject: `Your ${approved.product}`.slice(0, 150),
    // A reminder the lead did not ask for: marketing mail, with unsubscribe.
    messageClass: "MARKETING",
  });
  if (!sent.ok) return done("The reminder could not be queued.");

  logWriteError(
    await paymentsDb()
      .from("checkout_attempts")
      .update({ nudges_sent: nudge.nudge, last_nudged_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .lt("nudges_sent", nudge.nudge),
    "agent: record checkout nudge",
    { attemptId: attempt.id },
  );

  await closeRun(run, {
    status: "COMPLETED",
    outcome: "MESSAGE_SENT",
    intent: proposal.decision.intent,
    intentConfidence: proposal.decision.confidence,
    lifecycleAfter: context.lifecycle,
    decision: { action: "CHECKOUT_NUDGE", attemptId: attempt.id, nudge: nudge.nudge, checkoutLinkId: approved.id },
  });
  return { outcome: "MESSAGE_SENT", runId: run.id, detail: `Checkout reminder ${nudge.nudge} sent.` };
}

// ------------------------------------------------------------ quote path

type QuoteBranch = { result: TurnResult } | { guidance: string[] } | null;

/**
 * One quote move (quote-flow.ts decides it; tools.ts executes it through the
 * service registry). Returns a finished turn, extra guidance for the ordinary
 * turn, or null when the quote path has nothing to do.
 */
async function quoteTheLead(input: ExecuteInput, data: QuoteTurnData, legacyDiscountLine: string | null): Promise<QuoteBranch> {
  const { context, run } = input;
  const qi = input.stats.qi;
  const focusServiceId = qi?.interests?.primary.serviceId ?? null;
  const serviceId = focusServiceId ?? context.lead.service_id ?? null;
  const asksQuote = detectQuoteRequest(input.latestMessage);
  const sellableForService = data.items.filter((item) => item.active && !item.addOnOnly && item.serviceId === serviceId);
  const closeByQuote =
    !data.openQuote &&
    quoteIsTheClose({ pricingModel: data.pricingModel, itemsForService: sellableForService.length, nbaAction: qi?.mode === "LIVE" ? qi.nba.next_action : null });

  // ---- which items: named now, else the state's, else the offer's own
  // A path whose quote is no longer live (expired, declined, won, withdrawn)
  // is finished: a new ask starts a new request (and so a new quote).
  let state: QuotePathState = data.state.quoteId && !data.openQuote ? emptyQuotePathState() : data.state;
  if (!state.quoteId && !data.openQuote) {
    const named = matchCatalogueItems(input.latestMessage, data.items, { serviceId: asksQuote || closeByQuote ? serviceId : null });
    if (named.length > 0 && (asksQuote || state.itemIds.length === 0 || closeByQuote)) {
      state = { ...state, itemIds: [...new Set(named.map((item) => item.id))].slice(0, 10) };
    } else if (state.itemIds.length === 0 && closeByQuote && sellableForService.length === 1) {
      state = { ...state, itemIds: [sellableForService[0].id] };
    }
  }
  const items = state.itemIds
    .map((id) => data.items.find((item) => item.id === id))
    .filter((item): item is (typeof data.items)[number] => Boolean(item));
  const history = context.conversation.recentMessages.filter((m) => m.role === "lead").map((m) => m.body).join("\n");
  state = readQuoteInputs({ state, items, text: history, facts: data.facts, answering: null });
  state = readQuoteInputs({ state, items, text: input.latestMessage, facts: data.facts, answering: data.answering });
  if (items.length > 0 && !state.requestMessageId) state = { ...state, requestMessageId: input.event.eventId ?? run.id };

  const step = planQuoteStep({
    text: input.latestMessage,
    state,
    items,
    openQuote: data.openQuote,
    gate: data.access,
    focusServiceId,
    quoteIsTheClose: closeByQuote,
  });
  const remember = (next: QuotePathState, extra: Record<string, unknown> = {}) => {
    run.marks = { ...(run.marks ?? {}), quote: next, quoteStep: { kind: step.kind, ...extra } };
  };
  if (items.length > 0 || data.openQuote) remember(state);

  const firstName = context.lead.first_name ?? null;
  const figuresOf = (calc: QuoteCalculationView | null, validUntil: string | null) => (calc ? quoteFigures(calc, { validUntil }) : null);

  switch (step.kind) {
    case "NONE":
      if (items.length === 0 && !data.openQuote) delete run.marks?.quote;
      return null;
    case "NOT_PERMITTED":
      // The ordinary price handling carries on (a colleague confirms the price).
      remember(state, { reason: step.gate.reason });
      return null;
    case "DEFERRED":
      remember(state, { itemIds: step.itemIds });
      return { guidance: ["They also asked about pricing for another offer: say you will come back to that once this is sorted. No figure."] };

    case "COLLECT": {
      const asked = markAsked(state, step.input);
      run.marks = { ...(run.marks ?? {}), quote: asked, quoteAsk: step.input, quoteStep: { kind: "COLLECT", input: step.input.kind } };
      return deliverQuoteMessage(input, {
        lines: quoteStrategyLines(step, null),
        figures: null,
        message: { kind: "COLLECT", question: step.question },
        legacyDiscountLine,
        detail: `Asked for the ${step.input.kind.toLowerCase()} the quote needs.`,
      });
    }

    case "DRAFT": {
      const tools = toolContext(input, null);
      const key = agentQuoteRequestId(context.conversation.conversationId, state.requestMessageId ?? run.id);
      const priced = await calculateQuoteForLead(tools, { lines: step.lines, key: `${key}:calc` });
      if (!priced.ok || !priced.data.ok || !priced.data.calculation) {
        await raiseAssist(input, "CONFIRM_PRICE", "The assistant could not price this quote from the catalogue.");
        remember(state, { failed: priced.ok ? "CALCULATION" : priced.code });
        return { guidance: ["A colleague will confirm the price: say so in one short clause, never state a figure, then carry on."] };
      }
      const opportunityId = await openOpportunityFor(input, focusServiceId);
      if (!opportunityId) {
        await raiseAssist(input, "CONFIRM_PRICE", "The assistant priced a quote but the lead has no open opportunity to attach it to.");
        return { guidance: ["A colleague will confirm the price: say so in one short clause, never state a figure, then carry on."] };
      }
      const drafted = await draftQuote(tools, {
        opportunityId,
        lines: step.lines,
        requestId: key,
        afterObjection: data.priceObjectionSeen,
        priorAiConcessions: state.concessions,
        rationale: `Requested by the lead in conversation; lines from the catalogue items they named (${items.map((item) => item.name).join(", ")}).`,
      });
      if (!drafted.ok) {
        remember(state, { failed: drafted.code });
        if (drafted.code === "LEAD_HELD") return { guidance: ["A colleague is preparing their quote: say so in one short clause, no figure."] };
        await raiseAssist(input, "CONFIRM_PRICE", `The assistant could not draft the quote: ${drafted.detail}`);
        return { guidance: ["A colleague will confirm the price: say so in one short clause, never state a figure, then carry on."] };
      }
      const next: QuotePathState = { ...state, quoteId: drafted.data.quoteId };
      const revisionId = drafted.data.revisionId ?? "";
      return finishDraftedQuote(input, data, next, {
        quoteId: drafted.data.quoteId,
        revisionId,
        approvalRequired: drafted.data.approvalRequired,
        calculation: drafted.data.calculation ?? priced.data.calculation,
        validUntil: null,
        legacyDiscountLine,
        firstName,
      });
    }

    case "SEND": {
      const open = data.openQuote!;
      return finishDraftedQuote(input, data, { ...state, quoteId: open.id }, {
        quoteId: open.id,
        revisionId: open.revisionId ?? "",
        approvalRequired: false,
        calculation: open.calculation,
        validUntil: open.validUntil,
        legacyDiscountLine,
        firstName,
      });
    }

    case "ANSWER_FROM_QUOTE": {
      const open = data.openQuote!;
      const figures = figuresOf(open.calculation, open.validUntil);
      remember({ ...state, quoteId: open.id });
      return deliverQuoteMessage(input, {
        lines: quoteStrategyLines(step, figures),
        figures,
        message: { kind: "ANSWER_FROM_QUOTE" },
        legacyDiscountLine,
        detail: "Answered from the lead's quote.",
      });
    }

    case "AWAITING_APPROVAL": {
      remember({ ...state, quoteId: data.openQuote?.id ?? state.quoteId });
      return deliverQuoteMessage(input, {
        lines: quoteStrategyLines(step, null),
        figures: null,
        message: { kind: "AWAITING_APPROVAL" },
        legacyDiscountLine,
        detail: "Told the lead their quote is with a colleague.",
      });
    }

    case "NEXT_STEP": {
      const open = data.openQuote!;
      const permitted = aiMay(data.access.authority, open.status === "ACCEPTED" ? "request_signature" : "send_payment_link");
      const figures = figuresOf(open.calculation, open.validUntil);
      remember({ ...state, quoteId: open.id });
      return deliverQuoteMessage(input, {
        lines: permitted
          ? quoteStrategyLines(step, figures)
          : ["They have taken the next step on their quote. Thank them; a colleague will be in touch about what comes next. No figure, no link."],
        figures: permitted ? figures : null,
        message: { kind: "NEXT_STEP", status: open.status, permitted },
        legacyDiscountLine,
        detail: `The quote is ${open.status.toLowerCase()}.`,
      });
    }

    case "DISCOUNT":
      return discountTheQuote(input, data, state, step.requestedPercent, legacyDiscountLine);
  }
}

/** The lead's open opportunity for the turn's interest, created at QUALIFIED when there is none. */
async function openOpportunityFor(input: ExecuteInput, serviceId: string | null): Promise<string | null> {
  const { context } = input;
  const businessId = context.business.businessId;
  const query = createAdminClient()
    .from("opportunities")
    .select("id, service_id")
    .eq("business_id", businessId)
    .eq("lead_id", context.lead.id)
    .eq("outcome", "OPEN")
    .order("updated_at", { ascending: false })
    .limit(5);
  const { data } = await query;
  const rows = (data ?? []) as { id: string; service_id: string | null }[];
  const match = rows.find((row) => serviceId && row.service_id === serviceId) ?? rows[0];
  if (match) return match.id;
  const advanced = await advanceLeadOpportunitySafely({
    businessId,
    leadId: context.lead.id,
    event: "QUALIFIED",
    serviceId,
    motion: serviceId ? context.sales.motion : null,
  });
  return advanced.ok ? advanced.opportunityId : null;
}

/**
 * After a draft (or an approved quote): approval when the policy requires
 * it, a send when the workspace lets the assistant send, otherwise a person
 * sends it. The reply states figures only once the quote has gone out.
 */
async function finishDraftedQuote(
  input: ExecuteInput,
  data: QuoteTurnData,
  state: QuotePathState,
  quote: {
    quoteId: string;
    revisionId: string;
    approvalRequired: boolean;
    calculation: QuoteCalculationView | null;
    validUntil: string | null;
    legacyDiscountLine: string | null;
    firstName: string | null;
  },
): Promise<QuoteBranch> {
  const { run } = input;
  const tools = toolContext(input, null);
  let then: "SENT" | "APPROVAL" | "PERSON_SENDS";
  let validUntil = quote.validUntil;
  const extraUrls: string[] = [];
  let linkToAppend: string | null = null;

  if (quote.approvalRequired) {
    const requested = await requestQuoteApproval(tools, {
      quoteId: quote.quoteId,
      revisionId: quote.revisionId,
      note: "Drafted by the assistant from the lead's request; the workspace's policy needs a person to approve it.",
    });
    await raiseAssist(input, "QUOTE_REVIEW", requested.ok ? "The assistant drafted a quote that needs approval." : `The assistant drafted a quote; asking for approval failed (${requested.detail}).`);
    then = "APPROVAL";
  } else if (quoteToolGate("send_quote", data.access).allowed) {
    const sent = await sendQuoteToLead(tools, { quoteId: quote.quoteId, revisionId: quote.revisionId, hasEmail: data.leadHasEmail });
    if (sent.ok) {
      then = "SENT";
      validUntil = sent.data.validUntil;
      if (!sent.data.emailed) {
        // No email address: the reply carries the private link itself.
        linkToAppend = sent.data.publicUrl;
        extraUrls.push(sent.data.publicUrl);
      }
    } else {
      await raiseAssist(input, "QUOTE_REVIEW", `The assistant drafted a quote but could not send it (${sent.detail}).`);
      then = "PERSON_SENDS";
    }
  } else {
    await raiseAssist(input, "QUOTE_REVIEW", "The assistant drafted a quote for the lead; a person sends it.");
    then = "PERSON_SENDS";
  }

  run.marks = { ...(run.marks ?? {}), quote: state, quoteStep: { kind: "DRAFTED", then, quoteId: quote.quoteId } };
  const figures = then === "SENT" && quote.calculation ? quoteFigures(quote.calculation, { validUntil }) : null;
  const drafted = { kind: "DRAFTED" as const, then };
  return deliverQuoteMessage(input, {
    lines: quoteStrategyLines(drafted, figures),
    figures,
    message: drafted,
    legacyDiscountLine: quote.legacyDiscountLine,
    extraUrls,
    appendUrl: linkToAppend,
    detail: then === "SENT" ? "Quote sent." : then === "APPROVAL" ? "Quote drafted; waiting for approval." : "Quote drafted; a person sends it.",
  });
}

/**
 * A discount ask on a quote the lead has. The quote core decides (the
 * assistant's policy, the full calculation): ALLOW applies it and sends the
 * revision where permitted; REQUIRE_APPROVAL applies it for a person to
 * approve and tells the lead honestly it is being checked; DENY (or no
 * discount permission) holds the price with objection craft.
 */
async function discountTheQuote(
  input: ExecuteInput,
  data: QuoteTurnData,
  state: QuotePathState,
  requestedPercent: number | null,
  legacyDiscountLine: string | null,
): Promise<QuoteBranch> {
  const { run } = input;
  const open = data.openQuote!;
  const tools = toolContext(input, null);
  // The legacy two-step discount rule is replaced by the policy's own
  // (TWO_STEP_ESCALATION goes to approval, not to a hand-over).
  if (run.marks) delete run.marks.discountDemand;
  const current = open.calculation ? quoteFigures(open.calculation, { validUntil: open.validUntil }) : null;
  const hold = () =>
    deliverQuoteMessage(input, {
      lines: quoteStrategyLines({ kind: "DISCOUNT", quoteId: open.id, requestedPercent }, current, { concession: null }),
      figures: current,
      message: { kind: "DISCOUNT", outcome: "DENY", sent: false, bps: null },
      legacyDiscountLine,
      detail: "Held the price.",
    });

  if (!open.calculation || !open.revisionId || !quoteToolGate("propose_discount", data.access).allowed) {
    run.marks = { ...(run.marks ?? {}), quote: { ...state, quoteId: open.id }, quoteStep: { kind: "DISCOUNT", outcome: "DENY", reason: "NOT_PERMITTED" } };
    return hold();
  }
  const concession = planConcession({
    policy: data.aiPolicy,
    calculation: open.calculation,
    requestedPercent,
    afterObjection: data.priceObjectionSeen,
    priorAiConcessions: state.concessions,
  });
  run.marks = {
    ...(run.marks ?? {}),
    quote: { ...state, quoteId: open.id },
    quoteStep: { kind: "DISCOUNT", outcome: concession.decision.outcome, reason: concession.decision.reason, bps: concession.bps, countered: concession.countered },
  };
  if (concession.decision.outcome === "DENY") return hold();

  const applied = await proposeDiscount(tools, {
    quoteId: open.id,
    revisionId: open.revisionId,
    bps: concession.bps,
    afterObjection: data.priceObjectionSeen,
    priorAiConcessions: state.concessions,
    dryRun: false,
  });
  if (!applied.ok) return hold(); // POLICY_BLOCKED: the core's full check (margin) said no.

  const next: QuotePathState = { ...state, quoteId: open.id, concessions: state.concessions + 1 };
  const newRevision = applied.data.revisionId ?? open.revisionId;
  if (applied.data.approval.required) {
    await requestQuoteApproval(tools, { quoteId: open.id, revisionId: newRevision, note: `The lead asked for a better price; the assistant proposed ${concession.bps / 100}% off, which needs approval.` });
    await raiseAssist(input, "QUOTE_REVIEW", `The lead asked for a discount; ${concession.bps / 100}% off is waiting for approval.`);
    run.marks = { ...(run.marks ?? {}), quote: next, quoteStep: { kind: "DISCOUNT", outcome: "REQUIRE_APPROVAL", bps: concession.bps } };
    return deliverQuoteMessage(input, {
      lines: quoteStrategyLines({ kind: "DISCOUNT", quoteId: open.id, requestedPercent }, null, {
        concession: { ...concession, decision: { outcome: "REQUIRE_APPROVAL", role: "admin", reason: "APPROVAL_THRESHOLD", detail: "", discountBps: concession.bps, matchedRuleIds: [] } },
      }),
      figures: null,
      message: { kind: "DISCOUNT", outcome: "REQUIRE_APPROVAL", sent: false, bps: concession.bps },
      legacyDiscountLine,
      discountUnderReview: true,
      detail: "A discount is waiting for approval.",
    });
  }

  let sent = false;
  const extraUrls: string[] = [];
  let appendUrl: string | null = null;
  if (quoteToolGate("send_quote", data.access).allowed) {
    const delivered = await sendQuoteToLead(tools, { quoteId: open.id, revisionId: newRevision, hasEmail: data.leadHasEmail });
    sent = delivered.ok;
    if (delivered.ok && !delivered.data.emailed) {
      appendUrl = delivered.data.publicUrl;
      extraUrls.push(delivered.data.publicUrl);
    }
  }
  if (!sent) await raiseAssist(input, "QUOTE_REVIEW", `The assistant took ${concession.bps / 100}% off the quote; a person sends the revised quote.`);
  const figures = quoteFigures(applied.data.calculation, { validUntil: null });
  run.marks = { ...(run.marks ?? {}), quote: next, quoteStep: { kind: "DISCOUNT", outcome: "ALLOW", bps: concession.bps, sent } };
  return deliverQuoteMessage(input, {
    lines: quoteStrategyLines({ kind: "DISCOUNT", quoteId: open.id, requestedPercent }, figures, { concession }),
    figures,
    message: { kind: "DISCOUNT", outcome: "ALLOW", sent, bps: concession.bps },
    legacyDiscountLine,
    extraUrls,
    appendUrl,
    detail: sent ? "Discount applied and the revised quote sent." : "Discount applied; a person sends the revised quote.",
  });
}

/**
 * Composes the quote step's one message (the model words it from the quote
 * strategy block; its figures are the only ones the validator admits), falls
 * back to the deterministic wording when no draft passes, and sends it
 * through the ordinary send gate.
 */
async function deliverQuoteMessage(
  input: ExecuteInput,
  plan: {
    lines: string[];
    figures: QuoteFigures | null;
    message: QuoteMessageKind;
    legacyDiscountLine: string | null;
    detail: string;
    extraUrls?: string[];
    appendUrl?: string | null;
    discountUnderReview?: boolean;
  },
): Promise<QuoteBranch> {
  const { run, context } = input;
  const guidance = (input.guidance ?? []).filter((line) => line !== plan.legacyDiscountLine);
  const quoteInput: ExecuteInput = {
    ...input,
    strategy: { ...input.strategy, text: quoteStrategyBlock(plan.lines) },
    guidance,
    quote: { validation: validationFactsFor(plan.figures, { discountUnderReview: plan.discountUnderReview }), extraUrls: plan.extraUrls ?? [] },
    skipQuestionQa: true,
  };
  const withLink = (text: string) => (plan.appendUrl && !text.includes(plan.appendUrl) ? `${text.trim()} ${plan.appendUrl}` : text.trim());

  let body: string | null = null;
  const proposal = await proposeDecision(quoteInput, null);
  if (proposal.decision?.message) {
    const composed = await composeWithFacts(quoteInput, proposal.decision, [], null, validationFactsForTurn(quoteInput, [], null));
    if (composed) body = withLink(composed);
  }
  if (!body) {
    const fallback = withLink(quoteFallbackText(plan.message, plan.figures, context.lead.first_name ?? null));
    const check = validateResponse(fallback, validationFactsForTurn(quoteInput, [], null));
    if (!check.ok) {
      return {
        result: await handover(input, "OUT_OF_SCOPE", "A safe quote message could not be composed.", { trigger: "VALIDATOR_REJECTED" }),
      };
    }
    body = check.body;
  }

  const delivered = await deliverFixed(input, body, `agent:${run.id}`);
  await maybeRefreshSummary(context, run.id);
  await closeRun(run, {
    status: delivered.outcome === "FAILED" ? "FAILED" : "COMPLETED",
    outcome: delivered.outcome,
    intent: proposal.decision?.intent ?? input.heuristic?.intent ?? "UNKNOWN",
    intentConfidence: proposal.decision?.confidence,
    replyClassification: replyClassificationFor(proposal.decision?.intent ?? input.heuristic?.intent ?? "UNKNOWN"),
    lifecycleAfter: context.lifecycle,
    errorCode: delivered.errorCode,
    decision: { mode: input.mode, action: "QUOTE", detail: plan.detail },
  });
  return { result: { outcome: delivered.outcome, runId: run.id, detail: plan.detail } };
}

// ---------------------------------------------------------------- model

/**
 * One structured model call. `correction` is set only on the single retry
 * after a validation failure, and carries the validator's instructions -- not
 * the rejected text, so a bad draft cannot seed a worse one.
 */
type Proposal = {
  decision: AgentDecision | null;
  /** Why no call happened (budget, tokens, AI off); null when it did. */
  skippedReason: TaskSkippedReason | null;
};

/** Lifecycle states at which a lead is an opportunity for the budget manager. */
const OPPORTUNITY_LIFECYCLES = new Set(["QUALIFIED", "BOOKING_PENDING", "BOOKED", "WON"]);

/**
 * The spend stage for the budget manager (Phase 4): a qualified lead is an
 * opportunity (decision Q3 opens one at qualification), anything earlier in a
 * live conversation is engaged.
 */
function spendStage(context: AgentContext): SpendStage {
  return OPPORTUNITY_LIFECYCLES.has(context.lifecycle) ||
    context.lead.qualification_state === "QUALIFIED"
    ? "OPPORTUNITY"
    : "ENGAGED";
}

async function proposeDecision(
  input: ExecuteInput,
  correction: string | null,
  /** Real calendar slots the model may offer this turn (never invented). */
  confirmedSlots: string[] = [],
  pass: "first" | "retry" | "retry2" | "slots" | "assist" = correction ? "retry" : "first",
): Promise<Proposal> {
  const context = renderContextBlock(input.context, {
    latestMessage: input.latestMessage,
    confirmedSlots,
    correction: correction ?? undefined,
    strategy: [input.strategy.text, ...(input.guidance ?? [])].join("\n"),
  });
  input.stats.modelCalls += 1;

  const result = await runTask<AgentDecision>({
    taskType: "agent_decision",
    businessId: input.context.business.businessId,
    leadId: input.context.lead.id,
    conversationId: input.context.conversation.conversationId,
    // Offer card, voice and business rules: identical across this
    // workspace's turns, so it sits in the cacheable prefix.
    stableContext: renderStableBlock(input.context),
    context,
    maxOutputTokens: 400,
    // Keyed on the run so a retried job is charged once. The retry after a
    // validation failure is a genuinely second call and carries its own key.
    idempotencyKey: `agent:${input.run.id}:${pass}`,
    // Writes this call's tokens and cost onto the conversation_agent_runs row.
    agentRunId: input.run.id,
    // Phase 4 budget manager: an opportunity gets the opportunity ceiling.
    stage: spendStage(input.context),
  }).catch(() => null);

  const skippedReason = result?.skippedReason ?? null;
  if (!result?.data) return { decision: null, skippedReason };

  const parsed = agentDecisionSchema.safeParse(result.data);
  return { decision: parsed.success ? parsed.data : null, skippedReason };
}

/**
 * Composes the outbound text and runs it past the validator. Up to
 * MAX_VALIDATOR_REJECTIONS drafts (handover-policy.ts: three), each retry
 * carrying the validator's corrections; after the third rejection the caller
 * hands over -- the model cannot say this safely.
 */
async function composeValidated(
  input: ExecuteInput,
  decision: AgentDecision,
  confirmedSlots: string[],
  checkout: CheckoutLink | null = null,
): Promise<string | null> {
  const facts = validationFactsForTurn(input, confirmedSlots, checkout);
  return composeWithFacts(input, decision, confirmedSlots, checkout, facts);
}

/** Everything the validator checks a draft of this turn against. */
function validationFactsForTurn(input: ExecuteInput, confirmedSlots: string[], checkout: CheckoutLink | null): ValidationFacts {
  const authority = input.context.commerce?.authority ?? null;
  return {
    channel: input.channel,
    businessName: input.context.workspace.businessName,
    // A proposed checkout adds exactly its own approved price text, nothing more.
    publishedPriceText: [
      ...publishedPriceStrings(input.context),
      ...(checkout ? [checkout.price_text] : []),
    ],
    confirmedSlots,
    bookingConfirmed: false,
    // The checkout URL is allowed only on the turn that proposes it; a
    // quote's private link only on the turn that sends it.
    allowedUrls: [...allowedUrls(input.context), ...(checkout ? [checkout.url] : []), ...(input.quote?.extraUrls ?? [])],
    serviceAreaConfirmed: false,
    // Style lint: failures take the same one-retry -> handover path.
    forbiddenPhrases: input.context.offer.voice.forbiddenPhrases,
    prohibitedClaims: input.context.offer.voice.prohibitedClaims,
    // Direct close (Q2): discount ceiling and per-link price text.
    commercial: authority
      ? {
          enabled: authority.enabled,
          maxDiscountPercent: authority.max_discount_percent,
          checkoutLinks: authority.approved_checkout_links,
        }
      : null,
    // No word-for-word (or near) repeat of a question already sent on this
    // thread; only an engine-planned VERIFY of a stale fact may come close.
    priorOutbound: input.context.conversation.recentMessages
      .filter((message) => message.role === "business")
      .map((message) => message.body),
    verifyingStaleFact: verifiesStaleFact(input.stats.qi),
    // Human-style lint: the lead's name once at most (human-style.ts).
    leadFirstName: input.context.lead.first_name ?? null,
    // The quote in play: only its calculated figures may be stated
    // (quote-flow.ts quoteFigures; brief §7).
    quote: input.quote?.validation ?? null,
    // Commercial rules (0174): approved competitor points only, and nothing
    // outside the lead's agent's target.
    competitors: competitorRules(input.context.commercialRules?.competitors ?? []),
    offTargetNames: input.context.commercialRules?.offTargetNames ?? [],
  };
}

async function composeWithFacts(
  input: ExecuteInput,
  decision: AgentDecision,
  confirmedSlots: string[],
  checkout: CheckoutLink | null,
  facts: ValidationFacts,
): Promise<string | null> {
  // Pre-send question QA (design 08 §16): every draft of an engine-planned
  // turn is checked against the NBA and the fact state. LIVE: a rejection
  // takes the same retry -> handover path as any validator failure. SHADOW:
  // the draft is the legacy one; QA and the grade are recorded, never acted on.
  // A quote step owns its one question (quote-flow.ts), so QA does not apply.
  const qa = input.stats.qi && !input.skipQuestionQa ? qaContextFor(input, input.stats.qi) : null;
  if (qa && input.stats.qi?.mode === "LIVE") {
    facts.extraChecks = (body) => {
      const result = runQuestionQa(body, qa);
      input.stats.qaFindings.push(...result.findings.map((finding) => finding.code));
      return qaFailures(result);
    };
  }
  const record = (body: string) => {
    if (!qa) return;
    if (input.stats.qi?.mode === "SHADOW") {
      input.stats.qaFindings.push(...runQuestionQa(body, qa).findings.map((finding) => finding.code));
    }
    input.stats.questionGrade = gradeQuestion(body, qa)?.total ?? null;
  };

  // With a checkout, the text validated is the text sent: words + the URL.
  const render = (text: string) => (checkout ? checkoutMessage(text, checkout) : text);

  let draft = decision.message?.trim() ?? "";
  let rejections = 0;
  let fixTried = false;
  const passes = ["retry", "retry2"] as const;
  for (;;) {
    const check = validateResponse(render(draft), facts);
    if (check.ok) {
      record(draft);
      return checkout ? draft : check.body;
    }
    rejections += 1;
    // A draft failing only the human-style rules (an emoji, a dash, a stock
    // phrase) is regenerated once, then repaired deterministically and
    // re-validated: no third model call, never a hand-over (compose-policy.ts).
    const step = nextComposeStep({ codes: check.failures.map((failure) => failure.code), rejections, fixTried });
    if (step === "FIX") {
      fixTried = true;
      rejections -= 1;
      draft = fixHumanStyle(draft, { channel: input.channel, leadFirstName: facts.leadFirstName, priorOutbound: facts.priorOutbound });
      continue;
    }
    // Repaired, and only polish is left (a repeated opener, say): every claim
    // check passed, so it is sent rather than costing a call or a hand-over.
    if (step === "SEND_FIXED") {
      record(draft);
      return draft;
    }
    if (step === "HANDOVER" || policyOnCompose(rejections) === "HANDOVER") return null;
    const retry = await proposeDecision(input, correctionPrompt(check.failures), confirmedSlots, passes[rejections - 1] ?? "retry2");
    if (!retry.decision?.message) return null;
    draft = retry.decision.message.trim();
  }
}

// ----------------------------------------------------------- extractions

/**
 * Applies the model's candidate fields. Two rules, both enforced here rather
 * than trusted to the model: only a whitelisted field may be written, and only
 * a blank may be filled. Every candidate is logged either way.
 */
async function applyExtractions(
  input: ExecuteInput,
  decision: AgentDecision,
): Promise<void> {
  if (decision.extracted.length === 0) return;

  const records: ExtractionRecord[] = [];
  const update: Record<string, string> = {};

  for (const candidate of decision.extracted) {
    const field = candidate.field.trim().toLowerCase();

    if (!isExtractableField(field)) {
      records.push({
        leadId: input.context.lead.id,
        field,
        value: candidate.value,
        confidence: candidate.confidence,
        accepted: false,
        rejectedReason: "FIELD_NOT_EXTRACTABLE",
      });
      continue;
    }

    if (confidenceDecision(candidate.confidence) !== "ACT") {
      records.push({
        leadId: input.context.lead.id,
        field,
        value: candidate.value,
        confidence: candidate.confidence,
        accepted: false,
        rejectedReason: "BELOW_CONFIDENCE_FLOOR",
      });
      continue;
    }

    if (field === "service") {
      const match = input.context.workspace.services.find(
        (service) => service.name.toLowerCase() === candidate.value.trim().toLowerCase(),
      );
      if (!match) {
        records.push({
          leadId: input.context.lead.id,
          field,
          value: candidate.value,
          confidence: candidate.confidence,
          accepted: false,
          rejectedReason: "SERVICE_NOT_CONFIGURED",
        });
        continue;
      }
      update.service_id = match.id;
      records.push({
        leadId: input.context.lead.id,
        field,
        value: match.id,
        confidence: candidate.confidence,
        accepted: true,
      });
      continue;
    }

    update[field] = candidate.value.trim();
    records.push({
      leadId: input.context.lead.id,
      field,
      value: candidate.value,
      confidence: candidate.confidence,
      accepted: true,
    });
  }

  await recordExtractions(input.run, records);

  if (Object.keys(update).length > 0) {
    await updateLeadFields(toolContext(input, decision.confidence), update);
  }
}

// -------------------------------------------------------------- booking

/**
 * The slots this conversation was last offered. Read back from the run's own
 * decision record rather than re-querying the calendar, so a lead confirming
 * "3pm" is matched against the exact list they were shown.
 *
 * Offers go stale: after 24 hours the times are re-checked rather than booked
 * from memory, because the calendar has had a day to change underneath them.
 */
async function loadOfferedSlots(conversationId: string | null): Promise<{ slots: Slot[]; engineBookingReady: boolean }> {
  const none = { slots: [] as Slot[], engineBookingReady: false };
  if (!conversationId) return none;

  const admin = createAdminClient();
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("decision_json, created_at")
    .eq("conversation_id", conversationId)
    .eq("outcome", "BOOKING_OPTIONS_SENT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return none;
  if (Date.now() - Date.parse(data.created_at) > 24 * 60 * 60 * 1000) return none;

  const decision = (data.decision_json ?? {}) as { offeredSlots?: unknown; engineBookingReady?: unknown };
  if (!Array.isArray(decision.offeredSlots)) return none;

  const slots = decision.offeredSlots.filter(
    (slot): slot is Slot =>
      typeof slot === "object" &&
      slot !== null &&
      typeof (slot as Slot).startsAt === "string" &&
      typeof (slot as Slot).label === "string",
  );
  return { slots, engineBookingReady: decision.engineBookingReady === true };
}

/**
 * Acts on the time the lead just chose, then tells them -- in that order,
 * never the reverse. Every sentence here comes from `bookingReplyText`
 * (lib/bookings/confirmation.ts), never from the model, and which sentence is
 * sent depends on what actually happened (B10, brief §57, decision Q1):
 *
 *   * confirmed -- the provider accepted it: "that is booked for X".
 *   * pending   -- no calendar could confirm it: "I have requested X ... not
 *                  confirmed yet". The lead is not BOOKED.
 *   * calendar did not confirm -- same honest "requested" text, and the
 *                  conversation is handed to a person to confirm it.
 *   * slot taken -- fresh times from the calendar are offered instead.
 *   * Calendly  -- ClientTurn cannot book on Calendly; the lead is sent the
 *                  booking link to finish it, and the webhook records it.
 */
async function confirmBooking(
  input: ExecuteInput,
  decision: Confident,
  slot: Slot,
  offer: { engineBookingReady?: boolean } = {},
): Promise<TurnResult> {
  const { context, run } = input;

  // The slot came from a real calendar and was offered by this runtime, which
  // is precisely what `requiresConfirmedAvailability` asserts. The engine's
  // booking-readiness, recorded on the turn that offered the booking, stands
  // in for a QUALIFIED lifecycle (policy.ts; the lifecycle is re-read this
  // turn, so a lead disqualified, handed over or suppressed since is refused).
  const base = toolContext(input, decision.confidence);
  const tools = {
    ...base,
    facts: { ...base.facts, availabilityConfirmed: true, engineBookingReady: offer.engineBookingReady === true },
  };
  const firstName = context.leadContext.firstName;

  const booked = await createBooking(tools, {
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    slotLabel: slot.label,
    bufferMinutes: context.booking.bookingBufferMinutes,
    calendarIntegrationId: context.booking.meetingType?.calendarIntegrationId ?? null,
  });

  if (!booked.ok) {
    switch (bookingFailureRoute(booked.code)) {
      case "offer_alternatives":
        return offerAlternativeSlots(input, decision, slot);
      case "pending_handover":
        return requestedAndHandedOver(input, decision, slot, booked.detail);
      case "send_link":
        return sendLinkForSlot(input, decision, slot);
      default:
        // Already booked, or the write failed outright. Either way the lead
        // must not be told they are booked.
        return handover(
          input,
          booked.code === "BOOKING_ALREADY_EXISTS" ? "POLICY" : "TOOL_FAILURE",
          "The lead chose a time but the booking could not be completed.",
        );
    }
  }

  const confirmed = booked.data.outcome === "confirmed";
  // A meeting that closes through a person (ENTERPRISE, goal E) carries the
  // hand-off brief: the meeting is the hand-off, and the conversation stays
  // with the assistant until it (owner decision 2026-09-27).
  const brief = assistAfterBooking({
    motion: context.sales.motion,
    goal: input.stats.qi?.nba.current_goal ?? null,
  });
  if (brief) await raiseAssist(input, brief, `Meeting ${confirmed ? "booked" : "requested"} for ${slot.label}.`);
  const body = confirmed
    ? bookingReplyText({ kind: "confirmed", firstName, slotLabel: slot.label, invited: booked.data.invited })
    : bookingReplyText({ kind: "pending", firstName, slotLabel: slot.label });

  const sent = await sendMessage(tools, {
    body,
    sendKey: confirmed ? `agent-booked:${run.id}` : `agent-requested:${run.id}`,
  });

  await maybeRefreshSummary(context, run.id);

  await closeRun(run, {
    status: "COMPLETED",
    outcome: confirmed ? "BOOKING_CREATED" : sent.ok ? "MESSAGE_SENT" : "FAILED",
    intent: "BOOKING_REQUEST",
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: confirmed ? "BOOKED" : context.lifecycle,
    decision: {
      action: confirmed ? "CREATE_BOOKING" : "REQUEST_BOOKING",
      slot: slot.label,
      bookingId: booked.data.bookingId,
      bookingOutcome: booked.data.outcome,
      invited: booked.data.invited,
      confirmationSent: sent.ok,
    },
  });

  return confirmed
    ? { outcome: "BOOKING_CREATED", runId: run.id, detail: `Booked for ${slot.label}.` }
    : {
        outcome: sent.ok ? "MESSAGE_SENT" : "FAILED",
        runId: run.id,
        detail: `${slot.label} requested; awaiting the business's confirmation.`,
      };
}

/**
 * The chosen slot was taken between the offer and the booking. Fresh times
 * from the calendar are offered in its place -- recorded as a new
 * BOOKING_OPTIONS_SENT run so the lead's next reply is matched against them.
 */
async function offerAlternativeSlots(
  input: ExecuteInput,
  decision: Confident,
  taken: Slot,
): Promise<TurnResult> {
  const { context, run } = input;
  const tools = toolContext(input, decision.confidence);

  const availability = await getCalendarAvailability(tools, {
    date: null,
    dayPart: null,
    timezone: context.business.timezone,
    availability: {
      bookingMode: context.business.bookingMode,
      businessHours: context.booking.businessHours,
      appointmentDurationMinutes: context.booking.appointmentDurationMinutes,
      bookingBufferMinutes: context.booking.bookingBufferMinutes,
      calendarIntegrationId: context.booking.meetingType?.calendarIntegrationId ?? null,
    },
  });

  if (!availability.ok) {
    return handover(input, "PROVIDER_FAILURE", `${taken.label} was taken and fresh times could not be read.`);
  }

  const fresh = availability.data.slots.filter((slot) => slot.startsAt !== taken.startsAt);
  if (fresh.length === 0) return offerNothingAvailable(input, decision);

  const sent = await sendMessage(tools, {
    body: bookingReplyText({
      kind: "slot_taken",
      firstName: context.leadContext.firstName,
      slotLabel: taken.label,
      alternatives: fresh.map((slot) => slot.label),
    }),
    sendKey: `agent-slot-taken:${run.id}`,
  });

  await closeRun(run, {
    status: sent.ok ? "COMPLETED" : "FAILED",
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    intent: "BOOKING_REQUEST",
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: context.lifecycle,
    decision: { action: "SLOT_TAKEN", slot: taken.label, offeredSlots: fresh },
  });

  return {
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    runId: run.id,
    detail: `${taken.label} was taken; offered fresh times.`,
  };
}

/**
 * The calendar could not confirm the time. The request is held (`pending`)
 * and a person is asked to confirm it. The lead gets one honest message --
 * "requested, not confirmed yet" -- rather than a generic handover line, so
 * `requestHumanHandover` is called directly instead of via `handover()`.
 */
async function requestedAndHandedOver(
  input: ExecuteInput,
  decision: Confident,
  slot: Slot,
  detail: string,
): Promise<TurnResult> {
  const { context, run } = input;
  const tools = toolContext(input, decision.confidence);
  const unresolved = `The lead chose ${slot.label}; the calendar did not confirm it. ${detail}`.slice(0, 500);

  await requestHumanHandover(tools, {
    reason: "PROVIDER_FAILURE",
    summary: {
      intent: "BOOKING_REQUEST",
      service: context.leadContext.serviceName,
      qualificationStatus: context.lead.qualification_state,
      keyAnswers: context.qualification.answered.slice(0, 6),
      bookingIntent: true,
      unresolvedIssue: unresolved,
      sentiment: "neutral",
      summary: buildHandoverNarrative(context, unresolved),
    },
  });

  if (context.business.agent.mode === "AUTO_REPLY" && context.leadContext.contactable) {
    await sendMessage(tools, {
      body: bookingReplyText({
        kind: "pending",
        firstName: context.leadContext.firstName,
        slotLabel: slot.label,
      }),
      sendKey: `agent-requested:${run.id}`,
      // The takeover was set just above, so an `agent` message would be stopped
      // (stopped:human_takeover) and the lead would hear nothing after choosing
      // a time. This is the runtime's own fixed acknowledgement of that
      // takeover, which is exactly what `agent_handover` exempts (as in
      // handover()).
      origin: "agent_handover",
    });
  }

  await emitAutomationEvent({
    businessId: context.business.businessId,
    leadId: context.lead.id,
    eventType: "lead.human_takeover",
    payload: { reason: "PROVIDER_FAILURE" },
  });

  await closeRun(run, {
    status: "HANDED_OVER",
    outcome: "HANDOVER_CREATED",
    intent: "BOOKING_REQUEST",
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: "HANDED_OVER",
    decision: { action: "REQUEST_BOOKING", slot: slot.label, reason: "PROVIDER_FAILURE" },
  });

  return { outcome: "HANDOVER_CREATED", runId: run.id, detail: unresolved };
}

/**
 * Calendly: ClientTurn cannot create the booking, so the lead is sent the
 * configured booking link to finish it there. booking.sync records the
 * booking when Calendly's webhook arrives.
 */
async function sendLinkForSlot(
  input: ExecuteInput,
  decision: Confident,
  slot: Slot,
): Promise<TurnResult> {
  const { context, run } = input;
  if (!context.booking.bookingUrl) {
    return handover(input, "PROVIDER_FAILURE", `The lead chose ${slot.label}; no Calendly link is configured.`);
  }

  const tools = toolContext(input, decision.confidence);
  const sent = await sendBookingLink(tools, {
    body: bookingReplyText({
      kind: "calendly_link",
      firstName: context.leadContext.firstName,
      slotLabel: slot.label,
    }),
    sendKey: `agent-booking:${run.id}`,
  });

  await closeRun(run, {
    status: sent.ok ? "COMPLETED" : "FAILED",
    // Recorded as options sent (with no slots), so a repeat of the time does
    // not loop back into this branch.
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    intent: "BOOKING_REQUEST",
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: context.lifecycle,
    decision: { action: "SEND_BOOKING_LINK", slot: slot.label },
  });

  return {
    outcome: sent.ok ? "BOOKING_OPTIONS_SENT" : "FAILED",
    runId: run.id,
    detail: sent.ok ? "Calendly link sent for the chosen time." : "Could not send the booking link.",
  };
}

/**
 * The calendar answered honestly and had nothing free. Saying so beats
 * offering a link the lead has already worked past, and beats inventing a
 * time to fill the silence.
 */
async function offerNothingAvailable(
  input: ExecuteInput,
  decision: Confident,
): Promise<TurnResult> {
  // The calendar answered honestly and had nothing free: a colleague
  // arranges a time in the background and the conversation stays with the
  // assistant (was a hand-over).
  await raiseAssist(input, "ARRANGE_TIME", "No calendar availability inside the booking window.");
  return deliverAssistLine(input, "ARRANGE_TIME", decision);
}

// -------------------------------------------------------------- plumbing

/** What the booking steps read from a decision: its confidence only. */
type Confident = Pick<AgentDecision, "confidence">;

function toolContext(input: ExecuteInput, confidence: number | null): ToolContext {
  return {
    run: input.run,
    business: input.context.business,
    lead: input.context.lead,
    conversationId: input.context.conversation.conversationId,
    channel: input.channel,
    lifecycle: input.context.lifecycle,
    facts: {
      contactable: input.context.leadContext.contactable,
      availabilityConfirmed: false,
      optOutRecognised: false,
      bookingEnabled: Boolean(input.context.booking.bookingUrl),
    },
    confidence,
    // What the workspace lets the assistant do (commercial authority v2):
    // "Book meetings" binds the booking tools; the quote tools need the
    // turn's quote access (AI on, quote_ai_enabled) as well.
    ai: input.quoteAccess ?? {
      aiEnabled: input.context.business.aiAssistEnabled && input.context.business.agent.mode !== "OFF",
      quoteAiCapability: false,
      authority: aiAuthorityOf(input.context.commerce?.authority),
    },
  };
}

async function claimTurn(conversationId: string | null): Promise<number | null> {
  if (!conversationId) return 0;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_agent_turn", {
    target_conversation_id: conversationId,
    lock_seconds: AGENT_TURN_LOCK_SECONDS,
  });
  if (error) throw error;
  return typeof data === "number" ? data : null;
}

async function releaseTurn(conversationId: string | null, turnSeq: number): Promise<void> {
  if (!conversationId) return;
  const admin = createAdminClient();
  try {
    await admin.rpc("release_agent_turn", {
      target_conversation_id: conversationId,
      turn_seq: turnSeq,
    });
  } catch {
    // The lock expires on its own; failing to release it costs one stalled
    // turn, never a duplicate message.
  }
}

/** Exported for the tests: the ceiling is a constant, not a suggestion. */
export { MAX_AGENT_STEPS, createBooking };
