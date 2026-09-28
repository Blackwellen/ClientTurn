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

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTranscriptBlocks } from "./transcript";
import {
  DISABLED_AUTHORITY,
  parseAuthority,
  type CommercialAuthority,
} from "@/lib/commercial/authority";
import { motionAllowsDirectClose } from "@/lib/opportunities/stages";
import {
  loadBusinessContext,
  loadLead,
  leadContact,
  isSuppressed,
  type BusinessContext,
  type LeadRecord,
} from "@/lib/jobs/handlers/shared";
import {
  loadAdaptiveSelection,
  loadQuestions,
  primaryMotion,
  type QuestionRecord,
  type SalesProfile,
} from "@/lib/jobs/handlers/qualify";
import type { KnownQuestion, StopReason } from "@/lib/qualification/next-question";
import { loadOpportunityMemory } from "@/lib/opportunities/memory-service";
import { renderOpportunityMemory, type OpportunityMemory } from "@/lib/opportunities/memory";
import { loadSellingPreferencesOrDefault, loadWorkspaceObjectionsOrEmpty } from "@/lib/settings/ai-selling-queries";
import { reassuranceLines, type WorkspaceObjectionSet } from "@/lib/sales-library/workspace-objections";
import type { ChannelPreferenceState } from "./channel-preference-store";
import { buildOfferCard, buildVoiceProfile, type MemoryFactRow, type OfferCard, type OfferCardInput } from "./offer-card";
import { logWriteError } from "@/lib/supabase/write-result";
import { availabilityIsQueryable } from "./availability";
import { meetingTypeForLead } from "@/lib/bookings/meeting-type-store";
import { bookingShape } from "@/lib/bookings/meeting-types";
import type { WeekHours } from "./availability/slots";
import { parseBusinessHours } from "@/lib/settings/types";
import { resolveLifecycle } from "./lifecycle";
import { stageForMode } from "./strategy";
import type { ConversationStage } from "@/lib/sales-library/method-router";
import {
  VERBATIM_MESSAGE_WINDOW,
  isPlatformAgentChannel,
  messageChannelFor,
  type AgentChannel,
  type AgentMode,
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
  /**
   * The live `social_connection_states.state` on TikTok and LinkedIn, where the
   * permission to send is the relationship rather than the thread. Null on
   * every other channel, and null here means no accepted connection could be
   * found — which the send gate treats as a refusal, not a default.
   */
  socialConnectionState: string | null;
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
  /**
   * The platform address a reply on this thread goes to, prefixed by platform
   * (`meta_psid:...`, `meta_igsid:...`). Null on SMS, WhatsApp and email, where
   * the destination is a property of the lead rather than of the thread.
   */
  externalThreadId: string | null;
  recentMessages: ConversationTurn[];
  /** Compressed narrative of everything before `recentMessages`. */
  summary: string | null;
  totalMessages: number;
  currentQuestionId: string | null;
};

export type QualificationContext = {
  /** The adaptive next question (lib/qualification/next-question.ts). */
  nextQuestion: QuestionRecord | null;
  /**
   * The question put to the lead on an earlier turn, while it is still
   * unanswered. A reply is recorded against THIS, not against whatever the
   * selector would ask next.
   */
  currentQuestion: QuestionRecord | null;
  /** Set when there is no next question: why questioning stopped. */
  stopReason: StopReason | null;
  thresholdMet: boolean;
  /** Everything known: answered, and inferred from lead details or facts. */
  known: KnownQuestion[];
  /** Inferred answers with no answer row yet; the orchestrator records them. */
  inferred: KnownQuestion[];
  answered: { question: string; value: string }[];
  /** Questions still worth asking. Zero once the decision threshold is met. */
  outstanding: number;
};

export type SalesContext = SalesProfile & {
  /**
   * The business's own objections and reassurance (Settings -> AI & selling
   * -> Objections). Absent or empty = the library playbook applies.
   */
  objections?: WorkspaceObjectionSet;
  /**
   * Where the lead said they would rather be reached, and whether they were
   * asked (0147). Set by the orchestrator for the turn; absent = unknown.
   */
  channelPreference?: ChannelPreferenceState;
};

export type BookingContext = {
  /** calendly | google_calendar | handover */
  mode: string;
  bookingUrl: string | null;
  /**
   * A live booking, if the lead already has one: `scheduled` (confirmed) or
   * `pending` (a requested time awaiting the business's confirmation, B10).
   * Check `status` before calling it booked.
   */
  liveBooking: { id: string; startsAt: string | null; status: string } | null;
  /**
   * Whether a connected, healthy calendar can be asked for real availability.
   * False routes booking to the configured link or to a person -- never to an
   * invented time.
   */
  availabilityQueryable: boolean;
  /** Inputs the slot engine needs when availability IS queryable. */
  businessHours: WeekHours;
  appointmentDurationMinutes: number;
  bookingBufferMinutes: number;
  /**
   * The meeting type this lead's booking uses (§57), when the workspace has
   * any. Its duration and buffer are already applied to the two fields above;
   * its calendar, when set, is where availability is read. Null = the
   * workspace's single calendar and business_settings, as before.
   */
  meetingType: { id: string; name: string; calendarIntegrationId: string | null } | null;
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
  /** The workspace's archetype and primary motion (migration 0121). */
  sales: SalesContext;
  /**
   * What this lead's opportunity has established (§48, 0131): goals, pains,
   * stakeholders, objections, commitments. Null = no opportunity or no memory.
   */
  opportunityMemory: OpportunityMemory | null;
  /** One voice profile + offer card, budgeted, for the stable prompt prefix. */
  offer: OfferCard;
  /**
   * Direct close (decision Q2, Phase 3.2). `directClose` is true only when the
   * workspace enabled it AND its motion closes by checkout; only then is the
   * approved list shown to the model.
   */
  commerce?: { authority: CommercialAuthority; directClose: boolean };
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
      externalThreadId: null,
      recentMessages: [],
      summary: null,
      totalMessages: 0,
      currentQuestionId: null,
    };
  }

  const [conversation, messages, summary, count] = await Promise.all([
    admin
      .from("conversations")
      .select("id, owner, current_question_id, channel, external_thread_id")
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
    externalThreadId: conversation.data?.external_thread_id ?? null,
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

async function loadQualification(input: {
  businessId: string;
  lead: LeadRecord;
  salesProfile: SalesProfile;
  serviceName: string | null;
  currentQuestionId: string | null;
  /** The turn's stage (strategy.ts stageForMode), once the mode is known. */
  stage?: ConversationStage | null;
}): Promise<QualificationContext> {
  const questions = await loadQuestions(input.businessId);
  const selection = await loadAdaptiveSelection({
    businessId: input.businessId,
    lead: input.lead,
    questions,
    salesProfile: input.salesProfile,
    serviceName: input.serviceName,
    currentQuestionId: input.currentQuestionId,
    // Absent at assembly (the mode is resolved from this context); the
    // selector then derives the stage from the lead.
    stage: input.stage ?? null,
  });

  const knownIds = new Set(selection.known.map((entry) => entry.questionId));
  const current = input.currentQuestionId
    ? (questions.find((question) => question.id === input.currentQuestionId) ?? null)
    : null;

  return {
    nextQuestion: selection.question,
    // Only while it is unanswered and still applies to this lead.
    currentQuestion:
      current &&
      !knownIds.has(current.id) &&
      (current.serviceId === null || current.serviceId === input.lead.service_id)
        ? current
        : null,
    stopReason: selection.stopReason,
    thresholdMet: selection.thresholdMet,
    known: selection.known,
    inferred: selection.inferred,
    answered: selection.known
      .filter((entry) => entry.source === "ANSWER")
      .map((entry) => ({ question: entry.questionText, value: entry.value })),
    outstanding: selection.ranked.length,
  };
}

/**
 * Re-reads the qualification picture after this turn recorded an answer, so
 * the model is given the question that comes AFTER the one just answered.
 */
export async function refreshQualification(
  context: AgentContext,
  lead: LeadRecord,
  /** The turn's agent mode, so prematurity is judged at the turn's real stage. */
  mode?: AgentMode,
): Promise<QualificationContext> {
  return loadQualification({
    businessId: context.business.businessId,
    lead,
    salesProfile: context.sales,
    serviceName: context.workspace.services.find((service) => service.id === lead.service_id)?.name ?? null,
    currentQuestionId: context.conversation.currentQuestionId,
    stage: mode ? stageForMode(mode) : null,
  });
}

// ------------------------------------------------------- voice and offer

type VoiceRows = {
  profile: {
    archetype_key: string | null;
    sales_motions: unknown;
    outreach_tone: string | null;
    outreach_value_proposition: string | null;
    outreach_key_messages: string | null;
    outreach_proof_points: string | null;
    outreach_avoid: string | null;
    outreach_call_to_action: string | null;
    outreach_claim_restrictions: string | null;
  } | null;
  playbook: { tone: string | null; prohibited_claims: unknown } | null;
};

/**
 * The profile and default playbook rows the voice is built from. A failed
 * read is logged and treated as "nothing configured": the claim validators
 * still bind, so a missing voice degrades wording, never safety.
 */
async function readVoiceRows(businessId: string): Promise<VoiceRows> {
  const admin = createAdminClient();
  const [profile, playbook] = await Promise.all([
    admin
      .from("business_profiles")
      // archetype_key / sales_motions (0121) post-date the generated types.
      .select(
        ("archetype_key, sales_motions, outreach_tone, outreach_value_proposition, outreach_key_messages, " +
          "outreach_proof_points, outreach_avoid, outreach_call_to_action, outreach_claim_restrictions") as "business_id",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("business_playbooks")
      .select("tone, prohibited_claims")
      .eq("business_id", businessId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  logWriteError(profile, "business_profiles.voice read", { businessId });
  logWriteError(playbook, "business_playbooks.voice read", { businessId });
  return {
    profile: (profile.data ?? null) as unknown as VoiceRows["profile"],
    playbook: playbook.data ?? null,
  };
}

function offerInput(
  business: BusinessContext,
  rows: VoiceRows,
  services: ServiceFact[],
  facts: MemoryFactRow[],
): OfferCardInput {
  return {
    businessName: business.name,
    businessDescription: business.aiSettings.businessDescription,
    aiTone: business.aiSettings.tone,
    replyLength: business.aiSettings.replyLength,
    outreach: {
      tone: rows.profile?.outreach_tone ?? null,
      valueProposition: rows.profile?.outreach_value_proposition ?? null,
      keyMessages: rows.profile?.outreach_key_messages ?? null,
      proofPoints: rows.profile?.outreach_proof_points ?? null,
      avoid: rows.profile?.outreach_avoid ?? null,
      callToAction: rows.profile?.outreach_call_to_action ?? null,
      claimRestrictions: rows.profile?.outreach_claim_restrictions ?? null,
    },
    playbook: rows.playbook
      ? { tone: rows.playbook.tone, prohibitedClaims: rows.playbook.prohibited_claims }
      : null,
    signature: business.messageSignature,
    services: services.map((service) => ({
      name: service.name,
      description: service.description,
      publicPriceText: service.publicPriceText,
    })),
    facts,
    now: new Date(),
  };
}

async function loadVoiceAndOffer(
  business: BusinessContext,
  services: ServiceFact[],
): Promise<{ offer: OfferCard; sales: SalesContext }> {
  const admin = createAdminClient();
  const [rows, facts, preferences, objections] = await Promise.all([
    readVoiceRows(business.businessId),
    admin
      .from("business_memory_facts")
      .select("fact_key, value_json, source_type, confidence, verified_by_user, locked, valid_from, valid_to")
      .eq("business_id", business.businessId)
      .order("fact_key", { ascending: true }),
    loadSellingPreferencesOrDefault(business.businessId),
    loadWorkspaceObjectionsOrEmpty(business.businessId),
  ]);
  logWriteError(facts, "business_memory_facts.offer read", { businessId: business.businessId });

  const factRows: MemoryFactRow[] = (facts.data ?? []).map((row) => ({
    key: row.fact_key,
    value: row.value_json,
    sourceType: row.source_type,
    confidence: row.confidence === null ? null : Number(row.confidence),
    verifiedByUser: row.verified_by_user,
    locked: row.locked,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }));

  return {
    offer: buildOfferCard({
      ...offerInput(business, rows, services, factRows),
      // Tone examples only, labelled as such inside the card's budget.
      examples: { good: preferences.goodExamples, bad: preferences.badExamples },
      // The business's own reassurance facts, as approved claims.
      reassurance: reassuranceLines(objections.assets),
    }),
    sales: {
      archetypeKey: rows.profile?.archetype_key ?? null,
      motion: primaryMotion(rows.profile?.sales_motions),
      preferences,
      objections,
    },
  };
}

/**
 * Just the lintable workspace rules, for the non-agent paths that restyle or
 * personalise copy with AI (restyleMessage, reactivation copy).
 */
export async function loadStyleRules(
  business: BusinessContext,
): Promise<{ forbiddenPhrases: string[]; prohibitedClaims: string[] }> {
  const rows = await readVoiceRows(business.businessId);
  const voice = buildVoiceProfile(offerInput(business, rows, [], []));
  return { forbiddenPhrases: voice.forbiddenPhrases, prohibitedClaims: voice.prohibitedClaims };
}

/**
 * How the prompt describes the lead's live booking. A `pending` request must
 * never be presented as booked (B10, "never say a meeting is booked until the
 * provider confirms it").
 */
export function bookingContextLine(liveBooking: BookingContext["liveBooking"]): string {
  if (!liveBooking) return "This lead has no booking.";
  const when = liveBooking.startsAt ?? "an unspecified date";
  if (liveBooking.status === "pending") {
    return (
      `This lead has REQUESTED ${when}. It is NOT booked: it is awaiting confirmation ` +
      "from the team. Never say it is booked or confirmed; say it has been requested " +
      "and the team will confirm it. Do not offer or book another time unless the lead asks to change it."
    );
  }
  return `This lead already has a booking on ${when}.`;
}

async function loadBooking(
  business: BusinessContext,
  leadId: string,
  serviceId: string | null,
): Promise<BookingContext> {
  const admin = createAdminClient();

  const [booking, settings, queryable, meetingType] = await Promise.all([
    admin
      .from("bookings")
      .select("id, starts_at, status")
      .eq("business_id", business.businessId)
      .eq("lead_id", leadId)
      // A `pending` request (B10) holds its slot like a booking, so the agent
      // must not try to book the lead again -- but it is NOT a booking, and
      // the prompt says so. A confirmed booking wins when both exist
      // ("scheduled" sorts after "pending", hence descending).
      .in("status", ["scheduled", "pending"])
      .order("status", { ascending: false })
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("business_settings")
      .select("business_hours, appointment_duration_minutes, booking_buffer_minutes")
      .eq("business_id", business.businessId)
      .maybeSingle(),
    availabilityIsQueryable(business.businessId, business.bookingMode),
    meetingTypeForLead(business.businessId, serviceId),
  ]);

  const shape = bookingShape(
    {
      durationMinutes: settings.data?.appointment_duration_minutes ?? 60,
      bufferMinutes: settings.data?.booking_buffer_minutes ?? 0,
    },
    meetingType,
  );

  return {
    mode: business.bookingMode,
    bookingUrl: business.bookingUrl,
    liveBooking: booking.data
      ? { id: booking.data.id, startsAt: booking.data.starts_at, status: booking.data.status }
      : null,
    availabilityQueryable: queryable,
    businessHours: parseBusinessHours(settings.data?.business_hours) as WeekHours,
    appointmentDurationMinutes: shape.durationMinutes,
    bookingBufferMinutes: shape.bufferMinutes,
    meetingType: meetingType
      ? {
          id: meetingType.id,
          name: meetingType.name,
          calendarIntegrationId: meetingType.calendarIntegrationId,
        }
      : null,
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

  const [services, conversation, booking] = await Promise.all([
    loadServices(input.businessId),
    loadConversation(input.businessId, input.conversationId, input.channel),
    loadBooking(business, lead.id, lead.service_id ?? null),
  ]);

  const serviceName = services.find((service) => service.id === lead.service_id)?.name ?? null;

  // Second stage: the question selector needs the motion (from the profile),
  // the service name and the question asked last turn.
  const [{ offer, sales }, authority, opportunityMemory] = await Promise.all([
    loadVoiceAndOffer(business, services),
    loadCommercialAuthority(input.businessId),
    loadOpportunityMemory(input.businessId, lead.id),
  ]);
  const qualification = await loadQualification({
    businessId: input.businessId,
    lead,
    salesProfile: sales,
    serviceName,
    currentQuestionId: conversation.currentQuestionId,
  });

  // Where a reply would go. On Messenger and Instagram the address belongs to
  // the thread, not to the lead: the same person can hold a Messenger thread
  // and an Instagram one, and `leads` has no column that could hold either.
  // There is deliberately no fallback to the phone number -- texting somebody
  // who wrote to you on Instagram is a different act, on a channel they never
  // gave you.
  const contact = isPlatformAgentChannel(input.channel)
    ? conversation.externalThreadId
    : leadContact(lead, messageChannelFor(input.channel));

  const contactable = contact
    ? !lead.opted_out && !(await isSuppressed(input.businessId, contact, messageChannelFor(input.channel)))
    : false;

  /**
   * The live connection state behind a connect-gated channel.
   *
   * On TikTok and LinkedIn the permission to send is the relationship, not the
   * thread, and the recipient can end it at any moment without sending anything
   * the runtime would notice. So it is read fresh for the turn.
   *
   * Keyed through the prospect, because `social_connection_states` belongs to
   * the prospect record rather than the lead — a lead is what a prospect
   * becomes, and the connection was established before that happened. Null for
   * every other channel, and null here is a refusal rather than a default: if
   * the row cannot be found, the gate cannot be shown to have been passed.
   */
  const socialConnectionState = await loadSocialConnectionState(
    input.businessId,
    lead.id,
    input.channel,
  );

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
      socialConnectionState,
    },
    conversation,
    qualification,
    booking,
    lifecycle,
    sales,
    opportunityMemory,
    offer,
    commerce: {
      authority,
      directClose: authority.enabled && motionAllowsDirectClose(sales.motion),
    },
  };
}

/**
 * The workspace's commercial authority (0125). A missing row, a read failure
 * or a malformed row all mean "disabled": the safe default for money.
 */
async function loadCommercialAuthority(businessId: string): Promise<CommercialAuthority> {
  const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
    .from("commercial_authority")
    // `*` so the 0160 AI-permission columns are read when present and
    // defaulted (least privilege) when not.
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    logWriteError({ error }, "agent: read commercial authority", { businessId });
    return DISABLED_AUTHORITY;
  }
  return parseAuthority(data);
}

// ------------------------------------------------------------ prompt block

/**
 * Renders the context the model sees. Structure matters here: workspace facts
 * are plain text the model may rely on, and every word the lead wrote is
 * wrapped as untrusted data. Nothing from a lead is ever concatenated into a
 * labelled policy field.
 */
export function renderStableBlock(context: AgentContext): string {
  const { workspace } = context;

  const business = [
    "BUSINESS CONTEXT",
    workspace.allowedPostcodePrefixes.length
      ? `Configured service-area postcode prefixes: ${workspace.allowedPostcodePrefixes.join(", ")}`
      : "Service area: not configured as postcodes. Do not promise coverage.",
    workspace.quietHoursLabel ? `Quiet hours: ${workspace.quietHoursLabel}` : null,
    workspace.answerServiceQuestions
      ? null
      : "This workspace does not want general service questions answered. Hand those to a person.",
    workspace.handoverInstruction ? `Handover rule: ${workspace.handoverInstruction}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // The offer card carries the name, description, services, published prices,
  // voice and the never-say rules; see offer-card.ts.
  return `${context.offer.text}\n\n${business}`;
}

/**
 * The volatile part: the strategy for this turn, the lead, qualification,
 * booking and the conversation. Changes every turn, so it goes last, after
 * `renderStableBlock` (which is sent as `stableContext`).
 */
export function renderContextBlock(
  context: AgentContext,
  extra: {
    latestMessage: string | null;
    confirmedSlots: string[];
    correction?: string;
    /** Rendered by strategy.ts buildStrategyBlock. */
    strategy?: string;
  },
): string {
  const { leadContext, conversation, qualification, booking } = context;

  const blocks: string[] = [];

  if (extra.strategy) blocks.push(extra.strategy);

  // Compact opportunity memory instead of more raw history (§48).
  const memoryBlock = renderOpportunityMemory(context.opportunityMemory ?? null);
  if (memoryBlock) blocks.push(memoryBlock);

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

  const inferred = qualification.known.filter((entry) => entry.inferred);
  blocks.push(
    [
      "QUALIFICATION STATE",
      qualification.answered.length
        ? `Already answered (never ask these again): ${qualification.answered
            .map((answer) => `${answer.question} = ${answer.value}`)
            .join("; ")}`
        : "Nothing answered yet.",
      inferred.length
        ? `Inferred from the lead's details, not asked (never ask these; do not present them as something the lead told you): ${inferred
            .map((entry) => `${entry.questionText} = ${entry.value}`)
            .join("; ")}`
        : null,
      // The next question itself is in the strategy block.
    ]
      .filter(Boolean)
      .join("\n"),
  );

  blocks.push(
    [
      "BOOKING CONTEXT",
      `Booking method: ${booking.mode}`,
      booking.bookingUrl
        ? `Booking link you MAY send verbatim: ${booking.bookingUrl}`
        : "No booking link is configured.",
      bookingContextLine(booking.liveBooking),
      extra.confirmedSlots.length
        ? `CONFIRMED SLOTS you may offer: ${extra.confirmedSlots.join(", ")}`
        : "CONFIRMED SLOTS: none. You may not name any time.",
    ].join("\n"),
  );

  if (context.commerce?.directClose) {
    const { authority } = context.commerce;
    blocks.push(
      [
        "DIRECT CLOSE (approved checkout links)",
        "If the lead is ready to buy one of these, propose PROPOSE_CHECKOUT with its checkout_link_id. " +
          "Do not write the URL; the system appends it. If you state the price, use the price text exactly. " +
          "Never say anything has been bought, ordered or paid.",
        ...authority.approved_checkout_links.map(
          (link) => `- ${link.id}: ${link.label} (${link.product}) - ${link.price_text}`,
        ),
        authority.max_discount_percent > 0
          ? `You may offer at most ${authority.max_discount_percent}% off, only if the lead asks.`
          : "Never offer a discount.",
      ].join("\n"),
    );
  }

  if (conversation.summary) {
    blocks.push(`CONVERSATION SUMMARY (earlier history)\n${conversation.summary}`);
  }

  // Bounded in characters, the current message once (transcript.ts). Only the
  // rendering: recentMessages stays whole for the validator.
  blocks.push(
    ...renderTranscriptBlocks(conversation.recentMessages, extra.latestMessage),
  );

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

/**
 * The live social connection state for a lead, on the connect-gated channels.
 *
 * Returns null for every other channel, and null when no row exists — both of
 * which `evaluateSendGate` reads as "not shown to be connected". That default
 * is the safe one: on TikTok and LinkedIn a message without an accepted
 * connection is refused by the platform anyway, so a missing row can only ever
 * mean the send would fail.
 *
 * The join goes through `prospects.promoted_to_lead_id` because the connection
 * was established while the record was still a prospect; becoming a lead does
 * not move it.
 */
async function loadSocialConnectionState(
  businessId: string,
  leadId: string,
  channel: AgentChannel,
): Promise<string | null> {
  if (channel !== "tiktok" && channel !== "linkedin") return null;

  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("prospects")
    .select("id")
    .eq("business_id", businessId)
    .eq("promoted_to_lead_id", leadId)
    .maybeSingle();

  if (!prospect) return null;

  const { data } = await admin
    .from("social_connection_states")
    .select("state")
    .eq("business_id", businessId)
    .eq("prospect_id", prospect.id)
    .eq("platform", channel.toUpperCase())
    .maybeSingle();

  return data?.state ?? null;
}
