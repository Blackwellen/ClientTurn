import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue } from "@/lib/jobs/queue";
import type { ClaimedJob } from "@/lib/jobs/queue";
import {
  getLeadSourcePoller,
  isPollableLeadSource,
} from "@/lib/integrations/providers/lead-source-registry";

export const leadSourcePollPayload = z.object({
  integrationId: z.uuid(),
  provider: z.string(),
});

/**
 * Polls one connected lead-source integration for new form submissions and
 * enqueues `lead.process` for each. Providers that deliver leads by webhook
 * instead of polling (Meta) never enqueue this job in the first place; this
 * handler exists for the platforms whose lead-delivery API is pull-based.
 *
 * Re-schedules itself so polling continues for as long as the integration
 * stays connected — there is no separate cron entry per provider.
 */
export async function handleLeadSourcePoll(job: ClaimedJob) {
  const payload = leadSourcePollPayload.parse(job.payload);
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("id, business_id, provider_type, status")
    .eq("id", payload.integrationId)
    .maybeSingle();

  if (!integration) return; // Disconnected and cleaned up; nothing to do.
  if (integration.status === "DISCONNECTED") return;

  if (!isPollableLeadSource(integration.provider_type)) {
    // Not every provider polls (e.g. HubSpot, Slack, Zoho). A harmless no-op,
    // not an error — the callback route enqueues this unconditionally.
    return;
  }

  const poller = getLeadSourcePoller(integration.provider_type);

  try {
    await poller.poll({ integrationId: integration.id, businessId: integration.business_id });

    await admin
      .from("integrations")
      .update({ status: "HEALTHY", last_success_at: new Date().toISOString(), last_error_at: null, last_error_code: null, last_error_message: null })
      .eq("id", integration.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed.";
    await admin
      .from("integrations")
      .update({
        status: "ACTION_REQUIRED",
        last_error_at: new Date().toISOString(),
        last_error_message: message,
      })
      .eq("id", integration.id);

    if (error instanceof PermanentJobError) throw error;
    // A transient failure still reschedules below rather than killing polling.
  }

  await enqueue(
    "lead_source.poll",
    { integrationId: integration.id, provider: integration.provider_type },
    {
      businessId: integration.business_id,
      runAt: new Date(Date.now() + 5 * 60 * 1000),
      idempotencyKey: `poll:${integration.id}:${Math.floor(Date.now() / (5 * 60 * 1000))}`,
    },
  );
}
