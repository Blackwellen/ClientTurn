/**
 * The agent event for an abandoned-checkout nudge. Pure.
 *
 * A nudge is the agent reaching out, not a reply, so it is a `FOLLOW_UP_DUE`
 * turn: the run gate, the "paused" rule for non-reply triggers, the model,
 * the validator and the send guard all apply exactly as to any other
 * outbound turn. The payload names the checkout attempt; the orchestrator's
 * checkout-nudge branch re-reads it before composing anything.
 */

import type { AgentChannel, AgentEvent } from "../agent/types.ts";

export const CHECKOUT_NUDGE_KIND = "checkout_nudge";
export const CHECKOUT_NUDGE_SEND_KEY_PREFIX = "checkout-nudge:";

export function checkoutNudgeSendKey(attemptId: string, nudge: number): string {
  return `${CHECKOUT_NUDGE_SEND_KEY_PREFIX}${attemptId}:${nudge}`;
}

export function checkoutNudgeEvent(input: {
  businessId: string;
  leadId: string;
  attemptId: string;
  nudge: number;
  channel: AgentChannel;
  occurredAt: string;
}): AgentEvent {
  return {
    eventId: `${input.attemptId}:${input.nudge}`,
    eventType: "FOLLOW_UP_DUE",
    businessId: input.businessId,
    leadId: input.leadId,
    conversationId: null,
    channel: input.channel,
    provider: null,
    occurredAt: input.occurredAt,
    text: null,
    payload: { kind: CHECKOUT_NUDGE_KIND, attemptId: input.attemptId, nudge: input.nudge },
    idempotencyKey: checkoutNudgeSendKey(input.attemptId, input.nudge),
  };
}

/** The nudge an event carries, or null for any other event. */
export function checkoutNudgeOf(event: Pick<AgentEvent, "eventType" | "payload">): { attemptId: string; nudge: number } | null {
  if (event.eventType !== "FOLLOW_UP_DUE") return null;
  const payload = event.payload ?? {};
  if (payload.kind !== CHECKOUT_NUDGE_KIND) return null;
  const attemptId = typeof payload.attemptId === "string" ? payload.attemptId : null;
  const nudge = typeof payload.nudge === "number" && Number.isInteger(payload.nudge) ? payload.nudge : null;
  return attemptId && nudge !== null && nudge >= 1 ? { attemptId, nudge } : null;
}
