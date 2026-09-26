import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import {
  postSlackMessage,
  SlackChannelNotConfiguredError,
} from "@/lib/integrations/providers/slack";

export const notificationSlackPayload = z.object({
  businessId: z.uuid(),
  text: z.string().min(1).max(3000),
  leadId: z.uuid().optional(),
  /** Block Kit blocks — e.g. the Acknowledge/Resolve buttons on a handover alert. */
  blocks: z.array(z.record(z.string(), z.unknown())).optional(),
});

/**
 * Posts one alert to the workspace's connected Slack channel. A workspace
 * with no Slack connection is not an error — the caller enqueues this
 * unconditionally for every notification-worthy event, same as email.
 *
 * Deliberately not subject to quiet hours: quiet hours protect a *lead* from
 * being messaged outside the hours the workspace configured for them. This
 * alert goes to the workspace's own team about their own inbox, on a channel
 * they chose to connect for exactly that purpose — holding it until morning
 * would mean a handover raised at 2am waits for business hours to reach
 * anyone.
 */
export async function handleNotificationSlack(job: ClaimedJob) {
  const payload = notificationSlackPayload.parse(job.payload);
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("id, status, config")
    .eq("business_id", payload.businessId)
    .eq("provider_type", "slack")
    .maybeSingle();

  if (!integration || integration.status === "DISCONNECTED") return;

  try {
    await postSlackMessage({
      integrationId: integration.id,
      text: payload.text,
      blocks: payload.blocks,
    });
  } catch (error) {
    // A missing channel is a workspace misconfiguration, not a transient
    // failure — retrying it for up to 6 hours before it dead-letters only
    // delays the admin/customer signal that a channel needs to be set.
    if (error instanceof SlackChannelNotConfiguredError) {
      throw new PermanentJobError(error.message);
    }
    throw error;
  }
}
