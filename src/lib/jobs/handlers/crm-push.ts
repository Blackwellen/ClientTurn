import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { getCrmPushAdapter, isCrmProvider } from "@/lib/integrations/providers/crm-registry";

export const crmPushPayload = z.object({
  leadId: z.uuid(),
  provider: z.enum(["hubspot", "zoho_crm"]),
});

/**
 * Pushes one lead to one CRM. Re-reads the lead and the connection before
 * calling out, and records the result in `crm_push_records` keyed on
 * (business, lead, provider) so a retry after a partial failure updates the
 * same record rather than creating a duplicate contact.
 */
export async function handleCrmPush(job: ClaimedJob) {
  const payload = crmPushPayload.parse(job.payload);
  const admin = createAdminClient();

  if (!isCrmProvider(payload.provider)) {
    throw new PermanentJobError(`No CRM adapter for ${payload.provider}`);
  }

  // Genuinely nullable on the jobs table; every caller sets it for this job
  // type, but that is an invariant of the callers, not the schema.
  const businessId = job.business_id;
  if (!businessId) {
    throw new PermanentJobError("crm.push job is missing business_id.");
  }

  const [{ data: lead }, { data: integration }] = await Promise.all([
    admin
      .from("leads")
      .select(
        "id, business_id, first_name, last_name, phone, email, postcode, status, qualification_state, created_at, services(name, average_value)",
      )
      .eq("id", payload.leadId)
      .maybeSingle(),
    admin
      .from("integrations")
      .select("id, status, external_account_id")
      .eq("business_id", businessId)
      .eq("provider_type", payload.provider)
      .maybeSingle(),
  ]);

  if (!lead) throw new PermanentJobError("Lead no longer exists.");
  if (!integration || integration.status === "DISCONNECTED") {
    throw new PermanentJobError(`${payload.provider} is not connected.`);
  }

  const adapter = getCrmPushAdapter(payload.provider);

  try {
    const result = await adapter.push({ integrationId: integration.id, lead });

    await admin.from("crm_push_records").upsert(
      {
        business_id: job.business_id!,
        lead_id: lead.id,
        provider_type: payload.provider,
        external_contact_id: result.externalContactId,
        external_deal_id: result.externalDealId ?? null,
        status: "pushed",
        pushed_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "business_id,lead_id,provider_type" },
    );

    await recordAudit({
      businessId: job.business_id,
      action: "crm.pushed",
      entityType: "lead",
      entityId: lead.id,
      metadata: { provider: payload.provider },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push failed.";

    await admin.from("crm_push_records").upsert(
      {
        business_id: job.business_id!,
        lead_id: lead.id,
        provider_type: payload.provider,
        status: "failed",
        last_error: message,
      },
      { onConflict: "business_id,lead_id,provider_type" },
    );

    await recordAudit({
      businessId: job.business_id,
      action: "crm.push_failed",
      entityType: "lead",
      entityId: lead.id,
      metadata: { provider: payload.provider, error: message },
    });

    throw error;
  }
}
