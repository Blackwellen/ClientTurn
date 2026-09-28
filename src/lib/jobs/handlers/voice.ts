import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import type { ClaimedJob } from "../queue";
import { PermanentJobError } from "../registry";
import { voiceEventSchema, type VoiceEvent } from "@/lib/voice/providers/types";
import {
  dialCall,
  fetchRecording,
  ingestVoiceEvent,
  planCallRetry,
  postProcessCall,
  provisionStep,
  reconcileStaleCalls,
  scheduleNumberRelease,
} from "@/lib/voice/runtime-core";
import { serverVoiceDeps } from "@/lib/voice/server-deps";

/**
 * The voice jobs (phase P2). Each is a thin shell over runtime-core.ts, which
 * re-reads current state before any provider call and is idempotent, so a
 * retried job repeats nothing that already happened. Payloads are validated
 * here; a malformed payload is permanent (retrying cannot fix it).
 *
 *   voice.dial             dial one queued call (the only path to the provider)
 *   voice.webhook_ingest   apply a stored provider event to its call
 *   voice.post_call        transcript, outcome, objections, QI signals, minutes, cost
 *   voice.recording_fetch  copy the recording to R2 (signed URLs only)
 *   voice.retry            plan the next attempt or the text fallback
 *   voice.number_provision one provisioning step, re-scheduled until settled
 *   voice.number_release   schedule and drive a number release
 */

const callPayload = z.object({ callId: z.uuid() });
const postCallPayload = callPayload.extend({
  providerSummary: z.string().max(8000).nullable().optional(),
  providerCostCents: z.number().nonnegative().nullable().optional(),
});
const businessPayload = z.object({ businessId: z.uuid() });
const releasePayload = businessPayload.extend({ releaseAfter: z.string().datetime().nullable().optional() });
const ingestPayload = z.object({ provider: z.enum(["retell", "twilio"]), externalEventId: z.string().min(1).max(300) });

function parse<T>(schema: z.ZodType<T>, job: ClaimedJob): T {
  const r = schema.safeParse(job.payload);
  if (!r.success) throw new PermanentJobError(`${job.type}: invalid payload (${r.error.issues[0]?.message ?? "invalid"})`);
  return r.data;
}

const dialPayload = callPayload.extend({ personRequested: z.boolean().optional() });

export async function handleVoiceDial(job: ClaimedJob): Promise<void> {
  const { callId, personRequested } = parse(dialPayload, job);
  await dialCall(serverVoiceDeps(), callId, { personRequested });
}

export async function handleVoicePostCall(job: ClaimedJob): Promise<void> {
  const input = parse(postCallPayload, job);
  const result = await postProcessCall(serverVoiceDeps(), input);
  // The ended event has not landed yet: try again shortly (the job retries).
  if (result.status === "WAITING") throw new Error(`voice.post_call waiting: ${result.reason}`);
}

export async function handleVoiceRecordingFetch(job: ClaimedJob): Promise<void> {
  const { callId } = parse(callPayload, job);
  const result = await fetchRecording(serverVoiceDeps(), callId);
  if (result.status === "NOT_READY") throw new Error("voice.recording_fetch: recording not ready yet");
}

export async function handleVoiceRetry(job: ClaimedJob): Promise<void> {
  const { callId } = parse(callPayload, job);
  await planCallRetry(serverVoiceDeps(), callId);
}

/** voice.reconcile: close calls stuck live (runtime-core.ts reconcileStaleCalls). No payload. */
export async function handleVoiceReconcile(): Promise<void> {
  const result = await reconcileStaleCalls(serverVoiceDeps());
  if (result.closed + result.ended > 0) console.info(`[voice.reconcile] checked=${result.checked} closed=${result.closed} ended=${result.ended}`);
}

/** Queues the sweep at most once per fifteen-minute bucket (cron/worker schedulers). */
export async function scheduleVoiceReconcile(): Promise<void> {
  const { enqueue } = await import("@/lib/jobs/queue");
  const bucket = Math.floor(Date.now() / (15 * 60_000));
  await enqueue("voice.reconcile", {}, { idempotencyKey: `voice.reconcile:${bucket}`, maxAttempts: 2 });
}

export async function handleVoiceNumberProvision(job: ClaimedJob): Promise<void> {
  const { businessId } = parse(businessPayload, job);
  await provisionStep(serverVoiceDeps(), businessId);
}

export async function handleVoiceNumberRelease(job: ClaimedJob): Promise<void> {
  const { businessId, releaseAfter } = parse(releasePayload, job);
  await scheduleNumberRelease(serverVoiceDeps(), { businessId, releaseAfter: releaseAfter ?? null });
}

/**
 * The webhook routes stored the verified, normalised events on the
 * `webhook_events` row; this applies them. The row is marked processed or
 * failed, never deleted, so the event can be replayed.
 */
export async function handleVoiceWebhookIngest(job: ClaimedJob): Promise<void> {
  const { provider, externalEventId } = parse(ingestPayload, job);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_events")
    .select("payload, status")
    .eq("provider", provider === "retell" ? "retell" : "twilio_voice")
    .eq("external_event_id", externalEventId)
    .maybeSingle();
  if (error) throw new Error(`voice.webhook_ingest: ${error.message}`);
  if (!data) throw new PermanentJobError("voice.webhook_ingest: event row not found");
  const payload = (data.payload ?? {}) as { events?: unknown[] };
  const events: VoiceEvent[] = [];
  for (const raw of payload.events ?? []) {
    const parsed = voiceEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }

  let failure: string | null = null;
  try {
    const deps = serverVoiceDeps();
    for (const event of events) await ingestVoiceEvent(deps, event);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  logWriteError(
    await admin
      .from("webhook_events")
      .update(
        failure
          ? { status: "failed", last_error: failure.slice(0, 500) }
          : { status: "processed", processed_at: new Date().toISOString() },
      )
      .eq("provider", provider === "retell" ? "retell" : "twilio_voice")
      .eq("external_event_id", externalEventId),
    "voice webhook ingest: record outcome",
    { externalEventId, failure },
  );
  if (failure) throw new Error(failure);
}

const textBackPayload = z.object({
  businessId: z.uuid(),
  leadId: z.uuid().nullable().optional(),
  to: z.string().min(5).max(32),
  body: z.string().min(1).max(480),
});

/**
 * voice.text_back (§25): the text to a caller the dedicated number could not
 * answer. A reply to a call the person made, not marketing, and it carries
 * STOP. Re-checks the SMS suppression list first; a suppressed number is
 * never texted. Sent through the ordinary SMS path, so it goes from the
 * workspace's own number when that is ACTIVE (messaging/sms-sender.ts).
 */
export async function handleVoiceTextBack(job: ClaimedJob): Promise<void> {
  const input = parse(textBackPayload, job);
  const { checkSuppression } = await import("@/lib/policy/suppression");
  const hit = await checkSuppression(input.businessId, "SMS", { phone: input.to });
  if (hit) return;
  const { getMessagingProvider } = await import("@/lib/messaging/registry");
  const result = await getMessagingProvider().send({
    businessId: input.businessId,
    to: input.to,
    body: input.body,
    channel: "sms",
    sendKey: `voice-text-back:${job.id}`,
  });
  if (!result.ok) {
    if (result.permanent) throw new PermanentJobError(`voice.text_back: ${result.errorCode}`);
    throw new Error(`voice.text_back: ${result.errorMessage}`);
  }
}
