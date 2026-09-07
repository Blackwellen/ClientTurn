import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import {
  assertLeadCapacity,
  EntitlementError,
} from "@/lib/billing/entitlements";
import { normalisePhone } from "@/lib/messaging/types";
import { recordPermission } from "@/lib/policy/service";
import type { RelationshipType } from "@/lib/policy/types";
import {
  conversationFor,
  flagForAttention,
  isSuppressed,
  leadContact,
  loadBusinessContext,
  loadLead,
  queueNotification,
  type BusinessContext,
  type LeadRecord,
} from "./shared";
import { applyQualification } from "./qualify";
import { parsePayload } from "./parse";
import { leadProcessPayload } from "./payloads";

type SourceInput = NonNullable<
  ReturnType<typeof leadProcessPayload.parse>["source"]
>;

async function resolveSource(
  businessId: string,
  source: SourceInput,
): Promise<string | null> {
  const admin = createAdminClient();

  let lookup = admin
    .from("lead_sources")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider", source.provider);

  lookup = source.formId
    ? lookup.eq("form_id", source.formId)
    : lookup.is("form_id", null);

  const { data: existing } = await lookup.limit(1).maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await admin
    .from("lead_sources")
    .insert({
      business_id: businessId,
      provider: source.provider,
      page_id: source.pageId ?? null,
      page_name: source.pageName ?? null,
      form_id: source.formId ?? null,
      form_name: source.formName ?? null,
      campaign_id: source.campaignId ?? null,
      campaign_name: source.campaignName ?? null,
      adset_id: source.adsetId ?? null,
      adset_name: source.adsetName ?? null,
      ad_id: source.adId ?? null,
      ad_name: source.adName ?? null,
      source_name: source.sourceName ?? null,
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

async function resolveService(
  businessId: string,
  serviceName: string | undefined,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: services } = await admin
    .from("services")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("position", { ascending: true });

  const rows = services ?? [];
  if (rows.length === 0) return null;

  if (serviceName) {
    const wanted = serviceName.trim().toLowerCase();
    const exact = rows.find((row) => row.name.trim().toLowerCase() === wanted);
    if (exact) return exact.id;
    const partial = rows.find(
      (row) =>
        row.name.toLowerCase().includes(wanted) ||
        wanted.includes(row.name.toLowerCase()),
    );
    if (partial) return partial.id;
    return null;
  }

  // A single-service workspace has no ambiguity to resolve.
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * The relationship each inbound source actually establishes.
 *
 * Someone who completed a Meta lead form or a form on the website *did* contact
 * the business — that is what the form is — so recording it is a statement of
 * fact, not a convenience. `csv` and `manual` are absent deliberately: the
 * import flow and the Add Lead wizard ask a person to classify the relationship
 * and record their answer, and guessing here would overwrite a considered
 * answer with an assumed one.
 */
const SOURCE_RELATIONSHIP: Record<string, RelationshipType> = {
  meta: "THEY_CONTACTED_US",
  webform: "THEY_CONTACTED_US",
  // A test lead has to travel the same road as a real one, or the test proves
  // nothing about what happens in production.
  test: "THEY_CONTACTED_US",
};

/**
 * Records how this lead came to the business, once, if nothing has recorded it
 * already.
 *
 * This is what lets the contactability engine permit follow-up at all: the warm
 * rule set in every seeded pack requires a relationship, and a lead with none
 * is refused at send time and handed to a human. It never overwrites an
 * existing record — a permission captured by a person, with evidence, outranks
 * anything inferred from a form submission.
 */
async function providerForSource(sourceId: string | null): Promise<string | null> {
  if (!sourceId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_sources")
    .select("provider")
    .eq("id", sourceId)
    .maybeSingle();
  return data?.provider ?? null;
}

async function recordArrivalPermission(
  businessId: string,
  lead: LeadRecord,
  provider: string | null,
): Promise<void> {
  const relationship = provider ? SOURCE_RELATIONSHIP[provider] : undefined;
  if (!relationship) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("contact_permissions")
    .select("id")
    .eq("business_id", businessId)
    .eq("subject_type", "LEAD")
    .eq("subject_id", lead.id)
    .maybeSingle();

  if (existing) return;

  await recordPermission({
    businessId,
    subject: { type: "LEAD", id: lead.id },
    relationshipType: relationship,
    relationshipDetail: `Submitted an enquiry via ${provider}`,
    consentSource: `lead_source:${provider}`,
    email: lead.email,
    phone: lead.phone_normalized ?? lead.phone,
  });
}

async function alreadyMetered(businessId: string, leadId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("usage_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("metric", "lead_processed")
    .eq("source", `lead:${leadId}`)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function startFollowUp(business: BusinessContext, lead: LeadRecord) {
  await conversationFor(business.businessId, lead.id, business.defaultChannel);
  await enqueue(
    "automation.advance",
    { leadId: lead.id, automationType: "new_lead" },
    {
      businessId: business.businessId,
      priority: 20,
      idempotencyKey: `automation.advance:start:${lead.id}`,
    },
  );

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "New lead";
  await enqueue(
    "notification.slack",
    { businessId: business.businessId, leadId: lead.id, text: `New lead: ${name} — follow-up started` },
    { businessId: business.businessId },
  );
}

export async function handleLeadProcess(job: ClaimedJob) {
  const payload = parsePayload(leadProcessPayload, job.payload);

  const initial = await loadLead(payload.leadId);
  if (!initial) {
    throw new PermanentJobError(`Lead ${payload.leadId} no longer exists.`);
  }

  const business = await loadBusinessContext(initial.business_id);
  if (!business) {
    throw new PermanentJobError(
      `Business ${initial.business_id} no longer exists.`,
    );
  }

  const admin = createAdminClient();
  const patch: {
    phone_normalized?: string;
    source_id?: string;
    service_id?: string;
  } = {};

  const normalised = initial.phone ? normalisePhone(initial.phone) : null;
  if (normalised && normalised !== initial.phone_normalized) {
    patch.phone_normalized = normalised;
  }

  if (!initial.source_id && payload.source) {
    const sourceId = await resolveSource(business.businessId, payload.source);
    if (sourceId) patch.source_id = sourceId;
  }

  if (!initial.service_id) {
    const serviceId = await resolveService(
      business.businessId,
      payload.serviceName,
    );
    if (serviceId) patch.service_id = serviceId;
  }

  if (Object.keys(patch).length > 0) {
    await admin
      .from("leads")
      .update(patch)
      .eq("id", initial.id)
      .eq("business_id", business.businessId);
  }

  const lead = (await loadLead(initial.id)) ?? initial;
  const contact = leadContact(lead);

  // How this lead arrived is a compliance fact, and the send-time policy gate
  // needs it recorded before the first follow-up is attempted. Prefer the
  // payload's provider; fall back to the stored source for a lead that was
  // already attributed on a previous pass.
  await recordArrivalPermission(
    business.businessId,
    lead,
    payload.source?.provider ?? (await providerForSource(lead.source_id)),
  );

  if (contact && !lead.opted_out) {
    // A number suppressed before this lead arrived must never be contacted.
    if (await isSuppressed(business.businessId, contact, business.defaultChannel)) {
      await admin
        .from("leads")
        .update({ opted_out: true, automation_active: false })
        .eq("id", lead.id)
        .eq("business_id", business.businessId);
      lead.opted_out = true;
    }
  }

  if (!(await alreadyMetered(business.businessId, lead.id))) {
    try {
      await assertLeadCapacity(business.businessId);
    } catch (error) {
      if (error instanceof EntitlementError) {
        await flagForAttention({
          businessId: business.businessId,
          leadId: lead.id,
          reason:
            error.code === "PLAN_LIMIT" ? "plan_limit" : "subscription_inactive",
          title: "A lead arrived but could not be followed up",
          body: error.message,
        });
        await queueNotification({
          businessId: business.businessId,
          type: error.code === "PLAN_LIMIT" ? "usage_limit" : "billing",
          severity: "error",
          title:
            error.code === "PLAN_LIMIT"
              ? "Lead limit reached"
              : "Subscription inactive",
          body: `${error.message} New leads are being kept but not contacted.`,
          linkUrl: "/app/settings?section=billing",
          dedupeKey: `${error.code}:${business.businessId}:${new Date().toISOString().slice(0, 10)}`,
        });
        return;
      }
      throw error;
    }

    await recordUsage({
      businessId: business.businessId,
      metric: "lead_processed",
      source: `lead:${lead.id}`,
      metadata: { is_test: lead.is_test },
    });
  }

  const { output } = await applyQualification(business, lead);

  const blocked = output.reasons.some(
    (reason) =>
      reason.code === "postcode_blocked" ||
      reason.code === "postcode_outside_area" ||
      reason.code === "service_inactive",
  );

  if (blocked) {
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: output.reasons[0]?.code ?? "not_qualified",
      title: "A lead is outside your service rules",
      body: output.reasons.map((reason) => reason.detail).join(" "),
      takeover: true,
    });
    return;
  }

  if (!contact) {
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: "no_phone",
      title: "A lead arrived without a usable mobile number",
      body: "Follow-up cannot start until a mobile number is added.",
      takeover: true,
    });
    return;
  }

  if (lead.opted_out) {
    await flagForAttention({
      businessId: business.businessId,
      leadId: lead.id,
      reason: "opted_out",
      title: "A lead arrived on your opt-out list",
      body: "This number previously opted out, so no message was sent.",
      takeover: true,
    });
    return;
  }

  await startFollowUp(business, lead);
}
