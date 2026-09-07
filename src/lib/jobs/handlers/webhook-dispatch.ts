import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { assertSafeUrl } from "@/lib/security/safe-fetch";
import { openSecret } from "@/lib/security/secret-box";
import { signPayload, SIGNATURE_HEADER } from "@/lib/webhooks/signature";
import {
  markEndpointFailure,
  markEndpointHealthy,
} from "@/lib/webhooks/endpoints";
import { nextAttemptDelaySeconds } from "@/lib/webhooks/events";

/**
 * Delivering queued webhook events to customer endpoints.
 *
 * The handler claims due deliveries through `claim_webhook_deliveries`, which
 * increments the attempt count inside the same statement under FOR UPDATE SKIP
 * LOCKED. That is the whole concurrency story: two overlapping worker runs can
 * never pick up the same delivery, so an event is attempted once per attempt,
 * not once per worker.
 *
 * Everything else here is about being a good citizen of someone else's server:
 *
 *   * **The URL is re-validated immediately before connecting**, not only when
 *     it was saved. A hostname that resolved publicly last week can resolve to
 *     `10.0.0.5` today, and the check that matters is the one taken at the
 *     moment of the request.
 *   * **Redirects are not followed.** A 30x from a webhook endpoint is a
 *     misconfiguration, and following one would skip the validation above for
 *     the hop that actually connects.
 *   * **There is a hard timeout**, so one hanging endpoint cannot occupy the
 *     worker.
 *   * **4xx is not retried.** A 404 or a 401 will not become a 200 in six
 *     hours; retrying is noise for them and wasted work for us. 408 and 429 are
 *     the exceptions — both explicitly mean "try again".
 */

const REQUEST_TIMEOUT_MS = 10_000;

/** Enough of the response to debug with. Not a copy of their system. */
const MAX_RESPONSE_CHARS = 500;

const BATCH_SIZE = 25;

type DeliveryRow = {
  id: string;
  business_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

export async function handleWebhookDispatch(_job: ClaimedJob) {
  const db = createAdminClient();

  const { data, error } = await db.rpc("claim_webhook_deliveries", {
    batch_size: BATCH_SIZE,
  });

  if (error) throw error;

  const deliveries = (data ?? []) as DeliveryRow[];
  if (deliveries.length === 0) return;

  // Sequential rather than parallel. These are outbound requests to other
  // people's servers, and a batch of 25 simultaneous connections to the same
  // host is indistinguishable from a small attack.
  for (const delivery of deliveries) {
    await attemptDelivery(delivery);
  }

  // More may have come due while this batch was in flight. Re-queueing keeps
  // the queue draining without waiting for the next cron tick.
  const { count } = await db
    .from("webhook_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", new Date().toISOString());

  if ((count ?? 0) > 0) {
    await enqueue("webhook.dispatch", { sweep: true }, { priority: 60 });
  }
}

async function attemptDelivery(delivery: DeliveryRow): Promise<void> {
  const db = createAdminClient();

  const { data: endpoint } = await db
    .from("webhook_endpoints")
    .select("id, url, status, secret_sealed")
    .eq("id", delivery.endpoint_id)
    .maybeSingle();

  // The endpoint was deleted or switched off after the event was queued. The
  // customer's most recent instruction wins over an older queued intention.
  if (!endpoint || endpoint.status !== "ACTIVE") {
    await db
      .from("webhook_deliveries")
      .update({
        status: "CANCELLED",
        error: endpoint
          ? "The endpoint was switched off before this could be delivered."
          : "The endpoint was deleted before this could be delivered.",
      })
      .eq("id", delivery.id);
    return;
  }

  const secret = openSecret(endpoint.secret_sealed);
  if (!secret) {
    // An unopenable secret means the encryption key changed or the row was
    // tampered with. Sending unsigned, or signed with a guess, would be worse
    // than not sending: the receiver would reject it and have no idea why.
    await fail(
      delivery,
      "The signing secret could not be read. Rotate the endpoint's secret.",
      { permanent: true },
    );
    return;
  }

  const safe = await assertSafeUrl(endpoint.url);
  if (!safe.ok) {
    await fail(delivery, `The endpoint address is not reachable (${safe.code}).`, {
      permanent: safe.code === "BLOCKED_HOST" || safe.code === "BLOCKED_SCHEME",
    });
    await markEndpointFailure(endpoint.id, `Address rejected: ${safe.code}`);
    return;
  }

  const body = JSON.stringify(delivery.payload ?? {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(safe.url.toString(), {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "ClientTurn-Webhooks/1.0",
        [SIGNATURE_HEADER]: signPayload(body, secret),
        "clientturn-event-id": delivery.event_id,
        "clientturn-event-type": delivery.event_type,
        "clientturn-delivery-attempt": String(delivery.attempts),
      },
      body,
    });

    const text = await readBounded(response);
    const latency = Date.now() - started;

    if (response.status >= 200 && response.status < 300) {
      await db
        .from("webhook_deliveries")
        .update({
          status: "SUCCEEDED",
          response_status: response.status,
          response_body: text,
          error: null,
          delivered_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      await markEndpointHealthy(endpoint.id);
      return;
    }

    // 4xx means the request itself is wrong, and repeating it will not fix it.
    // 408 (timeout) and 429 (rate limited) are the two that explicitly ask to
    // be repeated, so they retry like a 5xx.
    const permanent =
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429;

    await fail(
      delivery,
      `The endpoint answered ${response.status} after ${latency}ms.`,
      { permanent, responseStatus: response.status, responseBody: text },
    );
    await markEndpointFailure(endpoint.id, `HTTP ${response.status}`);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const message = aborted
      ? `The endpoint did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
      : error instanceof Error
        ? error.message
        : "The request failed.";

    await fail(delivery, message, { permanent: false });
    await markEndpointFailure(endpoint.id, message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Records a failed attempt and schedules the next one, or gives up.
 *
 * `next_attempt_at` is what the claim function looks at, so setting it is how a
 * delivery re-enters the queue; leaving it null with status EXHAUSTED is how
 * one leaves it for good.
 */
async function fail(
  delivery: DeliveryRow,
  message: string,
  options: {
    permanent?: boolean;
    responseStatus?: number;
    responseBody?: string | null;
  },
): Promise<void> {
  const db = createAdminClient();
  const delay = options.permanent
    ? null
    : nextAttemptDelaySeconds(delivery.attempts);

  const exhausted = delay === null;

  const nextAttemptAt = exhausted ? null : new Date(Date.now() + delay * 1000);

  await db
    .from("webhook_deliveries")
    .update({
      status: exhausted ? "EXHAUSTED" : "PENDING",
      response_status: options.responseStatus ?? null,
      response_body: options.responseBody ?? null,
      error: message.slice(0, 500),
      next_attempt_at: nextAttemptAt ? nextAttemptAt.toISOString() : null,
    })
    .eq("id", delivery.id);

  if (!nextAttemptAt) return;

  // A row with a future `next_attempt_at` and nothing scheduled to look at it
  // would sit there forever. Booking the wake-up on the existing job queue,
  // rather than adding a cron entry, means the retry schedule is carried by the
  // same machinery that already survives restarts and redeploys. The
  // idempotency key is per attempt, so two failures in the same attempt cannot
  // book two wake-ups.
  await enqueue(
    "webhook.dispatch",
    { businessId: delivery.business_id, deliveryId: delivery.id },
    {
      businessId: delivery.business_id,
      runAt: nextAttemptAt,
      priority: 60,
      idempotencyKey: `webhook.dispatch:${delivery.id}:${delivery.attempts}`,
    },
  ).catch(() => null);
}

/** Reads at most `MAX_RESPONSE_CHARS`, and never lets a huge body stall us. */
async function readBounded(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text.slice(0, MAX_RESPONSE_CHARS) || null;
  } catch {
    return null;
  }
}
