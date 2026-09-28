import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundWebhookEvent } from "./message-inbound";
import { parsePayload } from "./parse";
import { webhookReplayPayload } from "./payloads";

/**
 * Re-dispatches a stored provider event through exactly the same processing
 * path the live webhook uses, so a replay cannot take a different route.
 */
export async function handleWebhookReplay(job: ClaimedJob) {
  const payload = parsePayload(webhookReplayPayload, job.payload);
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("webhook_events")
    .select("id, provider, event_type, business_id, payload, status")
    .eq("id", payload.webhookEventId)
    .maybeSingle();

  if (!event) {
    throw new PermanentJobError(
      `Webhook event ${payload.webhookEventId} no longer exists.`,
    );
  }

  if (event.provider === "twilio" || event.provider === "stub") {
    await processInboundWebhookEvent(event.id);
    return;
  }

  if (event.provider === "calendly" || event.provider === "google_calendar") {
    if (!event.business_id) {
      throw new PermanentJobError(
        `Webhook event ${event.id} has no workspace to apply to.`,
      );
    }
    await enqueue(
      "booking.sync",
      { ...(event.payload as Record<string, unknown>), webhookEventId: event.id },
      {
        businessId: event.business_id,
        idempotencyKey: `booking.sync:replay:${event.id}`,
      },
    );
    return;
  }

  // Voice (P3, P2 gap d): the stored, already-verified event goes back
  // through the voice ingest job, the path the live webhook uses. The
  // reduction is idempotent and voice_call_events is deduped on the event's
  // dedupe key, so a replay can never move a call twice.
  if (event.provider === "retell" || event.provider === "twilio_voice") {
    const { data: row } = await admin
      .from("webhook_events")
      .select("external_event_id")
      .eq("id", event.id)
      .maybeSingle();
    const externalEventId = (row as { external_event_id: string | null } | null)?.external_event_id;
    if (!externalEventId) {
      throw new PermanentJobError(`Voice webhook event ${event.id} has no event key to replay.`);
    }
    await admin.from("webhook_events").update({ status: "received", last_error: null, processed_at: null }).eq("id", event.id);
    await enqueue(
      "voice.webhook_ingest",
      { provider: event.provider === "retell" ? "retell" : "twilio", externalEventId },
      { priority: 10, idempotencyKey: `voice.webhook_ingest:replay:${event.id}:${job.id}` },
    );
    return;
  }

  // Stripe is reconciled from Stripe itself, never from a stored copy.
  await admin
    .from("webhook_events")
    .update({
      status: "ignored",
      last_error: `No replay path for provider ${event.provider}.`,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);
}
