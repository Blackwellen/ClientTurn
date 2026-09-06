import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { dispatchCampaign } from "@/lib/outreach/dispatch";
import { scheduleNextWake } from "@/lib/outreach/sequence-scheduler";

/**
 * Sends the next batch of a cold outreach campaign.
 *
 * Bounded per invocation and re-queued while work remains, for the same reason
 * the sourcing worker is time-boxed: a long campaign must not depend on one
 * invocation surviving, and a cap being reached should pause the work rather
 * than fail it.
 */

const payloadSchema = z.object({ campaignId: z.uuid(), businessId: z.uuid() });

export async function handleOutreachDispatch(job: ClaimedJob): Promise<void> {
  const { campaignId, businessId } = payloadSchema.parse(job.payload);

  const outcome = await dispatchCampaign({ businessId, campaignId });

  // A halt is a decision, not an error: the campaign is paused, the sender is
  // unverified, or the daily cap is spent. Throwing would retry with backoff
  // and change nothing.
  if (outcome.haltReason === "SENDER_DAILY_CAP") {
    await enqueue(
      "outreach.dispatch",
      { campaignId, businessId },
      {
        businessId,
        // Tomorrow, when the cap rolls over.
        runAt: new Date(Date.now() + 6 * 3600_000),
        idempotencyKey: `outreach.dispatch:${campaignId}:${new Date().toISOString().slice(0, 10)}:capped`,
      },
    );
    return;
  }

  if (outcome.haltReason) return;

  if (!outcome.more) {
    // No work right now, but a later step may be due in an hour or three days.
    // Without this the sequence stops after step 1: the dispatcher schedules
    // `next_step_due_at` and nothing ever comes back to act on it.
    await scheduleNextWake({ businessId, campaignId });
    return;
  }

  if (outcome.more) {
    await enqueue(
      "outreach.dispatch",
      { campaignId, businessId },
      {
        businessId,
        runAt: new Date(Date.now() + 60_000),
        idempotencyKey: `outreach.dispatch:${campaignId}:${Date.now()}`,
      },
    );
  }
}
