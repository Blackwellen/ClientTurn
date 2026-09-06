import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import {
  assertTransition,
  autoPauseReason,
  CampaignTransitionError,
  type AutoPauseSignals,
} from "../campaign-state";
import type { CampaignPriority, CampaignStatus } from "../types";
import { CAMPAIGN_PRIORITIES } from "../types";

/**
 * Campaign state changes (V4 section 18.2-18.7).
 *
 * Every write that moves a campaign between states goes through `transition`,
 * which asks the state machine first and records what happened second. Two
 * consequences: an invalid transition is impossible to write rather than
 * merely discouraged, and the Activity tab is complete by construction because
 * nothing can change state without passing through the place that logs it.
 */

export type CampaignEventInput = {
  businessId: string;
  campaignId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType?: "USER" | "SYSTEM" | "OPTIMIZATION";
  actorUserId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export async function recordCampaignEvent(input: CampaignEventInput): Promise<void> {
  const admin = createAdminClient();
  await admin.from("outreach_campaign_events").insert({
    business_id: input.businessId,
    campaign_id: input.campaignId,
    event_type: input.eventType,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    actor_type: input.actorType ?? (input.actorUserId ? "USER" : "SYSTEM"),
    actor_user_id: input.actorUserId ?? null,
    summary: input.summary ?? null,
    // Never a provider token, never a credential, never model reasoning.
    // Serialised through JSON so an unknown-typed value cannot reach the
    // column as something PostgREST refuses.
    metadata: JSON.parse(JSON.stringify(input.metadata ?? {})),
  });
}

export type TransitionResult =
  | { ok: true; status: CampaignStatus }
  | { ok: false; error: string };

const AUDIT_FOR_STATUS: Partial<Record<CampaignStatus, AuditAction>> = {
  ACTIVE: "outreach_campaign.launched",
  PAUSED: "outreach_campaign.paused",
  STOPPED: "outreach_campaign.stopped",
};

/**
 * Moves a campaign to `to`, or explains why it cannot go there.
 *
 * The update is conditional on the status that was read, so two people pausing
 * and stopping the same campaign at once cannot produce a state neither of
 * them chose.
 */
export async function transition(input: {
  businessId: string;
  campaignId: string;
  to: CampaignStatus;
  actorUserId?: string | null;
  actorType?: "USER" | "SYSTEM" | "OPTIMIZATION";
  reason?: string | null;
  summary?: string;
}): Promise<TransitionResult> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("id, status, review_before_outreach")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return { ok: false, error: "That campaign could not be found." };

  const from = campaign.status as CampaignStatus;
  if (from === input.to) return { ok: true, status: from };

  try {
    assertTransition(from, input.to);
  } catch (error) {
    if (error instanceof CampaignTransitionError) return { ok: false, error: error.message };
    throw error;
  }

  const now = new Date().toISOString();
  const timestamps: Record<string, string | null> = {};
  if (input.to === "ACTIVE") {
    timestamps.paused_at = null;
    timestamps.launched_at = now;
  }
  if (input.to === "PAUSED") timestamps.paused_at = now;
  if (input.to === "STOPPED") timestamps.stopped_at = now;
  if (input.to === "COMPLETED") timestamps.completed_at = now;

  const { data: updated } = await admin
    .from("outreach_campaigns")
    .update({
      status: input.to,
      pause_reason: input.to === "PAUSED" ? (input.reason ?? null) : null,
      ...timestamps,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .eq("status", from)
    .select("id");

  if (!updated?.length) {
    return { ok: false, error: "This campaign was changed elsewhere. Reload and try again." };
  }

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: input.to,
    fromStatus: from,
    toStatus: input.to,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    summary: input.summary ?? input.reason ?? undefined,
    metadata: input.reason ? { reason: input.reason } : {},
  });

  const action = AUDIT_FOR_STATUS[input.to];
  if (action) {
    await recordAudit({
      businessId: input.businessId,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? "user" : "system",
      action,
      entityType: "outreach_campaign",
      entityId: input.campaignId,
      metadata: { from, to: input.to, reason: input.reason ?? null },
    });
  }

  // Resuming a campaign that sends automatically should start sending again;
  // one waiting on review should not, whatever resumed it.
  if (input.to === "ACTIVE" && !campaign.review_before_outreach) {
    await enqueue(
      "outreach.dispatch",
      { campaignId: input.campaignId, businessId: input.businessId },
      {
        businessId: input.businessId,
        idempotencyKey: `outreach.dispatch:resume:${input.campaignId}:${now.slice(0, 13)}`,
      },
    );
  }

  return { ok: true, status: input.to };
}

/* -------------------------------------------------------------- priority */

/**
 * Priority changes scheduling order and nothing else.
 *
 * It is stored as the integer the scheduler orders by, chosen from four named
 * bands so a customer is picking a meaning rather than guessing whether 40
 * outranks 60. It can never move a campaign past suppression, contactability,
 * a budget ceiling or an unhealthy sender — all of those are re-checked per
 * recipient at send time, after ordering has already happened.
 */
export async function setPriority(input: {
  businessId: string;
  campaignId: string;
  priority: CampaignPriority;
  actorUserId: string;
}): Promise<TransitionResult> {
  const admin = createAdminClient();
  const band = CAMPAIGN_PRIORITIES.find((p) => p.value === input.priority);
  if (!band) return { ok: false, error: "That is not a priority." };

  const { data: before } = await admin
    .from("outreach_campaigns")
    .select("status, priority")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!before) return { ok: false, error: "That campaign could not be found." };

  const { data: updated } = await admin
    .from("outreach_campaigns")
    .update({ priority: band.band })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .select("id");

  if (!updated?.length) return { ok: false, error: "That priority could not be saved." };

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: "PRIORITY_CHANGED",
    actorUserId: input.actorUserId,
    summary: `Priority set to ${band.label}.`,
    metadata: { before: before.priority, after: band.band },
  });

  return { ok: true, status: before.status as CampaignStatus };
}

/* ------------------------------------------------------------- duplicate */

/**
 * Copies a campaign back into a DRAFT.
 *
 * Configuration only. Audience membership, messages, replies and spend belong
 * to the campaign that produced them, and a duplicate that inherited them
 * would double-count every one of those in reporting.
 */
export async function duplicateCampaign(input: {
  businessId: string;
  campaignId: string;
  userId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: source } = await admin
    .from("outreach_campaigns")
    .select("*")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!source) return { ok: false, error: "That campaign could not be found." };

  const { data: created, error } = await admin
    .from("outreach_campaigns")
    .insert({
      business_id: input.businessId,
      name: `${source.name} (copy)`,
      description: source.description,
      status: "DRAFT",
      conversion_goal_id: source.conversion_goal_id,
      conversion_goal_type: source.conversion_goal_type,
      success_event: source.success_event,
      icp_profile_id: source.icp_profile_id,
      service_id: source.service_id,
      search_session_id: source.search_session_id,
      sender_identity_id: source.sender_identity_id,
      audience_json: source.audience_json,
      exclusions_json: source.exclusions_json,
      named_companies: source.named_companies,
      prospect_source: source.prospect_source,
      minimum_grade: source.minimum_grade,
      intent_filter_json: source.intent_filter_json,
      intent_required: source.intent_required,
      max_intent_age_days: source.max_intent_age_days,
      review_threshold: source.review_threshold,
      reply_rules_json: source.reply_rules_json,
      promotion_rule: source.promotion_rule,
      variants_enabled: source.variants_enabled,
      variants_per_step: source.variants_per_step,
      daily_contact_cap: source.daily_contact_cap,
      monthly_contact_cap: source.monthly_contact_cap,
      prospects_per_run: source.prospects_per_run,
      communication_allowance: source.communication_allowance,
      // A copy starts having reserved nothing and having spent nothing.
      max_cost_minor: 0,
      spent_cost_minor: 0,
      reserved_allowance_minor: 0,
      // And with both spending switches off, whatever the original had.
      auto_overage: false,
      auto_optimize: false,
      review_before_outreach: true,
      launch_mode: "MANUAL_REVIEW",
      priority: source.priority,
      created_by: input.userId,
      draft_step: "review",
    })
    .select("id")
    .single();

  if (error || !created) return { ok: false, error: "That campaign could not be duplicated." };

  await copySequence(input.businessId, input.campaignId, created.id);

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: created.id,
    eventType: "CREATED",
    toStatus: "DRAFT",
    actorUserId: input.userId,
    summary: `Duplicated from ${source.name}.`,
    metadata: { sourceCampaignId: input.campaignId },
  });

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.userId,
    action: "campaign.duplicated",
    entityType: "outreach_campaign",
    entityId: created.id,
    metadata: { sourceCampaignId: input.campaignId },
  });

  return { ok: true, id: created.id };
}

async function copySequence(
  businessId: string,
  fromCampaignId: string,
  toCampaignId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { data: source } = await admin
    .from("outreach_sequences")
    .select("id")
    .eq("business_id", businessId)
    .eq("campaign_id", fromCampaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!source) return;

  const { data: sequence } = await admin
    .from("outreach_sequences")
    .insert({
      business_id: businessId,
      campaign_id: toCampaignId,
      version: 1,
      status: "DRAFT",
    })
    .select("id")
    .single();

  if (!sequence) return;

  const { data: steps } = await admin
    .from("outreach_steps")
    .select("position, delay_seconds, channel, subject_template, body_template, enabled")
    .eq("business_id", businessId)
    .eq("sequence_id", source.id)
    .order("position", { ascending: true });

  if (!steps?.length) return;

  await admin.from("outreach_steps").insert(
    steps.map((step) => ({
      business_id: businessId,
      sequence_id: sequence.id,
      position: step.position,
      delay_seconds: step.delay_seconds,
      channel: step.channel,
      subject_template: step.subject_template,
      body_template: step.body_template,
      enabled: step.enabled,
    })),
  );
}

/* --------------------------------------------------------------- archive */

/**
 * Archiving is metadata, not a sending state.
 *
 * A running campaign is stopped first — archiving something that is still
 * emailing people would hide it from the list while it carried on sending.
 */
export async function setArchived(input: {
  businessId: string;
  campaignId: string;
  archived: boolean;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("status, archived_at")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return { ok: false, error: "That campaign could not be found." };

  if (input.archived && (campaign.status === "ACTIVE" || campaign.status === "OPTIMIZING")) {
    return {
      ok: false,
      error: "Pause or stop this campaign before archiving it — it is still sending.",
    };
  }

  await admin
    .from("outreach_campaigns")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId);

  await recordCampaignEvent({
    businessId: input.businessId,
    campaignId: input.campaignId,
    eventType: input.archived ? "ARCHIVED" : "UNARCHIVED",
    actorUserId: input.userId,
    summary: input.archived ? "Campaign archived." : "Campaign restored from the archive.",
  });

  return { ok: true };
}

/* ------------------------------------------------------------ auto-pause */

/**
 * Pauses a running campaign when continuing would be unsafe.
 *
 * Called by the dispatcher before each batch. Priority is irrelevant here by
 * design: a campaign marked Urgent that is bouncing 8% of its mail is stopped
 * exactly as fast as one marked Low.
 */
export async function autoPauseIfUnsafe(input: {
  businessId: string;
  campaignId: string;
  signals: AutoPauseSignals;
}): Promise<{ paused: boolean; reason?: string }> {
  const reason = autoPauseReason(input.signals);
  if (!reason) return { paused: false };

  const result = await transition({
    businessId: input.businessId,
    campaignId: input.campaignId,
    to: "PAUSED",
    actorType: "SYSTEM",
    reason: reason.code,
    summary: reason.message,
  });

  if (!result.ok) return { paused: false };

  // The customer has to find out without going looking. An auto-pause they
  // discover a week later has already cost them the week. Queued through the
  // notification handler so it reaches every admin and respects their email
  // preferences, rather than landing on one row nobody is watching.
  await enqueue(
    "notification.send",
    {
      businessId: input.businessId,
      type: "campaign_paused",
      severity: "warning",
      title: "A campaign was paused automatically",
      body: reason.message,
      linkUrl: `/app/find-leads/campaigns/${input.campaignId}`,
      entityType: "outreach_campaign",
      entityId: input.campaignId,
    },
    {
      businessId: input.businessId,
      idempotencyKey: `campaign.autopause:${input.campaignId}:${reason.code}`,
    },
  );

  return { paused: true, reason: reason.code };
}
