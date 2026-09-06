import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { enqueue } from "@/lib/jobs/queue";
import { materializeAudience } from "@/lib/outreach/campaigns/materialize";

/**
 * Builds a campaign's audience after launch.
 *
 * Separate from dispatch because selecting who a campaign *could* contact and
 * deciding to write to them are different acts with different safety
 * properties. A READY campaign runs this and sends nothing, which is what lets
 * a customer inspect the audience before activating.
 *
 * Bounded per invocation and re-queued while candidates remain, so a workspace
 * with fifty thousand prospects does not depend on one job surviving.
 */

const payloadSchema = z.object({ businessId: z.uuid(), campaignId: z.uuid() });

export async function handleOutreachAudience(job: ClaimedJob): Promise<void> {
  const { businessId, campaignId } = payloadSchema.parse(job.payload);

  const outcome = await materializeAudience({ businessId, campaignId });

  if (outcome.more) {
    await enqueue(
      "outreach.audience",
      { businessId, campaignId },
      {
        businessId,
        runAt: new Date(Date.now() + 30_000),
        // Keyed on how far it got, so a re-queue is a distinct job while a
        // duplicate of the same batch is not.
        idempotencyKey: `outreach.audience:${campaignId}:${outcome.enrolled}:${Date.now()}`,
      },
    );
  }
}
