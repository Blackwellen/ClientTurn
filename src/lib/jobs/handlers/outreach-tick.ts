import "server-only";
import { sweepDueCampaigns } from "@/lib/outreach/sequence-scheduler";

/**
 * The safety net under the sequence scheduler.
 *
 * Each dispatch queues its own next wake, which is precise and cheap. This
 * sweep exists for everything that path cannot cover: a job dropped by a
 * failed worker, a campaign resumed after a pause, a recipient whose due time
 * was set by the reply handler rather than the dispatcher.
 *
 * Idempotency keys are bucketed by minute, so running it more often than
 * necessary queues nothing extra.
 */
export async function handleOutreachTick(): Promise<void> {
  await sweepDueCampaigns();
}
