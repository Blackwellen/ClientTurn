import "server-only";

/**
 * The qualification engine inside one agent turn: the server half (design 08
 * Wave 2, CD-14, CD-15). The pure half is qi-turn.ts.
 *
 * `prepareQiTurn` runs after the legacy path has recorded any configured
 * answer, and:
 *
 *   1. reads the workspace's engine mode (OFF => null, nothing else runs);
 *   2. interprets the inbound reply (interpret.ts, deterministic first; the
 *      optional AI assist proposes INFERRED candidates only) and writes it
 *      back: facts to lead_qualification_facts and signals to
 *      lead_intent_signals, both with source_ref = the inbound message id;
 *   3. re-assesses the lead (A1's service: signals -> intent -> facts ->
 *      dimensions -> goal -> candidates) and decides the NBA, recording one
 *      lead_assessments row keyed on this turn (record_lead_assessment,
 *      idempotent on a retried job);
 *   4. applies a running QUESTION_STRATEGY experiment's wording to the planned
 *      question (LIVE only; the model rewords, never re-plans).
 *
 * Fail-safe: any error is logged and returns null, and the turn continues on
 * the legacy path. The engine can cost a turn its plan; it never costs the
 * lead their reply.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runTask } from "@/lib/ai/model-router";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import { estimateTokensForCall } from "@/lib/billing/tokens";
import { meetingTypeForLead } from "@/lib/bookings/meeting-type-store";
import {
  checkoutLinkForService,
  interestStrategyLines,
  interestTurnRecord,
  type Coordination,
  type InterestPlan,
  type InterestService,
} from "@/lib/qualification-intelligence/interests";
import {
  lastInterestFocus,
  enqueueReassessment,
  loadEngineMode,
  planLeadTurn,
  prepareLeadIntelligence,
  recordLeadAssessment,
  writeInterpretation,
} from "@/lib/qualification-intelligence/service";
import { checkoutGate, DISABLED_AUTHORITY, toMinor } from "@/lib/commercial/authority";
import { motionAllowsDirectClose } from "@/lib/opportunities/stages";
import { latestLeadOpportunity } from "@/lib/opportunities/service";
import { readLiveFacts } from "@/lib/qualification-intelligence/store-reads";
import { interpret, withIntentDelta, type AiCandidate } from "@/lib/qualification-intelligence/interpret";
import { deriveDimensionStatuses } from "@/lib/qualification-intelligence/facts";
import { gateDimensions } from "@/lib/qualification-intelligence/nba";
import { serviceTermsFor } from "@/lib/qualification-intelligence/question-intents";
import { inferDimension, type QuestionRecord } from "@/lib/qualification/next-question";
import {
  QI_DIMENSION_KEYS,
  nextBestActionSchema,
  type Interpretation,
  type NextBestAction,
  type QiDimensionKey,
} from "@/lib/qualification-intelligence/types";
import { armForLead, questionStrategyExperiment } from "@/lib/learning/experiments-service";
import { variantQuestion } from "@/lib/learning/experiments";
import { reengagementReasonOf } from "@/lib/reengagement/triggers";
import type { QualificationExtraction } from "@/lib/ai/schemas";
import type { PriorAsk } from "@/lib/qualification-intelligence/qa";
import type { ConversationStage } from "@/lib/sales-library/method-router";
import type { AgentContext } from "./context";
import { askedIntentFor, isReplyTrigger, withVerifiedAnswer, type InterestTurn, type LegacyDecision, type QiTurn } from "./qi-turn";
import type { AgentChannel, AgentEvent } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a reply with no deterministic fact is worth an AI assist call. */
const AI_ASSIST_MIN_CHARS = 20;

export async function prepareQiTurn(input: {
  context: AgentContext;
  event: AgentEvent;
  latestMessage: string | null;
  channel: AgentChannel;
  stage: ConversationStage;
  legacy: LegacyDecision;
  /** The deterministic engine's verdict this turn, when it ran. */
  engineVerdict: string | null;
}): Promise<QiTurn | null> {
  const { context, event } = input;
  const businessId = context.business.businessId;
  const leadId = context.lead.id;
  try {
    const mode = await loadEngineMode(businessId);
    if (mode === "OFF") return null;
    const now = new Date();

    // ---- 1. interpret the reply and write it back (CD-15) -------------------
    let interpretation: Interpretation | null = null;
    let interpretationTokens = 0;
    const messageId = event.eventId;
    if (input.latestMessage && isReplyTrigger(event.eventType) && UUID.test(messageId)) {
      const facts = await readLiveFacts(businessId, leadId);
      const dimensions = deriveDimensionStatuses(facts, now);
      const lastIntentKey = await lastPlannedIntentKey(businessId, context.conversation.conversationId);
      const current = context.qualification.currentQuestion;
      const aiAssistAllowed = context.business.aiAssistEnabled && context.business.aiSettings.allowAiInterpretation;
      const state = {
        messageId,
        now: event.occurredAt && Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : now.toISOString(),
        currentQuestion: current,
        currentQuestionDimension: current ? (inferDimension(current) as QiDimensionKey | null) : null,
        currentIntent: current ? null : askedIntentFor(lastIntentKey),
        dimensions,
        context: {
          serviceNames: context.workspace.services.map((service) => service.name),
          // The business type's own service vocabulary (MI-2): "year end
          // accounts and corporation tax" answers an accountant's "accounts,
          // tax, payroll or advisory?" before it is asked.
          serviceTerms: serviceTermsFor(context.sales.archetypeKey),
        },
        aiAssistAllowed,
      };
      interpretation = withVerifiedAnswer(interpret(input.latestMessage, state), input.latestMessage, state.currentIntent, facts);

      // The optional AI assist: one nano call, only when the rules found
      // nothing and the reply is long enough to hold a fact. Its candidates
      // are INFERRED at most and re-validated inside interpret() (CD-8).
      if (aiAssistAllowed && interpretation.facts.length === 0 && input.latestMessage.trim().length >= AI_ASSIST_MIN_CHARS) {
        const assisted = await aiCandidates(context, input.latestMessage, messageId);
        interpretationTokens = assisted.tokens;
        if (assisted.candidates.length > 0) {
          interpretation = withVerifiedAnswer(
            interpret(input.latestMessage, state, assisted.candidates),
            input.latestMessage,
            state.currentIntent,
            facts,
          );
        }
      }

      await writeInterpretation({
        businessId,
        leadId,
        serviceId: context.lead.service_id ?? null,
        interpretation,
        observedAt: state.now,
        // Several interests: record the services the reply names, and give its
        // per-offer facts to the interest it is about (08 §B.20).
        attribution: { text: input.latestMessage, focusServiceId: await lastInterestFocus(businessId, leadId).catch(() => null) },
      });
    }

    // ---- 2. re-assess and decide ---------------------------------------------
    const intel = await prepareLeadIntelligence(businessId, leadId, { mode, now });
    if (!intel) return null;
    const turn = {
      interpretation,
      bindingVerdict: null,
      channel: input.channel,
      // An objection is the one stage the turn knows better than the lead row.
      stage: input.stage === "OBJECTION" ? input.stage : null,
      checkoutAllowed: await checkoutAllowed(context),
      ...(intel.interests.length >= 2 ? await interestGates(context, intel.services.length) : {}),
      latestMessage: input.latestMessage,
      // A planned re-engagement check-in (reengage.trigger): the wait the
      // lead asked for is over, so the engine re-engages instead of waiting.
      checkInDue: event.eventType === "FOLLOW_UP_DUE" && reengagementReasonOf(event.payload) !== null,
      focusServiceId: intel.interests.length >= 2 ? await lastInterestFocus(businessId, leadId).catch(() => null) : null,
    };
    const qualificationScore = await currentScore(businessId, leadId);
    const planned = planLeadTurn(intel, qualificationScore, turn);
    const recorded = await recordLeadAssessment(intel, {
      ...turn,
      triggerEvent: `agent.turn:${event.idempotencyKey}`.slice(0, 200),
      qualificationScore,
      nba: planned.nba,
      interestPlans: planned.interests?.plans ?? null,
    });
    if (interpretation) {
      const before = (context.lead as { intent_score?: number | null }).intent_score ?? recorded.write.intent_score;
      interpretation = withIntentDelta(interpretation, before, recorded.write.intent_score);
    }

    // ---- 3. the question strategy experiment (LIVE only) -------------------
    let nba: NextBestAction = recorded.nba;
    let experiment: QiTurn["experiment"] = null;
    if (mode === "LIVE" && nba.question_intent) {
      const running = await questionStrategyExperiment(businessId, context.lead.service_id ?? null);
      if (running) {
        const arm = armForLead(running, leadId);
        const variant = variantQuestion(
          { id: running.id, holdoutPercent: running.holdout_percent, variants: running.variants },
          arm,
          nba.question_intent.key,
        );
        experiment = { id: running.id, arm, wordingFamily: variant?.wordingFamily ?? null };
        if (variant) {
          const next = nextBestActionSchema.safeParse({
            ...nba,
            question_intent: {
              ...nba.question_intent,
              wording_family: variant.wordingFamily.slice(0, 80),
              rendering: (variant.rendering ?? nba.question_intent.rendering).slice(0, 300),
            },
          });
          if (next.success) nba = next.data;
        }
      }
    }

    return {
      mode,
      nba,
      interpretation,
      dimensions: intel.dimensions,
      forbiddenIntents: intel.resolved.forbiddenIntents,
      recentOutbound: await recentAsks(businessId, context.conversation.conversationId, intel.dimensions),
      stage: intel.stage,
      interpretationTokens,
      customerType: intel.resolved.offer.customerType ?? "B2B",
      offerId: context.lead.service_id ?? null,
      questionPosition: intel.askHistory.reduce((sum, entry) => sum + entry.asked, 0) + 1,
      experiment,
      interests: planned.interests ? await interestTurn(businessId, context, planned.interests) : undefined,
      bookingGate: {
        gateDimensions: gateDimensions(planned.input),
        requiredDimensions: [
          ...new Set<QiDimensionKey>([...(planned.input.offer.requiredDimensions ?? []), ...(planned.input.policy.requiredDimensions ?? [])]),
        ],
      },
    };
  } catch (error) {
    console.error("[agent] qualification engine failed; continuing on the legacy path", {
      businessId,
      leadId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * The consequences of a zero-token NBA the orchestrator has already acted on
 * (stop follow-up happens there): a WAIT schedules the re-assessment at its
 * resume time, so the lead is picked up again rather than forgotten.
 */
export async function recordQiDisposition(input: { context: AgentContext; nba: NextBestAction }): Promise<void> {
  const { context, nba } = input;
  try {
    if (nba.next_action === "WAIT" && nba.resume_at) {
      const at = new Date(nba.resume_at);
      await enqueueReassessment(
        context.business.businessId,
        context.lead.id,
        `intent.resume:${context.lead.id}:${nba.resume_at.slice(0, 10)}`,
        at,
      );
    }
  } catch (error) {
    console.error("[agent] could not schedule the engine's resume", {
      leadId: context.lead.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ---------------------------------------------------------------- reads */

/** messages.features (0131) post-dates the generated types. */
type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The question intent the last engine-planned outbound message asked. */
async function lastPlannedIntentKey(businessId: string, conversationId: string | null): Promise<string | null> {
  if (!conversationId) return null;
  const { data } = await (createAdminClient() as unknown as Untyped)
    .from("messages")
    .select("features, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const key = (data?.features as { questionIntent?: unknown } | null)?.questionIntent;
  return typeof key === "string" ? key : null;
}

/** The last two outbound questions on this conversation, newest first (QA check 13). */
async function recentAsks(
  businessId: string,
  conversationId: string | null,
  dimensions: readonly { dimension: string; status: string }[],
): Promise<PriorAsk[]> {
  if (!conversationId) return [];
  const { data } = await (createAdminClient() as unknown as Untyped)
    .from("messages")
    .select("features, created_at")
    .eq("business_id", businessId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(2);
  const known = new Set(dimensions.filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED").map((d) => d.dimension));
  return ((data ?? []) as { features: unknown }[]).map((row) => {
    const dimension = (row.features as { dimension?: unknown } | null)?.dimension;
    const d = typeof dimension === "string" ? (dimension as PriorAsk["dimension"]) : null;
    return { dimension: d, answered: d ? known.has(d) : false };
  });
}

/**
 * The real direct-close gate at turn time (commercial_authority, the motion,
 * an approved link, the value ceiling, contactability): the same checks
 * proposeTheCheckout applies to the link the model later names. Without it a
 * PURCHASE_READY lead would escalate READY_TO_BUY even where a checkout is
 * authorised.
 */
async function checkoutAllowed(context: AgentContext): Promise<boolean> {
  const authority = context.commerce?.authority ?? DISABLED_AUTHORITY;
  const link = authority.approved_checkout_links[0];
  if (!authority.enabled || !link) return false;
  const opportunity = await latestLeadOpportunity(context.business.businessId, context.lead.id).catch(() => null);
  return checkoutGate({
    authority,
    motionAllowsDirectClose: motionAllowsDirectClose(context.sales.motion),
    linkId: link.id,
    opportunityValueMinor: opportunity?.outcome === "OPEN" ? toMinor(opportunity.value) : null,
    contactable: context.leadContext.contactable,
  }).allowed;
}

/**
 * The direct-close gate per offer, for a lead with several interests: the
 * same checkoutGate, with THAT offer's motion and its own approved link
 * (interests.ts checkoutLinkForService; a workspace with one service keeps
 * the first link).
 */
async function interestGates(context: AgentContext, serviceCount: number) {
  const authority = context.commerce?.authority ?? DISABLED_AUTHORITY;
  return {
    checkoutLinkFor: (service: InterestService) =>
      checkoutLinkForService(authority.approved_checkout_links, service)?.id ??
      (serviceCount <= 1 ? (authority.approved_checkout_links[0]?.id ?? null) : null),
    checkoutFor: (offer: { motion: string; linkId: string | null; valueGbp: number | null }) =>
      authority.enabled &&
      checkoutGate({
        authority,
        motionAllowsDirectClose: motionAllowsDirectClose(offer.motion),
        linkId: offer.linkId,
        opportunityValueMinor: toMinor(offer.valueGbp),
        contactable: context.leadContext.contactable,
      }).allowed,
  };
}

/** What the orchestrator needs from the coordinated plan (qi-turn.ts InterestTurn). */
async function interestTurn(
  businessId: string,
  context: AgentContext,
  interests: { plans: InterestPlan[]; coordination: Coordination },
): Promise<InterestTurn> {
  const { coordination, plans } = interests;
  const primary = coordination.primary;
  const meetingGoal = primary.goal.goal === "B_BOOK_MEETING" || primary.goal.goal === "E_HUMAN_CLOSER";
  const meeting =
    meetingGoal && primary.serviceId !== (context.lead.service_id ?? null) ? await meetingTypeForLead(businessId, primary.serviceId) : null;
  const companionPlan = coordination.companion ? plans.find((p) => p.serviceId === coordination.companion!.serviceId) : null;
  const q = coordination.companion?.question ?? null;
  return {
    primary: {
      serviceId: primary.serviceId,
      serviceName: primary.serviceName,
      goal: primary.goal.goal,
      motion: primary.motion,
      checkoutLinkId: primary.checkoutLinkId,
      meetingType: meeting ? { id: meeting.id, name: meeting.name, calendarIntegrationId: meeting.calendarIntegrationId } : null,
    },
    companion: coordination.companion
      ? {
          serviceId: coordination.companion.serviceId,
          kind: coordination.companion.kind,
          question: q ? { key: q.key, dimension: q.dimension, purpose: q.purpose, rendering: q.rendering } : null,
          dimensions: companionPlan?.dimensions ?? [],
        }
      : null,
    strategyLines: interestStrategyLines(coordination),
    record: interestTurnRecord(coordination, plans) as unknown as Record<string, unknown>,
  };
}

/** The lead's current score total (lead_scores.is_current); 0 when unscored. */
async function currentScore(businessId: string, leadId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("lead_scores")
    .select("total")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("is_current", true)
    .maybeSingle();
  return typeof data?.total === "number" ? data.total : 0;
}

/**
 * The AI assist's multi-dimension extraction (answer_extraction, nano). Only
 * candidates with a verbatim evidence span survive interpret(); anything the
 * model returns is data, never an instruction.
 */
async function aiCandidates(
  context: AgentContext,
  reply: string,
  messageId: string,
): Promise<{ candidates: AiCandidate[]; tokens: number }> {
  const dimensions = QI_DIMENSION_KEYS.join(", ");
  const block = `Question (text): none (multi-dimension extraction)\nDimensions: ${dimensions}\nReply: ${wrapUntrustedContent(reply)}`;
  const result = await runTask<QualificationExtraction>({
    taskType: "answer_extraction",
    businessId: context.business.businessId,
    leadId: context.lead.id,
    conversationId: context.conversation.conversationId,
    stage: "ENGAGED",
    context: block,
    maxOutputTokens: 200,
    correlationId: `interpret:${context.lead.id}:${messageId}`,
    agentRunId: null,
  }).catch(() => null);
  const tokens = result?.data ? estimateTokensForCall(200, block.length) : 0;
  const found = result?.data?.dimensions ?? [];
  return {
    candidates: found
      .filter((c) => typeof c.evidence_span === "string" && c.evidence_span.length > 0)
      .map((c) => ({ dimension: c.dimension, value: c.value, evidence_span: c.evidence_span, confidence: c.confidence })),
    tokens,
  };
}

/**
 * The non-agent path (message-inbound.ts, agent OFF for this channel): with
 * the engine on, the reply is still interpreted and written back (CD-15),
 * deterministically only (the legacy AI fallback already ran for the
 * configured question), and the lead is re-assessed by the lead.score job.
 * Fail-safe: never throws into the inbound handler.
 */
export async function interpretInboundReply(input: {
  businessId: string;
  leadId: string;
  serviceId: string | null;
  conversationId: string | null;
  messageId: string;
  body: string;
  receivedAt: string;
  currentQuestion: QuestionRecord | null;
}): Promise<void> {
  try {
    if (!UUID.test(input.messageId) || !input.body.trim()) return;
    const mode = await loadEngineMode(input.businessId);
    if (mode === "OFF") return;
    const now = Number.isFinite(Date.parse(input.receivedAt)) ? new Date(input.receivedAt).toISOString() : new Date().toISOString();
    const facts = await readLiveFacts(input.businessId, input.leadId);
    const lastIntentKey = input.currentQuestion ? null : await lastPlannedIntentKey(input.businessId, input.conversationId);
    const asked = input.currentQuestion ? null : askedIntentFor(lastIntentKey);
    const interpretation = withVerifiedAnswer(
      interpret(input.body, {
        messageId: input.messageId,
        now,
        currentQuestion: input.currentQuestion,
        currentQuestionDimension: input.currentQuestion ? (inferDimension(input.currentQuestion) as QiDimensionKey | null) : null,
        currentIntent: asked,
        dimensions: deriveDimensionStatuses(facts, now),
        aiAssistAllowed: false,
      }),
      input.body,
      asked,
      facts,
    );
    await writeInterpretation({
      businessId: input.businessId,
      leadId: input.leadId,
      serviceId: input.serviceId,
      interpretation,
      observedAt: now,
      attribution: { text: input.body, focusServiceId: await lastInterestFocus(input.businessId, input.leadId).catch(() => null) },
    });
    await enqueueReassessment(input.businessId, input.leadId, `reply:${input.messageId}`);
  } catch (error) {
    console.error("[inbound] qualification engine write-back failed", {
      businessId: input.businessId,
      leadId: input.leadId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
