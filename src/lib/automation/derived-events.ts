/**
 * Automation triggers read off facts the product already records (gap map
 * §45), so their source paths do not each need a new emit call:
 *
 *   * `intent.threshold_exceeded`  from `lead.intent_changed` (lead.score), with
 *     the new intent score. A rule's "score at least" condition is the
 *     threshold, so one event serves every workspace's own line.
 *   * `objection.detected`         from an inbound reply classified OBJECTION.
 *   * `human.requested`            from a hand-over whose reason is that the
 *     lead asked for a person (the conversation agent's `lead.human_takeover`).
 *
 * Voice calls produce the same two triggers through voice-events.ts.
 * Pure, so tests/automation-rules.test.ts asserts it directly.
 */

import type { AutomationEventType } from "./event-types.ts";

export type DerivedEvent = {
  eventType: AutomationEventType;
  leadId: string | null;
  payload: Record<string, unknown>;
};

/** From a domain event (the outbox). */
export function derivedFromDomainEvent(event: {
  type: string;
  subject_type: string;
  subject_id: string | null;
  payload: Record<string, unknown>;
}): DerivedEvent[] {
  const payload = event.payload ?? {};
  const leadId =
    event.subject_type === "lead" && event.subject_id
      ? event.subject_id
      : typeof payload.lead_id === "string"
        ? payload.lead_id
        : null;

  if (event.type === "lead.intent_changed") {
    const score = typeof payload.intent_score === "number" ? payload.intent_score : Number(payload.intent_score);
    if (!Number.isFinite(score)) return [];
    return [
      {
        eventType: "intent.threshold_exceeded",
        leadId,
        payload: { leadId, score, intentState: payload.intent_state ?? null, previousState: payload.previous_intent_state ?? null },
      },
    ];
  }

  if ((event.type === "reply.received" || event.type === "reply.classified") && payload.classification === "OBJECTION") {
    return [
      {
        eventType: "objection.detected",
        leadId,
        payload: { leadId, messageId: payload.message_id ?? null, channel: payload.channel ?? null, source: "message" },
      },
    ];
  }
  return [];
}

/** From an automation event as it is written (emitAutomationEvent). */
export function derivedFromAutomationEvent(input: {
  eventType: string;
  leadId: string | null;
  payload: Record<string, unknown>;
}): DerivedEvent[] {
  if (input.eventType === "lead.human_takeover" && input.payload.reason === "HUMAN_REQUESTED") {
    return [{ eventType: "human.requested", leadId: input.leadId, payload: { leadId: input.leadId, source: "message" } }];
  }
  return [];
}
