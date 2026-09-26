import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import {
  CrmPartialPushError,
  getCrmPushAdapter,
  isCrmProvider,
} from "@/lib/integrations/providers/crm-registry";
import { latestLeadOpportunity } from "@/lib/opportunities/service";

export const crmPushPayload = z.object({
  leadId: z.uuid(),
  provider: z.enum(["hubspot", "zoho_crm", "salesforce"]),
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
        "id, business_id, first_name, last_name, phone, email, postcode, company_name, status, qualification_state, created_at, services(name, average_value)",
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

  // Source guard: a lead pulled *from* this CRM goes back into the record it
  // came from. Without this a CRM-imported lead with no push record yet was
  // created again in the CRM on its first push -- a duplicate of the very
  // record it was imported from.
  const { data: link, error: linkError } = await admin
    .from("external_entity_links")
    .select("external_id")
    .eq("business_id", businessId)
    .eq("connection_id", integration.id)
    .eq("local_type", "LEAD")
    .eq("local_id", lead.id)
    .limit(1)
    .maybeSingle();
  // Unknown is not "not linked": retrying beats risking a duplicate record.
  if (linkError) throw new Error(`crm.push link lookup failed: ${linkError.message}`);

  // Re-read at push time, like the lead: the opportunity's current stage and
  // outcome are what the CRM should show, not whatever triggered the job.
  const opportunity = await latestLeadOpportunity(businessId, lead.id);

  try {
    const result = await adapter.push({
      integrationId: integration.id,
      linkedExternalId: link?.external_id ?? null,
      lead: {
        ...lead,
        opportunity: opportunity
          ? {
              id: opportunity.id,
              name: opportunity.name,
              stage: opportunity.stage,
              outcome: opportunity.outcome,
              outcomeReason: opportunity.outcome_reason,
              value: opportunity.value,
              currency: opportunity.currency,
              expectedCloseDate: opportunity.expected_close_date,
              closedAt: opportunity.closed_at,
            }
          : null,
      },
    });

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

    // A push is not one call. If the contact was created and the deal was not,
    // that contact exists in the customer's CRM and its id has to be kept --
    // otherwise the retry finds no prior contact and creates a second one, and
    // the attempt after that a third.
    const partial = error instanceof CrmPartialPushError ? error : null;

    await admin.from("crm_push_records").upsert(
      {
        business_id: job.business_id!,
        lead_id: lead.id,
        provider_type: payload.provider,
        // "partial" rather than "failed": something is in the customer's CRM,
        // and an operator reading this row needs to know that before deciding
        // whether to intervene by hand.
        status: partial ? "partial" : "failed",
        ...(partial
          ? {
              external_contact_id: partial.externalContactId,
              external_deal_id: partial.externalDealId,
            }
          : {}),
        last_error: message,
      },
      { onConflict: "business_id,lead_id,provider_type" },
    );

    await recordAudit({
      businessId: job.business_id,
      action: "crm.push_failed",
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        provider: payload.provider,
        error: message,
        // Named in the audit too, because "the contact is already there" is the
        // single fact somebody cleaning up by hand needs first.
        partial_contact_id: partial?.externalContactId ?? null,
      },
    });

    throw error;
  }
}
