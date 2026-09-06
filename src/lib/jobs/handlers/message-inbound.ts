import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { createStubProvider } from "@/lib/messaging/stub";
import { createTwilioProvider } from "@/lib/messaging/twilio";
import {
  isOptInKeyword,
  isOptOutKeyword,
  normalisePhone,
  type Channel,
  type InboundMessage,
  type MessagingProvider,
} from "@/lib/messaging/types";
import { normaliseEmail } from "@/lib/email/account";
import {
  conversationFor,
  flagForAttention,
  loadBusinessContext,
  loadLead,
  mergeValues,
  queueNotification,
  queueOutboundMessage,
  restyleMessage,
  stopAutomationRuns,
  type BusinessContext,
  type LeadRecord,
} from "./shared";
import {
  applyQualification,
  matchAnswer,
  matchAnswerWithAi,
  nextQuestion,
  questionPrompt,
  type QuestionRecord,
} from "./qualify";
import { parsePayload } from "./parse";
import { messageInboundPayload } from "./payloads";
import { emitAutomationEvent } from "@/lib/automation/events";
import { enqueueAgentTurn, inboundMessageEvent } from "@/lib/agent/events";
import { isOptOutPhrase } from "@/lib/agent/classification";

const HANDOVER_REPLY = "Thanks. A member of the team will pick this up.";

type StoredInbound = {
  kind?: string;
  form?: Record<string, string>;
  /** Set for provider "smtp": the already-parsed inbound email. */
  message?: InboundMessage;
};

function providerFor(name: string): MessagingProvider {
  if (name === "twilio") return createTwilioProvider();
  if (name === "stub") return createStubProvider();
  return getMessagingProvider();
}

async function resolveBusinessId(
  message: InboundMessage,
  hint: string | null,
): Promise<string | null> {
  if (hint) return hint;

  const admin = createAdminClient();
  const to = normalisePhone(message.to) ?? message.to;

  const { data: object } = await admin
    .from("integration_objects")
    .select("business_id")
    .eq("object_type", "phone_number")
    .eq("external_id", to)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (object) return object.business_id;

  // No mapped receiving number: fall back to the sender, but only when the
  // number belongs to exactly one workspace, so a reply is never misfiled.
  const from = normalisePhone(message.from) ?? message.from;
  const { data: leads } = await admin
    .from("leads")
    .select("business_id")
    .eq("phone_normalized", from)
    .limit(50);

  const businesses = new Set((leads ?? []).map((row) => row.business_id));
  return businesses.size === 1 ? [...businesses][0] : null;
}

async function resolveLead(
  businessId: string,
  message: InboundMessage,
): Promise<LeadRecord | null> {
  const admin = createAdminClient();

  const query = admin
    .from("leads")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (message.channel === "email") {
    const from = normaliseEmail(message.from);
    if (!from) return null;
    const { data } = await query.ilike("email", from).maybeSingle();
    return data ? loadLead(data.id) : null;
  }

  const from = normalisePhone(message.from) ?? message.from;
  const { data } = await query.eq("phone_normalized", from).maybeSingle();
  return data ? loadLead(data.id) : null;
}

async function recordOptOut(
  business: BusinessContext,
  lead: LeadRecord,
  contact: string,
) {
  const admin = createAdminClient();

  await admin
    .from("contact_suppressions")
    .upsert(
      {
        business_id: business.businessId,
        normalized_contact: contact,
        channel: "all",
        reason: "opt_out",
        source: "inbound_reply",
      },
      { onConflict: "business_id,normalized_contact,channel" },
    );

  await admin
    .from("leads")
    .update({
      opted_out: true,
      automation_active: false,
      needs_attention: false,
      attention_reason: null,
    })
    .eq("id", lead.id)
    .eq("business_id", business.businessId);

  await stopAutomationRuns(business.businessId, lead.id, "opted_out");

  await admin
    .from("campaign_contacts")
    .update({ state: "stopped", stopped_reason: "opted_out" })
    .eq("business_id", business.businessId)
    .eq("lead_id", lead.id)
    .in("state", ["pending", "scheduled"]);

  await emitAutomationEvent({
    businessId: business.businessId,
    leadId: lead.id,
    eventType: "lead.opted_out",
  });

  await queueNotification({
    businessId: business.businessId,
    type: "lead_attention",
    severity: "warning",
    title: "A lead opted out",
    body: `${contact} will not receive any further messages.`,
    entityType: "lead",
    entityId: lead.id,
    linkUrl: `/app/leads/${lead.id}`,
    dedupeKey: `opt_out:${lead.id}`,
  });
}

async function recordOptIn(
  business: BusinessContext,
  lead: LeadRecord,
  contact: string,
) {
  const admin = createAdminClient();
  await admin
    .from("contact_suppressions")
    .delete()
    .eq("business_id", business.businessId)
    .eq("normalized_contact", contact)
    .eq("reason", "opt_out");

  await admin
    .from("leads")
    .update({ opted_out: false })
    .eq("id", lead.id)
    .eq("business_id", business.businessId);
}

async function answeredQuestionIds(businessId: string, leadId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("qualification_answers")
    .select("question_id, answer_value")
    .eq("business_id", businessId)
    .eq("lead_id", leadId);
  return new Set(
    (data ?? [])
      .filter((row) => row.answer_value !== null)
      .map((row) => row.question_id),
  );
}

async function askNext(
  business: BusinessContext,
  lead: LeadRecord,
  channel: Channel,
  questions: QuestionRecord[],
  conversationId: string,
) {
  const answered = await answeredQuestionIds(business.businessId, lead.id);
  const question = nextQuestion(questions, answered, lead.service_id);

  if (!question) {
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: "awaiting_answers",
      title: "A conversation needs a person",
      body: "There is no next question configured for this lead.",
      takeover: true,
    });
    return;
  }

  const admin = createAdminClient();
  await admin
    .from("conversations")
    .update({ current_question_id: question.id })
    .eq("id", conversationId);

  const basePrompt = questionPrompt(question);
  // Numbered picks in matchAnswer() rely on option order/wording surviving
  // verbatim, so only a no-options question (text/number/postcode) is ever
  // eligible for AI restyling.
  const body =
    question.options.length === 0
      ? await restyleMessage(business, {
          leadId: lead.id,
          conversationId,
          baseMessage: basePrompt,
        })
      : basePrompt;

  await queueOutboundMessage({
    businessId: business.businessId,
    leadId: lead.id,
    channel,
    body,
    origin: "system",
    sendKey: `question:${lead.id}:${question.id}`,
  });
}

async function sendHandoverReply(
  business: BusinessContext,
  lead: LeadRecord,
  channel: Channel,
  reason: string,
) {
  const body = await restyleMessage(business, {
    leadId: lead.id,
    baseMessage: HANDOVER_REPLY,
  });

  await queueOutboundMessage({
    businessId: business.businessId,
    leadId: lead.id,
    channel,
    body,
    origin: "system",
    sendKey: `handover:${lead.id}:${reason}`,
  });
}

/**
 * Applies one inbound message. Idempotent: the unique index on
 * (provider, provider_message_id) makes a replay a no-op.
 */
export async function applyInboundMessage(
  message: InboundMessage,
  businessHint: string | null,
): Promise<"applied" | "duplicate" | "unmatched"> {
  const businessId = await resolveBusinessId(message, businessHint);
  if (!businessId) return "unmatched";

  const business = await loadBusinessContext(businessId);
  if (!business) return "unmatched";

  const lead = await resolveLead(businessId, message);
  if (!lead) return "unmatched";

  const admin = createAdminClient();
  const channel: Channel =
    message.channel === "whatsapp"
      ? "whatsapp"
      : message.channel === "email"
        ? "email"
        : "sms";
  const conversationId = await conversationFor(businessId, lead.id, channel);
  if (!conversationId) return "unmatched";

  const now = new Date().toISOString();

  // The stored row's id is the agent turn's idempotency key, so it is read
  // back here rather than discarded.
  const { data: storedMessage, error: insertError } = await admin
    .from("messages")
    .insert({
      business_id: businessId,
      conversation_id: conversationId,
      lead_id: lead.id,
      direction: "inbound",
      channel,
      body: message.body,
      status: "RECEIVED",
      origin: "system",
      provider: message.provider,
      provider_message_id: message.providerMessageId,
      received_at: message.receivedAt || now,
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") return "duplicate";
  if (insertError || !storedMessage) throw insertError ?? new Error("Inbound message not stored.");

  await admin
    .from("conversations")
    .update({ last_inbound_at: now, last_message_at: now })
    .eq("id", conversationId);

  const terminal = ["QUALIFIED", "BOOKED", "WON", "LOST"];
  await admin
    .from("leads")
    .update({
      first_replied_at: lead.first_replied_at ?? now,
      last_contact_at: now,
      status: terminal.includes(lead.status) ? lead.status : "RESPONDED",
    })
    .eq("id", lead.id)
    .eq("business_id", businessId);

  await recordUsage({
    businessId,
    metric: "message_received",
    source: `message:${message.providerMessageId}`,
    metadata: { channel },
  });

  await emitAutomationEvent({ businessId, leadId: lead.id, eventType: "lead.replied" });

  // A reply always ends the unattended sequence.
  await stopAutomationRuns(businessId, lead.id, "replied");
  await admin
    .from("campaign_contacts")
    .update({ state: "replied", replied_at: now })
    .eq("business_id", businessId)
    .eq("lead_id", lead.id)
    .in("state", ["pending", "scheduled", "sent", "delivered"]);

  const contact = normalisePhone(message.from) ?? message.from;

  // Two deterministic layers: the carrier keywords ("STOP", "UNSUBSCRIBE") and
  // the plain-English instructions that carry the same legal weight ("do not
  // message me", "take me off your list"). Neither consults a model, and both
  // apply whether or not the agent is enabled.
  if (isOptOutKeyword(message.body) || isOptOutPhrase(message.body)) {
    await recordOptOut(business, lead, contact);
    return "applied";
  }

  if (isOptInKeyword(message.body)) {
    await recordOptIn(business, lead, contact);
    return "applied";
  }

  if (lead.human_takeover) {
    await queueNotification({
      businessId,
      type: "handover",
      severity: "info",
      title: "New reply on a conversation you are handling",
      body: message.body.slice(0, 240),
      entityType: "lead",
      entityId: lead.id,
      linkUrl: `/app/leads/${lead.id}`,
    });
    await emitAutomationEvent({
      businessId,
      leadId: lead.id,
      eventType: "lead.human_takeover",
      payload: { reason: "reply_during_takeover" },
    });
    return "applied";
  }

  // ---- agent handover ---------------------------------------------------
  // When the workspace has the agent on for this channel, the turn is queued
  // and this handler stops here: the agent owns the reply decision, the
  // qualification write and the handover from this point on. The queue keeps
  // the model call off the webhook path entirely.
  //
  // With the agent OFF -- the default for every workspace -- the original
  // deterministic flow below runs unchanged.
  if (
    business.agent.mode !== "OFF" &&
    business.agent.channels.includes(channel)
  ) {
    const { data: campaignContact } = await admin
      .from("campaign_contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("lead_id", lead.id)
      .eq("state", "replied")
      .limit(1)
      .maybeSingle();

    await enqueueAgentTurn(
      inboundMessageEvent({
        businessId,
        leadId: lead.id,
        conversationId,
        channel,
        provider: message.provider,
        messageId: storedMessage.id,
        body: message.body,
        receivedAt: message.receivedAt || now,
        fromReactivation: Boolean(campaignContact),
      }),
    );
    return "applied";
  }

  const { data: conversation } = await admin
    .from("conversations")
    .select("current_question_id")
    .eq("id", conversationId)
    .maybeSingle();

  const current = await loadLead(lead.id);
  if (!current) return "applied";

  if (conversation?.current_question_id) {
    const { data: questionRow } = await admin
      .from("qualification_questions")
      .select("id, question_text, response_type, required, service_id, position")
      .eq("business_id", businessId)
      .eq("id", conversation.current_question_id)
      .maybeSingle();

    if (questionRow) {
      const { data: options } = await admin
        .from("qualification_options")
        .select("label, value, position")
        .eq("question_id", questionRow.id)
        .order("position", { ascending: true });

      const question: QuestionRecord = {
        id: questionRow.id,
        questionText: questionRow.question_text,
        responseType: questionRow.response_type as QuestionRecord["responseType"],
        required: questionRow.required,
        serviceId: questionRow.service_id,
        position: questionRow.position,
        options: (options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
        })),
      };

      let matched = matchAnswer(question, message.body);

      if (
        matched.value === null &&
        question.responseType !== "text" &&
        business.aiAssistEnabled &&
        business.aiSettings.allowAiInterpretation
      ) {
        const aiMatched = await matchAnswerWithAi(question, message.body, {
          businessId,
          leadId: current.id,
          conversationId,
        });
        if (aiMatched) matched = aiMatched;
      }

      await admin.from("qualification_answers").upsert(
        {
          business_id: businessId,
          lead_id: current.id,
          question_id: question.id,
          answer_value: matched.value,
          answer_text: matched.text,
          source: "reply",
          answered_at: now,
        },
        { onConflict: "lead_id,question_id" },
      );
    }
  }

  const refreshed = (await loadLead(current.id)) ?? current;
  const { output, questions } = await applyQualification(business, refreshed);

  if (output.result === "QUALIFIED") {
    await admin
      .from("conversations")
      .update({ current_question_id: null })
      .eq("id", conversationId);

    const values = await mergeValues(business, refreshed);

    if (business.bookingUrl) {
      await queueOutboundMessage({
        businessId,
        leadId: refreshed.id,
        channel,
        body: `Thanks ${values.first_name}. You can book a time that suits you here: ${business.bookingUrl}`,
        origin: "system",
        sendKey: `booking-link:${refreshed.id}`,
      });
    } else {
      await sendHandoverReply(business, refreshed, channel, "qualified");
      await flagForAttention({
        businessId,
        leadId: refreshed.id,
        reason: "qualified_handover",
        title: "A qualified lead is ready to book",
        body: "No booking link is configured, so this lead needs a call back.",
        takeover: true,
      });
    }

    await queueNotification({
      businessId,
      type: "handover",
      severity: "info",
      title: "A lead qualified",
      entityType: "lead",
      entityId: refreshed.id,
      linkUrl: `/app/leads/${refreshed.id}`,
      dedupeKey: `qualified:${refreshed.id}`,
    });
    return "applied";
  }

  if (output.result === "NOT_QUALIFIED") {
    await admin
      .from("conversations")
      .update({ current_question_id: null, state: "closed" })
      .eq("id", conversationId);
    await stopAutomationRuns(businessId, refreshed.id, "not_qualified");
    return "applied";
  }

  if (output.result === "REVIEW") {
    await sendHandoverReply(business, refreshed, channel, "review");
    await flagForAttention({
      businessId,
      leadId: refreshed.id,
      reason: "qualification_review",
      title: "A reply could not be matched",
      body: output.reasons.map((reason) => reason.detail).join(" "),
      takeover: true,
    });
    return "applied";
  }

  await askNext(business, refreshed, channel, questions, conversationId);
  return "applied";
}

/** Shared by the live webhook path and by `webhook.replay`. */
export async function processInboundWebhookEvent(
  webhookEventId: string,
): Promise<"processed" | "ignored" | "duplicate"> {
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("webhook_events")
    .select("id, provider, external_event_id, business_id, payload, status")
    .eq("id", webhookEventId)
    .maybeSingle();

  if (!event) {
    throw new PermanentJobError(`Webhook event ${webhookEventId} is gone.`);
  }
  if (event.status === "processed") return "duplicate";

  await admin
    .from("webhook_events")
    .update({ status: "processing" })
    .eq("id", event.id);

  const stored = (event.payload ?? {}) as StoredInbound;

  // Email arrives from the `email.poll` job, which has already parsed the
  // MIME message. There is no signed webhook body to re-parse, so the stored
  // payload is the message.
  const messages: InboundMessage[] =
    event.provider === "smtp"
      ? stored.message
        ? [stored.message]
        : []
      : await providerFor(event.provider).parseInbound(
          new URLSearchParams(stored.form ?? {}).toString(),
        );

  if (messages.length === 0) {
    await admin
      .from("webhook_events")
      .update({
        status: "ignored",
        last_error: "No inbound message in payload.",
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return "ignored";
  }

  let unmatched = 0;
  for (const message of messages) {
    const result = await applyInboundMessage(message, event.business_id);
    if (result === "unmatched") unmatched += 1;
  }

  await admin
    .from("webhook_events")
    .update({
      status: unmatched === messages.length ? "ignored" : "processed",
      last_error:
        unmatched > 0 ? "Could not match a lead for this number." : null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  return unmatched === messages.length ? "ignored" : "processed";
}

export async function handleMessageProcessInbound(job: ClaimedJob) {
  const payload = parsePayload(messageInboundPayload, job.payload);

  let eventId = payload.webhookEventId;

  if (!eventId && payload.externalEventId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("webhook_events")
      .select("id")
      .eq("provider", payload.provider)
      .eq("external_event_id", payload.externalEventId)
      .maybeSingle();
    eventId = data?.id;
  }

  if (!eventId) {
    throw new PermanentJobError("No webhook event to process.");
  }

  await processInboundWebhookEvent(eventId);
}
