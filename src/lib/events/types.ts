/**
 * The domain event catalogue and the dispatcher's routing decisions
 * (design 03 §4). Pure: the outbox (`./outbox.ts`) does the I/O, this decides
 * what each event is owed, so the routing is asserted without a database
 * (tests/domain-events.test.ts).
 */

/** The public catalogue (design §4). Webhook-deliverable once emitted. */
export const DOMAIN_EVENT_TYPES = [
  "prospect.created",
  "lead.created",
  "lead.touched",
  "lead.scored",
  "score.changed",
  "lead.engaged",
  "lead.qualified",
  "lead.booking_ready",
  "reply.received",
  "meeting.booked",
  "meeting.pending",
  "meeting.cancelled",
  "meeting.no_show",
  "opportunity.created",
  "opportunity.won",
  "opportunity.lost",
  "contact.unsubscribed",
  "contact.suppressed",
  "integration.failed",
  "ai.escalated",
  // Qualification intelligence (design 08 §B.5): emitted by lead.score only
  // when the intent state changes. Public, but deliberately NOT in RESCORE_ON,
  // so an intent change can never re-trigger the assessment that caused it.
  "lead.intent_changed",
] as const;

/**
 * Internal events: facts the engine reacts to (re-scoring) that are not part
 * of the public contract, so they are never forwarded to a customer webhook.
 */
export const INTERNAL_EVENT_TYPES = [
  "reply.classified",
  "qualification.answered",
  // From opportunities/service.ts whenever an open opportunity moves stage.
  "opportunity.stage_changed",
  // From the intent.sweep job: a lead's intent decay boundary (valid_until,
  // a stated timeframe, a NOT_NOW resume date) has passed. "Silence" is this.
  "intent.decay_due",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export type InternalEventType = (typeof INTERNAL_EVENT_TYPES)[number];
export type AnyEventType = DomainEventType | InternalEventType;

export type DomainEventSubject =
  | "lead"
  | "prospect"
  | "booking"
  | "message"
  | "contact"
  | "agent_handoff"
  | "opportunity"
  | "integration"
  | "qualification_answer";

export type DomainEventRow = {
  id: string;
  business_id: string;
  type: string;
  subject_type: string;
  subject_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  causation_depth: number;
  dispatched_at: string | null;
};

export function isKnownEventType(type: string): type is AnyEventType {
  return (
    (DOMAIN_EVENT_TYPES as readonly string[]).includes(type) ||
    (INTERNAL_EVENT_TYPES as readonly string[]).includes(type)
  );
}

/** Loop protection: anything caused more than this many hops deep is dropped. */
export const MAX_CAUSATION_DEPTH = 3;

export function exceedsCausationDepth(depth: number): boolean {
  return depth > MAX_CAUSATION_DEPTH;
}

/* -------------------------------------------------------------- re-score */

/**
 * Events after which a lead is re-scored and re-assessed (design 04 §2
 * triggers; design 08 §B.5 recalculation triggers), in one place. The
 * lead.score job runs the whole assessment: signals -> intent -> score ->
 * tags -> NBA -> one lead_assessments row.
 *
 *   new activity / new form     lead.touched
 *   reply / objection           reply.classified
 *   qualification answer        qualification.answered
 *   booking                     meeting.*
 *   opt-out                     contact.*
 *   opportunity change          opportunity.created / .stage_changed / .won / .lost
 *   silence, expired timeframe  intent.decay_due (the intent.sweep job)
 *
 * `lead.scored`, `score.changed` and `lead.intent_changed` are deliberately
 * absent: scoring must never trigger scoring.
 */
export const RESCORE_ON: readonly AnyEventType[] = [
  "lead.touched",
  "reply.classified",
  "qualification.answered",
  "meeting.booked",
  "meeting.pending",
  "meeting.cancelled",
  "meeting.no_show",
  "contact.unsubscribed",
  "contact.suppressed",
  "opportunity.created",
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "intent.decay_due",
];

/**
 * The lead a re-score is for, or null. `triggerEvent` is `<type>:<event id>`,
 * which with the scoring version is the score's idempotency key -- the same
 * event is scored once however often it is dispatched. It matches
 * `leadScorePayload.triggerEvent`.
 */
export function rescoreFor(event: Pick<DomainEventRow, "id" | "type" | "subject_type" | "subject_id" | "payload">):
  | { leadId: string; triggerEvent: string }
  | null {
  if (!RESCORE_ON.includes(event.type as AnyEventType)) return null;
  const leadId =
    event.subject_type === "lead" && event.subject_id
      ? event.subject_id
      : typeof event.payload?.lead_id === "string"
        ? (event.payload.lead_id as string)
        : null;
  if (!leadId) return null;
  return { leadId, triggerEvent: `${event.type}:${event.id}` };
}

/* ------------------------------------------------------ automation_events */

/**
 * The automation_events projection: the outbox events whose automation
 * vocabulary equivalent has no direct emitter today. Booking and opt-out
 * automation events are still written at their source (book-lead.ts,
 * booking-sync.ts, message-inbound.ts, the agent); projecting those too would
 * double them. Moving them here is the follow-up that lets the direct
 * emitters be deleted.
 */
export const AUTOMATION_PROJECTION: Partial<Record<AnyEventType, string>> = {
  "lead.created": "lead.created",
  "lead.touched": "lead.updated",
};

/* --------------------------------------------------------------- webhooks */

/**
 * The webhook event id for an outbox event. `lead.created` uses the lead id,
 * the id `lead.process` has always used for it, so the two emit paths
 * deliver one event to a customer, not two.
 */
export function webhookEventIdFor(event: Pick<DomainEventRow, "id" | "type" | "subject_id">): string {
  if (event.type === "lead.created" && event.subject_id) return event.subject_id;
  return event.id;
}

/** Only the public catalogue reaches a customer endpoint. */
export function isWebhookForwarded(type: string): boolean {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(type);
}
