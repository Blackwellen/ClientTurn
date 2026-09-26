import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { syncMetaTemplates, syncTwilioTemplates } from "@/lib/messaging/template-registry";

/**
 * `whatsapp.template_sync` (brief §45), daily.
 *
 * Without a business id: sync the platform's Twilio Content templates, then
 * queue one sync per workspace that sends through its own WhatsApp Business
 * Account. With one: sync that workspace's Meta templates. A template paused
 * or rejected at the provider shows as such here by the next day at the latest,
 * and the send path re-checks the status before every template send anyway.
 */

export const whatsAppTemplateSyncPayload = z.object({
  businessId: z.uuid().optional(),
});

export async function handleWhatsAppTemplateSync(job: ClaimedJob): Promise<void> {
  const payload = whatsAppTemplateSyncPayload.parse(job.payload ?? {});

  if (payload.businessId) {
    await syncMetaTemplates(payload.businessId);
    return;
  }

  await syncTwilioTemplates();

  const { data, error } = await createAdminClient()
    .from("integrations")
    .select("business_id")
    .eq("provider_type", "whatsapp_cloud")
    .neq("status", "DISCONNECTED")
    .limit(2000);
  if (error) throw new Error(`whatsapp.template_sync: ${error.message}`);

  const day = new Date().toISOString().slice(0, 10);
  for (const row of data ?? []) {
    await enqueue(
      "whatsapp.template_sync",
      { businessId: row.business_id },
      { businessId: row.business_id, idempotencyKey: `whatsapp-template-sync:${row.business_id}:${day}` },
    );
  }
}
