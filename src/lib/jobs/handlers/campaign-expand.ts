import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertEntitlement,
  EntitlementError,
} from "@/lib/billing/entitlements";
import { nextPermittedSendTime } from "@/lib/automation/scheduler";
import { loadReactivationAllowance, resolveAudience } from "@/lib/campaigns/queries";
import { reactivationLimitProblem } from "@/lib/campaigns/reactivation-limit";
import { audienceFilterSchema } from "@/lib/campaigns/types";
import { loadBusinessContext, queueNotification } from "./shared";
import { parsePayload } from "./parse";
import { campaignExpandPayload } from "./payloads";

const BATCH_SIZE = 40;

export async function handleCampaignExpand(job: ClaimedJob) {
  const payload = parsePayload(campaignExpandPayload, job.payload);
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "id, business_id, status, channel, filter_config, send_rate_per_minute, scheduled_at",
    )
    .eq("id", payload.campaignId)
    .maybeSingle();

  if (!campaign) {
    throw new PermanentJobError(`Campaign ${payload.campaignId} is gone.`);
  }
  if (campaign.status !== "RUNNING" && campaign.status !== "SCHEDULED") return;

  const business = await loadBusinessContext(campaign.business_id);
  if (!business) {
    throw new PermanentJobError(`Business ${campaign.business_id} is gone.`);
  }

  try {
    await assertEntitlement(campaign.business_id, "campaigns");
  } catch (error) {
    if (error instanceof EntitlementError) {
      await admin
        .from("campaigns")
        .update({ status: "PAUSED" })
        .eq("id", campaign.id);
      await queueNotification({
        businessId: campaign.business_id,
        type: "billing",
        severity: "error",
        title: "A campaign was paused",
        body: error.message,
        entityType: "campaign",
        entityId: campaign.id,
        linkUrl: `/app/reactivation?campaign=${campaign.id}`,
        dedupeKey: `campaign_paused:${campaign.id}`,
      });
      return;
    }
    throw error;
  }

  const scheduledAt = campaign.scheduled_at
    ? new Date(campaign.scheduled_at)
    : null;

  if (scheduledAt && scheduledAt.getTime() > Date.now() + 1000) {
    await enqueue(
      "campaign.expand",
      { campaignId: campaign.id },
      {
        businessId: campaign.business_id,
        runAt: scheduledAt,
        idempotencyKey: `campaign.expand:${campaign.id}:${scheduledAt.toISOString()}`,
      },
    );
    return;
  }

  if (campaign.status === "SCHEDULED") {
    await admin
      .from("campaigns")
      .update({ status: "RUNNING" })
      .eq("id", campaign.id)
      .eq("status", "SCHEDULED");
  }

  const filter = audienceFilterSchema.parse(campaign.filter_config ?? {});
  // An email campaign's audience is the leads with an email address, checked
  // against the email suppression list -- not the ones with a mobile.
  const channel =
    campaign.channel === "whatsapp" || campaign.channel === "email"
      ? campaign.channel
      : "sms";

  // Recomputed here rather than trusting the audience stored at review time.
  const { eligibleLeadIds } = await resolveAudience(
    campaign.business_id,
    filter,
    channel,
    admin,
  );

  // The plan's reactivation allowance, against the contacts this expansion
  // would add (rows already in the campaign were counted when added). Over it,
  // the campaign pauses with a plan-limit notice rather than part-sending.
  const { data: existingRows, error: existingError } = await admin
    .from("campaign_contacts")
    .select("lead_id")
    .eq("business_id", campaign.business_id)
    .eq("campaign_id", campaign.id)
    .limit(10_000);
  if (existingError) {
    throw new Error(`Could not read campaign ${campaign.id} contacts: ${existingError.message}`);
  }
  const already = new Set((existingRows ?? []).map((row) => row.lead_id));
  const adding = eligibleLeadIds.filter((leadId) => !already.has(leadId)).length;
  const limitProblem = reactivationLimitProblem(
    await loadReactivationAllowance(campaign.business_id),
    adding,
  );
  if (limitProblem) {
    await admin
      .from("campaigns")
      .update({ status: "PAUSED", paused_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("business_id", campaign.business_id);
    await queueNotification({
      businessId: campaign.business_id,
      type: "billing",
      severity: "warning",
      title: "A campaign was paused at your plan limit",
      body: limitProblem,
      entityType: "campaign",
      entityId: campaign.id,
      linkUrl: `/app/reactivation?campaign=${campaign.id}`,
      dedupeKey: `campaign_limit:${campaign.id}`,
    });
    return;
  }

  const intervalMs = Math.max(
    1000,
    Math.round(60_000 / Math.max(1, campaign.send_rate_per_minute)),
  );
  const start = nextPermittedSendTime(new Date(), business.quietHours);

  const rows = eligibleLeadIds.map((leadId, index) => ({
    business_id: campaign.business_id,
    campaign_id: campaign.id,
    lead_id: leadId,
    state: "scheduled",
    next_send_at: nextPermittedSendTime(
      new Date(start.getTime() + index * intervalMs),
      business.quietHours,
    ).toISOString(),
  }));

  for (let index = 0; index < rows.length; index += 200) {
    await admin
      .from("campaign_contacts")
      .upsert(rows.slice(index, index + 200), {
        onConflict: "campaign_id,lead_id",
        ignoreDuplicates: true,
      });
  }

  const { data: pending, error: pendingError } = await admin
    .from("campaign_contacts")
    .select("id, next_send_at")
    .eq("campaign_id", campaign.id)
    .in("state", ["pending", "scheduled"])
    .order("next_send_at", { ascending: true })
    .limit(5000);

  /**
   * A failed due-work query must throw, never read as "nothing to do".
   *
   * The two outcomes are indistinguishable downstream: both produce an empty
   * list, the loop runs zero times and the job reports success. That is how a
   * missing column once left the social channel silently dead while every
   * signal said healthy. Throwing puts the reason in `jobs.last_error`, where
   * the worker records it and Admin -> System shows it.
   */
  if (pendingError) {
    throw new Error(
      `Could not read pending contacts for campaign ${campaign.id}: ${pendingError.message}`,
    );
  }

  const contacts = pending ?? [];

  if (contacts.length === 0) {
    await admin
      .from("campaigns")
      .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("status", "RUNNING");
    return;
  }

  for (let index = 0; index < contacts.length; index += BATCH_SIZE) {
    const batch = contacts.slice(index, index + BATCH_SIZE);
    await enqueue(
      "campaign.send",
      { campaignId: campaign.id, contactIds: batch.map((row) => row.id) },
      {
        businessId: campaign.business_id,
        runAt: batch[0].next_send_at
          ? new Date(batch[0].next_send_at)
          : new Date(),
        idempotencyKey: `campaign.send:${campaign.id}:${batch[0].id}`,
      },
    );
  }
}
