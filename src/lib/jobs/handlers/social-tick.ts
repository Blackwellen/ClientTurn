import "server-only";
import { parsePayload } from "./parse";
import { socialAdvancePayload } from "./payloads";
import type { ClaimedJob } from "@/lib/jobs/queue";
import {
  advanceSocialWorkspace,
  sweepDueSocialWork,
} from "@/lib/outreach/social-scheduler";

/**
 * The 24/7 driver for connect-then-message.
 *
 * Two handlers, matching the two layers in `social-scheduler.ts`. The split
 * exists so that one workspace whose LinkedIn account has been restricted, or
 * whose provider is timing out, cannot stall every other workspace's queue --
 * the failure is contained to that workspace's own job and its own retries.
 *
 * Neither handler takes any action on a platform. See the header of
 * `social-scheduler.ts` for what "performing" means on this channel and why
 * the default is deliberately not autonomous.
 */

/** The sweep. Finds workspaces with due rows and fans out one job each. */
export async function handleSocialTick(): Promise<void> {
  await sweepDueSocialWork();
}

/** One workspace's due rows. */
export async function handleSocialAdvance(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(socialAdvancePayload, job.payload);
  await advanceSocialWorkspace(payload.businessId);
}
