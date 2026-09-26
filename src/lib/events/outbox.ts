import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { emitAutomationEvent, type AutomationEventType } from "@/lib/automation/events";
import {
  AUTOMATION_PROJECTION,
  exceedsCausationDepth,
  isWebhookForwarded,
  rescoreFor,
  webhookEventIdFor,
  type AnyEventType,
  type DomainEventRow,
  type DomainEventType,
  type DomainEventSubject,
} from "./types";

/**
 * The domain event outbox (design 03 §4, D10).
 *
 * `emitDomainEvent()` writes one `domain_events` row (idempotent on its
 * `dedupe_key`) and queues `event.dispatch` in the same database call
 * (`emit_domain_event()`, 0123). Bookings, suppressions, handoffs, inbound
 * replies and qualification answers emit from SQL triggers instead, inside the
 * transaction of the change itself.
 *
 * `event.dispatch` runs the consumers below. Each is retry-safe on its own:
 *
 *   - **webhooks**: the types in `WEBHOOK_FORWARDED`, routed through
 *     `emitWebhookEvent`, idempotent per (endpoint, event id), so a
 *     re-dispatch delivers nothing twice.
 *   - **automation_events**: the projection in `AUTOMATION_PROJECTION`.
 *   - **re-scoring**: `lead.score` for the events in `RESCORE_ON`, keyed
 *     `<type>:<event id>` so each event is scored once.
 *
 * Slack is deliberately not a consumer yet. Every Slack notification that
 * exists today (new lead once follow-up starts, handover, booking) is sent
 * directly by its source, two of them from modules this outbox does not own;
 * a Slack consumer here would notify twice until those are moved.
 *
 * Loop protection: an event more than MAX_CAUSATION_DEPTH hops from its root
 * is dropped with a warning and marked dispatched, never fanned out.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type EmitDomainEventInput = {
  businessId: string;
  type: AnyEventType;
  subject: { type: DomainEventSubject; id: string | null };
  payload?: Record<string, unknown>;
  /** Unique across the platform: the same key never emits twice. */
  dedupeKey: string;
  causation?: { id?: string | null; depth?: number };
  occurredAt?: string | null;
};

/**
 * Never throws: an event is a notification about work that already happened,
 * and failing that work because its notification could not be written would
 * be the tail wagging the dog. A failure is logged with context.
 */
export async function emitDomainEvent(
  input: EmitDomainEventInput,
): Promise<{ id: string | null; inserted: boolean }> {
  try {
    const { data, error } = await db().rpc("emit_domain_event", {
      p_business_id: input.businessId,
      p_type: input.type,
      p_subject_type: input.subject.type,
      p_subject_id: input.subject.id,
      p_payload: input.payload ?? {},
      p_dedupe_key: input.dedupeKey,
      p_causation_id: input.causation?.id ?? null,
      p_causation_depth: input.causation?.depth ?? 0,
      p_occurred_at: input.occurredAt ?? null,
    });
    if (error) {
      console.error("[outbox] emit_domain_event failed", {
        type: input.type,
        businessId: input.businessId,
        dedupeKey: input.dedupeKey,
        code: error.code,
        message: error.message,
      });
      return { id: null, inserted: false };
    }
    const result = (data ?? {}) as { id?: string | null; inserted?: boolean };
    return { id: result.id ?? null, inserted: result.inserted === true };
  } catch (error) {
    console.error("[outbox] emit_domain_event threw", { type: input.type, error });
    return { id: null, inserted: false };
  }
}

/* ------------------------------------------------------------ dispatcher */

export const eventDispatchPayload = z.object({ eventId: z.uuid() });

type Consumer = {
  name: string;
  run(event: DomainEventRow): Promise<void>;
};

/**
 * The catalogue events a customer endpoint receives from the outbox. Each
 * one is listed in `WEBHOOK_EVENTS` with this file as its emitter.
 * "lead.created" is also sent by `lead.process` under the same event id (the
 * lead id), so the two paths deliver it once.
 */
export const WEBHOOK_FORWARDED = [
  "lead.created",
  "lead.touched",
  "lead.scored",
  "score.changed",
  "reply.received",
  "meeting.booked",
  "meeting.pending",
  "meeting.cancelled",
  "meeting.no_show",
  "contact.unsubscribed",
  "contact.suppressed",
  "ai.escalated",
  // Emitted by opportunities/service.ts; forwarded so a customer's systems see
  // the pipeline, not only the lead.
  "opportunity.created",
  "opportunity.won",
  "opportunity.lost",
] as const satisfies readonly DomainEventType[];

const webhookConsumer: Consumer = {
  name: "webhooks",
  async run(event) {
    if (!isWebhookForwarded(event.type)) return;
    if (!(WEBHOOK_FORWARDED as readonly string[]).includes(event.type)) return;
    await emitWebhookEvent({
      businessId: event.business_id,
      type: event.type,
      eventId: webhookEventIdFor(event),
      data: {
        ...event.payload,
        subject_type: event.subject_type,
        subject_id: event.subject_id,
        occurred_at: event.occurred_at,
      },
    });
  },
};

const automationConsumer: Consumer = {
  name: "automation_events",
  async run(event) {
    const projected = AUTOMATION_PROJECTION[event.type as AnyEventType];
    if (!projected) return;
    // automation_events has no idempotency key of its own, so a re-dispatch
    // after a crash between this write and `dispatched_at` would repeat it.
    // Acceptable for an observability trail that nothing decides on; noted
    // rather than hidden.
    await emitAutomationEvent({
      businessId: event.business_id,
      leadId: event.subject_type === "lead" ? event.subject_id : null,
      eventType: projected as AutomationEventType,
      payload: { domain_event_id: event.id, ...event.payload },
    });
  },
};

const rescoreConsumer: Consumer = {
  name: "rescore",
  async run(event) {
    const rescore = rescoreFor(event);
    if (!rescore) return;
    await enqueue(
      "lead.score",
      {
        leadId: rescore.leadId,
        triggerEvent: rescore.triggerEvent,
        causationId: event.id,
        causationDepth: event.causation_depth + 1,
      },
      {
        businessId: event.business_id,
        priority: 60,
        idempotencyKey: `lead.score:${rescore.leadId}:${rescore.triggerEvent}`,
      },
    );
  },
};

export const EVENT_CONSUMERS: readonly Consumer[] = [
  webhookConsumer,
  automationConsumer,
  rescoreConsumer,
];

export async function handleEventDispatch(job: ClaimedJob): Promise<void> {
  const parsed = eventDispatchPayload.safeParse(job.payload);
  if (!parsed.success) throw new PermanentJobError("event.dispatch: invalid payload");

  const client = db();
  const { data, error } = await client
    .from("domain_events")
    .select("id, business_id, type, subject_type, subject_id, payload, occurred_at, causation_depth, dispatched_at")
    .eq("id", parsed.data.eventId)
    .maybeSingle();
  if (error) throw new Error(`event.dispatch: read failed: ${error.message}`);
  if (!data) throw new PermanentJobError(`event.dispatch: event ${parsed.data.eventId} is gone`);

  const event = data as DomainEventRow;
  if (event.dispatched_at) return;

  if (exceedsCausationDepth(event.causation_depth)) {
    console.warn("[outbox] dropped event past the causation depth limit", {
      eventId: event.id,
      type: event.type,
      depth: event.causation_depth,
      businessId: event.business_id,
    });
    await markDispatched(client, event.id, "dropped: causation depth exceeded");
    return;
  }

  // Every consumer runs; one failing does not starve the others. The job is
  // failed (and retried) if any did, and each consumer is idempotent, so the
  // retry repeats nothing that already succeeded.
  const failures: string[] = [];
  for (const consumer of EVENT_CONSUMERS) {
    try {
      await consumer.run(event);
    } catch (consumerError) {
      failures.push(
        `${consumer.name}: ${consumerError instanceof Error ? consumerError.message : String(consumerError)}`,
      );
    }
  }

  if (failures.length > 0) {
    const { error: noteError } = await client
      .from("domain_events")
      .update({ dispatch_error: failures.join("; ").slice(0, 2000) })
      .eq("id", event.id);
    if (noteError) console.error("[outbox] could not record dispatch error", noteError.message);
    throw new Error(`event.dispatch ${event.type}: ${failures.join("; ")}`);
  }

  await markDispatched(client, event.id, null);
}

async function markDispatched(client: SupabaseClient, eventId: string, note: string | null) {
  const { error } = await client
    .from("domain_events")
    .update({ dispatched_at: new Date().toISOString(), dispatch_error: note })
    .eq("id", eventId);
  // Thrown: a lost mark means a retry re-runs idempotent consumers, which is
  // safe, but the job must not report success over it.
  if (error) throw new Error(`event.dispatch: could not mark dispatched: ${error.message}`);
}
