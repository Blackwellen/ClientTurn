import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import {
  campaignsDueForOptimization,
  optimizeCampaign,
} from "@/lib/outreach/campaigns/optimizer";

/**
 * The daily optimisation pass.
 *
 * Daily rather than per-tick because the evidence it reads accumulates over
 * days: running it every minute would mean re-deciding the same question
 * against the same numbers, and every pass writes an audit row.
 *
 * With no payload it sweeps every campaign that has opted in; with a campaign
 * id it optimises that one, which is what the "run now" path uses.
 */

const payloadSchema = z.object({
  businessId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
});

export async function handleOutreachOptimize(job: ClaimedJob): Promise<void> {
  const payload = payloadSchema.parse(job.payload ?? {});

  if (payload.businessId && payload.campaignId) {
    await optimizeCampaign({
      businessId: payload.businessId,
      campaignId: payload.campaignId,
    });
    return;
  }

  const due = await campaignsDueForOptimization();

  // Sequential on purpose. This is a background sweep with no deadline, and a
  // burst of parallel writes against the same workspace buys nothing.
  for (const campaign of due) {
    try {
      await optimizeCampaign(campaign);
    } catch (error) {
      // One campaign's bad data must not stop the sweep for everyone else.
      console.error(
        "Optimisation failed for campaign",
        campaign.campaignId,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
