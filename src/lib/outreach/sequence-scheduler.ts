import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";

/**
 * The sequence scheduler.
 *
 * Multi-step outreach had a hole that only showed up on the second step. The
 * dispatcher sends step 1, sets `next_step_due_at` to now plus the step's
 * delay, and returns — and because there was no more work *right now*, nothing
 * re-queued it. Three days later the follow-up was due and no job existed to
 * send it. Every sequence silently stopped after its first message, which is
 * the worst kind of failure: the campaign looks like it is running, the
 * recipients look enrolled, and the follow-ups simply never arrive.
 *
 * Two mechanisms close it, deliberately overlapping:
 *
 *   * **Precise.** After a dispatch batch, `scheduleNextWake` looks up the
 *     earliest future due time for that campaign and queues one job for then.
 *     No polling, and a sequence with a three-day gap costs one job.
 *   * **A sweep.** `sweepDueCampaigns` finds anything due across every
 *     workspace and queues it. This is the safety net for a job that was
 *     dropped, a campaign resumed after a pause, or a recipient whose due time
 *     was set by something other than the dispatcher.
 *
 * The sweep alone would work, but it would mean polling every campaign
 * forever; the precise wake alone would work until the first lost job. Having
 * both is what makes a follow-up that is due in four days actually arrive.
 */

/** Never queue a wake further out than this; the sweep will pick it up. */
const MAX_WAKE_HORIZON_MS = 6 * 3600_000;

/** Floor, so a zero-delay step cannot spin the queue. */
const MIN_WAKE_MS = 30_000;

/**
 * Queues the next dispatch for one campaign, at the moment its earliest
 * pending recipient actually becomes due.
 */
export async function scheduleNextWake(input: {
  businessId: string;
  campaignId: string;
}): Promise<{ scheduledFor: string | null }> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("status")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  // A paused or finished campaign gets no wake. Resuming re-queues it.
  if (!campaign || campaign.status !== "ACTIVE") return { scheduledFor: null };

  const { data: next } = await admin
    .from("outreach_recipient_runs")
    .select("next_step_due_at")
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .not("next_step_due_at", "is", null)
    .order("next_step_due_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next?.next_step_due_at) return { scheduledFor: null };

  const dueAt = new Date(next.next_step_due_at).getTime();
  const delay = Math.min(
    MAX_WAKE_HORIZON_MS,
    Math.max(MIN_WAKE_MS, dueAt - Date.now()),
  );
  const runAt = new Date(Date.now() + delay);

  // Bucketed to the minute so a campaign whose recipients are all due at once
  // queues one job rather than one per recipient.
  const bucket = new Date(Math.floor(runAt.getTime() / 60_000) * 60_000).toISOString();

  await enqueue(
    "outreach.dispatch",
    { campaignId: input.campaignId, businessId: input.businessId },
    {
      businessId: input.businessId,
      runAt,
      idempotencyKey: `outreach.dispatch:${input.campaignId}:wake:${bucket}`,
    },
  );

  return { scheduledFor: runAt.toISOString() };
}

export type SweepOutcome = {
  campaignsQueued: number;
  recipientsDue: number;
};

/**
 * Finds every campaign with work that is due now and queues one dispatch each.
 *
 * Scoped to ACTIVE campaigns and bounded, so one workspace with a huge backlog
 * cannot starve the rest. Idempotency keys are bucketed by minute, so running
 * this more often than needed costs nothing.
 */
export async function sweepDueCampaigns(
  limit = 50,
): Promise<SweepOutcome> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: due } = await admin
    .from("outreach_recipient_runs")
    .select("business_id, campaign_id")
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .not("next_step_due_at", "is", null)
    .lte("next_step_due_at", now)
    .order("next_step_due_at", { ascending: true })
    .limit(limit * 20);

  if (!due?.length) return { campaignsQueued: 0, recipientsDue: 0 };

  // Collapse to one job per campaign: the dispatcher works a batch and
  // re-queues itself, so queueing per recipient would be pure waste.
  const byCampaign = new Map<string, string>();
  for (const row of due) {
    if (!row.campaign_id) continue;
    if (!byCampaign.has(row.campaign_id)) {
      byCampaign.set(row.campaign_id, row.business_id);
    }
  }

  const campaignIds = [...byCampaign.keys()].slice(0, limit);
  if (campaignIds.length === 0) return { campaignsQueued: 0, recipientsDue: due.length };

  // Only campaigns that are actually running. A recipient left due on a paused
  // campaign is correct — it waits — and must not be woken by the sweep.
  const { data: active } = await admin
    .from("outreach_campaigns")
    .select("id, business_id")
    .in("id", campaignIds)
    .eq("status", "ACTIVE");

  const bucket = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  let queued = 0;

  for (const campaign of active ?? []) {
    await enqueue(
      "outreach.dispatch",
      { campaignId: campaign.id, businessId: campaign.business_id },
      {
        businessId: campaign.business_id,
        idempotencyKey: `outreach.dispatch:${campaign.id}:sweep:${bucket}`,
      },
    );
    queued += 1;
  }

  return { campaignsQueued: queued, recipientsDue: due.length };
}
