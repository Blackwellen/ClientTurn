import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";

const CRM_PROVIDERS = ["hubspot", "zoho_crm"] as const;

/**
 * Called at every point a lead reaches QUALIFIED, BOOKED or WON. Enqueues one
 * `crm.push` job per CRM destination the business currently has connected;
 * businesses with neither connected pay one cheap `integrations` lookup and
 * nothing else.
 */
export async function enqueueCrmPushes(businessId: string, leadId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: integrations } = await admin
    .from("integrations")
    .select("provider_type, status")
    .eq("business_id", businessId)
    .in("provider_type", CRM_PROVIDERS)
    .neq("status", "DISCONNECTED");

  for (const integration of integrations ?? []) {
    const provider = integration.provider_type as (typeof CRM_PROVIDERS)[number];
    await enqueue(
      "crm.push",
      { leadId, provider },
      { businessId, idempotencyKey: `crm-push:${leadId}:${provider}` },
    );
  }
}
