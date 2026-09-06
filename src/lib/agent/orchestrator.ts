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
 * unavailable entirely, degrades the turn to a clarification or a handover --
 * never to silence, and never to a guess.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runTask } from "@/lib/ai/model-router";
import { applyQualification } from "@/lib/jobs/handlers/qualify";
import { loadLead, queueNotification } from "@/lib/jobs/handlers/shared";
import { emitAutomationEvent } from "@/lib/automation/events";
import {
  assembleContext,
  allowedUrls,
  publishedPriceStrings,
  renderContextBlock,
  type AgentContext,
} from "./context";
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
} from "./classification";
import { modeIsSilent, resolveMode } from "./lifecycle";
import { evaluateRunGate, evaluateSendGate } from "./policy";
import { correctionPrompt, validateResponse } from "./validate";
import {
  applySuppression,
  createBooking,
  draftMessage,
  getCalendarAvailability,
  recordQualificationAnswer,
  recordReplyClassification,
  requestHumanHandover,
  sendBookingLink,
  sendMessage,
  stopFollowUp,
  updateLeadFields,
  type HandoverSummary,
  type ToolContext,
} from "./tools";
import { maybeRefreshSummary } from "./summary";
import { matchOfferedSlot, type Slot } from "./availability/slots";
import {
  AGENT_TURN_LOCK_SECONDS,
  agentDecisionSchema,
  confidenceDecision,
  isExtractableField,
  MAX_AGENT_STEPS,
  replyClassificationFor,
  type AgentDecision,
  type AgentEvent,
  type AgentOutcome,
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
  const binding = latestMessage ? classifyDeterministic(latestMessage) : null;
  const heuristic = latestMessage ? classifyHeuristic(latestMessage) : null;
  const injection = latestMessage ? detectInjectionAttempt(latestMessage) : null;

  const provisionalIntent: LeadIntent =
    binding?.intent ?? heuristic?.intent ?? (event.eventType === "LEAD_CREATED" ? "SERVICE_ENQUIRY" : "UNKNOWN");

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

  try {
    return await executeTurn({
      event,
      context,
      run,
      mode,
      channel,
      latestMessage,
      binding,
      heuristic,
      injection,
    });
  } finally {
    await releaseTurn(context.conversation.conversationId, turnSeq);
  }
}

// --------------------------------------------------------------- the turn

type ExecuteInput = {
  event: AgentEvent;
  context: AgentContext;
  run: AgentRunHandle;
  mode: ReturnType<typeof resolveMode>;
  channel: "sms" | "whatsapp" | "email";
  latestMessage: string | null;
  binding: ReturnType<typeof classifyDeterministic>;
  heuristic: ReturnType<typeof classifyHeuristic>;
  injection: string | null;
};

async function executeTurn(input: ExecuteInput): Promise<TurnResult> {
  const { context, run, event } = input;

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

  if (modeIsSilent(input.mode)) {
    await closeRun(run, {
      status: "COMPLETED",
      outcome: "NO_ACTION",
      intent: input.heuristic?.intent ?? "UNKNOWN",
      decision: { mode: input.mode, reason: "MODE_IS_SILENT" },
    });
    return { outcome: "NO_ACTION", runId: run.id, detail: "Nothing to say in this mode." };
  }

  // ---- the model proposes ----------------------------------------------
  const decision = await proposeDecision(input, null);

  if (!decision) {
    // The model was unavailable or returned nothing usable. Fail safe:
    // a person, not a guess.
    return handover(input, "LOW_CONFIDENCE", "The assistant could not interpret this reply.");
  }

  // A binding verdict has already returned above, so the model's intent is
  // the only one still in play here.
  const intent = decision.intent;
  const verdict = confidenceDecision(decision.confidence);

  if (verdict === "HANDOVER") {
    return handover(input, "LOW_CONFIDENCE", "The reply was too unclear to answer safely.");
  }

  if (decision.proposed_action === "REQUEST_HANDOVER") {
    return handover(
      input,
      decision.handover_reason ?? "OUT_OF_SCOPE",
      "The assistant judged this needs a person.",
    );
  }

  // ---- accept extractions ----------------------------------------------
  await applyExtractions(input, decision);

  // ---- record the qualification answer ---------------------------------
  let qualificationChanged = false;
  if (
    input.latestMessage &&
    context.qualification.nextQuestion &&
    context.conversation.currentQuestionId === context.qualification.nextQuestion.id
  ) {
    const stored = await recordQualificationAnswer(tools, {
      question: context.qualification.nextQuestion,
      reply: input.latestMessage,
      value: input.latestMessage,
    });
    qualificationChanged = stored.ok;
  }

  let qualificationResult: string | null = null;
  if (qualificationChanged) {
    const refreshed = (await loadLead(context.lead.id)) ?? context.lead;
    const { output } = await applyQualification(context.business, refreshed);
    qualificationResult = output.result;

    // The engine, not the model, decides. A REVIEW result that the workspace
    // has configured for human review ends the turn here.
    if (output.result === "REVIEW" && context.business.agent.handoverOnReview) {
      return handover(input, "QUALIFICATION_REVIEW", "Qualification needs a person to review.");
    }
    if (output.result === "NOT_QUALIFIED") {
      await stopFollowUp(tools, { reason: "not_qualified" });
      await closeRun(run, {
        status: "COMPLETED",
        outcome: "QUALIFICATION_UPDATED",
        intent,
        intentConfidence: decision.confidence,
        replyClassification: replyClassificationFor(intent),
        qualificationAfter: output.result,
        decision: { reasoningCode: decision.reasoning_code, qualification: output.result },
      });
      return {
        outcome: "QUALIFICATION_UPDATED",
        runId: run.id,
        detail: "The lead did not meet the workspace's rules.",
      };
    }
  }

  // ---- is the lead confirming a time we already offered? ---------------
  // Checked before anything else booking-related, and decided by string
  // matching against slots this runtime offered on an earlier turn -- never by
  // asking the model which one it thinks they meant. That is what makes
  // arming create_booking safe at all.
  const offered = await loadOfferedSlots(context.conversation.conversationId);
  if (offered.length > 0 && input.latestMessage) {
    const chosen = matchOfferedSlot(input.latestMessage, offered);
    if (chosen) return confirmBooking(input, decision, chosen);
  }

  // ---- availability, if the model asked for it -------------------------
  let confirmedSlots: string[] = [];
  let offeredSlots: Slot[] = [];
  if (
    decision.proposed_action === "CHECK_AVAILABILITY" ||
    decision.proposed_action === "SEND_BOOKING_OPTIONS"
  ) {
    const availability = await getCalendarAvailability(tools, {
      date: null,
      dayPart: null,
      timezone: context.business.timezone,
      availability: {
        bookingMode: context.business.bookingMode,
        businessHours: context.booking.businessHours,
        appointmentDurationMinutes: context.booking.appointmentDurationMinutes,
        bookingBufferMinutes: context.booking.bookingBufferMinutes,
      },
    });
    if (availability.ok && availability.data.slots.length > 0) {
      // `labels` are the human strings the reply may quote. The raw slots are
      // objects, and letting them reach the validator would compare a message
      // against "[object Object]" and pass anything.
      confirmedSlots = availability.data.labels;
      offeredSlots = availability.data.slots;
    } else if (availability.ok) {
      // The calendar answered, and the answer was "nothing free". That is a
      // real fact and earns a real reply, not a fallback link.
      return offerNothingAvailable(input, decision);
    } else if (context.booking.bookingUrl) {
      // No live calendar, but a link exists: that is the configured booking
      // method for this workspace, so use it rather than stalling.
      return sendTheBookingLink(input, decision);
    } else {
      return handover(input, "PROVIDER_FAILURE", "Booking could not be arranged automatically.");
    }
  }

  // ---- compose and validate --------------------------------------------
  const composed = await composeValidated(input, decision, confirmedSlots);
  if (!composed) {
    return handover(input, "OUT_OF_SCOPE", "A safe reply could not be composed.");
  }

  // ---- decide how the message leaves -----------------------------------
  const sendGate = evaluateSendGate({
    agentMode: context.business.agent.mode,
    channel: input.channel,
    contactSuppressed: !context.leadContext.contactable,
    hasDestination: Boolean(context.leadContext.contactable),
    providerHealthy: true,
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
  if (
    context.conversation.conversationId &&
    (decision.proposed_action === "ASK_NEXT_QUESTION" ||
      decision.proposed_action === "ANSWER_AND_ASK") &&
    context.qualification.nextQuestion
  ) {
    const admin = createAdminClient();
    await admin
      .from("conversations")
      .update({ current_question_id: context.qualification.nextQuestion.id })
      .eq("id", context.conversation.conversationId)
      .eq("business_id", context.business.businessId);
  }

  await maybeRefreshSummary(context);

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
  if (context.business.agent.mode === "AUTO_REPLY" && context.leadContext.contactable) {
    await sendMessage(tools, {
      body: acknowledgementFor(reason),
      sendKey: `agent-handover:${run.id}`,
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
    decision: { reason, injectionAttempt: input.injection },
  });

  return { outcome: "HANDOVER_CREATED", runId: run.id, detail };
}

function acknowledgementFor(reason: HandoverReason): string {
  if (reason === "COMPLAINT") {
    return "I'm sorry you've had that experience. I'll pass this straight to the team so someone can look into it.";
  }
  if (reason === "EMERGENCY") {
    return "Thanks for letting us know — I'll get someone from the team onto this as a priority. If anyone is in danger, please call the emergency services first.";
  }
  if (reason === "HUMAN_REQUESTED") {
    return "Of course — I'll get someone from the team to pick this up.";
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

// ---------------------------------------------------------------- model

/**
 * One structured model call. `correction` is set only on the single retry
 * after a validation failure, and carries the validator's instructions -- not
 * the rejected text, so a bad draft cannot seed a worse one.
 */
async function proposeDecision(
  input: ExecuteInput,
  correction: string | null,
): Promise<AgentDecision | null> {
  const context = renderContextBlock(input.context, {
    latestMessage: input.latestMessage,
    confirmedSlots: [],
    correction: correction ?? undefined,
  });

  const result = await runTask<AgentDecision>({
    taskType: "agent_decision",
    businessId: input.context.business.businessId,
    leadId: input.context.lead.id,
    conversationId: input.context.conversation.conversationId,
    context,
    maxOutputTokens: 400,
  }).catch(() => null);

  if (!result?.data) return null;

  const parsed = agentDecisionSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

/**
 * Composes the outbound text and runs it past the validator. One retry, then
 * the caller hands over -- a second failure means the model cannot say this
 * safely, and repeating the attempt only burns budget.
 */
async function composeValidated(
  input: ExecuteInput,
  decision: AgentDecision,
  confirmedSlots: string[],
): Promise<string | null> {
  const facts = {
    channel: input.channel,
    businessName: input.context.workspace.businessName,
    publishedPriceText: publishedPriceStrings(input.context),
    confirmedSlots,
    bookingConfirmed: false,
    allowedUrls: allowedUrls(input.context),
    serviceAreaConfirmed: false,
  };

  const first = decision.message?.trim() ?? "";
  const firstCheck = validateResponse(first, facts);
  if (firstCheck.ok) return firstCheck.body;

  const retry = await proposeDecision(input, correctionPrompt(firstCheck.failures));
  if (!retry?.message) return null;

  const secondCheck = validateResponse(retry.message.trim(), facts);
  return secondCheck.ok ? secondCheck.body : null;
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
async function loadOfferedSlots(conversationId: string | null): Promise<Slot[]> {
  if (!conversationId) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("decision_json, created_at")
    .eq("conversation_id", conversationId)
    .eq("outcome", "BOOKING_OPTIONS_SENT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return [];
  if (Date.now() - Date.parse(data.created_at) > 24 * 60 * 60 * 1000) return [];

  const decision = (data.decision_json ?? {}) as { offeredSlots?: unknown };
  if (!Array.isArray(decision.offeredSlots)) return [];

  return decision.offeredSlots.filter(
    (slot): slot is Slot =>
      typeof slot === "object" &&
      slot !== null &&
      typeof (slot as Slot).startsAt === "string" &&
      typeof (slot as Slot).label === "string",
  );
}

/**
 * Creates the booking the lead just confirmed, then tells them -- in that
 * order, never the reverse. The confirmation sentence is composed
 * deterministically from the tool result, so the one line that must never be
 * wrong ("that is booked for X") is never a model output.
 */
async function confirmBooking(
  input: ExecuteInput,
  decision: AgentDecision,
  slot: Slot,
): Promise<TurnResult> {
  const { context, run } = input;

  // The slot came from a real calendar and was offered by this runtime, which
  // is precisely what `requiresConfirmedAvailability` asserts.
  const base = toolContext(input, decision.confidence);
  const tools = { ...base, facts: { ...base.facts, availabilityConfirmed: true } };

  const booked = await createBooking(tools, {
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    slotLabel: slot.label,
  });

  if (!booked.ok) {
    // Someone took the slot, or the insert failed. Either way the lead must
    // not be told they are booked.
    return handover(
      input,
      booked.code === "BOOKING_ALREADY_EXISTS" ? "POLICY" : "TOOL_FAILURE",
      "The lead chose a time but the booking could not be completed.",
    );
  }

  const name = context.leadContext.firstName;
  const body = name
    ? `Thanks ${name} — that is booked for ${slot.label}. We will send confirmation shortly.`
    : `That is booked for ${slot.label}. We will send confirmation shortly.`;

  const sent = await sendMessage(tools, { body, sendKey: `agent-booked:${run.id}` });

  await maybeRefreshSummary(context);

  await closeRun(run, {
    status: "COMPLETED",
    outcome: "BOOKING_CREATED",
    intent: "BOOKING_REQUEST",
    intentConfidence: decision.confidence,
    replyClassification: "BOOKING_INTENT",
    lifecycleAfter: "BOOKED",
    decision: {
      action: "CREATE_BOOKING",
      slot: slot.label,
      bookingId: booked.data.bookingId,
      confirmationSent: sent.ok,
    },
  });

  return { outcome: "BOOKING_CREATED", runId: run.id, detail: `Booked for ${slot.label}.` };
}

/**
 * The calendar answered honestly and had nothing free. Saying so beats
 * offering a link the lead has already worked past, and beats inventing a
 * time to fill the silence.
 */
async function offerNothingAvailable(
  input: ExecuteInput,
  decision: AgentDecision,
): Promise<TurnResult> {
  const tools = toolContext(input, decision.confidence);

  await sendMessage(tools, {
    body:
      "I could not find anything free in the next couple of weeks. " +
      "I will get someone from the team to sort a time with you.",
    sendKey: `agent-no-slots:${input.run.id}`,
  });

  return handover(input, "POLICY", "No calendar availability inside the booking window.");
}

// -------------------------------------------------------------- plumbing

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
