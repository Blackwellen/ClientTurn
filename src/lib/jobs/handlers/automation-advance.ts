import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeNextRunAt,
  evaluateStopConditions,
} from "@/lib/automation/scheduler";
import type { Channel } from "@/lib/messaging/types";
import {
  channelState,
  leadContact,
  leadState,
  loadBusinessContext,
  loadLead,
  flagForAttention,
  mergeValues,
  queueOutboundMessage,
  type BusinessContext,
  type LeadRecord,
} from "./shared";
import { parsePayload } from "./parse";
import { automationAdvancePayload } from "./payloads";
import { emitAutomationEvent } from "@/lib/automation/events";
import { renderTemplate } from "@/lib/messaging/merge-fields";
import { resolveFallback } from "@/lib/follow-up/channel-policy";
import { getFollowUpChannelContext } from "@/lib/follow-up/channel-context";

type StepRow = {
  id: string;
  position: number;
  delay_seconds: number;
  channel: string;
  subject: string | null;
  template: string;
  sender_identity_id: string | null;
};

async function publishedSequence(
  businessId: string,
  type: "new_lead" | "booking_reminder" | "unresponsive",
) {
  const admin = createAdminClient();

  const { data: definition } = await admin
    .from("automation_definitions")
    .select("id, enabled")
    .eq("business_id", businessId)
    .eq("type", type)
    .maybeSingle();

  if (!definition || !definition.enabled) return null;

  const { data: version } = await admin
    .from("automation_versions")
    .select("id")
    .eq("business_id", businessId)
    .eq("automation_id", definition.id)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!version) return null;

  const { data: steps } = await admin
    .from("automation_steps")
    .select(
      "id, position, delay_seconds, channel, subject, template, sender_identity_id",
    )
    .eq("business_id", businessId)
    .eq("version_id", version.id)
    .eq("enabled", true)
    .order("position", { ascending: true });

  const rows = (steps ?? []) as StepRow[];
  if (rows.length === 0) return null;

  return { versionId: version.id, steps: rows };
}

async function stopRun(
  runId: string,
  reason: string,
  businessId: string,
  leadId: string,
) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("automation_runs")
    .update({
      state: "STOPPED",
      stopped_reason: reason,
      stopped_at: new Date().toISOString(),
      next_run_at: null,
    })
    .eq("id", runId)
    .eq("state", "ACTIVE")
    .select("id")
    .maybeSingle();

  if (data) {
    await emitAutomationEvent({
      businessId,
      leadId,
      automationRunId: runId,
      eventType: "automation.stopped",
      payload: { reason },
    });
  }
}

function composeBody(
  business: BusinessContext,
  channel: Channel,
  rendered: string,
  isFirstStep: boolean,
): string {
  let body = rendered.trim();

  if (business.messageSignature && !body.includes(business.messageSignature)) {
    body = `${body}\n${business.messageSignature}`;
  }

  // The opt-out route has to appear on the first message of a sequence. On
  // email the unsubscribe link is appended by the email renderer from the
  // lead's own revocable token, so the SMS "reply STOP" wording would be both
  // wrong and unactionable.
  if (
    channel !== "email" &&
    isFirstStep &&
    business.optOutWording &&
    !body.toLowerCase().includes("stop")
  ) {
    body = `${body}\n${business.optOutWording}`;
  }

  return body.trim();
}

function normaliseChannel(value: string): Channel {
  return value === "whatsapp" || value === "email" ? value : "sms";
}

function channelWord(channel: Channel): string {
  return channel === "sms" ? "SMS" : channel === "whatsapp" ? "WhatsApp" : "Email";
}

/**
 * Which channel this step will actually use for this lead.
 *
 * Returns the configured channel when it is usable, the deterministic fallback
 * when it is not and the workspace has switched fallback on, and null when
 * nothing is permitted -- in which case the caller raises an attention item
 * rather than choosing a channel on the customer's behalf.
 */
async function resolveStepChannel(
  business: BusinessContext,
  lead: LeadRecord,
  configured: Channel,
): Promise<{ channel: Channel; destination: string } | null> {
  const context = await getFollowUpChannelContext(business.businessId);

  const usable = (channel: Channel) => {
    if (!context.available[channel]) return null;
    const destination = leadContact(lead, channel);
    return destination ? { channel, destination } : null;
  };

  const direct = usable(configured);
  if (direct) return direct;

  if (!context.fallbackEnabled) return null;

  const outcome = resolveFallback(configured, context.available, {
    fallbackEnabled: true,
  });
  if (!outcome || outcome.kind !== "FALLBACK") return null;

  return usable(outcome.to);
}

async function scheduleNext(
  business: BusinessContext,
  lead: LeadRecord,
  runId: string,
  nextIndex: number,
  delaySeconds: number,
  automationType: string,
) {
  const admin = createAdminClient();
  const at = computeNextRunAt(new Date(), delaySeconds, business.quietHours);

  await admin
    .from("automation_runs")
    .update({ current_step: nextIndex, next_run_at: at.toISOString() })
    .eq("id", runId);

  await enqueue(
    "automation.advance",
    { leadId: lead.id, runId, automationType },
    {
      businessId: business.businessId,
      runAt: at,
      idempotencyKey: `automation.advance:${runId}:${nextIndex}`,
    },
  );
}

export async function handleAutomationAdvance(job: ClaimedJob) {
  const payload = parsePayload(automationAdvancePayload, job.payload);

  const lead = await loadLead(payload.leadId);
  if (!lead) {
    throw new PermanentJobError(`Lead ${payload.leadId} no longer exists.`);
  }

  const business = await loadBusinessContext(lead.business_id);
  if (!business) {
    throw new PermanentJobError(`Business ${lead.business_id} no longer exists.`);
  }

  const sequence = await publishedSequence(
    business.businessId,
    payload.automationType,
  );
  if (!sequence) return;

  const admin = createAdminClient();

  const { data: existingRun } = await admin
    .from("automation_runs")
    .select("id, current_step, next_run_at, state")
    .eq("business_id", business.businessId)
    .eq("lead_id", lead.id)
    .eq("version_id", sequence.versionId)
    .eq("state", "ACTIVE")
    .maybeSingle();

  let run = existingRun;

  if (!run) {
    const firstDelay = sequence.steps[0].delay_seconds;
    const firstRunAt = computeNextRunAt(
      new Date(),
      firstDelay,
      business.quietHours,
    );

    const { data: created, error } = await admin
      .from("automation_runs")
      .insert({
        business_id: business.businessId,
        lead_id: lead.id,
        version_id: sequence.versionId,
        state: "ACTIVE",
        current_step: 0,
        next_run_at: firstRunAt.toISOString(),
      })
      .select("id, current_step, next_run_at, state")
      .single();

    // A concurrent worker won the partial unique index; its run is the one.
    if (error?.code === "23505") return;
    if (error || !created) throw error ?? new Error("Could not start the run.");

    run = created;

    await emitAutomationEvent({
      businessId: business.businessId,
      leadId: lead.id,
      automationRunId: run.id,
      eventType: "automation.started",
      payload: { automationType: payload.automationType },
    });

    if (firstRunAt.getTime() > Date.now() + 1000) {
      await enqueue(
        "automation.advance",
        { leadId: lead.id, runId: run.id, automationType: payload.automationType },
        {
          businessId: business.businessId,
          runAt: firstRunAt,
          idempotencyKey: `automation.advance:${run.id}:0`,
        },
      );
      return;
    }
  }

  if (run.next_run_at && new Date(run.next_run_at).getTime() > Date.now() + 1000) {
    return;
  }

  // A lead with no phone number is no longer a dead end: an email step can
  // still reach them. The destination is resolved per channel below, once the
  // step -- and therefore the channel -- is known.
  if (!lead.email && !leadContact(lead, "sms")) {
    await stopRun(run.id, "invalid_number", business.businessId, lead.id);
    return;
  }

  const step = sequence.steps[run.current_step];
  if (!step) {
    await admin
      .from("automation_runs")
      .update({ state: "COMPLETED", next_run_at: null })
      .eq("id", run.id)
      .eq("state", "ACTIVE");
    return;
  }

  // Email joined SMS and WhatsApp as a warm channel in V4 §19. The step's
  // configured channel is honoured rather than being collapsed onto SMS.
  const configured = normaliseChannel(step.channel);

  // The channel a step was configured with is not a promise that this lead can
  // receive it. Resolve the channel that will actually be used, which may be
  // the deterministic fallback, or nothing at all.
  const resolved = await resolveStepChannel(business, lead, configured);

  if (!resolved) {
    // §19.6: never silently substitute a channel. Raise an attention item and
    // pause the run so a person decides what happens next.
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: "channel_unavailable",
      title: `Step ${step.position} could not be sent`,
      body: `${channelWord(configured)} is not available for this lead, and no permitted fallback is configured.`,
    });
    await emitAutomationEvent({
      businessId: business.businessId,
      leadId: lead.id,
      automationRunId: run.id,
      eventType: "automation.step_blocked",
      payload: { position: step.position, channel: configured },
    });
    await admin
      .from("automation_runs")
      .update({ state: "PAUSED", next_run_at: null })
      .eq("id", run.id)
      .eq("state", "ACTIVE");
    return;
  }

  const channel = resolved.channel;
  const destination = resolved.destination;

  // Re-checked here, and re-checked again inside message.send immediately
  // before the provider call.
  const stop = evaluateStopConditions(
    leadState(lead),
    await channelState(
      business.businessId,
      channel,
      destination,
      business.subscriptionActive && business.status !== "suspended",
    ),
  );

  if (stop) {
    await stopRun(run.id, stop, business.businessId, lead.id);
    return;
  }

  const values = await mergeValues(business, lead);

  // A merge field with no value and no safe fallback must never go out as a
  // literal token. The step pauses and a person is told which field is
  // missing (§19.9).
  const bodyRender = renderTemplate(step.template, values, "follow-up");
  const subjectRender =
    channel === "email" && step.subject
      ? renderTemplate(step.subject, values, "follow-up")
      : ({ ok: true, text: "" } as const);

  if (!bodyRender.ok || !subjectRender.ok) {
    const missing = [
      ...new Set([
        ...(bodyRender.ok ? [] : bodyRender.missing),
        ...(subjectRender.ok ? [] : subjectRender.missing),
      ]),
    ];
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: "merge_field_missing",
      title: `Step ${step.position} is missing information`,
      body: `This message needs ${missing
        .map((token) => `{{${token}}}`)
        .join(", ")}, which has no value for this lead.`,
    });
    await admin
      .from("automation_runs")
      .update({ state: "PAUSED", next_run_at: null })
      .eq("id", run.id)
      .eq("state", "ACTIVE");
    return;
  }

  const body = composeBody(
    business,
    channel,
    bodyRender.text,
    run.current_step === 0,
  );

  await queueOutboundMessage({
    businessId: business.businessId,
    leadId: lead.id,
    channel,
    body,
    subject: channel === "email" ? subjectRender.text : null,
    origin: "automation",
    automationRunId: run.id,
    // The key names the step, not the channel, so a fallback send and the
    // original can never both go out for the same step on a retry.
    sendKey: `run:${run.id}:step:${step.position}`,
  });

  await emitAutomationEvent({
    businessId: business.businessId,
    leadId: lead.id,
    automationRunId: run.id,
    eventType: "automation.step_completed",
    payload: { position: step.position, channel },
  });

  const nextIndex = run.current_step + 1;
  const nextStep = sequence.steps[nextIndex];

  if (!nextStep) {
    await admin
      .from("automation_runs")
      .update({
        state: "COMPLETED",
        current_step: nextIndex,
        next_run_at: null,
      })
      .eq("id", run.id)
      .eq("state", "ACTIVE");
    return;
  }

  await scheduleNext(
    business,
    lead,
    run.id,
    nextIndex,
    nextStep.delay_seconds,
    payload.automationType,
  );
}
