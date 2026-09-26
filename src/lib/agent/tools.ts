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
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { suppress } from "@/lib/policy/suppression";
import { emitAutomationEvent } from "@/lib/automation/events";
import { enqueue } from "@/lib/jobs/queue";
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
import { getAvailability, recheckGoogleSlot, type AvailabilityContext } from "./availability";
import { assignBooking, meetingTypeForLead } from "@/lib/bookings/meeting-type-store";
import {
  createGoogleCalendarEvent,
  type CreateGoogleCalendarEventResult,
} from "@/lib/integrations/providers/google-calendar";
import {
  ACTIVE_BOOKING_STATUSES,
  calendarIsUsable,
  inviteeEmail,
  isUniqueViolation,
  planBookingRoute,
} from "@/lib/bookings/confirmation";
import { onBookingScheduled } from "@/lib/bookings/reminders";
import { advanceLeadOpportunitySafely } from "@/lib/opportunities/service";
import { checkoutMessage, type CheckoutLink } from "@/lib/commercial/authority";
import { recordAudit } from "@/lib/audit";
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
import { HANDOVER_PRIORITY_FOR, toMessageReplyClassification } from "./types";
import { interestForReplyClassification } from "@/lib/inbox/interest";

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
  "propose_checkout",
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
  propose_checkout: {
    name: "propose_checkout",
    description:
      "Send one approved checkout link with its approved price text (direct close, decision Q2).",
    // HIGH: it asks a person for money. The commercial gate (enabled, motion,
    // approved link, value ceiling) is decided before this is reached; the
    // policy gate adds the confidence floor and contactability.
    risk: "HIGH",
    requirements: { requiresContactability: true },
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

/** One slot as returned by a calendar provider. */
export type AvailabilitySlot = { startsAt: string; endsAt: string; label: string };

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
 * Real bookable slots, from a real calendar.
 *
 * Google is asked for busy intervals and the pure slot engine subtracts them
 * from configured business hours; Calendly owns its own availability rules and
 * is asked for free times directly. Either way the labels returned here are
 * the ONLY times the composer is allowed to say out loud -- `validateResponse`
 * rejects any other clock time in the draft.
 *
 * A provider that is missing, unhealthy or erroring returns a typed failure,
 * never an empty list. Empty means "genuinely nothing free", which is a
 * different answer and earns a different reply.
 */
export async function getCalendarAvailability(
  context: ToolContext,
  input: {
    dayPart?: string | null;
    date?: string | null;
    availability: AvailabilityContext;
    timezone: string;
    limit?: number;
  },
): Promise<ToolResult<{ slots: AvailabilitySlot[]; labels: string[]; provider: string }>> {
  return invoke<{ slots: AvailabilitySlot[]; labels: string[]; provider: string }>(
    "get_calendar_availability",
    context,
    { date: input.date ?? null, dayPart: input.dayPart ?? null },
    async () => {
      const result = await getAvailability(
        {
          businessId: context.business.businessId,
          timezone: input.timezone,
          date: input.date,
          dayPart: input.dayPart,
          limit: input.limit ?? 3,
        },
        input.availability,
      );

      if (!result.ok) {
        return {
          ok: false as const,
          code: result.code,
          detail: result.detail,
          // A transient provider error is worth one retry on a later turn; a
          // missing configuration is not.
          recoverable: result.code === "PROVIDER_ERROR",
        };
      }

      return {
        ok: true as const,
        data: {
          slots: result.slots,
          labels: result.slots.map((slot) => slot.label),
          provider: result.provider,
        },
      };
    },
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
  input: {
    body: string;
    sendKey: string;
    runAt?: Date;
    subject?: string | null;
    /**
     * `agent_handover` only for the runtime's own fixed acknowledgement of a
     * handover, which the guard lets through the takeover it announces. Never
     * set from model output.
     */
    origin?: "agent" | "agent_handover";
    /** §61 outcome features for this message (learning/features.ts). */
    features?: Record<string, unknown> | null;
  },
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
        origin: input.origin ?? "agent",
        sendKey: input.sendKey,
        runAt: input.runAt,
        features: input.features ?? null,
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
    const { error: draftError } = await admin
      .from("messages")
      .update({ status: "DRAFT", scheduled_for: null, agent_run_id: context.run.id })
      .eq("id", messageId)
      .eq("business_id", context.business.businessId);

    // The row was written QUEUED with no send job. If it could not be demoted
    // to DRAFT it is not reviewable, so the tool reports failure rather than
    // telling the workspace a draft is waiting.
    if (draftError) {
      console.error("[draftMessage] DRAFT demotion failed", {
        businessId: context.business.businessId,
        leadId: context.lead.id,
        messageId,
        code: draftError.code,
        message: draftError.message,
      });
      return {
        ok: false as const,
        code: "DRAFT_NOT_WRITTEN",
        detail: "Could not write the draft.",
        recoverable: true,
      };
    }

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
 * Direct close (Phase 3.2). Sends an approved checkout link: the model's
 * words, then the registered URL appended by the runtime, so the link that
 * goes out is the approved one byte for byte. The lead's opportunity moves to
 * CHECKOUT_SENT. Nothing here records a purchase -- completion arrives from
 * the customer's CRM or a webhook, never from the agent.
 *
 * The caller has already passed `checkoutGate` and the validator; this is the
 * action, not the decision.
 */
export async function proposeCheckout(
  context: ToolContext,
  input: { body: string; sendKey: string; link: CheckoutLink },
): Promise<ToolResult<{ messageId: string | null; opportunityId: string | null }>> {
  return invoke("propose_checkout", context, { linkId: input.link.id }, async () => {
    const messageId = await queueOutboundMessage({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      channel: context.channel,
      body: checkoutMessage(input.body, input.link),
      origin: "agent",
      sendKey: input.sendKey,
    });
    if (messageId) await tagMessageWithRun(messageId, context.run.id);

    const advanced = await advanceLeadOpportunitySafely({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      event: "CHECKOUT_SENT",
      checkoutLinkId: input.link.id,
    });

    await recordAudit({
      businessId: context.business.businessId,
      actorType: "system",
      action: "checkout.proposed",
      entityType: "lead",
      entityId: context.lead.id,
      metadata: { link_id: input.link.id, agent_run_id: context.run.id, message_id: messageId },
    });

    return {
      ok: true as const,
      data: { messageId, opportunityId: advanced.ok ? advanced.opportunityId : null },
    };
  });
}

/**
 * Booking creation. Gated on a slot the calendar confirmed during this turn.
 *
 * B10 (brief §57, decision Q1): a time the lead chose is only a *booking*
 * once a provider has confirmed it. The route is decided by
 * `planBookingRoute` (lib/bookings/confirmation.ts):
 *
 *   * `google_calendar` -- the slot is re-checked against the calendar right
 *     now, a `pending` row claims it (the partial unique index from 0113 stops
 *     a second lead taking the same start time), and the Google event is
 *     written with the lead as an attendee so they receive a real invite. Only
 *     when Google accepts the event does the row become `scheduled` and the
 *     lead BOOKED. If Google cannot confirm it, the row stays `pending`, the
 *     team is notified, and the call fails with CALENDAR_NOT_CONFIRMED so the
 *     orchestrator tells the lead a person will confirm -- never "booked".
 *   * `calendly_link` -- the Calendly integration has no scheduling API, so
 *     ClientTurn cannot book for the lead. Fails with PROVIDER_BOOKS_ITSELF;
 *     the orchestrator sends the booking link and booking.sync records the
 *     booking when Calendly's webhook arrives.
 *   * `pending` (manual / handover / no usable calendar) -- recorded as a
 *     request awaiting the business's confirmation. The lead is not BOOKED
 *     until a person confirms it (bookings/actions.ts).
 *
 * A slot taken since it was offered fails with SLOT_TAKEN (recoverable) so the
 * orchestrator can offer fresh times.
 */
/** The meeting type and assignee for a new booking (§57). Never throws. */
async function routeBooking(
  businessId: string,
  leadId: string,
  serviceId: string | null,
): Promise<{ meetingTypeId: string | null; assignedUserId: string | null }> {
  try {
    const meetingType = await meetingTypeForLead(businessId, serviceId);
    if (!meetingType) return { meetingTypeId: null, assignedUserId: null };
    const { data: owner } = await createAdminClient()
      .from("leads")
      .select("assigned_user_id")
      .eq("business_id", businessId)
      .eq("id", leadId)
      .maybeSingle();
    const decision = await assignBooking({
      businessId,
      meetingType,
      serviceId,
      ownerUserId: owner?.assigned_user_id ?? null,
    });
    return { meetingTypeId: meetingType.id, assignedUserId: decision.userId };
  } catch (error) {
    console.error("[createBooking] rep routing failed; booking unassigned", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { meetingTypeId: null, assignedUserId: null };
  }
}

export async function createBooking(
  context: ToolContext,
  input: {
    startsAt: string;
    endsAt?: string | null;
    slotLabel: string;
    /** The workspace's booking buffer, applied to the re-check. */
    bufferMinutes?: number;
    /**
     * The lead's meeting type's calendar (§57) -- the one the offered slot was
     * read from, so the re-check and the event write use it too.
     */
    calendarIntegrationId?: string | null;
  },
): Promise<ToolResult<CreatedBooking>> {
  return invoke<CreatedBooking>("create_booking", context, { slot: input.slotLabel }, async () => {
    const admin = createAdminClient();
    const businessId = context.business.businessId;

    // Re-read before acting: a booking or request made by a human between
    // the model's proposal and here must not be duplicated.
    const { data: existing, error: existingError } = await admin
      .from("bookings")
      .select("id")
      .eq("business_id", businessId)
      .eq("lead_id", context.lead.id)
      .in("status", [...ACTIVE_BOOKING_STATUSES])
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return {
        ok: false as const,
        code: "BOOKING_ALREADY_EXISTS",
        detail: "This lead already has an active booking or booking request.",
        recoverable: false,
      };
    }

    let calendarStatus: string | null = null;
    if (context.business.bookingMode === "google_calendar") {
      const { data: integration, error: integrationError } = await admin
        .from("integrations")
        .select("status")
        .eq("business_id", businessId)
        .eq("provider_type", "google_calendar")
        .maybeSingle();
      if (integrationError) throw integrationError;
      calendarStatus = integration?.status ?? null;
    }

    const route = planBookingRoute({
      bookingMode: context.business.bookingMode,
      calendarUsable: calendarIsUsable(calendarStatus),
    });

    if (route === "calendly_link") {
      return {
        ok: false as const,
        code: "PROVIDER_BOOKS_ITSELF",
        detail: "Calendly bookings are made by the lead on Calendly, not by ClientTurn.",
        recoverable: false,
      };
    }

    // The offered slot (see ./availability) always carries an end time; the
    // fallback here only guards against a malformed model call and matches no
    // particular configured duration, so it is deliberately conservative.
    const endsAt =
      input.endsAt ?? new Date(new Date(input.startsAt).getTime() + 60 * 60_000).toISOString();
    const slot = { startsAt: input.startsAt, endsAt };

    // ---- google: is the slot still free right now? ----------------------
    let recheck: Awaited<ReturnType<typeof recheckGoogleSlot>> | null = null;
    if (route === "google_calendar") {
      recheck = await recheckGoogleSlot({
        businessId,
        slot,
        bufferMinutes: input.bufferMinutes ?? 0,
        calendarIntegrationId: input.calendarIntegrationId ?? null,
      });
      if (recheck.ok && !recheck.free) {
        return {
          ok: false as const,
          code: "SLOT_TAKEN",
          detail: "The calendar no longer has this slot free.",
          recoverable: true,
        };
      }
    }

    // ---- rep routing (§57) ----------------------------------------------
    // The lead's meeting type decides who takes it: round robin, specialism
    // or the lead's owner. No meeting types = no assignee, as before. Routing
    // never blocks a booking -- a failed lookup books it unassigned.
    const routing = await routeBooking(businessId, context.lead.id, context.lead.service_id ?? null);

    // ---- claim the slot as a request ------------------------------------
    const { data: row, error: insertError } = await admin
      .from("bookings")
      .insert({
        // meeting_type_id (0127) post-dates the generated types.
        ...((routing.meetingTypeId ? { meeting_type_id: routing.meetingTypeId } : {}) as Record<string, never>),
        assigned_user_id: routing.assignedUserId,
        business_id: businessId,
        lead_id: context.lead.id,
        service_id: context.lead.service_id,
        provider: "manual",
        starts_at: input.startsAt,
        ends_at: endsAt,
        status: "pending",
        notes: "Requested through the ClientTurn assistant; awaiting confirmation.",
      })
      .select("id")
      .single();

    if (isUniqueViolation(insertError)) {
      return {
        ok: false as const,
        code: "SLOT_TAKEN",
        detail: "Another booking already holds this start time.",
        recoverable: true,
      };
    }
    if (insertError || !row) throw insertError ?? new Error("Booking insert failed.");

    const leadName =
      [context.lead.first_name, context.lead.last_name].filter(Boolean).join(" ") || "Lead";

    // ---- manual: a request for the business to confirm (Q1) -------------
    if (route === "pending") {
      await notifyPendingBooking(context, row.id, leadName, input.slotLabel, null);
      return {
        ok: true as const,
        data: { bookingId: row.id, startsAt: input.startsAt, outcome: "pending", invited: false },
      };
    }

    // ---- google: only the provider's acceptance makes it a booking ------
    const invitee = inviteeEmail(context.lead.email);
    const eventResult: CreateGoogleCalendarEventResult =
      recheck && recheck.ok
        ? await createGoogleCalendarEvent({
            integrationId: recheck.integrationId,
            calendarId: recheck.calendarId,
            summary: `${leadName} — ${context.business.name}`,
            description: "Booked by the ClientTurn assistant.",
            startsAt: input.startsAt,
            endsAt,
            timezone: context.business.timezone,
            attendees: invitee ? [{ email: invitee, displayName: leadName }] : undefined,
          })
        : {
            ok: false,
            detail: recheck && !recheck.ok ? recheck.detail : "Calendar re-check unavailable.",
          };

    if (!eventResult.ok) {
      const reason = `Google Calendar could not confirm this time: ${eventResult.detail}`;
      const { error: noteError } = await admin
        .from("bookings")
        .update({
          notes: `Requested through the ClientTurn assistant; awaiting confirmation. ${reason}`.slice(
            0,
            2000,
          ),
        })
        .eq("id", row.id)
        .eq("business_id", businessId);
      if (noteError) console.error("[createBooking] note write failed", noteError.message);

      await notifyPendingBooking(context, row.id, leadName, input.slotLabel, reason);
      return {
        ok: false as const,
        code: "CALENDAR_NOT_CONFIRMED",
        detail: reason,
        recoverable: true,
      };
    }

    const { error: confirmError } = await admin
      .from("bookings")
      .update({
        status: "scheduled",
        provider: "google_calendar",
        external_event_id: eventResult.eventId,
        booking_url: eventResult.htmlLink,
        notes: "Arranged by the ClientTurn assistant.",
      })
      .eq("id", row.id)
      .eq("business_id", businessId);

    if (confirmError) {
      // The event exists on the calendar, but ClientTurn could not record the
      // confirmation. Leave it for a person rather than claim a booking the
      // system of record does not hold.
      const reason = `Google Calendar event ${eventResult.eventId} was created but the booking could not be marked confirmed.`;
      await notifyPendingBooking(context, row.id, leadName, input.slotLabel, reason);
      return {
        ok: false as const,
        code: "CALENDAR_NOT_CONFIRMED",
        detail: reason,
        recoverable: true,
      };
    }

    await markLeadBooked(context, leadName, input.startsAt, row.id);

    return {
      ok: true as const,
      data: {
        bookingId: row.id,
        startsAt: input.startsAt,
        outcome: "confirmed",
        invited: Boolean(invitee),
      },
    };
  });
}

export type CreatedBooking = {
  bookingId: string;
  startsAt: string;
  /** `confirmed` only after a provider accepted it; `pending` awaits the business. */
  outcome: "confirmed" | "pending";
  /** Whether the lead was sent a calendar invitation. */
  invited: boolean;
};

/** A confirmed booking: the lead is BOOKED and follow-up stops. */
async function markLeadBooked(
  context: ToolContext,
  leadName: string,
  startsAt: string,
  bookingId: string,
): Promise<void> {
  const businessId = context.business.businessId;
  const leadId = context.lead.id;
  const { error } = await createAdminClient()
    .from("leads")
    .update({ status: "BOOKED", booked_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("business_id", businessId);
  if (error) throw error;

  await stopAutomationRuns(businessId, leadId, "booked");

  await emitAutomationEvent({ businessId, leadId, eventType: "booking.created" });

  // Reminder + opportunity MEETING_BOOKED (Phase 3.1 / 3.3).
  await onBookingScheduled({ businessId, leadId, bookingId });

  if (context.business.slackNotify.booking) {
    await enqueue(
      "notification.slack",
      { businessId, leadId, text: `Booked: ${leadName} — ${startsAt}` },
      { businessId },
    );
  }
}

/** A requested time the business must confirm. The lead is not BOOKED. */
async function notifyPendingBooking(
  context: ToolContext,
  bookingId: string,
  leadName: string,
  slotLabel: string,
  problem: string | null,
): Promise<void> {
  const businessId = context.business.businessId;
  await queueNotification({
    businessId,
    type: "booking",
    severity: problem ? "warning" : "info",
    title: `${leadName} requested ${slotLabel} — please confirm`,
    body: problem ?? "The lead has been told the time is requested and that you will confirm it.",
    entityType: "lead",
    entityId: context.lead.id,
    linkUrl: `/app/leads/${context.lead.id}`,
    dedupeKey: `booking_pending:${bookingId}`,
  });

  if (context.business.slackNotify.booking) {
    await enqueue(
      "notification.slack",
      {
        businessId,
        leadId: context.lead.id,
        text: `Booking requested (needs confirming): ${leadName} — ${slotLabel}`,
      },
      { businessId },
    );
  }
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
 * The agent already computed a real summary for `agent_handoffs.summary_json`
 * -- qualification state, sentiment, the answers so far -- and until now that
 * detail was thrown away the moment it reached Slack, which only ever saw the
 * generic "A conversation needs a person" line every other handover reason
 * also produces. This is the one Slack message on the whole platform that can
 * actually justify more than a title, because it is the one case where the
 * extra detail already exists for free.
 */
function formatHandoverSlackText(
  leadName: string,
  reason: HandoverReason,
  priority: HandoverPriority,
  summary: HandoverSummary,
): string {
  const lines = [
    `🤖 Agent handover — ${reason.replace(/_/g, " ").toLowerCase()} (${priority.toLowerCase()} priority)`,
    `Lead: ${leadName}${summary.service ? ` · ${summary.service}` : ""}`,
    `Qualification: ${summary.qualificationStatus} · Sentiment: ${summary.sentiment} · Booking intent: ${summary.bookingIntent ? "yes" : "no"}`,
  ];
  if (summary.keyAnswers.length > 0) {
    lines.push(
      `Key answers: ${summary.keyAnswers.map((a) => `${a.question} — ${a.value}`).join(" · ")}`,
    );
  }
  if (summary.unresolvedIssue) lines.push(`Unresolved: ${summary.unresolvedIssue}`);
  if (summary.summary) lines.push(summary.summary);
  return lines.join("\n");
}

/**
 * Acknowledge/Resolve buttons, handled by
 * `src/app/api/webhooks/slack/interactive/route.ts`. `value` carries the
 * `agent_handoffs.id` verbatim -- the interactive handler re-derives the
 * business from the Slack team id and re-checks the handoff belongs to it
 * before touching anything, so this value is a lookup key, never a trusted
 * authorization claim by itself.
 */
function buildHandoverSlackBlocks(text: string, handoffId: string): unknown[] {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Acknowledge" },
          action_id: "handoff_ack",
          value: handoffId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Resolve" },
          style: "primary",
          action_id: "handoff_resolve",
          value: handoffId,
        },
      ],
    },
  ];
}

/** The handoff-pack keys of an existing summary_json (Phase 3.4). */
function keepBrief(value: unknown): Record<string, unknown> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of ["leadBrief", "quickBrief", "crmNotes"]) {
    if (key in raw) kept[key] = raw[key];
  }
  return kept;
}

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
        .select("id, summary_json")
        .eq("business_id", context.business.businessId)
        .eq("conversation_id", context.conversationId)
        .in("status", ["OPEN", "ACKNOWLEDGED"])
        .maybeSingle();

      if (open) {
        // The open handoff already exists; a failed refresh only leaves its
        // summary one reason behind.
        logWriteError(
          await admin
            .from("agent_handoffs")
            .update({
              reason: input.reason,
              priority,
              // The handoff pack (leadBrief / quickBrief / crmNotes) survives a
              // refresh until the re-queued brief job rebuilds it.
              summary_json: { ...keepBrief(open.summary_json), ...input.summary } as never,
              agent_run_id: context.run.id,
            })
            .eq("id", open.id),
          "handover: refresh open handoff",
          { businessId: context.business.businessId, leadId: context.lead.id, handoffId: open.id },
        );
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

    // The handoff pack (Phase 3.4): built off the conversation's critical path.
    // Keyed on the handoff so a refreshed reason while one is queued does not
    // queue a second; a later refresh re-builds it from current state.
    if (handoffId) {
      await enqueue(
        "handoff.brief",
        { handoffId },
        { businessId: context.business.businessId, idempotencyKey: `handoff-brief:${handoffId}` },
      );
    }

    // Ownership moves atomically with the handoff so the agent cannot take
    // another turn on this conversation.
    // A failure here would leave the agent owning a conversation it has
    // handed over, so it fails the tool (invoke() records TOOL_ERROR) rather
    // than reporting a handover that did not take. The handoff row above is
    // reused by a retry through the open-handoff lookup.
    if (context.conversationId) {
      assertWrite(
        await admin
          .from("conversations")
          .update({
            owner: "HANDED_OVER",
            owner_changed_at: new Date().toISOString(),
            state: "handover",
            current_question_id: null,
          })
          .eq("id", context.conversationId)
          .eq("business_id", context.business.businessId),
        "handover: move conversation ownership",
        {
          businessId: context.business.businessId,
          leadId: context.lead.id,
          conversationId: context.conversationId,
        },
      );
    }

    const leadName =
      [context.lead.first_name, context.lead.last_name].filter(Boolean).join(" ") ||
      "A lead";

    const slackText = formatHandoverSlackText(leadName, input.reason, priority, input.summary);

    await flagForAttention({
      businessId: context.business.businessId,
      leadId: context.lead.id,
      reason: `agent_handover:${input.reason}`,
      title: "A conversation needs a person",
      body: input.summary.summary,
      takeover: true,
      slackText,
      // No handoffId, no buttons: a button posted without one to act on would
      // be worse than none, since clicking it could only ever fail.
      slackBlocks: handoffId ? buildHandoverSlackBlocks(slackText, handoffId) : undefined,
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

      // The one suppression list, shared with the cold path (0069). The agent's
      // scope and reason vocabularies are the V3 lower-case ones, mapped here
      // rather than at the tool boundary so the tool contract is unchanged.
      await suppress({
        businessId: context.business.businessId,
        channel:
          input.scope === "all"
            ? "ALL"
            : input.scope === "email"
              ? "EMAIL"
              : input.scope === "whatsapp"
                ? "WHATSAPP"
                : "SMS",
        reason: input.reason === "opt_out" ? "OPT_OUT" : "INVALID",
        source: "AGENT_REPLY",
        email: contact.includes("@") ? contact : null,
        phone: contact.includes("@") ? null : contact,
      });

      // A wrong number suppresses that endpoint. It does not mark the whole
      // lead unreachable, because another channel may still be valid and the
      // lead may be a real enquiry reached on the wrong number.
      if (input.reason === "opt_out") {
        // The suppression above already blocks sends; the lead flag is what
        // the UI and follow-up read, so a failure fails the tool rather than
        // reporting an opt-out that is only half recorded.
        assertWrite(
          await admin
            .from("leads")
            .update({
              opted_out: true,
              automation_active: false,
              needs_attention: false,
              attention_reason: null,
            })
            .eq("id", context.lead.id)
            .eq("business_id", context.business.businessId),
          "agent opt-out: lead update",
          { businessId: context.business.businessId, leadId: context.lead.id },
        );

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
    // A contact left "scheduled" would still be sent the next step.
    assertWrite(
      await admin
        .from("campaign_contacts")
        .update({ state: "stopped", stopped_reason: input.reason })
        .eq("business_id", context.business.businessId)
        .eq("lead_id", context.lead.id)
        .in("state", ["pending", "scheduled"]),
      "stop follow-up: campaign contacts stop",
      { businessId: context.business.businessId, leadId: context.lead.id },
    );

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
      // The agent's bucket is mapped onto the stored vocabulary; writing it
      // raw was rejected by the CHECK for most values (B14).
      const stored = toMessageReplyClassification(input.classification);
      const { error } = await admin
        .from("messages")
        .update({
          reply_classification: stored,
          reply_confidence: input.confidence,
        })
        .eq("id", input.messageId)
        .eq("business_id", context.business.businessId);

      if (error) {
        // Non-fatal for the turn: the caller ignores the result, and invoke()
        // records the failure in the decision log.
        console.error("recordReplyClassification update failed", {
          businessId: context.business.businessId,
          messageId: input.messageId,
          classification: input.classification,
          stored,
          code: error.code,
          message: error.message,
        });
        return {
          ok: false as const,
          code: "WRITE_FAILED",
          detail: `reply_classification not stored: ${error.message}`,
          recoverable: true,
        };
      }

      // Carry the verdict onto the thread for the inbox's Interested view.
      // Display state: logged, never fails the turn.
      const interest = interestForReplyClassification(stored);
      if (interest && context.conversationId) {
        const { error: interestError } = await admin
          .from("conversations")
          .update({ interest })
          .eq("id", context.conversationId)
          .eq("business_id", context.business.businessId);
        if (interestError) {
          console.error("recordReplyClassification interest update failed", {
            businessId: context.business.businessId,
            conversationId: context.conversationId,
            code: interestError.code,
            message: interestError.message,
          });
        }
      }

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

