import "server-only";

/**
 * The tool registry.
 *
 * Two rules shape this file.
 *
 * First: **context is pushed, actions are pulled.** Everything the model needs
 * to know about the workspace, the lead, the qualification state and the
 * booking configuration is assembled up front by ./context.ts and handed to it
 * in one block. There are therefore no `get_lead` / `get_services` /
 * `get_qualification_state` round trips -- they would spend a model call to
 * fetch something the runtime already holds. What remains here is the set of
 * things that genuinely change the world, plus the one read (availability)
 * that cannot be known in advance.
 *
 * Second: **the model names an action, never a target.** Every tool receives a
 * `ToolContext` the runtime built from the verified event -- business, lead,
 * conversation, channel. Nothing the model returns can redirect a tool at a
 * different workspace, a different lead, or a different channel, because those
 * arguments do not exist in any tool's input schema.
 *
 * There is deliberately no SQL tool, no HTTP tool, and no tool at CRITICAL
 * risk: billing, account administration, permissions and credentials are
 * outside this agent's authority entirely.
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitAutomationEvent } from "@/lib/automation/events";
import {
  flagForAttention,
  leadContact,
  queueNotification,
  queueOutboundMessage,
  stopAutomationRuns,
  type BusinessContext,
  type LeadRecord,
} from "@/lib/jobs/handlers/shared";
import { matchAnswer, type QuestionRecord } from "@/lib/jobs/handlers/qualify";
import { normalisePhone } from "@/lib/messaging/types";
import type { AgentRunHandle } from "./audit";
import { recordAction } from "./audit";
import { evaluateToolGate } from "./policy";
import type {
  AgentChannel,
  HandoverPriority,
  HandoverReason,
  LifecycleState,
  ReplyClassification,
  RiskLevel,
} from "./types";
import { HANDOVER_PRIORITY_FOR } from "./types";

// ------------------------------------------------------------- declaration

export type ToolRequirements = {
  requiresContactability?: boolean;
  requiresConfirmedAvailability?: boolean;
  requiresQualifiedState?: boolean;
  requiresRecognisedOptOut?: boolean;
  requiresBookingEnabled?: boolean;
};

export type ToolDeclaration = {
  name: ToolName;
  description: string;
  risk: RiskLevel;
  requirements: ToolRequirements;
  /**
   * True when re-running with the same ToolContext is guaranteed harmless.
   * Every tool here is idempotent by construction: sends carry a send_key,
   * answers upsert on (lead_id, question_id), handovers upsert on the open
   * conversation index, suppression is an upsert.
   */
  idempotent: boolean;
};

export const TOOL_NAMES = [
  "check_service_area",
  "get_calendar_availability",
  "record_qualification_answer",
  "update_lead_fields",
  "send_message",
  "draft_message",
  "send_booking_link",
  "create_booking",
  "request_human_handover",
  "apply_suppression",
  "stop_follow_up",
  "record_reply_classification",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_REGISTRY: Record<ToolName, ToolDeclaration> = {
  check_service_area: {
    name: "check_service_area",
    description: "Test a postcode against the workspace's configured prefixes.",
    risk: "LOW",
    requirements: {},
    idempotent: true,
  },
  get_calendar_availability: {
    name: "get_calendar_availability",
    description: "Fetch real bookable slots from the connected calendar.",
    risk: "LOW",
    requirements: {},
    idempotent: true,
  },
  record_qualification_answer: {
    name: "record_qualification_answer",
    description: "Store a lead's answer to one configured qualification question.",
    risk: "MEDIUM",
    requirements: {},
    idempotent: true,
  },
  update_lead_fields: {
    name: "update_lead_fields",
    description: "Write validated extracted fields onto the lead record.",
    risk: "MEDIUM",
    requirements: {},
    idempotent: true,
  },
  send_message: {
    name: "send_message",
    description: "Queue an outbound reply on the conversation's channel.",
    risk: "MEDIUM",
    requirements: { requiresContactability: true },
    idempotent: true,
  },
  draft_message: {
    name: "draft_message",
    description: "Save a reply for a human to review and send.",
    risk: "LOW",
    requirements: {},
    idempotent: true,
  },
  send_booking_link: {
    name: "send_booking_link",
    description: "Send the workspace's configured booking link.",
    risk: "MEDIUM",
    requirements: { requiresContactability: true, requiresBookingEnabled: true },
    idempotent: true,
  },
  create_booking: {
    name: "create_booking",
    description: "Create a booking on a slot the calendar confirmed in this turn.",
    risk: "HIGH",
    requirements: { requiresConfirmedAvailability: true, requiresQualifiedState: true },
    idempotent: true,
  },
  request_human_handover: {
    name: "request_human_handover",
    description: "Pass the conversation to a person with a factual summary.",
    risk: "HIGH",
    requirements: {},
    idempotent: true,
  },
  apply_suppression: {
    name: "apply_suppression",
    description: "Suppress a contact after a recognised opt-out.",
    risk: "HIGH",
    requirements: { requiresRecognisedOptOut: true },
    idempotent: true,
  },
  stop_follow_up: {
    name: "stop_follow_up",
    description: "Stop pending follow-up and campaign sends for this lead.",
    risk: "MEDIUM",
    requirements: {},
    idempotent: true,
  },
  record_reply_classification: {
    name: "record_reply_classification",
    description: "Persist the classification of the lead's latest reply.",
    risk: "LOW",
    requirements: {},
    idempotent: true,
  },
};

// ------------------------------------------------------------- invocation

/**
 * Trusted identifiers. Built by the runtime from the verified event; never
 * from anything the model returned.
 */
export type ToolContext = {
  run: AgentRunHandle;
  business: BusinessContext;
  lead: LeadRecord;
  conversationId: string | null;
  channel: AgentChannel;
  lifecycle: LifecycleState;
  /** Facts the policy engine tests tool requirements against. */
  facts: {
    contactable: boolean;
    availabilityConfirmed: boolean;
    optOutRecognised: boolean;
    bookingEnabled: boolean;
  };
  /** Confidence of the proposal that led here; null for deterministic calls. */
  confidence: number | null;
};

export type ToolResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; code: string; detail: string; recoverable: boolean };

/**
 * The single entry point. Every tool call passes the policy gate first, and
 * both the allowed calls and the refusals are written to the decision log.
 */
async function invoke<T extends Record<string, unknown>>(
  name: ToolName,
  context: ToolContext,
  inputSummary: Record<string, unknown>,
  run: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const declaration = TOOL_REGISTRY[name];
  const startedAt = Date.now();

  const gate = evaluateToolGate({
    riskLevel: declaration.risk,
    confidence: context.confidence,
    lifecycle: context.lifecycle,
    requirements: declaration.requirements,
    facts: context.facts,
  });

  if (!gate.allowed) {
    await recordAction(context.run, {
      toolName: name,
      riskLevel: declaration.risk,
      status: gate.status,
      denialReason: gate.detail,
      input: inputSummary,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, code: gate.status, detail: gate.detail, recoverable: false };
  }

  try {
    const result = await run();
    await recordAction(context.run, {
      toolName: name,
      riskLevel: declaration.risk,
      status: result.ok ? "OK" : "ERROR",
      denialReason: result.ok ? null : result.detail,
      input: inputSummary,
      result: result.ok ? result.data : { code: result.code },
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Tool failed.";
    await recordAction(context.run, {
      toolName: name,
      riskLevel: declaration.risk,
      status: "ERROR",
      denialReason: detail,
      input: inputSummary,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false, code: "TOOL_ERROR", detail, recoverable: true };
  }
}

// ------------------------------------------------------------------ tools

export const serviceAreaInput = z.object({ postcode: z.string().min(2).max(12) });

export type ServiceAreaVerdict = { verdict: "IN_AREA" | "OUT_OF_AREA" | "UNKNOWN" };

/**
 * Deterministic service-area test. Returns UNKNOWN -- not "yes" -- when the
 * workspace has configured no prefixes, so the composer is never handed a
 * coverage promise it could repeat.
 */
export async function checkServiceArea(
  context: ToolContext,
  input: z.infer<typeof serviceAreaInput>,
): Promise<ToolResult<ServiceAreaVerdict>> {
  return invoke<ServiceAreaVerdict>(
    "check_service_area",
    context,
    { postcode: input.postcode },
    async (): Promise<ToolResult<ServiceAreaVerdict>> => {
      const outward = input.postcode.toUpperCase().replace(/\s+/g, "").slice(0, 4);
      const { allowedPostcodePrefixes: allowed, blockedPostcodePrefixes: blocked } =
        context.business;

      const matches = (prefixes: string[]) =>
        prefixes.some((prefix) =>
          outward.startsWith(prefix.toUpperCase().replace(/\s+/g, "")),
        );

      if (blocked.length > 0 && matches(blocked)) {
        return { ok: true, data: { verdict: "OUT_OF_AREA" } };
      }
      // No configured prefixes means the workspace has never told us its
      // area. That is UNKNOWN, and never a yes.
      if (allowed.length === 0) {
        return { ok: true, data: { verdict: "UNKNOWN" } };
      }
      return {
        ok: true,
        data: { verdict: matches(allowed) ? "IN_AREA" : "OUT_OF_AREA" },
      };
    },
  );
}

/**
 * Real bookable slots.
 *
 * No integration in this codebase currently exposes calendar free/busy --
 * Calendly and Google Calendar arrive as inbound booking webhooks, not as an
 * availability query. Rather than approximate it, this returns
 * PROVIDER_UNAVAILABLE, which routes the turn to the configured booking link
 * or to a person. That is the correct fail-safe: a wrong slot is worse than no
 * slot. When an availability provider lands, this is the only function that
 * changes.
 */
export async function getCalendarAvailability(
  context: ToolContext,
  input: { dayPart?: string | null; date?: string | null },
): Promise<ToolResult<{ slots: string[] }>> {
  return invoke(
    "get_calendar_availability",
    context,
    { date: input.date ?? null, dayPart: input.dayPart ?? null },
    async () => ({
      ok: false as const,
      code: "PROVIDER_UNAVAILABLE",
      detail: "No calendar availability provider is connected for this workspace.",
      recoverable: false,
    }),
  );
}

export async function recordQualificationAnswer(
  context: ToolContext,
  input: { question: QuestionRecord; reply: string; value: string },
): Promise<ToolResult<{ questionId: string; stored: boolean }>> {
  return invoke(
    "record_qualification_answer",
    context,
    { questionId: input.question.id },
    async () => {
      // The model's candidate is re-validated through the deterministic
      // matcher, so a stored value can never fall outside the question's
      // configured options or format.
      const revalidated = matchAnswer(input.question, input.value);
      if (!revalidated.value) {
        return {
          ok: false as const,
          code: "VALUE_NOT_ACCEPTED",
          detail: "The candidate value is not a configured option for this question.",
          recoverable: false,
        };
      }

      const admin = createAdminClient();
      const { error } = await admin.from("qualification_answers").upsert(
        {
          business_id: context.business.businessId,
          lead_id: context.lead.id,
          question_id: input.question.id,
          answer_value: revalidated.value,
          answer_text: input.reply.trim(),
          source: "reply",
          answered_at: new Date().toISOString(),
        },
        { onConflict: "lead_id,question_id" },
      );
      if (error) throw error;

      return {
        ok: true as const,
        data: { questionId: input.question.id, stored: true },
      };
    },
  );
}

type LeadFieldUpdate = {
  first_name?: string;
  last_name?: string;
  email?: string;
  postcode?: string;
  service_id?: string;
};

export const leadFieldUpdateSchema = z.object({
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  email: z.email().max(200).optional(),
  postcode: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i)
    .optional(),
  service_id: z.uuid().optional(),
});

/**
 * Writes extracted fields. Only ever fills a blank: an existing trusted value
 * is never overwritten by an extraction, however confident the model was.
 */
export async function updateLeadFields(
  context: ToolContext,
  input: z.infer<typeof leadFieldUpdateSchema>,
): Promise<ToolResult<{ written: string[]; skipped: string[] }>> {
  return invoke("update_lead_fields", context, { fields: Object.keys(input) }, async () => {
    const parsed = leadFieldUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false as const,
        code: "INVALID_FIELDS",
        detail: "One or more candidate values failed validation.",
        recoverable: false,
      };
    }

    const existing: Record<string, unknown> = {
      first_name: context.lead.first_name,
      last_name: context.lead.last_name,
      email: context.lead.email,
      postcode: context.lead.postcode,
      service_id: context.lead.service_id,
    };

    const update: LeadFieldUpdate = {};
    const written: string[] = [];
    const skipped: string[] = [];

    for (const [field, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      if (existing[field]) {
        skipped.push(field);
        continue;
      }
      update[field as keyof LeadFieldUpdate] =
        field === "postcode" ? String(value).toUpperCase() : String(value);
      written.push(field);
    }

    if (written.length === 0) {
      return { ok: true as const, data: { written, skipped } };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("leads")
      .update(update)
      .eq("id", context.lead.id)
      .eq("business_id", context.business.businessId);
    if (error) throw error;

    return { ok: true as const, data: { written, skipped } };
  });
}

/**
 * Queues an outbound reply. Nothing here talks to a provider: the message is
 * written QUEUED and the existing `message.send` worker re-checks stop
 * conditions, suppression, quiet hours and connection health against live
 * state immediately before dispatch. That guard, not this call, is the last
 * word on whether the message leaves.
 */
export async function sendMessage(
  context: ToolContext,
  input: { body: string; sendKey: string; runAt?: Date; subject?: string | null },
): Promise<ToolResult<{ messageId: string | null; queuedFor: string }>> {
  return invoke(
    "send_message",
    context,
    { length: input.body.length, channel: context.channel, deferred: Boolean(input.runAt) },
    async () => {
      const messageId = await queueOutboundMessage({
        businessId: context.business.businessId,
        leadId: context.lead.id,
        channel: context.channel,
        body: input.body,
        subject: input.subject ?? null,
        origin: "agent",
        sendKey: input.sendKey,
        runAt: input.runAt,
      });

      if (messageId) await tagMessageWithRun(messageId, context.run.id);

      return {
        ok: true as const,
        data: {
          messageId,
          queuedFor: (input.runAt ?? new Date()).toISOString(),
        },
      };
    },
  );
}

/**
 * SUGGEST_ONLY output. A real message row in DRAFT, which the send worker
 * never claims, so a workspace reviewing drafts is in no danger of one
 * escaping.
 */
export async function draftMessage(
  context: ToolContext,
  input: { body: string; sendKey: string; subject?: string | null },
): Promise<ToolResult<{ messageId: string | null }>> {
  return invoke("draft_message", context, { length: input.body.length }, async () => {
    const messageId = await queueOutboundMessage({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      channel: context.channel,
      body: input.body,
      subject: input.subject ?? null,
      origin: "agent",
      sendKey: input.sendKey,
      enqueueSend: false,
    });

    if (!messageId) {
      return {
        ok: false as const,
        code: "DRAFT_NOT_WRITTEN",
        detail: "Could not write the draft.",
        recoverable: true,
      };
    }

    const admin = createAdminClient();
    await admin
      .from("messages")
      .update({ status: "DRAFT", scheduled_for: null, agent_run_id: context.run.id })
      .eq("id", messageId)
      .eq("business_id", context.business.businessId);

    await queueNotification({
      businessId: context.business.businessId,
      type: "handover",
      severity: "info",
      title: "A suggested reply is ready to review",
      body: input.body.slice(0, 240),
      entityType: "lead",
      entityId: context.lead.id,
      linkUrl: `/app/leads/${context.lead.id}`,
      dedupeKey: `agent_draft:${messageId}`,
    });

    return { ok: true as const, data: { messageId } };
  });
}

export async function sendBookingLink(
  context: ToolContext,
  input: { body: string; sendKey: string },
): Promise<ToolResult<{ messageId: string | null }>> {
  return invoke("send_booking_link", context, { hasLink: true }, async () => {
    const link = context.business.bookingUrl;
    if (!link) {
      return {
        ok: false as const,
        code: "NO_BOOKING_LINK",
        detail: "No booking link is configured.",
        recoverable: false,
      };
    }
    // The link is appended by the runtime, not written by the model, so the
    // URL that goes out is always the configured one byte for byte.
    const body = input.body.includes(link) ? input.body : `${input.body.trim()} ${link}`;

    const messageId = await queueOutboundMessage({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      channel: context.channel,
      body,
      origin: "agent",
      sendKey: input.sendKey,
    });
    if (messageId) await tagMessageWithRun(messageId, context.run.id);

    return { ok: true as const, data: { messageId } };
  });
}

/**
 * Booking creation. Gated on a slot the calendar confirmed during this turn;
 * since no availability provider exists yet, the gate refuses every call and
 * the turn falls back to the booking link or a person. The function is written
 * out in full so that wiring a provider is a one-place change.
 */
export async function createBooking(
  context: ToolContext,
  input: { startsAt: string; endsAt?: string | null; slotLabel: string },
): Promise<ToolResult<{ bookingId: string }>> {
  return invoke("create_booking", context, { slot: input.slotLabel }, async () => {
    const admin = createAdminClient();

    // Re-read before acting: a booking made by a human between the model's
    // proposal and here must not be duplicated.
    const { data: existing } = await admin
      .from("bookings")
      .select("id")
      .eq("business_id", context.business.businessId)
      .eq("lead_id", context.lead.id)
      .eq("status", "scheduled")
      .limit(1)
      .maybeSingle();

    if (existing) {
      return {
        ok: false as const,
        code: "BOOKING_ALREADY_EXISTS",
        detail: "This lead already has a scheduled booking.",
        recoverable: false,
      };
    }

    const { data, error } = await admin
      .from("bookings")
      .insert({
        business_id: context.business.businessId,
        lead_id: context.lead.id,
        service_id: context.lead.service_id,
        provider: "manual",
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        status: "scheduled",
        notes: "Arranged by the ClientTurn assistant.",
      })
      .select("id")
      .single();

    if (error || !data) throw error ?? new Error("Booking insert failed.");

    await admin
      .from("leads")
      .update({ status: "BOOKED" })
      .eq("id", context.lead.id)
      .eq("business_id", context.business.businessId);

    await stopAutomationRuns(context.business.businessId, context.lead.id, "booked");

    return { ok: true as const, data: { bookingId: data.id } };
  });
}

export type HandoverSummary = {
  intent: string;
  service: string | null;
  qualificationStatus: string;
  keyAnswers: { question: string; value: string }[];
  bookingIntent: boolean;
  unresolvedIssue: string | null;
  sentiment: "positive" | "neutral" | "negative";
  summary: string;
};

/**
 * Creates or updates the open handoff for this conversation and moves
 * ownership to a person. The unique partial index means a second reason in the
 * same conversation updates one row instead of flooding the team.
 */
export async function requestHumanHandover(
  context: ToolContext,
  input: { reason: HandoverReason; summary: HandoverSummary; priority?: HandoverPriority },
): Promise<ToolResult<{ handoffId: string | null }>> {
  return invoke("request_human_handover", context, { reason: input.reason }, async () => {
    const admin = createAdminClient();
    const priority = input.priority ?? HANDOVER_PRIORITY_FOR[input.reason];

    let handoffId: string | null = null;

    if (context.conversationId) {
      const { data: open } = await admin
        .from("agent_handoffs")
        .select("id")
        .eq("business_id", context.business.businessId)
        .eq("conversation_id", context.conversationId)
        .in("status", ["OPEN", "ACKNOWLEDGED"])
        .maybeSingle();

      if (open) {
        await admin
          .from("agent_handoffs")
          .update({
            reason: input.reason,
            priority,
            summary_json: input.summary as never,
            agent_run_id: context.run.id,
          })
          .eq("id", open.id);
        handoffId = open.id;
      }
    }

    if (!handoffId) {
      const { data, error } = await admin
        .from("agent_handoffs")
        .insert({
          business_id: context.business.businessId,
          lead_id: context.lead.id,
          conversation_id: context.conversationId,
          agent_run_id: context.run.id,
          reason: input.reason,
          priority,
          summary_json: input.summary as never,
        })
        .select("id")
        .single();
      if (error && error.code !== "23505") throw error;
      handoffId = data?.id ?? null;
    }

    // Ownership moves atomically with the handoff so the agent cannot take
    // another turn on this conversation.
    if (context.conversationId) {
      await admin
        .from("conversations")
        .update({
          owner: "HANDED_OVER",
          owner_changed_at: new Date().toISOString(),
          state: "handover",
          current_question_id: null,
        })
        .eq("id", context.conversationId)
        .eq("business_id", context.business.businessId);
    }

    await flagForAttention({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      reason: `agent_handover:${input.reason}`,
      title: "A conversation needs a person",
      body: input.summary.summary,
      takeover: true,
    });

    return { ok: true as const, data: { handoffId } };
  });
}

/**
 * Suppression. Deterministic by construction: the gate requires a recognised
 * opt-out, which only the keyword/phrase layer can set. No model output can
 * reach this, and no model output can prevent it either.
 */
export async function applySuppression(
  context: ToolContext,
  input: { reason: "opt_out" | "wrong_number"; scope: AgentChannel | "all" },
): Promise<ToolResult<{ contact: string | null }>> {
  return invoke(
    "apply_suppression",
    context,
    { reason: input.reason, scope: input.scope },
    async () => {
      const contact =
        leadContact(context.lead, context.channel) ??
        (context.lead.phone ? normalisePhone(context.lead.phone) : null);

      if (!contact) {
        return {
          ok: false as const,
          code: "NO_CONTACT",
          detail: "The lead has no contact point to suppress.",
          recoverable: false,
        };
      }

      const admin = createAdminClient();
      await admin.from("contact_suppressions").upsert(
        {
          business_id: context.business.businessId,
          normalized_contact: contact,
          channel: input.scope,
          reason: input.reason,
          source: "agent_reply",
        },
        { onConflict: "business_id,normalized_contact,channel" },
      );

      // A wrong number suppresses that endpoint. It does not mark the whole
      // lead unreachable, because another channel may still be valid and the
      // lead may be a real enquiry reached on the wrong number.
      if (input.reason === "opt_out") {
        await admin
          .from("leads")
          .update({
            opted_out: true,
            automation_active: false,
            needs_attention: false,
            attention_reason: null,
          })
          .eq("id", context.lead.id)
          .eq("business_id", context.business.businessId);

        await emitAutomationEvent({
          businessId: context.business.businessId,
          leadId: context.lead.id,
          eventType: "lead.opted_out",
        });
      }

      return { ok: true as const, data: { contact } };
    },
  );
}

export async function stopFollowUp(
  context: ToolContext,
  input: { reason: string },
): Promise<ToolResult<{ stopped: true }>> {
  return invoke("stop_follow_up", context, { reason: input.reason }, async () => {
    await stopAutomationRuns(context.business.businessId, context.lead.id, input.reason);

    const admin = createAdminClient();
    await admin
      .from("campaign_contacts")
      .update({ state: "stopped", stopped_reason: input.reason })
      .eq("business_id", context.business.businessId)
      .eq("lead_id", context.lead.id)
      .in("state", ["pending", "scheduled"]);

    return { ok: true as const, data: { stopped: true as const } };
  });
}

export async function recordReplyClassification(
  context: ToolContext,
  input: { messageId: string; classification: ReplyClassification; confidence: number },
): Promise<ToolResult<{ classification: ReplyClassification }>> {
  return invoke(
    "record_reply_classification",
    context,
    { classification: input.classification },
    async () => {
      const admin = createAdminClient();
      await admin
        .from("messages")
        .update({
          reply_classification: input.classification,
          reply_confidence: input.confidence,
        })
        .eq("id", input.messageId)
        .eq("business_id", context.business.businessId);

      return { ok: true as const, data: { classification: input.classification } };
    },
  );
}

async function tagMessageWithRun(messageId: string, runId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.from("messages").update({ agent_run_id: runId }).eq("id", messageId);
  } catch {
    // Attribution is useful, not load-bearing.
  }
}

