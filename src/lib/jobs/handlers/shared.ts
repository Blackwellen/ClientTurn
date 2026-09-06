import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import type { SendOrigin } from "@/lib/jobs/send-core";
import {
  renderTemplate,
  type ChannelState,
  type LeadState,
  type QuietHours,
} from "@/lib/automation/scheduler";
import { normaliseEmail } from "@/lib/email/account";
import { normalisePhone, type Channel } from "@/lib/messaging/types";
import { getEntitlements } from "@/lib/billing/entitlements";
import { emitAutomationEvent } from "@/lib/automation/events";
import { runTask } from "@/lib/ai/model-router";
import type { ReplyPlan } from "@/lib/ai/schemas";
import {
  AGENT_OPERATING_MODES,
  type AgentChannel,
  type AgentOperatingMode,
} from "@/lib/agent/types";

export type NotificationType =
  | "handover"
  | "booking"
  | "integration_failure"
  | "message_failed"
  | "campaign_complete"
  | "billing"
  | "usage_limit"
  | "lead_attention";

const UNHEALTHY = new Set(["ACTION_REQUIRED", "DISCONNECTED"]);

const AGENT_CHANNELS: AgentChannel[] = ["sms", "whatsapp", "email"];

/** An unrecognised or un-entitled mode always resolves to OFF, never on. */
function resolveAgentMode(
  raw: string | null | undefined,
  aiAssistEnabled: boolean,
): AgentOperatingMode {
  if (!aiAssistEnabled) return "OFF";
  const mode = AGENT_OPERATING_MODES.find((value) => value === raw);
  return mode ?? "OFF";
}

function resolveAgentChannels(raw: string[] | null | undefined): AgentChannel[] {
  if (!raw?.length) return [];
  return AGENT_CHANNELS.filter((channel) => raw.includes(channel));
}
const ACTIVE_SUBSCRIPTION = new Set(["TRIALING", "ACTIVE", "PAST_DUE"]);

export type BusinessContext = {
  businessId: string;
  name: string;
  phone: string | null;
  timezone: string;
  status: string;
  quietHours: QuietHours;
  defaultChannel: Channel;
  allowedPostcodePrefixes: string[];
  blockedPostcodePrefixes: string[];
  optOutWording: string;
  messageSignature: string | null;
  bookingMode: string;
  bookingUrl: string | null;
  /** Master toggle (business_settings) AND the plan entitles this workspace. */
  aiAssistEnabled: boolean;
  aiSettings: {
    tone: "professional" | "friendly" | "direct";
    replyLength: "short" | "normal";
    businessDescription: string | null;
    handoverInstruction: string | null;
    fallbackMessage: string | null;
    allowAiReply: boolean;
    allowAiInterpretation: boolean;
  };
  /**
   * Conversation-agent configuration. Separate from `aiSettings` because
   * these four control an autonomous actor, not the wording of a message
   * ClientTurn had already decided to send.
   */
  agent: {
    mode: AgentOperatingMode;
    /** Channels the workspace has enabled the agent on. */
    channels: AgentChannel[];
    /** Hand a REVIEW qualification result to a person instead of replying. */
    handoverOnReview: boolean;
    /** Allow answering general service questions, not just qualification. */
    answerServiceQuestions: boolean;
  };
  notify: {
    handover: boolean;
    booking: boolean;
    integrationFailure: boolean;
    campaignComplete: boolean;
  };
  subscriptionActive: boolean;
};

export async function loadBusinessContext(
  businessId: string,
): Promise<BusinessContext | null> {
  const admin = createAdminClient();

  const [business, settings, subscription, aiSettings, entitlements] = await Promise.all([
    admin
      .from("businesses")
      .select("id, name, phone, timezone, status")
      .eq("id", businessId)
      .maybeSingle(),
    admin
      .from("business_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("subscriptions")
      .select("status")
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("business_ai_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    getEntitlements(businessId),
  ]);

  if (!business.data) return null;
  const settingsRow = settings.data;
  const timezone = business.data.timezone || "Europe/London";

  return {
    businessId,
    name: business.data.name,
    phone: business.data.phone,
    timezone,
    status: business.data.status,
    quietHours: {
      enabled: settingsRow?.quiet_hours_enabled ?? true,
      start: (settingsRow?.quiet_hours_start ?? "20:00").slice(0, 5),
      end: (settingsRow?.quiet_hours_end ?? "08:00").slice(0, 5),
      timezone,
    },
    defaultChannel:
      settingsRow?.default_channel === "whatsapp" ? "whatsapp" : "sms",
    allowedPostcodePrefixes: settingsRow?.allowed_postcode_prefixes ?? [],
    blockedPostcodePrefixes: settingsRow?.blocked_postcode_prefixes ?? [],
    optOutWording: settingsRow?.opt_out_wording ?? "Reply STOP to opt out.",
    messageSignature: settingsRow?.message_signature ?? null,
    bookingMode: settingsRow?.booking_mode ?? "handover",
    bookingUrl: settingsRow?.booking_url ?? null,
    aiAssistEnabled: (settingsRow?.ai_assist_enabled ?? false) && entitlements.aiAssistAllowed,
    aiSettings: {
      tone: (aiSettings.data?.tone as "professional" | "friendly" | "direct") ?? "professional",
      replyLength: (aiSettings.data?.reply_length as "short" | "normal") ?? "short",
      businessDescription: aiSettings.data?.business_description ?? null,
      handoverInstruction: aiSettings.data?.handover_instruction ?? null,
      fallbackMessage: aiSettings.data?.fallback_message ?? null,
      allowAiReply: aiSettings.data?.allow_ai_reply ?? false,
      allowAiInterpretation: aiSettings.data?.allow_ai_interpretation ?? true,
    },
    agent: {
      // The agent is gated by the same master switch and entitlement as the
      // rest of the AI layer: a workspace cannot leave it on by editing one
      // row after AI assist has been turned off or has left its plan.
      mode: resolveAgentMode(
        aiSettings.data?.agent_mode,
        (settingsRow?.ai_assist_enabled ?? false) && entitlements.aiAssistAllowed,
      ),
      channels: resolveAgentChannels(aiSettings.data?.agent_channels),
      handoverOnReview: aiSettings.data?.agent_handover_on_review ?? true,
      answerServiceQuestions: aiSettings.data?.agent_answer_service_questions ?? true,
    },
    notify: {
      handover: settingsRow?.notify_handover ?? true,
      booking: settingsRow?.notify_booking ?? true,
      integrationFailure: settingsRow?.notify_integration_failure ?? true,
      campaignComplete: settingsRow?.notify_campaign_complete ?? true,
    },
    // No subscription row is a workspace mid-provisioning, not a lapsed one.
    subscriptionActive: subscription.data
      ? ACTIVE_SUBSCRIPTION.has(subscription.data.status)
      : true,
  };
}

export type LeadRecord = {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  postcode: string | null;
  service_id: string | null;
  source_id: string | null;
  status: string;
  qualification_state: string;
  opted_out: boolean;
  automation_active: boolean;
  human_takeover: boolean;
  needs_attention: boolean;
  is_test: boolean;
  first_replied_at: string | null;
  first_contacted_at: string | null;
  unsubscribe_token: string;
};

export const LEAD_COLUMNS =
  "id, business_id, first_name, last_name, phone, phone_normalized, email, postcode, service_id, source_id, status, qualification_state, opted_out, automation_active, human_takeover, needs_attention, is_test, first_replied_at, first_contacted_at, unsubscribe_token";

export async function loadLead(leadId: string): Promise<LeadRecord | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", leadId)
    .maybeSingle();
  return (data as LeadRecord | null) ?? null;
}

export function leadState(lead: LeadRecord): LeadState {
  return {
    status: lead.status,
    optedOut: lead.opted_out,
    humanTakeover: lead.human_takeover,
    automationActive: lead.automation_active,
    hasReplied: Boolean(lead.first_replied_at),
  };
}

export async function channelState(
  businessId: string,
  channel: Channel,
  contact: string | null,
  subscriptionActive: boolean,
): Promise<ChannelState> {
  const admin = createAdminClient();
  const providerType =
    channel === "email"
      ? "imap_smtp"
      : channel === "whatsapp"
        ? "twilio_whatsapp"
        : "twilio_sms";

  const [integration, suppression] = await Promise.all([
    admin
      .from("integrations")
      .select("status")
      .eq("business_id", businessId)
      .eq("provider_type", providerType)
      .maybeSingle(),
    contact
      ? isSuppressed(businessId, contact, channel)
      : Promise.resolve(false),
  ]);

  return {
    subscriptionActive,
    // For SMS/WhatsApp, no connection row means the platform sender is in
    // use, which is healthy. Email has no platform sender — a workspace
    // without its own mailbox connected cannot send at all.
    integrationHealthy: integration.data
      ? !UNHEALTHY.has(integration.data.status)
      : channel !== "email",
    contactSuppressed: suppression,
  };
}

export async function isSuppressed(
  businessId: string,
  contact: string,
  channel: Channel,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("contact_suppressions")
    .select("id")
    .eq("business_id", businessId)
    .eq("normalized_contact", contact)
    .in("channel", [channel, "all"])
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/**
 * The address a message on `channel` would actually go to. Email campaigns
 * address the lead's email; SMS and WhatsApp address the normalised mobile.
 */
export function leadContact(
  lead: LeadRecord,
  channel: Channel = "sms",
): string | null {
  if (channel === "email") return normaliseEmail(lead.email);
  return (
    lead.phone_normalized ?? (lead.phone ? normalisePhone(lead.phone) : null)
  );
}

export async function mergeValues(
  business: BusinessContext,
  lead: LeadRecord,
): Promise<Record<string, string>> {
  const admin = createAdminClient();

  let serviceName = "";
  if (lead.service_id) {
    const { data } = await admin
      .from("services")
      .select("name")
      .eq("id", lead.service_id)
      .maybeSingle();
    serviceName = data?.name ?? "";
  }

  return {
    first_name: lead.first_name ?? "there",
    last_name: lead.last_name ?? "",
    full_name:
      [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "there",
    business_name: business.name,
    service_name: serviceName,
    booking_link: business.bookingUrl ?? "",
    business_phone: business.phone ?? "",
  };
}

export function renderBody(
  template: string,
  values: Record<string, string>,
): string {
  return renderTemplate(template, values).trim();
}

export async function conversationFor(
  businessId: string,
  leadId: string,
  channel: Channel,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("channel", channel)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created } = await admin
    .from("conversations")
    .insert({ business_id: businessId, lead_id: leadId, channel })
    .select("id")
    .single();

  return created?.id ?? null;
}

/**
 * Queues an outbound message. Nothing anywhere calls a provider directly:
 * every send goes through a QUEUED row so the guard runs against live state
 * immediately before dispatch.
 */
export async function queueOutboundMessage(input: {
  businessId: string;
  leadId: string;
  channel: Channel;
  body: string;
  /** Email only. Required for the email channel, ignored elsewhere. */
  subject?: string | null;
  origin: SendOrigin;
  automationRunId?: string | null;
  campaignId?: string | null;
  sendKey: string;
  runAt?: Date;
  enqueueSend?: boolean;
}): Promise<string | null> {
  const admin = createAdminClient();

  const conversationId = await conversationFor(
    input.businessId,
    input.leadId,
    input.channel,
  );
  if (!conversationId) return null;

  const { data, error } = await admin
    .from("messages")
    .insert({
      business_id: input.businessId,
      conversation_id: conversationId,
      lead_id: input.leadId,
      direction: "outbound",
      channel: input.channel,
      body: input.body,
      subject: input.channel === "email" ? (input.subject ?? null) : null,
      status: "QUEUED",
      origin: input.origin,
      send_key: input.sendKey,
      automation_run_id: input.automationRunId ?? null,
      campaign_id: input.campaignId ?? null,
      scheduled_for: (input.runAt ?? new Date()).toISOString(),
    })
    .select("id")
    .single();

  let messageId = data?.id ?? null;

  // A duplicate send_key means a retry re-queued a message already written.
  if (error?.code === "23505") {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("send_key", input.sendKey)
      .maybeSingle();
    messageId = existing?.id ?? null;
  } else if (error || !messageId) {
    throw error ?? new Error("Could not queue the message.");
  }

  if (messageId && input.enqueueSend !== false) {
    await enqueue(
      "message.send",
      { messageId, leadId: input.leadId, sendKey: input.sendKey },
      {
        businessId: input.businessId,
        runAt: input.runAt,
        idempotencyKey: `message.send:${input.sendKey}`,
      },
    );
  }

  return messageId;
}

export async function stopAutomationRuns(
  businessId: string,
  leadId: string,
  reason: string,
) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("automation_runs")
    .update({
      state: "STOPPED",
      stopped_reason: reason,
      stopped_at: new Date().toISOString(),
      next_run_at: null,
    })
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("state", "ACTIVE")
    .select("id");

  for (const run of data ?? []) {
    await emitAutomationEvent({
      businessId,
      leadId,
      automationRunId: run.id,
      eventType: "automation.stopped",
      payload: { reason },
    });
  }
}

/**
 * Restyles a message ClientTurn has already deterministically decided to
 * send — the content and facts are fixed before this is ever called; AI
 * only adjusts wording/tone. Any candidate that drops a required substring
 * (a URL, a name, an option word) or exceeds the SMS length guard is
 * discarded, and the original deterministic text is sent instead. This is
 * dynamic AI-generated wording (§25), not AI-generated decisions.
 */
export async function restyleMessage(
  business: BusinessContext,
  input: {
    leadId: string;
    conversationId?: string | null;
    baseMessage: string;
    requiredSubstrings?: string[];
    maxLength?: number;
  },
): Promise<string> {
  if (!business.aiAssistEnabled || !business.aiSettings.allowAiReply) {
    return input.baseMessage;
  }

  const context =
    `Tone: ${business.aiSettings.tone}. Length: ${business.aiSettings.replyLength}.\n` +
    `Restyle this exact message for a UK home-service SMS/WhatsApp reply. ` +
    `Keep every fact, name, link and instruction — only adjust wording and tone.\n` +
    `Message: ${input.baseMessage}`;

  const result = await runTask<ReplyPlan>({
    taskType: "reply_generation",
    businessId: business.businessId,
    leadId: input.leadId,
    conversationId: input.conversationId ?? null,
    context,
    maxOutputTokens: 150,
  }).catch(() => null);

  const candidate = result?.data?.message?.trim();
  if (!candidate) return input.baseMessage;

  const maxLength = input.maxLength ?? 300;
  if (candidate.length === 0 || candidate.length > maxLength) return input.baseMessage;

  for (const required of input.requiredSubstrings ?? []) {
    if (!candidate.includes(required)) return input.baseMessage;
  }

  return candidate;
}

export async function queueNotification(input: {
  businessId: string;
  type: NotificationType;
  title: string;
  body?: string;
  severity?: "info" | "warning" | "error";
  linkUrl?: string;
  entityType?: string;
  entityId?: string;
  userId?: string | null;
  dedupeKey?: string;
}) {
  const { dedupeKey, ...payload } = input;
  await enqueue("notification.send", payload, {
    businessId: input.businessId,
    idempotencyKey: dedupeKey ? `notification.send:${dedupeKey}` : undefined,
  });
}

/** Marks a lead as needing a person, and tells the workspace why. */
export async function flagForAttention(input: {
  businessId: string;
  leadId: string;
  reason: string;
  title: string;
  body?: string;
  takeover?: boolean;
}) {
  const admin = createAdminClient();
  await admin
    .from("leads")
    .update({
      needs_attention: true,
      attention_reason: input.reason,
      ...(input.takeover
        ? { human_takeover: true, automation_active: false }
        : {}),
    })
    .eq("id", input.leadId)
    .eq("business_id", input.businessId);

  if (input.takeover) {
    await stopAutomationRuns(input.businessId, input.leadId, "human_takeover");
    await emitAutomationEvent({
      businessId: input.businessId,
      leadId: input.leadId,
      eventType: "lead.human_takeover",
      payload: { reason: input.reason },
    });
  }

  await queueNotification({
    businessId: input.businessId,
    type: "lead_attention",
    severity: "warning",
    title: input.title,
    body: input.body,
    entityType: "lead",
    entityId: input.leadId,
    linkUrl: `/app/leads/${input.leadId}`,
    dedupeKey: `lead_attention:${input.leadId}:${input.reason}`,
  });

  await enqueue(
    "notification.slack",
    { businessId: input.businessId, leadId: input.leadId, text: `Needs attention: ${input.title}` },
    { businessId: input.businessId },
  );
}
