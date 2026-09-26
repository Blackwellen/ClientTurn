import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { recordUsage } from "@/lib/audit";
import {
  liftOptOutForChannel,
  suppress,
} from "@/lib/policy/suppression";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { createStubProvider } from "@/lib/messaging/stub";
import { createTwilioProvider } from "@/lib/messaging/twilio";
import {
  isOptInKeyword,
  isOptOutKeyword,
  optInChannelFor,
  optOutScope,
  isMetaChannel,
  normalisePhone,
  type Channel,
  type InboundMessage,
  type MessagingProvider,
} from "@/lib/messaging/types";
import { parseMetaInbound } from "@/lib/messaging/meta";
import { resolveMetaBusinessId, resolveSocialThread } from "@/lib/social/meta-inbound";
import { normaliseEmail } from "@/lib/email/account";
import { escapeIlike } from "@/lib/supabase/ilike";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
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
  loadAdaptiveSelection,
  loadQuestions,
  questionPrompt,
  recordInferredAnswers,
  type QuestionRecord,
} from "./qualify";
import { parsePayload } from "./parse";
import { messageInboundPayload } from "./payloads";
import { emitAutomationEvent } from "@/lib/automation/events";
import { enqueueAgentTurn, inboundMessageEvent } from "@/lib/agent/events";
import { isOptOutPhrase } from "@/lib/agent/classification";
import { handleCampaignReply } from "@/lib/outreach/campaigns/replies";
import {
  deterministicReplyClassification,
  interestForReplyClassification,
} from "@/lib/inbox/interest";
import type { MessageReplyClassification } from "@/lib/agent/types";

const HANDOVER_REPLY = "Thanks. A member of the team will pick this up.";

type StoredInbound = {
  kind?: string;
  form?: Record<string, string>;
  /** Set for provider "smtp": the already-parsed inbound email. */
  message?: InboundMessage;
  /** Set for provider "meta": the raw webhook entry, as delivered. */
  object?: string;
  entry?: unknown;
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

  // Meta addresses the recipient by Page or Instagram account id, which maps to
  // exactly one connected integration. There is no sender-based fallback for
  // social: a page-scoped id means nothing outside the Page that issued it, so
  // there is nothing to fall back *to*.
  if (isMetaChannel(message.channel)) {
    return resolveMetaBusinessId(message);
  }

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
    const { data } = await query.ilike("email", escapeIlike(from)).maybeSingle();
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
  scope: "ALL" | "SMS" | "WHATSAPP",
) {
  const admin = createAdminClient();

  // On the one list every send path reads (0069), at the scope the person
  // asked for (optOutScope in lib/messaging/types): a carrier STOP keyword on
  // SMS or WhatsApp is about that channel, which is how the carrier itself
  // treats it and what START later re-permits; "stop contacting me", or STOP
  // anywhere else, is about everything.
  await suppress({
    businessId: business.businessId,
    channel: scope,
    reason: "OPT_OUT",
    source: "INBOUND_REPLY",
    phone: contact.includes("@") ? null : contact,
    email: contact.includes("@") ? contact : null,
  });

  // `leads.opted_out` is derived from the list (0123): the suppression above
  // sets it for an all-channel opt-out and leaves it alone for a channel one.
  // Follow-up stops either way -- a STOP ends the unattended sequence -- and a
  // failure throws so the job retries. Every write here is idempotent, and a
  // retry resumes past the stored message (see `resume` in
  // `applyInboundMessage`).
  assertWrite(
    await admin
      .from("leads")
      .update({
        automation_active: false,
        needs_attention: false,
        attention_reason: null,
      })
      .eq("id", lead.id)
      .eq("business_id", business.businessId),
    "opt-out: lead update",
    { businessId: business.businessId, leadId: lead.id },
  );

  await stopAutomationRuns(business.businessId, lead.id, "opted_out");

  assertWrite(
    await admin
      .from("campaign_contacts")
      .update({ state: "stopped", stopped_reason: "opted_out" })
      .eq("business_id", business.businessId)
      .eq("lead_id", lead.id)
      .in("state", ["pending", "scheduled"]),
    "opt-out: campaign contacts stop",
    { businessId: business.businessId, leadId: lead.id },
  );

  await emitAutomationEvent({
    businessId: business.businessId,
    leadId: lead.id,
    eventType: "lead.opted_out",
    payload: { scope },
  });

  await queueNotification({
    businessId: business.businessId,
    type: "lead_attention",
    severity: "warning",
    title: "A lead opted out",
    body:
      scope === "ALL"
        ? `${contact} will not receive any further messages.`
        : `${contact} will not receive any further ${scope === "SMS" ? "text" : "WhatsApp"} messages.`,
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
  channel: "SMS" | "WHATSAPP",
) {
  // The recipient reversing their own decision on the channel they texted
  // from, which is the one case where lifting an OPT_OUT is right —
  // `unsuppress()` refuses it precisely because a *workspace* may not do this.
  // Only that channel's OPT_OUT goes (0111): a manual block, a bounce, an
  // invalid number and every other channel's opt-out all stand. The lead's
  // `opted_out` flag follows by itself (0123 derives it from the list), so it
  // is not written here -- writing it is what used to leave START a no-op.
  await liftOptOutForChannel(business.businessId, channel, {
    phone: contact,
    email: lead.email,
  });
}

async function askNext(
  business: BusinessContext,
  lead: LeadRecord,
  channel: Channel,
  questions: QuestionRecord[],
  conversationId: string,
) {
  // Adaptive: the most useful unknown question, never one the lead's details
  // or an earlier answer already settle (lib/qualification/next-question.ts).
  const selection = await loadAdaptiveSelection({
    businessId: business.businessId,
    lead,
    questions,
  });
  const question = selection.question;

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
  // Written before the question is sent: a question whose id was not recorded
  // cannot have its answer matched to it.
  assertWrite(
    await admin
      .from("conversations")
      .update({ current_question_id: question.id })
      .eq("id", conversationId),
    "qualification: set current question",
    { businessId: business.businessId, leadId: lead.id, conversationId },
  );

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
/**
 * An inbound message from someone who is a prospect, not yet a lead.
 *
 * This is the other half of cold outreach: without it a campaign would keep
 * sending to people who have already replied, and an "unsubscribe me" from a
 * stranger would land nowhere. It deliberately does NOT run lead
 * qualification or an agent turn — a cold prospect has no follow-up
 * automation to advance, and `handleCampaignReply` decides what their reply
 * means and what it does.
 */
async function applyProspectReply(
  message: InboundMessage,
  businessId: string,
): Promise<"applied" | "duplicate" | "unmatched"> {
  // Cold outreach is email-first, so a prospect thread only exists on email.
  if (message.channel !== "email") return "unmatched";

  const from = normaliseEmail(message.from);
  if (!from) return "unmatched";

  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, campaign_id, conversation_id")
    .eq("business_id", businessId)
    .ilike("email", escapeIlike(from))
    .is("promoted_to_lead_id", null)
    .order("last_contacted_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!prospect) return "unmatched";

  const now = new Date().toISOString();

  // Reuse the thread the outbound steps were sent on, so promotion carries the
  // whole exchange across rather than starting a second conversation.
  let conversationId = prospect.conversation_id;
  if (!conversationId) {
    const createdResult = await admin
      .from("conversations")
      .insert({
        business_id: businessId,
        prospect_id: prospect.id,
        channel: "multi",
        subject: "Reply",
      })
      .select("id")
      .single();
    // A failed insert used to fall through to "unmatched", discarding the
    // prospect's reply (and any opt-out in it). Nothing has been stored yet,
    // so throwing lets the queue retry from a clean start.
    assertWrite(createdResult, "prospect reply: create conversation", {
      businessId,
      prospectId: prospect.id,
    });
    conversationId = createdResult.data?.id ?? null;
    if (conversationId) {
      logWriteError(
        await admin
          .from("prospects")
          .update({ conversation_id: conversationId })
          .eq("business_id", businessId)
          .eq("id", prospect.id),
        "prospect reply: link conversation",
        { businessId, prospectId: prospect.id, conversationId },
      );
    }
  }

  if (!conversationId) return "unmatched";

  const { data: storedMessage, error: insertError } = await admin
    .from("messages")
    .insert({
      business_id: businessId,
      conversation_id: conversationId,
      prospect_id: prospect.id,
      campaign_id: prospect.campaign_id,
      direction: "inbound",
      channel: "email",
      body: message.body,
      status: "RECEIVED",
      origin: "outreach",
      provider: message.provider,
      provider_message_id: message.providerMessageId,
      received_at: message.receivedAt || now,
    })
    .select("id")
    .single();

  // The unique index on the provider message id is what makes a re-polled
  // mail a no-op rather than a second reply.
  if (insertError?.code === "23505") return "duplicate";
  if (insertError || !storedMessage) {
    throw insertError ?? new Error("Inbound prospect message not stored.");
  }

  logWriteError(
    await admin
      .from("conversations")
      .update({ last_inbound_at: now, last_message_at: now })
      .eq("id", conversationId),
    "prospect reply: conversation timestamps",
    { businessId, prospectId: prospect.id, conversationId },
  );

  // The same deterministic classifier handleCampaignReply uses, so the thread's
  // verdict and the message's classification agree.
  await recordReplyInterest(
    businessId,
    conversationId,
    deterministicReplyClassification(message.body),
    { prospectId: prospect.id },
  );

  // A prospect with no campaign still gets their reply recorded, but there is
  // no sequence to stop and no campaign rule to apply.
  if (!prospect.campaign_id) return "applied";

  await handleCampaignReply({
    businessId,
    campaignId: prospect.campaign_id,
    prospectId: prospect.id,
    messageId: storedMessage.id,
    body: message.body,
  });

  return "applied";
}

/**
 * Carries a reply's classification onto its thread as `conversations.interest`,
 * which the inbox's "Interested" view filters on. Display state: a failure is
 * logged, never thrown, so it cannot hold up an opt-out or the reply itself.
 */
async function recordReplyInterest(
  businessId: string,
  conversationId: string,
  classification: MessageReplyClassification,
  context: Record<string, unknown>,
) {
  const interest = interestForReplyClassification(classification);
  if (!interest) return;
  logWriteError(
    await createAdminClient()
      .from("conversations")
      .update({ interest })
      .eq("business_id", businessId)
      .eq("id", conversationId),
    "inbound: conversation interest",
    { businessId, conversationId, ...context },
  );
}

/**
 * Whether a reply-sourced answer was recorded for this lead at or after `since`
 * — i.e. a previous attempt at this message (or a later message) already
 * recorded its answer.
 */
async function replyAnsweredSince(businessId: string, leadId: string, since: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("qualification_answers")
    .select("question_id")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("source", "reply")
    .gte("answered_at", since)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function applyInboundMessage(
  message: InboundMessage,
  businessHint: string | null,
  options: { resume?: boolean } = {},
): Promise<"applied" | "duplicate" | "unmatched"> {
  const businessId = await resolveBusinessId(message, businessHint);
  if (!businessId) return "unmatched";

  const business = await loadBusinessContext(businessId);
  if (!business) return "unmatched";

  // On a social channel the thread is the identity, and a first message from
  // somebody unknown creates the lead rather than being discarded: opening a
  // conversation with a business is asking to be answered, which is the same
  // act as submitting a lead form. A comment or a like is not, and those go
  // through `engagement-ingest` to a human instead.
  const socialThread = isMetaChannel(message.channel)
    ? await resolveSocialThread(message, businessId)
    : null;

  const lead = socialThread
    ? await loadLead(socialThread.leadId)
    : await resolveLead(businessId, message);

  // No lead, but possibly a cold prospect mid-campaign. Their reply has to be
  // acted on — it stops the sequence, and an opt-out in it has to suppress —
  // so it is handled here rather than discarded as unmatched.
  if (!lead) {
    return applyProspectReply(message, businessId);
  }

  const admin = createAdminClient();

  // The channel the message actually arrived on. This used to collapse
  // everything that was not WhatsApp or email into 'sms', which was harmless
  // while those were the only inbound transports and is not any more: a
  // Messenger reply filed as 'sms' would be answered by SMS, to a phone number
  // belonging to a different person or to nobody.
  const channel: Channel = message.channel;

  // A social thread is found by its platform address, not by (lead, channel):
  // the same lead can hold a Messenger thread and an Instagram one, and
  // `conversationFor` would return whichever it found first.
  const conversationId = socialThread
    ? socialThread.conversationId
    : await conversationFor(businessId, lead.id, channel);

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

  // `resume` is a retry of a webhook event whose previous attempt stored this
  // message and then failed part-way (a write below throws rather than being
  // silently lost). Returning "duplicate" there would make the retry a no-op
  // and drop the opt-out or qualification write that failed, so the retry
  // carries on from the stored row instead. Every step below is idempotent:
  // updates set fixed values, outbound messages carry send keys, the agent turn
  // is keyed by the message id and notifications by dedupe keys.
  // The one step that is not naturally idempotent is recording the reply as the
  // answer to the conversation's *current* question: if the previous attempt
  // recorded it and moved on to the next question, re-recording would file it
  // against the wrong one. `resumedReceivedAt` guards that below.
  let storedMessageId: string;
  let resumedReceivedAt: string | null = null;
  if (insertError?.code === "23505") {
    if (!options.resume) return "duplicate";
    const { data: existing, error: existingError } = await admin
      .from("messages")
      .select("id, received_at")
      .eq("business_id", businessId)
      .eq("provider", message.provider)
      .eq("provider_message_id", message.providerMessageId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return "duplicate";
    storedMessageId = existing.id;
    resumedReceivedAt = existing.received_at ?? message.receivedAt ?? now;
  } else if (insertError || !storedMessage) {
    throw insertError ?? new Error("Inbound message not stored.");
  } else {
    storedMessageId = storedMessage.id;
  }

  // Placed after the duplicate check, so a re-polled or replayed provider event
  // does not deliver the same reply twice. The stored message id is the event
  // id for the same reason.
  await emitWebhookEvent({
    businessId,
    type: "message.received",
    eventId: storedMessageId,
    data: {
      message_id: storedMessageId,
      lead_id: lead.id,
      conversation_id: conversationId,
      channel,
      body: message.body,
      received_at: message.receivedAt || now,
    },
  });

  // Timestamps and the RESPONDED status are display state; a failure is
  // logged rather than thrown so it cannot hold up the opt-out check below.
  logWriteError(
    await admin
      .from("conversations")
      .update({ last_inbound_at: now, last_message_at: now })
      .eq("id", conversationId),
    "inbound: conversation timestamps",
    { businessId, leadId: lead.id, conversationId },
  );

  const terminal = ["QUALIFIED", "BOOKED", "WON", "LOST"];
  logWriteError(
    await admin
      .from("leads")
      .update({
        first_replied_at: lead.first_replied_at ?? now,
        last_contact_at: now,
        status: terminal.includes(lead.status) ? lead.status : "RESPONDED",
      })
      .eq("id", lead.id)
      .eq("business_id", businessId),
    "inbound: lead reply status",
    { businessId, leadId: lead.id },
  );

  await recordUsage({
    businessId,
    metric: "message_received",
    source: `message:${message.providerMessageId}`,
    // Keyed by the stored message so a resumed retry is not counted twice.
    operationId: `message_received:${storedMessageId}`,
    metadata: { channel },
  });

  await emitAutomationEvent({ businessId, leadId: lead.id, eventType: "lead.replied" });

  // A reply always ends the unattended sequence.
  await stopAutomationRuns(businessId, lead.id, "replied");
  // A contact left "scheduled" after replying would be sent the next
  // reactivation step, so this failure matters. It is asserted only after the
  // opt-out check, though: an opt-out must never wait on it.
  const repliedContacts = await admin
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
    await recordOptOut(
      business,
      lead,
      contact,
      optOutScope(channel, message.body),
    );
    await recordReplyInterest(businessId, conversationId, "UNSUBSCRIBE", { leadId: lead.id });
    return "applied";
  }

  assertWrite(repliedContacts, "inbound: mark campaign contacts replied", {
    businessId,
    leadId: lead.id,
  });

  // START is honoured only where it is a carrier keyword. On email or a DM it
  // falls through and is handled as an ordinary reply.
  const optInChannel = optInChannelFor(channel);
  if (optInChannel && isOptInKeyword(message.body)) {
    await recordOptIn(business, lead, contact, optInChannel);
    return "applied";
  }

  // Deterministic, so the Interested view works with the assistant off (the
  // default). With it on, its own record_reply_classification refines this.
  await recordReplyInterest(
    businessId,
    conversationId,
    deterministicReplyClassification(message.body),
    { leadId: lead.id },
  );

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
      dedupeKey: `takeover_reply:${storedMessageId}`,
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
        messageId: storedMessageId,
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

  const answerAlreadyRecorded = resumedReceivedAt
    ? await replyAnsweredSince(businessId, current.id, resumedReceivedAt)
    : false;

  if (conversation?.current_question_id && !answerAlreadyRecorded) {
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

      assertWrite(
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
        ),
        "qualification: record reply answer",
        { businessId, leadId: current.id, questionId: question.id },
      );
    }
  }

  const refreshed = (await loadLead(current.id)) ?? current;

  // Answers the lead's own details already give (a postcode on the form, the
  // service they picked) are recorded as inferred answers before the engine
  // runs, so it judges them like any other answer and they are never asked.
  const inferredSelection = await loadAdaptiveSelection({
    businessId,
    lead: refreshed,
    questions: await loadQuestions(businessId),
  });
  await recordInferredAnswers(businessId, refreshed.id, inferredSelection.inferred);

  const { output, questions } = await applyQualification(business, refreshed);

  if (output.result === "QUALIFIED") {
    // A current question left set would match the next reply against it and
    // overwrite a recorded answer.
    assertWrite(
      await admin
        .from("conversations")
        .update({ current_question_id: null })
        .eq("id", conversationId),
      "qualification: clear current question",
      { businessId, leadId: refreshed.id, conversationId },
    );

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
    assertWrite(
      await admin
        .from("conversations")
        .update({ current_question_id: null, state: "closed" })
        .eq("id", conversationId),
      "qualification: close not-qualified conversation",
      { businessId, leadId: refreshed.id, conversationId },
    );
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

  // Still "processing" when read means a previous attempt started and did not
  // finish (it threw), so this run resumes past messages it already stored.
  const resume = event.status === "processing";

  logWriteError(
    await admin
      .from("webhook_events")
      .update({ status: "processing" })
      .eq("id", event.id),
    "inbound webhook: mark processing",
    { businessId: event.business_id, webhookEventId: event.id },
  );

  const stored = (event.payload ?? {}) as StoredInbound;

  // Email arrives from the `email.poll` job, which has already parsed the
  // MIME message. There is no signed webhook body to re-parse, so the stored
  // payload is the message.
  // Three shapes, because three providers deliver differently. Email arrives
  // from the `email.poll` job, which has already parsed the MIME message, so
  // there is no signed body to re-parse. Meta posts JSON. Twilio posts a form.
  // Handing Meta's JSON to the form parser would silently yield no messages,
  // which is the failure mode where a webhook looks healthy and never delivers.
  const messages: InboundMessage[] =
    event.provider === "smtp"
      ? stored.message
        ? [stored.message]
        : []
      : event.provider === "meta"
        ? // `webhook_events.payload` stores one entry per row (see the route
          // handler's comment on why), but `parseMetaInbound` expects Meta's
          // original envelope shape, where `entry` is always an array.
          parseMetaInbound(
            JSON.stringify({
              object: stored.object,
              entry: stored.entry ? [stored.entry] : [],
            }),
          )
        : await providerFor(event.provider).parseInbound(
            new URLSearchParams(stored.form ?? {}).toString(),
          );

  if (messages.length === 0) {
    logWriteError(
      await admin
        .from("webhook_events")
        .update({
          status: "ignored",
          last_error: "No inbound message in payload.",
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id),
      "inbound webhook: mark ignored",
      { businessId: event.business_id, webhookEventId: event.id },
    );
    return "ignored";
  }

  let unmatched = 0;
  for (const message of messages) {
    const result = await applyInboundMessage(message, event.business_id, { resume });
    if (result === "unmatched") unmatched += 1;
  }

  logWriteError(
    await admin
      .from("webhook_events")
      .update({
        status: unmatched === messages.length ? "ignored" : "processed",
        last_error:
          unmatched > 0 ? "Could not match a lead for this number." : null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id),
    "inbound webhook: mark processed",
    { businessId: event.business_id, webhookEventId: event.id },
  );

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
