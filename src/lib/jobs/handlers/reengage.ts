import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { recordAudit } from "@/lib/audit";
import { enqueueAgentTurn } from "@/lib/agent/events";
import { getAvailability } from "@/lib/agent/availability";
import type { WeekHours } from "@/lib/agent/availability/slots";
import type { AgentChannel } from "@/lib/agent/types";
import { parseBusinessHours } from "@/lib/settings/types";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { leadIsEngaged } from "@/lib/billing/limits-service";
import { getFollowUpChannelContext } from "@/lib/follow-up/channel-context";
import { chooseCostAwareChannel } from "@/lib/follow-up/channel-strategy";
import { withOptOutWording } from "@/lib/messaging/sms-compliance";
import { buildMessageFeatures } from "@/lib/learning/features";
import { parseCloseReason } from "@/lib/leads/close-reasons";
import { bestSendTime, hourHistogram } from "@/lib/reengagement/send-time";
import { reengagementCopy, type ApprovedOffer } from "@/lib/reengagement/templates";
import {
  isReengagementTrigger,
  reengagementAgentKey,
  reengagementSendKey,
  statedDateOf,
  TRIGGER_LOOP,
  TRIGGER_SKIP_LABEL,
  triggerJobKey,
  triggerSkipReason,
  type ReengagementTrigger,
  type TriggerSkipReason,
} from "@/lib/reengagement/triggers";
import { checkAutomatedTouchAllowed, loadReengagementSettings } from "@/lib/reengagement/service";
import { enabledForTrigger, sweepReengagementTriggers } from "@/lib/reengagement/planner";
import {
  conversationFor,
  isSuppressed,
  leadContact,
  loadBusinessContext,
  loadLead,
  mergeValues,
  queueOutboundMessage,
  type BusinessContext,
  type LeadRecord,
} from "./shared";

/**
 * `reengage.trigger` -- one intent-driven re-engagement (reengagement/
 * triggers.ts): a NOT_NOW resume, a stated deadline passing, a no-show
 * rebooking and its 24h nudge, or a lost deal's win-back.
 *
 * Retry-safe and state-first (CLAUDE.md). Every run re-reads the lead, the
 * source (the signal, the booking, the opportunity), the workspace switches
 * and the lead's contact history, and cancels on any stop condition before
 * doing anything. What it produces is either:
 *
 *   * an agent turn (FOLLOW_UP_DUE) through the normal agent path, for the
 *     NOT_NOW and deadline check-ins, so the message is composed from the
 *     conversation and refers to what the lead said; or
 *   * a deterministic message (reengagement/templates.ts) for the no-show
 *     and win-back messages, and for the check-ins where the agent cannot run.
 *
 * Either way the message is queued QUEUED and the send gate decides whether
 * it leaves: stop conditions, quiet hours, opt-out, suppression, consent (the
 * policy engine) and the frequency guard, all re-checked at the moment of
 * sending. Idempotent end to end: the agent turn and the message are both
 * keyed `reengage:<trigger>:<source>`.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const reengageTriggerPayload = z.object({
  trigger: z.string().refine(isReengagementTrigger, "unknown trigger"),
  sourceId: z.uuid(),
  leadId: z.uuid(),
  dueAt: z.string(),
  expiresAt: z.string(),
  optimiseSendTime: z.boolean(),
  slotted: z.boolean().optional(),
  deferrals: z.number().int().min(0).max(10).optional(),
});

type Payload = z.infer<typeof reengageTriggerPayload> & { trigger: ReengagementTrigger };

/** Frequency deferrals before a trigger gives up (each is at most 48 hours). */
const MAX_DEFERRALS = 3;
/** A best slot this close to now is just now. */
const SLOT_SLACK_MS = 5 * 60_000;
/** For the check-ins: a message from the lead this recently means the conversation is live. */
const LIVE_CONVERSATION_MS = 7 * 86_400_000;

/* ---------------------------------------------------------------- state --- */

type SourceFacts = {
  /** When the source happened: the signal observed, the no-show, the loss. */
  at: string | null;
  current: boolean;
  /** Win-back: the recorded loss reason. Deadline: the stated date. */
  lossReason?: string | null;
  statedDate?: Date | null;
  /** NOT_NOW: the date the lead asked to be contacted again. */
  resumeAt?: string | null;
};

async function readSource(payload: Payload, businessId: string): Promise<SourceFacts> {
  switch (payload.trigger) {
    case "NOT_NOW_RESUME":
    case "DEADLINE_PASSED": {
      const type = payload.trigger === "NOT_NOW_RESUME" ? "NOT_NOW" : "TIMEFRAME";
      const { data, error } = await db()
        .from("lead_intent_signals")
        .select("id, signal_type, observed_at, flat_until, resume_at, retracted_at")
        .eq("business_id", businessId)
        .eq("lead_id", payload.leadId)
        .eq("signal_type", type)
        .is("retracted_at", null)
        .order("observed_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`reengage: signal read failed: ${error.message}`);
      const newest = ((data ?? []) as { id: string; observed_at: string | null; flat_until: string | null; resume_at: string | null }[])[0];
      // Current only while it is still the lead's newest word of its kind.
      return {
        at: newest?.observed_at ?? null,
        current: Boolean(newest && newest.id === payload.sourceId),
        statedDate: newest ? statedDateOf({ type, flat_until: newest.flat_until, observed_at: newest.observed_at }) : null,
        resumeAt: newest?.resume_at ?? null,
      };
    }
    case "NO_SHOW_REBOOK":
    case "NO_SHOW_NUDGE": {
      const { data, error } = await db()
        .from("bookings")
        .select("id, status, updated_at")
        .eq("business_id", businessId)
        .eq("id", payload.sourceId)
        .maybeSingle();
      if (error) throw new Error(`reengage: booking read failed: ${error.message}`);
      const row = data as { status: string; updated_at: string } | null;
      return { at: row?.updated_at ?? null, current: row?.status === "no_show" };
    }
    case "QUOTE_EXPIRED": {
      // Current while the quote is still EXPIRED and is still the
      // opportunity's latest quote (a re-issued one supersedes it).
      const { data, error } = await db()
        .from("quotes")
        .select("id, status, updated_at, opportunity_id")
        .eq("business_id", businessId)
        .eq("id", payload.sourceId)
        .maybeSingle();
      if (error) throw new Error(`reengage: quote read failed: ${error.message}`);
      const row = data as { id: string; status: string; updated_at: string; opportunity_id: string } | null;
      if (!row) return { at: null, current: false };
      const { data: newer, error: newerError } = await db()
        .from("quotes")
        .select("id")
        .eq("business_id", businessId)
        .eq("opportunity_id", row.opportunity_id)
        .gt("created_at", row.updated_at)
        .limit(1);
      if (newerError) throw new Error(`reengage: quote read failed: ${newerError.message}`);
      return { at: row.updated_at, current: row.status === "EXPIRED" && (newer ?? []).length === 0, resumeAt: row.updated_at };
    }
    case "WIN_BACK": {
      const { data, error } = await db()
        .from("opportunities")
        .select("id, outcome, outcome_reason, closed_at")
        .eq("business_id", businessId)
        .eq("id", payload.sourceId)
        .maybeSingle();
      if (error) throw new Error(`reengage: opportunity read failed: ${error.message}`);
      const row = data as { outcome: string; outcome_reason: string | null; closed_at: string | null } | null;
      return { at: row?.closed_at ?? null, current: row?.outcome === "LOST", lossReason: row?.outcome_reason ?? null };
    }
  }
}

async function lastInbound(businessId: string, leadId: string): Promise<{ at: string; channel: string } | null> {
  const { data, error } = await db()
    .from("messages")
    .select("created_at, channel")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`reengage: inbound read failed: ${error.message}`);
  const row = ((data ?? []) as { created_at: string; channel: string }[])[0];
  return row ? { at: row.created_at, channel: row.channel } : null;
}

async function bookedSince(businessId: string, leadId: string, since: string | null, excludeId: string | null): Promise<boolean> {
  if (!since) return false;
  let query = db()
    .from("bookings")
    .select("id")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .in("status", ["scheduled", "pending", "completed"])
    .gt("created_at", since)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw new Error(`reengage: bookings read failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function leadExtras(leadId: string): Promise<{ archived: boolean; anonymised: boolean }> {
  const { data, error } = await db().from("leads").select("archived_at, anonymised_at").eq("id", leadId).maybeSingle();
  if (error) throw new Error(`reengage: lead read failed: ${error.message}`);
  const row = data as { archived_at: string | null; anonymised_at: string | null } | null;
  return { archived: Boolean(row?.archived_at), anonymised: Boolean(row?.anonymised_at) };
}

/* ------------------------------------------------------------ send time --- */

async function workspaceReplyHistogram(businessId: string, timeZone: string): Promise<number[] | null> {
  const { data, error } = await db()
    .from("messages")
    .select("created_at")
    .eq("business_id", businessId)
    .eq("direction", "inbound")
    .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return null;
  return hourHistogram(((data ?? []) as { created_at: string }[]).map((row) => row.created_at), timeZone);
}

async function leadReplyTimes(businessId: string, leadId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("messages")
    .select("created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return ((data ?? []) as { created_at: string }[]).map((row) => row.created_at);
}

/** The best moment for this lead, never before `notBefore`. */
export async function bestSendTimeFor(input: {
  business: BusinessContext;
  leadId: string;
  notBefore: Date;
  workspaceHistogram?: number[] | null;
}): Promise<Date> {
  const [leadReplies, workspaceHistogram] = await Promise.all([
    leadReplyTimes(input.business.businessId, input.leadId),
    input.workspaceHistogram !== undefined
      ? Promise.resolve(input.workspaceHistogram)
      : workspaceReplyHistogram(input.business.businessId, input.business.timezone),
  ]);
  return bestSendTime({
    notBefore: input.notBefore,
    leadReplies,
    workspaceHistogram,
    timeZone: input.business.timezone,
    quietHours: input.business.quietHours,
  }).at;
}

export { workspaceReplyHistogram };

/* --------------------------------------------------------------- channel --- */

async function chooseChannel(
  business: BusinessContext,
  lead: LeadRecord,
  preferred: string | null,
): Promise<"sms" | "email" | null> {
  const [engaged, context] = await Promise.all([
    leadIsEngaged(business.businessId, lead.id),
    getFollowUpChannelContext(business.businessId),
  ]);
  const email = leadContact(lead, "email");
  const phone = leadContact(lead, "sms");
  // A suppressed address is not an address: pick the other channel rather
  // than queue a message the gate would only refuse.
  const [emailSuppressed, smsSuppressed] = await Promise.all([
    email ? isSuppressed(business.businessId, email, "email") : Promise.resolve(true),
    phone ? isSuppressed(business.businessId, phone, "sms") : Promise.resolve(true),
  ]);
  return chooseCostAwareChannel({
    engaged,
    preferred: preferred === "sms" || preferred === "email" ? preferred : null,
    available: { sms: context.available.sms, email: context.available.email },
    leadHas: { sms: Boolean(phone) && !smsSuppressed, email: Boolean(email) && !emailSuppressed },
  });
}

function agentCanCompose(business: BusinessContext, channel: AgentChannel): boolean {
  return (
    business.aiAssistEnabled &&
    business.agent.mode !== "OFF" &&
    business.agent.channels.includes(channel)
  );
}

/* ------------------------------------------------------------- content --- */

async function freshSlots(business: BusinessContext): Promise<string[]> {
  try {
    const { data } = await db()
      .from("business_settings")
      .select("business_hours, appointment_duration_minutes, booking_buffer_minutes")
      .eq("business_id", business.businessId)
      .maybeSingle();
    const row = (data ?? {}) as {
      business_hours?: unknown;
      appointment_duration_minutes?: number | null;
      booking_buffer_minutes?: number | null;
    };
    const result = await getAvailability(
      { businessId: business.businessId, timezone: business.timezone, limit: 3 },
      {
        bookingMode: business.bookingMode,
        businessHours: parseBusinessHours(row.business_hours) as WeekHours,
        appointmentDurationMinutes: row.appointment_duration_minutes ?? 60,
        bookingBufferMinutes: row.booking_buffer_minutes ?? 0,
      },
    );
    return result.ok ? result.slots.slice(0, 3).map((slot) => slot.label) : [];
  } catch (error) {
    // No calendar, or it did not answer: the message offers the booking link
    // (or asks for a time) instead of inventing one.
    console.info("[reengage] no fresh slots", { businessId: business.businessId, message: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function approvedOffer(businessId: string): Promise<ApprovedOffer | null> {
  try {
    const authority = await loadCommercialAuthoritySettings(businessId);
    const link = authority.enabled ? authority.approved_checkout_links[0] : null;
    return link ? { label: link.label, priceText: link.price_text, url: link.url } : null;
  } catch {
    return null;
  }
}

function formatStatedDate(date: Date | null | undefined, timeZone: string): string | null {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone }).format(date);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- outcome --- */

async function skip(payload: Payload, businessId: string, reason: TriggerSkipReason | "frequency" | "no_channel", detail?: string) {
  await recordAudit({
    businessId,
    actorType: "system",
    action: "reengagement.trigger_skipped",
    entityType: "lead",
    entityId: payload.leadId,
    metadata: {
      trigger: payload.trigger,
      source_id: payload.sourceId,
      reason,
      detail: detail ?? (reason in TRIGGER_SKIP_LABEL ? TRIGGER_SKIP_LABEL[reason as TriggerSkipReason] : reason),
    },
  });
}

async function requeue(job: ClaimedJob, payload: Payload, at: Date, suffix: string, patch: Partial<Payload> = {}) {
  await enqueue(
    "reengage.trigger",
    { ...payload, ...patch } as unknown as Record<string, unknown>,
    {
      businessId: job.business_id,
      runAt: at,
      priority: 90,
      maxAttempts: 4,
      idempotencyKey: `${triggerJobKey(payload.trigger, payload.sourceId)}:${suffix}`,
    },
  );
}

/* --------------------------------------------------------------- handler --- */

export async function handleReengageTrigger(job: ClaimedJob): Promise<void> {
  const parsed = reengageTriggerPayload.safeParse(job.payload ?? {});
  if (!parsed.success) throw new PermanentJobError("reengage.trigger: invalid payload");
  const payload = parsed.data as Payload;
  const businessId = job.business_id;
  if (!businessId) throw new PermanentJobError("reengage.trigger: job has no workspace");

  const now = new Date();
  const [business, lead, settings] = await Promise.all([
    loadBusinessContext(businessId),
    loadLead(payload.leadId),
    loadReengagementSettings(businessId),
  ]);
  if (!business) throw new PermanentJobError(`reengage.trigger: workspace ${businessId} is gone`);
  if (lead && lead.business_id !== businessId) throw new PermanentJobError("reengage.trigger: lead belongs to another workspace");

  // ---- 1. re-read state and cancel on any stop condition --------------
  const source = await readSource(payload, businessId);
  const [extras, inbound, booked] = await Promise.all([
    lead ? leadExtras(lead.id) : Promise.resolve({ archived: false, anonymised: true }),
    lead ? lastInbound(businessId, lead.id) : Promise.resolve(null),
    lead
      ? bookedSince(
          businessId,
          lead.id,
          source.at,
          payload.trigger === "NO_SHOW_REBOOK" || payload.trigger === "NO_SHOW_NUDGE" ? payload.sourceId : null,
        )
      : Promise.resolve(false),
  ]);

  const repliedSinceSource = (() => {
    if (!inbound) return false;
    const at = Date.parse(inbound.at);
    if (payload.trigger === "NOT_NOW_RESUME" || payload.trigger === "DEADLINE_PASSED") {
      // "Thanks, speak in March" does not cancel March. A conversation that
      // is live right now does: the agent is already talking to them.
      // The message the signal was read from is not "since": a minute of slack.
      return now.getTime() - at < LIVE_CONVERSATION_MS && (!source.at || at > Date.parse(source.at) + 60_000);
    }
    return Boolean(source.at && at > Date.parse(source.at));
  })();

  const reason = triggerSkipReason({
    trigger: payload.trigger,
    now,
    expiresAt: new Date(payload.expiresAt),
    enabled: enabledForTrigger(payload.trigger, settings),
    lead: lead
      ? {
          status: lead.status,
          optedOut: lead.opted_out,
          humanTakeover: lead.human_takeover,
          automationActive: lead.automation_active,
          archived: extras.archived,
          anonymised: extras.anonymised,
          isTest: lead.is_test,
        }
      : null,
    repliedSinceSource,
    bookedSinceSource: booked,
    sourceCurrent: source.current,
  });
  if (reason) {
    await skip(payload, businessId, reason);
    return;
  }
  if (!lead) return;

  // ---- 2. best send time (not for the time-critical no-show messages) --
  if (payload.optimiseSendTime && !payload.slotted) {
    const at = await bestSendTimeFor({ business, leadId: lead.id, notBefore: now });
    if (at.getTime() - now.getTime() > SLOT_SLACK_MS) {
      await requeue(job, payload, at, "slot", { slotted: true });
      return;
    }
  }

  // ---- 3. the frequency guard, before anything is composed ------------
  const verdict = await checkAutomatedTouchAllowed({
    businessId,
    leadId: lead.id,
    loop: TRIGGER_LOOP[payload.trigger],
    at: now,
    settings,
  });
  if (verdict.action === "skip") {
    await skip(payload, businessId, "frequency", verdict.message);
    return;
  }
  if (verdict.action === "defer") {
    const deferrals = (payload.deferrals ?? 0) + 1;
    if (deferrals > MAX_DEFERRALS) {
      await skip(payload, businessId, "frequency", "Deferred too often by the contact-frequency limits.");
      return;
    }
    await requeue(job, payload, verdict.at, `defer:${deferrals}`, { deferrals });
    return;
  }

  // ---- 4. channel: cheapest first for a lead who has not engaged -------
  const channel = await chooseChannel(business, lead, inbound?.channel ?? null);
  if (!channel) {
    await skip(payload, businessId, "no_channel", "No usable channel: no permitted, connected channel with an address for this lead.");
    return;
  }

  // ---- 5a. check-ins: the conversation agent composes -----------------
  if (
    (payload.trigger === "NOT_NOW_RESUME" || payload.trigger === "DEADLINE_PASSED" || payload.trigger === "QUOTE_EXPIRED") &&
    agentCanCompose(business, channel)
  ) {
    const conversationId = await conversationFor(businessId, lead.id, channel);
    const key = reengagementAgentKey(payload.trigger, payload.sourceId);
    await enqueueAgentTurn({
      eventId: key,
      eventType: "FOLLOW_UP_DUE",
      businessId,
      leadId: lead.id,
      conversationId,
      channel,
      provider: null,
      occurredAt: now.toISOString(),
      // Never the lead's words: a FOLLOW_UP_DUE turn carries no message.
      text: null,
      // Why the agent is writing, as structured facts (triggers.ts
      // reengagementReasonLine renders them into the turn's plan).
      payload: {
        reengagement: payload.trigger,
        sourceId: payload.sourceId,
        reengagementDate:
          payload.trigger === "NOT_NOW_RESUME" || payload.trigger === "QUOTE_EXPIRED"
            ? (source.resumeAt ?? null)
            : (source.statedDate?.toISOString() ?? null),
      },
      idempotencyKey: key,
    });
    await recordAudit({
      businessId,
      actorType: "system",
      action: "reengagement.trigger_fired",
      entityType: "lead",
      entityId: lead.id,
      metadata: { trigger: payload.trigger, source_id: payload.sourceId, channel, path: "agent" },
    });
    return;
  }

  // ---- 5b. deterministic copy ------------------------------------------
  const values = await mergeValues(business, lead);
  const lossCategory =
    payload.trigger === "WIN_BACK" ? parseCloseReason(source.lossReason).category : null;
  const copy = reengagementCopy({
    trigger: payload.trigger,
    values: {
      firstName: lead.first_name,
      businessName: business.name,
      serviceName: values.service_name || null,
      bookingLink: business.bookingUrl,
    },
    lossCategory,
    slots: payload.trigger === "NO_SHOW_REBOOK" ? await freshSlots(business) : [],
    offer: payload.trigger === "WIN_BACK" && lossCategory === "Price" ? await approvedOffer(businessId) : null,
    statedDate: payload.trigger === "DEADLINE_PASSED" ? formatStatedDate(source.statedDate, business.timezone) : null,
  });
  const body = withOptOutWording(copy.body, { channel, wording: business.optOutWording });
  const sendKey = reengagementSendKey(payload.trigger, payload.sourceId);

  const messageId = await queueOutboundMessage({
    businessId,
    leadId: lead.id,
    channel,
    body,
    subject: channel === "email" ? copy.subject : null,
    origin: "automation",
    sendKey,
    messageClass: "MARKETING",
    features: {
      ...buildMessageFeatures({
        family: payload.trigger === "WIN_BACK" ? "REACTIVATION" : "FOLLOW_UP",
        body,
        channel,
        sendAt: now,
        timeZone: business.timezone,
        templateId: `reengage:${payload.trigger}`,
      }),
      loop: TRIGGER_LOOP[payload.trigger],
    },
  });
  if (!messageId) throw new Error(`reengage.trigger: could not queue the ${payload.trigger} message`);

  await recordAudit({
    businessId,
    actorType: "system",
    action: "reengagement.trigger_fired",
    entityType: "lead",
    entityId: lead.id,
    metadata: { trigger: payload.trigger, source_id: payload.sourceId, channel, path: "template", message_id: messageId },
  });
}

/* ----------------------------------------------------------------- sweep --- */

const HOUR_MS = 3_600_000;

/** Queued by the worker tick; one sweep per hour bucket. */
export async function scheduleReengageSweep(): Promise<void> {
  const bucket = Math.floor(Date.now() / HOUR_MS);
  await enqueue("reengage.sweep", { bucket }, { idempotencyKey: `reengage.sweep:${bucket}`, priority: 120 });
}

export async function handleReengageSweep(_job: ClaimedJob): Promise<void> {
  void _job;
  const result = await sweepReengagementTriggers();
  if (result.planned > 0) console.info("[reengage.sweep] planned", result);
}
