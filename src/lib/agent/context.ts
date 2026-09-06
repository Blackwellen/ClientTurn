import "server-only";

/**
 * The context assembler.
 *
 * Loads exactly what one turn needs and nothing more, always scoped to a
 * single business_id that the caller supplies from a trusted source. The model
 * never names a workspace, a lead or a conversation -- every identifier in
 * here arrives from the event envelope, which the runtime built from a
 * verified provider fact.
 *
 * Token discipline is deliberate: recent messages are capped, older history is
 * represented by the rolling summary, and only the *next* unresolved
 * qualification question is included rather than the whole question set.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import {
  loadBusinessContext,
  loadLead,
  leadContact,
  isSuppressed,
  type BusinessContext,
  type LeadRecord,
} from "@/lib/jobs/handlers/shared";
import { loadQuestions, nextQuestion, type QuestionRecord } from "@/lib/jobs/handlers/qualify";
import { resolveLifecycle } from "./lifecycle";
import {
  VERBATIM_MESSAGE_WINDOW,
  type AgentChannel,
  type ConversationOwner,
  type LifecycleState,
} from "./types";

// ------------------------------------------------------------------ shapes

export type ServiceFact = {
  id: string;
  name: string;
  description: string | null;
  pricingVisibility: "INTERNAL_ONLY" | "PUBLIC_FIXED" | "PUBLIC_FROM" | "QUOTE_REQUIRED";
  /** Only ever populated for PUBLIC_FIXED / PUBLIC_FROM. */
  publicPriceText: string | null;
};

export type WorkspaceContext = {
  businessId: string;
  businessName: string;
  phone: string | null;
  timezone: string;
  services: ServiceFact[];
  /** Postcode prefixes the workspace has configured, if any. */
  allowedPostcodePrefixes: string[];
  blockedPostcodePrefixes: string[];
  quietHoursLabel: string | null;
  bookingMode: string;
  bookingUrl: string | null;
  tone: "professional" | "friendly" | "direct";
  replyLength: "short" | "normal";
  businessDescription: string | null;
  handoverInstruction: string | null;
  answerServiceQuestions: boolean;
};

export type LeadContext = {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  serviceId: string | null;
  serviceName: string | null;
  status: string;
  qualificationState: string;
  optedOut: boolean;
  humanTakeover: boolean;
  contactable: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

export type ConversationTurn = {
  id: string;
  role: "lead" | "business";
  body: string;
  at: string;
};

export type ConversationContext = {
  conversationId: string | null;
  channel: AgentChannel;
  owner: ConversationOwner;
  recentMessages: ConversationTurn[];
  /** Compressed narrative of everything before `recentMessages`. */
  summary: string | null;
  totalMessages: number;
  currentQuestionId: string | null;
};

export type QualificationContext = {
  nextQuestion: QuestionRecord | null;
  answered: { question: string; value: string }[];
  outstanding: number;
};

export type BookingContext = {
  /** calendly | google_calendar | handover */
  mode: string;
  bookingUrl: string | null;
  /** A live (scheduled) booking, if the lead already has one. */
  liveBooking: { id: string; startsAt: string | null; status: string } | null;
  /**
   * Whether the runtime can query real availability. No provider integration
   * exposes free/busy yet, so this is false everywhere today and the booking
   * flow correctly falls back to the configured link or to a person, rather
   * than to an invented time.
   */
  availabilityQueryable: boolean;
};

export type AgentContext = {
  business: BusinessContext;
  workspace: WorkspaceContext;
  lead: LeadRecord;
  leadContext: LeadContext;
  conversation: ConversationContext;
  qualification: QualificationContext;
  booking: BookingContext;
  lifecycle: LifecycleState;
};

// ----------------------------------------------------------------- loaders

function quietHoursLabel(business: BusinessContext): string | null {
  if (!business.quietHours.enabled) return null;
  return `${business.quietHours.start}-${business.quietHours.end} ${business.timezone}`;
}

async function loadServices(businessId: string): Promise<ServiceFact[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("services")
    .select("id, name, description, pricing_visibility, public_price_text")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("position", { ascending: true });

  return (data ?? []).map((row) => {
    const visibility = (row.pricing_visibility ??
      "QUOTE_REQUIRED") as ServiceFact["pricingVisibility"];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      pricingVisibility: visibility,
      // `average_value` is deliberately not read here. It is internal
      // commercial data and must never travel into a prompt.
      publicPriceText:
        visibility === "PUBLIC_FIXED" || visibility === "PUBLIC_FROM"
          ? (row.public_price_text ?? null)
          : null,
    };
  });
}

async function loadConversation(
  businessId: string,
  conversationId: string | null,
  channel: AgentChannel,
): Promise<ConversationContext> {
  const admin = createAdminClient();

  if (!conversationId) {
    return {
      conversationId: null,
      channel,
      owner: "AI_ACTIVE",
      recentMessages: [],
      summary: null,
      totalMessages: 0,
      currentQuestionId: null,
    };
  }

  const [conversation, messages, summary, count] = await Promise.all([
    admin
      .from("conversations")
      .select("id, owner, current_question_id, channel")
      .eq("id", conversationId)
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("messages")
      .select("id, direction, body, created_at, status")
      .eq("conversation_id", conversationId)
      .eq("business_id", businessId)
      // Drafts and discarded candidates are not part of the conversation as
      // the lead experienced it, so they never become model context.
      .in("status", ["QUEUED", "SENT", "DELIVERED", "RECEIVED"])
      .order("created_at", { ascending: false })
      .limit(VERBATIM_MESSAGE_WINDOW),
    admin
      .from("conversation_summaries")
      .select("summary_json, message_count")
      .eq("conversation_id", conversationId)
      .maybeSingle(),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("business_id", businessId),
  ]);

  const summaryJson = (summary.data?.summary_json ?? null) as
    | { conciseNarrative?: string }
    | null;

  return {
    conversationId,
    channel: (conversation.data?.channel as AgentChannel) ?? channel,
    owner: (conversation.data?.owner as ConversationOwner) ?? "AI_ACTIVE",
    recentMessages: (messages.data ?? [])
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.direction === "inbound" ? ("lead" as const) : ("business" as const),
        body: row.body,
        at: row.created_at,
      })),
    summary: summaryJson?.conciseNarrative ?? null,
    totalMessages: count.count ?? 0,
    currentQuestionId: conversation.data?.current_question_id ?? null,
  };
}

async function loadQualification(
  businessId: string,
  lead: LeadRecord,
): Promise<QualificationContext> {
  const admin = createAdminClient();
  const [questions, answers] = await Promise.all([
    loadQuestions(businessId),
    admin
      .from("qualification_answers")
      .select("question_id, answer_value, answer_text")
      .eq("business_id", businessId)
      .eq("lead_id", lead.id),
  ]);

  const answeredIds = new Set(
    (answers.data ?? [])
      .filter((row) => row.answer_value !== null)
      .map((row) => row.question_id),
  );

  const byId = new Map(questions.map((question) => [question.id, question]));
  const applicable = questions.filter(
    (question) => question.serviceId === null || question.serviceId === lead.service_id,
  );

  return {
    nextQuestion: nextQuestion(questions, answeredIds, lead.service_id),
    answered: (answers.data ?? [])
      .filter((row) => row.answer_value !== null)
      .map((row) => ({
        question: byId.get(row.question_id)?.questionText ?? row.question_id,
        value: row.answer_value as string,
      })),
    outstanding: applicable.filter((question) => !answeredIds.has(question.id)).length,
  };
}

async function loadBooking(
  business: BusinessContext,
  leadId: string,
): Promise<BookingContext> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select("id, starts_at, status")
    .eq("business_id", business.businessId)
    .eq("lead_id", leadId)
    .eq("status", "scheduled")
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    mode: business.bookingMode,
    bookingUrl: business.bookingUrl,
    liveBooking: data ? { id: data.id, startsAt: data.starts_at, status: data.status } : null,
    // No provider currently exposes free/busy to this codebase. Stated as a
    // fact rather than assumed, so the composer can never be handed a slot
    // list that did not come from a real calendar.
    availabilityQueryable: false,
  };
}

/**
 * Assembles everything one turn needs. Returns null when the lead or the
 * workspace has gone -- a deleted lead is a no-op, not an error.
 */
export async function assembleContext(input: {
  businessId: string;
  leadId: string;
  conversationId: string | null;
  channel: AgentChannel;
}): Promise<AgentContext | null> {
  const [business, lead] = await Promise.all([
    loadBusinessContext(input.businessId),
    loadLead(input.leadId),
  ]);

  if (!business || !lead || lead.business_id !== input.businessId) return null;

  const [services, conversation, qualification, booking] = await Promise.all([
    loadServices(input.businessId),
    loadConversation(input.businessId, input.conversationId, input.channel),
    loadQualification(input.businessId, lead),
    loadBooking(business, lead.id),
  ]);

  const serviceName = services.find((service) => service.id === lead.service_id)?.name ?? null;
  const contact = leadContact(lead, input.channel);
  const contactable = contact
    ? !lead.opted_out && !(await isSuppressed(input.businessId, contact, input.channel))
    : false;

  const admin = createAdminClient();
  const { data: conversationTimes } = input.conversationId
    ? await admin
        .from("conversations")
        .select("last_inbound_at, last_outbound_at")
        .eq("id", input.conversationId)
        .maybeSingle()
    : { data: null };

  const lifecycle = resolveLifecycle({
    status: lead.status,
    qualificationState: lead.qualification_state,
    optedOut: lead.opted_out,
    humanTakeover: lead.human_takeover,
    conversationOwner: conversation.owner,
    hasLiveBooking: Boolean(booking.liveBooking),
    hasReplied: Boolean(lead.first_replied_at),
    hasOutstandingQuestions: qualification.outstanding > 0,
  });

  return {
    business,
    workspace: {
      businessId: business.businessId,
      businessName: business.name,
      phone: business.phone,
      timezone: business.timezone,
      services,
      allowedPostcodePrefixes: business.allowedPostcodePrefixes,
      blockedPostcodePrefixes: business.blockedPostcodePrefixes,
      quietHoursLabel: quietHoursLabel(business),
      bookingMode: business.bookingMode,
      bookingUrl: business.bookingUrl,
      tone: business.aiSettings.tone,
      replyLength: business.aiSettings.replyLength,
      businessDescription: business.aiSettings.businessDescription,
      handoverInstruction: business.aiSettings.handoverInstruction,
      answerServiceQuestions: business.agent.answerServiceQuestions,
    },
    lead,
    leadContext: {
      leadId: lead.id,
      firstName: lead.first_name,
      lastName: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      postcode: lead.postcode,
      serviceId: lead.service_id,
      serviceName,
      status: lead.status,
      qualificationState: lead.qualification_state,
      optedOut: lead.opted_out,
      humanTakeover: lead.human_takeover,
      contactable,
      lastInboundAt: conversationTimes?.last_inbound_at ?? null,
      lastOutboundAt: conversationTimes?.last_outbound_at ?? null,
    },
    conversation,
    qualification,
    booking,
    lifecycle,
  };
}

// ------------------------------------------------------------ prompt block

/**
 * Renders the context the model sees. Structure matters here: workspace facts
 * are plain text the model may rely on, and every word the lead wrote is
 * wrapped as untrusted data. Nothing from a lead is ever concatenated into a
 * labelled policy field.
 */
export function renderContextBlock(
  context: AgentContext,
  extra: { latestMessage: string | null; confirmedSlots: string[]; correction?: string },
): string {
  const { workspace, leadContext, conversation, qualification, booking } = context;

  const priceLines = workspace.services
    .filter((service) => service.publicPriceText)
    .map((service) => `- ${service.name}: ${service.publicPriceText}`);

  const blocks: string[] = [];

  blocks.push(
    [
      "BUSINESS CONTEXT",
      `Name: ${workspace.businessName}`,
      workspace.businessDescription ? `About: ${workspace.businessDescription}` : null,
      workspace.services.length
        ? `Services offered: ${workspace.services.map((service) => service.name).join(", ")}`
        : "Services offered: none configured",
      priceLines.length
        ? `Published prices you MAY quote:\n${priceLines.join("\n")}`
        : "Published prices: none. You may not state any price.",
      workspace.allowedPostcodePrefixes.length
        ? `Configured service-area postcode prefixes: ${workspace.allowedPostcodePrefixes.join(", ")}`
        : "Service area: not configured as postcodes. Do not promise coverage.",
      workspace.quietHoursLabel ? `Quiet hours: ${workspace.quietHoursLabel}` : null,
      `Tone: ${workspace.tone}. Reply length: ${workspace.replyLength}.`,
      workspace.answerServiceQuestions
        ? null
        : "This workspace does not want general service questions answered. Hand those to a person.",
      workspace.handoverInstruction ? `Handover rule: ${workspace.handoverInstruction}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  blocks.push(
    [
      "LEAD CONTEXT",
      `Name: ${[leadContext.firstName, leadContext.lastName].filter(Boolean).join(" ") || "unknown"}`,
      `Service of interest: ${leadContext.serviceName ?? "not yet identified"}`,
      `Postcode: ${leadContext.postcode ?? "unknown"}`,
      `Lifecycle: ${context.lifecycle}`,
      `Channel: ${conversation.channel}`,
    ].join("\n"),
  );

  blocks.push(
    [
      "QUALIFICATION STATE",
      qualification.answered.length
        ? `Already answered (never ask these again): ${qualification.answered
            .map((answer) => `${answer.question} = ${answer.value}`)
            .join("; ")}`
        : "Nothing answered yet.",
      qualification.nextQuestion
        ? `Next unresolved question to ask: ${qualification.nextQuestion.questionText}` +
          (qualification.nextQuestion.options.length
            ? ` (acceptable answers: ${qualification.nextQuestion.options
                .map((option) => option.label)
                .join(", ")})`
            : "")
        : "No further questions are configured.",
    ].join("\n"),
  );

  blocks.push(
    [
      "BOOKING CONTEXT",
      `Booking method: ${booking.mode}`,
      booking.bookingUrl
        ? `Booking link you MAY send verbatim: ${booking.bookingUrl}`
        : "No booking link is configured.",
      booking.liveBooking
        ? `This lead already has a booking on ${booking.liveBooking.startsAt ?? "an unspecified date"}.`
        : "This lead has no booking.",
      extra.confirmedSlots.length
        ? `CONFIRMED SLOTS you may offer: ${extra.confirmedSlots.join(", ")}`
        : "CONFIRMED SLOTS: none. You may not name any time.",
    ].join("\n"),
  );

  if (conversation.summary) {
    blocks.push(`CONVERSATION SUMMARY (earlier history)\n${conversation.summary}`);
  }

  const transcript = conversation.recentMessages.length
    ? conversation.recentMessages
        .map((turn) =>
          turn.role === "lead"
            ? `Lead: ${wrapUntrustedContent(turn.body)}`
            : `Business: ${turn.body}`,
        )
        .join("\n")
    : "No prior messages.";
  blocks.push(`RECENT CONVERSATION\n${transcript}`);

  if (extra.latestMessage) {
    blocks.push(`CURRENT MESSAGE FROM THE LEAD\n${wrapUntrustedContent(extra.latestMessage)}`);
  }

  if (extra.correction) blocks.push(extra.correction);

  return blocks.join("\n\n");
}

/** Price wording the validator will accept in an outbound message. */
export function publishedPriceStrings(context: AgentContext): string[] {
  return context.workspace.services
    .map((service) => service.publicPriceText)
    .filter((text): text is string => Boolean(text));
}

/** Links the validator will accept in an outbound message. */
export function allowedUrls(context: AgentContext): string[] {
  return [context.booking.bookingUrl].filter((url): url is string => Boolean(url));
}
