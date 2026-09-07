import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { endpointsForEvent } from "./endpoints";
import { WEBHOOK_TEST_EVENT, type WebhookEventType } from "./events";

/**
 * Emitting a domain event to a workspace's own systems.
 *
 * Three properties the call sites depend on, so they can call this from
 * anywhere without thinking about it:
 *
 *   1. **It never throws.** A webhook is a notification about work that already
 *      happened. If emitting failed loudly, a customer's misconfigured endpoint
 *      could fail the job that created the lead — the tail wagging the dog.
 *      Every failure here is swallowed and logged.
 *   2. **It does no network I/O.** It writes one row per subscribed endpoint
 *      and queues a job. The HTTP request happens in the worker, so a slow
 *      endpoint cannot slow down lead processing.
 *   3. **It is idempotent per event.** The `event_id` is unique per delivery
 *      row, so a handler that re-runs after a retry inserts nothing new when
 *      given the same id. Call sites that can re-run should pass one.
 */

export type EmitResult = { eventId: string; queued: number };

export async function emitWebhookEvent(input: {
  businessId: string;
  type: WebhookEventType | string;
  data: Record<string, unknown>;
  /**
   * A stable id for this occurrence. Pass one from a retry-safe job handler so
   * a second run does not deliver the same thing twice; omit it and each call
   * is treated as a distinct occurrence.
   */
  eventId?: string;
}): Promise<EmitResult> {
  const eventId = input.eventId ?? randomUUID();

  try {
    const endpoints = await endpointsForEvent(input.businessId, input.type);
    if (endpoints.length === 0) return { eventId, queued: 0 };

    const db = createAdminClient();
    const now = new Date().toISOString();

    // The envelope is built once and stored per endpoint, so what a customer
    // sees in the delivery log is byte-for-byte what was sent.
    const payload = {
      id: eventId,
      type: input.type,
      created_at: now,
      data: input.data,
    };

    const { data: rows } = await db
      .from("webhook_deliveries")
      .upsert(
        endpoints.map((endpoint) => ({
          business_id: input.businessId,
          endpoint_id: endpoint.id,
          event_id: eventId,
          event_type: input.type,
          payload: payload as never,
          status: "PENDING",
          next_attempt_at: now,
        })),
        // The unique index on (endpoint_id, event_id) is what makes a re-run of
        // a job harmless: ignoring the conflict leaves the original row, and its
        // attempt count, untouched.
        { onConflict: "endpoint_id,event_id", ignoreDuplicates: true },
      )
      .select("id");

    const queued = rows?.length ?? 0;
    if (queued > 0) {
      await enqueue(
        "webhook.dispatch",
        { businessId: input.businessId, eventId },
        { businessId: input.businessId, priority: 50 },
      );
    }

    return { eventId, queued };
  } catch {
    // Deliberately silent to the caller. An event that could not be queued is
    // visible in the delivery log's absence, and failing the surrounding work
    // would be a far worse outcome than a missed notification.
    return { eventId, queued: 0 };
  }
}

/**
 * Sends a test event to one endpoint.
 *
 * Bypasses the subscription filter deliberately: the point of the button is to
 * prove the address, the TLS and the signature all work, and requiring the
 * customer to first subscribe to a test event would make the check test
 * something other than what it claims to.
 *
 * The event type is `endpoint.test`, never a fabricated `lead.created`. A
 * receiver must be able to tell a drill from the real thing, or testing an
 * endpoint means creating a phantom lead in their CRM.
 */
export async function emitTestEvent(input: {
  businessId: string;
  endpointId: string;
}): Promise<{ ok: boolean; eventId: string }> {
  const eventId = randomUUID();

  try {
    const db = createAdminClient();
    const now = new Date().toISOString();

    const { error } = await db.from("webhook_deliveries").insert({
      business_id: input.businessId,
      endpoint_id: input.endpointId,
      event_id: eventId,
      event_type: WEBHOOK_TEST_EVENT,
      payload: {
        id: eventId,
        type: WEBHOOK_TEST_EVENT,
        created_at: now,
        data: {
          message:
            "This is a test event from ClientTurn. Nothing in your workspace changed.",
        },
      } as never,
      status: "PENDING",
      next_attempt_at: now,
    });

    if (error) return { ok: false, eventId };

    await enqueue(
      "webhook.dispatch",
      { businessId: input.businessId, eventId },
      { businessId: input.businessId, priority: 10 },
    );

    return { ok: true, eventId };
  } catch {
    return { ok: false, eventId };
  }
}
