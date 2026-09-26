import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import {
  BOOKING_REMINDER_SEND_KEY_PREFIX,
  computeNextRunAt,
  evaluateStopConditions,
  planBookingReminder,
} from "@/lib/automation/scheduler";
import { isBroadcastChannel } from "@/lib/messaging/types";
import type { BroadcastChannel, Channel } from "@/lib/messaging/types";
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
import { emailMessageClass } from "@/lib/email/sender-health";
import { loadTemplate, stepTemplateFor } from "@/lib/messaging/template-registry";
import { resolveTemplateVariables } from "@/lib/messaging/whatsapp-templates";
import { HOLDOUT_ARM, variantTemplate } from "@/lib/learning/experiments";
import { armForLead, featureContext, holdoutStopReason, runningExperiment } from "@/lib/learning/experiments-service";
import { buildMessageFeatures } from "@/lib/learning/features";
import { withOptOutWording } from "@/lib/messaging/sms-compliance";

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

  return { automationId: definition.id, versionId: version.id, steps: rows };
}

/**
 * The approved template a WhatsApp step falls back to when the 24-hour window
 * has closed by send time (§45). Resolved now, with the lead's values, and
 * stored on the message; the send path re-checks the template's status and
 * uses it only if the window really has closed. Missing variables are stored
 * as missing -- the send path refuses rather than sending a blank.
 */
async function whatsappTemplateForStep(
  businessId: string,
  automationId: string,
  position: number,
  values: Record<string, string>,
): Promise<{ templateId: string; variables: Record<string, string> } | null> {
  const mapping = await stepTemplateFor(businessId, automationId, position);
  if (!mapping) return null;
  const template = await loadTemplate(mapping.templateId);
  if (!template) return null;
  const resolved = resolveTemplateVariables(template.variables, mapping.variableMap, values);
  if (resolved.ok) return { templateId: template.id, variables: resolved.variables };
  const partial: Record<string, string> = {};
  for (const key of template.variables) {
    const source = mapping.variableMap[key];
    const value = source ? values[source]?.trim() : "";
    if (value) partial[key] = value;
  }
  return { templateId: template.id, variables: partial };
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
  // One helper shared with reactivation campaigns (sms-compliance.ts).
  if (isFirstStep) {
    body = withOptOutWording(body, { channel, wording: business.optOutWording });
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
): Promise<{ channel: BroadcastChannel; destination: string } | null> {
  // An automation step schedules a send for the future, which is only
  // meaningful on a channel where the right to send still exists when the time
  // arrives. Messenger's window will have closed; LinkedIn and TikTok depend on
  // an acceptance that may never come. A step configured for one of those is
  // not a broken step — it is a step on a channel that is driven live by the
  // agent instead, so there is nothing for this to schedule.
  if (!isBroadcastChannel(configured)) return null;

  const context = await getFollowUpChannelContext(business.businessId);

  const usable = (channel: BroadcastChannel) => {
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

/**
 * The start of the lead's next scheduled meeting, or null when there is none
 * (cancelled, completed, no-show, or already started). A booking reminder is
 * timed from this, re-read on every run, so a reschedule or a cancellation
 * is picked up before anything is sent.
 */
async function upcomingBookingStart(businessId: string, leadId: string): Promise<Date | null> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("starts_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.starts_at ? new Date(data.starts_at) : null;
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

  // ---- booking reminders: timed BACK from the meeting, not forward from now.
  // Each step's `delay_seconds` is "this long before the meeting starts". The
  // plan is recomputed from the booking's current start on every run, so a
  // stale job for a rescheduled meeting re-plans rather than sending early,
  // and a cancelled meeting stops the run.
  if (payload.automationType === "booking_reminder") {
    const startsAt = await upcomingBookingStart(business.businessId, lead.id);
    const plan = startsAt
      ? planBookingReminder({
          startsAt,
          offsetsSeconds: sequence.steps.map((row) => row.delay_seconds),
          fromIndex: run?.current_step ?? 0,
          now: new Date(),
          quiet: business.quietHours,
        })
      : null;

    if (!plan) {
      if (run && !startsAt) {
        await stopRun(run.id, "booking_not_upcoming", business.businessId, lead.id);
      } else if (run) {
        // Every remaining reminder's moment has passed.
        assertWrite(
          await admin
            .from("automation_runs")
            .update({ state: "COMPLETED", next_run_at: null })
            .eq("id", run.id)
            .eq("state", "ACTIVE"),
          "automation: complete booking reminder (nothing left to send)",
          { businessId: business.businessId, leadId: lead.id, runId: run.id },
        );
      }
      return;
    }

    if (!run) {
      const { data: created, error } = await admin
        .from("automation_runs")
        .insert({
          business_id: business.businessId,
          lead_id: lead.id,
          version_id: sequence.versionId,
          state: "ACTIVE",
          current_step: plan.stepIndex,
          next_run_at: plan.at.toISOString(),
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
    } else if (
      run.current_step !== plan.stepIndex ||
      !run.next_run_at ||
      new Date(run.next_run_at).getTime() !== plan.at.getTime()
    ) {
      assertWrite(
        await admin
          .from("automation_runs")
          .update({ current_step: plan.stepIndex, next_run_at: plan.at.toISOString() })
          .eq("id", run.id)
          .eq("state", "ACTIVE"),
        "automation: re-plan booking reminder",
        { businessId: business.businessId, leadId: lead.id, runId: run.id },
      );
    }

    run = { ...run, current_step: plan.stepIndex, next_run_at: plan.at.toISOString() };

    if (plan.at.getTime() > Date.now() + 1000) {
      // Keyed on the time as well, so a re-plan to a new time is queued even
      // while the job for the old time is still pending.
      await enqueue(
        "automation.advance",
        { leadId: lead.id, runId: run.id, automationType: payload.automationType },
        {
          businessId: business.businessId,
          runAt: plan.at,
          idempotencyKey: `automation.advance:${run.id}:${plan.stepIndex}:${plan.at.toISOString()}`,
        },
      );
      return;
    }
    // Due now: fall through to the ordinary send path below.
  }

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
    // Thrown so the job retries: a run left ACTIVE would keep advancing into
    // this same dead end. The retry re-reads the run; the attention item is
    // deduplicated by its key.
    assertWrite(
      await admin
        .from("automation_runs")
        .update({ state: "PAUSED", next_run_at: null })
        .eq("id", run.id)
        .eq("state", "ACTIVE"),
      "automation: pause run (channel unavailable)",
      { businessId: business.businessId, leadId: lead.id, runId: run.id },
    );
    return;
  }

  const channel = resolved.channel;
  const destination = resolved.destination;

  // Re-checked here, and re-checked again inside message.send immediately
  // before the provider call.
  const bookingReminder = payload.automationType === "booking_reminder";
  const stop = evaluateStopConditions(
    leadState(lead),
    await channelState(
      business.businessId,
      channel,
      destination,
      business.subscriptionActive && business.status !== "suspended",
    ),
    { bookingReminder },
  );

  if (stop) {
    await stopRun(run.id, stop, business.businessId, lead.id);
    return;
  }

  // §62: a running experiment on this sequence (never on booking reminders).
  // The arm is deterministic per lead; HOLDOUT leads get no follow-up from
  // this sequence, which is what the holdout measures against.
  const experiment = bookingReminder
    ? null
    : await runningExperiment(business.businessId, "WARM_FOLLOW_UP", sequence.automationId);
  const arm = experiment ? armForLead(experiment, lead.id) : null;
  if (experiment && arm === HOLDOUT_ARM) {
    await stopRun(run.id, holdoutStopReason(experiment.id), business.businessId, lead.id);
    return;
  }
  const stepTemplate =
    (experiment && arm
      ? variantTemplate(
          { id: experiment.id, holdoutPercent: experiment.holdout_percent, variants: experiment.variants },
          arm,
          step.position,
        )
      : null) ?? step.template;

  const values = await mergeValues(business, lead);

  // A merge field with no value and no safe fallback must never go out as a
  // literal token. The step pauses and a person is told which field is
  // missing (§19.9).
  const bodyRender = renderTemplate(stepTemplate, values, "follow-up");
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
    assertWrite(
      await admin
        .from("automation_runs")
        .update({ state: "PAUSED", next_run_at: null })
        .eq("id", run.id)
        .eq("state", "ACTIVE"),
      "automation: pause run (merge field missing)",
      { businessId: business.businessId, leadId: lead.id, runId: run.id },
    );
    return;
  }

  const body = composeBody(
    business,
    channel,
    bodyRender.text,
    run.current_step === 0,
  );

  // A failed template lookup queues the step without one: inside the window
  // it sends as before, and outside it the send path refuses (never free text).
  const whatsappTemplate =
    channel === "whatsapp"
      ? await whatsappTemplateForStep(business.businessId, sequence.automationId, step.position, values).catch(
          (error: unknown) => {
            console.error("[automation] WhatsApp template lookup failed", {
              businessId: business.businessId,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          },
        )
      : null;

  await queueOutboundMessage({
    businessId: business.businessId,
    leadId: lead.id,
    channel,
    body,
    subject: channel === "email" ? subjectRender.text : null,
    origin: "automation",
    automationRunId: run.id,
    // §61: what this message was, for workspace-level learning.
    features: buildMessageFeatures({
      family: "FOLLOW_UP",
      body,
      channel,
      sendAt: new Date(),
      timeZone: business.timezone,
      templateId: step.id,
      step: step.position,
      ...(await featureContext(business.businessId, lead.id)),
      experimentId: experiment?.id ?? null,
      arm,
    }),
    // §43: the step's sender identity controls From (the workspace default
    // when the step names none, resolved at send time); a booking reminder is
    // transactional, every other automated email is marketing.
    senderIdentityId: channel === "email" ? step.sender_identity_id : null,
    messageClass: channel === "email" ? emailMessageClass({ origin: "automation", bookingReminder }) : null,
    whatsappTemplate,
    // The key names the step, not the channel, so a fallback send and the
    // original can never both go out for the same step on a retry.
    // A booking reminder's key carries the prefix the send guard reads to
    // exempt it from the BOOKED stop condition (scheduler.ts).
    sendKey: `${bookingReminder ? BOOKING_REMINDER_SEND_KEY_PREFIX : ""}run:${run.id}:step:${step.position}`,
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

  if (payload.automationType === "booking_reminder") {
    // The next reminder's time comes from the meeting, so hand straight back
    // to the planner, which re-reads the booking.
    assertWrite(
      await admin
        .from("automation_runs")
        .update({ current_step: nextIndex, next_run_at: null })
        .eq("id", run.id)
        .eq("state", "ACTIVE"),
      "automation: advance booking reminder",
      { businessId: business.businessId, leadId: lead.id, runId: run.id },
    );
    await enqueue(
      "automation.advance",
      { leadId: lead.id, runId: run.id, automationType: payload.automationType },
      {
        businessId: business.businessId,
        idempotencyKey: `automation.advance:${run.id}:${nextIndex}`,
      },
    );
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
