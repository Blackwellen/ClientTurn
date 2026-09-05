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
  mergeValues,
  queueOutboundMessage,
  renderBody,
  type BusinessContext,
  type LeadRecord,
} from "./shared";
import { parsePayload } from "./parse";
import { automationAdvancePayload } from "./payloads";
import { emitAutomationEvent } from "@/lib/automation/events";

type StepRow = {
  id: string;
  position: number;
  delay_seconds: number;
  channel: string;
  template: string;
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
    .select("id, position, delay_seconds, channel, template")
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
  template: string,
  values: Record<string, string>,
  isFirstStep: boolean,
): string {
  let body = renderBody(template, values);

  if (business.messageSignature && !body.includes(business.messageSignature)) {
    body = `${body}\n${business.messageSignature}`;
  }

  // The opt-out route has to appear on the first message of a sequence.
  if (
    isFirstStep &&
    business.optOutWording &&
    !body.toLowerCase().includes("stop")
  ) {
    body = `${body}\n${business.optOutWording}`;
  }

  return body.trim();
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

  const contact = leadContact(lead);
  if (!contact) {
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

  const channel = (step.channel === "whatsapp" ? "whatsapp" : "sms") as Channel;

  // Re-checked here, and re-checked again inside message.send immediately
  // before the provider call.
  const stop = evaluateStopConditions(
    leadState(lead),
    await channelState(
      business.businessId,
      channel,
      contact,
      business.subscriptionActive && business.status !== "suspended",
    ),
  );

  if (stop) {
    await stopRun(run.id, stop, business.businessId, lead.id);
    return;
  }

  const values = await mergeValues(business, lead);
  const body = composeBody(business, step.template, values, run.current_step === 0);

  await queueOutboundMessage({
    businessId: business.businessId,
    leadId: lead.id,
    channel,
    body,
    origin: "automation",
    automationRunId: run.id,
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
