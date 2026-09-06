import "server-only";

/**
 * Event normalisation and dispatch.
 *
 * Every trigger becomes an `AgentEvent` here and nowhere else, so the
 * orchestrator has exactly one input shape and never branches on which
 * provider a message arrived from. The idempotency key is built from facts the
 * provider cannot vary between retries -- a stored message id, a booking id --
 * so a redelivered webhook, a retried job and a restarted worker all collapse
 * onto one agent run.
 */

import { z } from "zod";
import { enqueue } from "@/lib/jobs/queue";
import type { AgentChannel, AgentEvent, AgentEventType } from "./types";

export const agentRunPayload = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.enum([
    "LEAD_CREATED",
    "INBOUND_SMS",
    "INBOUND_WHATSAPP",
    "INBOUND_EMAIL",
    "FORM_SUBMISSION",
    "QUALIFICATION_ANSWER",
    "BOOKING_CREATED",
    "BOOKING_CANCELLED",
    "BOOKING_RESCHEDULED",
    "FOLLOW_UP_DUE",
    "REACTIVATION_REPLY",
    "HUMAN_HANDOVER_RESOLVED",
    "MANUAL_AGENT_REQUEST",
  ]),
  businessId: z.uuid(),
  leadId: z.uuid(),
  conversationId: z.uuid().nullable().default(null),
  channel: z.enum(["sms", "whatsapp", "email"]).nullable().default(null),
  provider: z.string().max(60).nullable().default(null),
  occurredAt: z.string(),
  text: z.string().max(8000).nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(200),
});

export type AgentRunPayload = z.infer<typeof agentRunPayload>;

const CHANNEL_EVENT: Record<AgentChannel, AgentEventType> = {
  sms: "INBOUND_SMS",
  whatsapp: "INBOUND_WHATSAPP",
  email: "INBOUND_EMAIL",
};

/** Builds the envelope for an inbound message that has already been stored. */
export function inboundMessageEvent(input: {
  businessId: string;
  leadId: string;
  conversationId: string;
  channel: AgentChannel;
  provider: string | null;
  /** The `messages.id` of the stored inbound row -- stable across retries. */
  messageId: string;
  body: string;
  receivedAt: string;
  /** Set when the message arrived on a live reactivation campaign contact. */
  fromReactivation?: boolean;
}): AgentEvent {
  return {
    eventId: input.messageId,
    eventType: input.fromReactivation
      ? "REACTIVATION_REPLY"
      : CHANNEL_EVENT[input.channel],
    businessId: input.businessId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    channel: input.channel,
    provider: input.provider,
    occurredAt: input.receivedAt,
    text: input.body,
    payload: {},
    // The stored message id is the natural dedupe key: the unique index on
    // (provider, provider_message_id) already made writing it once-only.
    idempotencyKey: `inbound:${input.messageId}`,
  };
}

export function leadCreatedEvent(input: {
  businessId: string;
  leadId: string;
  conversationId: string | null;
  channel: AgentChannel;
  enquiryText: string | null;
  createdAt: string;
}): AgentEvent {
  return {
    eventId: input.leadId,
    eventType: "LEAD_CREATED",
    businessId: input.businessId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    channel: input.channel,
    provider: null,
    occurredAt: input.createdAt,
    text: input.enquiryText,
    payload: {},
    idempotencyKey: `lead-created:${input.leadId}`,
  };
}

export function bookingEvent(input: {
  businessId: string;
  leadId: string;
  conversationId: string | null;
  channel: AgentChannel;
  bookingId: string;
  kind: "BOOKING_CREATED" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED";
  occurredAt: string;
}): AgentEvent {
  return {
    eventId: input.bookingId,
    eventType: input.kind,
    businessId: input.businessId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    channel: input.channel,
    provider: null,
    occurredAt: input.occurredAt,
    text: null,
    payload: { bookingId: input.bookingId },
    idempotencyKey: `${input.kind.toLowerCase()}:${input.bookingId}`,
  };
}

/**
 * Queues a turn. The webhook path must never wait for a model call, so every
 * agent run goes through the job queue -- the provider gets its acknowledgement
 * in milliseconds and the worker does the thinking.
 */
export async function enqueueAgentTurn(event: AgentEvent): Promise<string | null> {
  return enqueue("agent.run", event as unknown as Record<string, unknown>, {
    businessId: event.businessId,
    // Priority 50 puts agent turns ahead of the default-100 background work
    // (rollups, health checks) without pre-empting an in-flight send.
    priority: 50,
    maxAttempts: 3,
    idempotencyKey: `agent.run:${event.idempotencyKey}`,
  });
}
