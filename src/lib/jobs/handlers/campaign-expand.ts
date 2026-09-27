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
import type { SupabaseClient } from "@supabase/supabase-js";
import { bestSendTime } from "@/lib/reengagement/send-time";
import { workspaceReplyHistogram } from "./reengage";

/**
 * The campaign's send timing (0146). `best_time` sends each contact at the
 * hour they have replied in before (else the workspace's, else Tue-Thu
 * 10:00), within 14 days; `immediate` as fast as the send rate allows. A
 * database without the column keeps the old behaviour.
 */
async function campaignSendTiming(campaignId: string): Promise<"best_time" | "immediate"> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.from("campaigns").select("send_timing").eq("id", campaignId).maybeSingle();
  if (error) return "immediate";
  return (data as { send_timing?: string | null } | null)?.send_timing === "best_time" ? "best_time" : "immediate";
}

/** Each lead's recent inbound message times, read in chunks. */
async function replyTimesByLead(businessId: string, leadIds: string[]): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const out = new Map<string, string[]>();
  for (let index = 0; index < leadIds.length; index += 200) {
    const { data, error } = await admin
      .from("messages")
      .select("lead_id, created_at")
      .eq("business_id", businessId)
      .eq("direction", "inbound")
      .in("lead_id", leadIds.slice(index, index + 200))
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(`Could not read reply history: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.lead_id) continue;
      const list = out.get(row.lead_id) ?? [];
      if (list.length < 50) list.push(row.created_at);
      out.set(row.lead_id, list);
    }
  }
  return out;
}
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

  // Best send time: never earlier than the rate-limited slot, at the lead's
  // own reply hour where known. Only for contacts this expansion adds.
  const timing = await campaignSendTiming(campaign.id);
  const newLeads = eligibleLeadIds.filter((leadId) => !already.has(leadId));
  const [replies, workspaceHistogram] =
    timing === "best_time"
      ? await Promise.all([
          replyTimesByLead(campaign.business_id, newLeads),
          workspaceReplyHistogram(campaign.business_id, business.timezone),
        ])
      : [new Map<string, string[]>(), null];

  const rows = eligibleLeadIds.map((leadId, index) => {
    const slot = nextPermittedSendTime(new Date(start.getTime() + index * intervalMs), business.quietHours);
    const at =
      timing === "best_time"
        ? bestSendTime({
            notBefore: slot,
            leadReplies: replies.get(leadId) ?? [],
            workspaceHistogram,
            timeZone: business.timezone,
            quietHours: business.quietHours,
          }).at
        : slot;
    return {
      business_id: campaign.business_id,
      campaign_id: campaign.id,
      lead_id: leadId,
      state: "scheduled",
      next_send_at: at.toISOString(),
    };
  });

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

  // Batches of up to BATCH_SIZE contacts due within ten minutes of each
  // other (best-time contacts are spread over days), each run at its LAST
  // contact's time so nobody is sent before their own slot.
  const WINDOW_MS = 10 * 60_000;
  const due = (row: { next_send_at: string | null }) => (row.next_send_at ? Date.parse(row.next_send_at) : Date.now());
  let batch: typeof contacts = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const runAt = new Date(Math.max(...batch.map(due)));
    await enqueue(
      "campaign.send",
      { campaignId: campaign.id, contactIds: batch.map((row) => row.id) },
      {
        businessId: campaign.business_id,
        runAt,
        idempotencyKey: `campaign.send:${campaign.id}:${batch[0].id}`,
      },
    );
    batch = [];
  };
  for (const row of contacts) {
    if (batch.length >= BATCH_SIZE || (batch.length > 0 && due(row) - due(batch[0]) > WINDOW_MS)) await flush();
    batch.push(row);
  }
  await flush();
}
