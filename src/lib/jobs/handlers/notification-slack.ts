import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { postSlackMessage } from "@/lib/integrations/providers/slack";

export const notificationSlackPayload = z.object({
  businessId: z.uuid(),
  text: z.string().min(1).max(3000),
  leadId: z.uuid().optional(),
});

/**
 * Posts one alert to the workspace's connected Slack channel. A workspace
 * with no Slack connection is not an error — the caller enqueues this
 * unconditionally for every notification-worthy event, same as email.
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

  await postSlackMessage({ integrationId: integration.id, text: payload.text });
}
