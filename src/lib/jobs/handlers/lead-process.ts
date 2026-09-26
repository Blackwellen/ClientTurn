import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { PermanentJobError } from "@/lib/jobs/registry";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
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
import { applyAttributionFilter, attributionTuple } from "./lead-source-key";

type SourceInput = NonNullable<
  ReturnType<typeof leadProcessPayload.parse>["source"]
>;

/**
 * `lead_sources.provider` is a closed list (lead_sources_provider_check, 0038).
 * Three intake providers exist only on the job payload -- MCP creates, Meta
 * DMs and CRM/connector records -- and writing them into the form registry
 * failed the check, killing lead.process for every such lead (no attribution
 * row, no permission record, no first score). They are filed under the
 * nearest permitted provider; the touch itself keeps the precise provider.
 */
const REGISTRY_PROVIDER: Record<string, string> = {
  mcp: "api",
  meta_dm: "meta",
  connector: "other",
};

async function resolveSource(
  businessId: string,
  source: SourceInput,
): Promise<string | null> {
  const admin = createAdminClient();
  // B11: one row per full attribution tuple, not per form. Keying on the form
  // alone gave every later lead the *first* lead's campaign/ad set/ad. Rows
  // written before the fix still carry that first lead's ids; they cannot be
  // corrected retroactively (the per-lead ids were never stored), so this only
  // stops new leads being mis-attributed.
  const tuple = attributionTuple({
    ...source,
    provider: REGISTRY_PROVIDER[source.provider] ?? source.provider,
  });

  const find = async () => {
    const { data, error } = await applyAttributionFilter(
      admin.from("lead_sources").select("id").eq("business_id", businessId),
      tuple,
    )
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`lead_sources lookup failed: ${error.message}`);
    return data?.id ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  // Race-safe: `lead_sources_attribution_key` (0114) is unique over the tuple
  // with NULLS NOT DISTINCT, so two workers resolving the same new ad at once
  // produce one row. DO NOTHING rather than DO UPDATE: an existing row's
  // display names are left as they were.
  const { data: created, error } = await admin
    .from("lead_sources")
    .upsert(
      {
        business_id: businessId,
        ...tuple,
        page_name: source.pageName ?? null,
        form_name: source.formName ?? null,
        campaign_name: source.campaignName ?? null,
        adset_name: source.adsetName ?? null,
        ad_name: source.adName ?? null,
        source_name: source.sourceName ?? null,
      },
      {
        onConflict: "business_id,provider,page_id,form_id,campaign_id,adset_id,ad_id",
        ignoreDuplicates: true,
      },
    )
    .select("id");

  if (error && error.code !== "23505") {
    throw new Error(`lead_sources insert failed: ${error.message}`);
  }
  return created?.[0]?.id ?? (await find());
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

  if (business.slackNotify.newLead) {
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "New lead";
    await enqueue(
      "notification.slack",
      { businessId: business.businessId, leadId: lead.id, text: `New lead: ${name} — follow-up started` },
      { businessId: business.businessId },
    );
  }
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

  // The form registry row for this submission's attribution tuple. Resolved
  // for every touch (not only a lead with no source) so the touch itself is
  // attributed; the lead's own source_id is provenance and set only once.
  const touchSourceId = payload.source
    ? await resolveSource(business.businessId, payload.source)
    : null;
  if (!initial.source_id && touchSourceId) patch.source_id = touchSourceId;

  if (payload.touchId && touchSourceId) {
    // lead_touches is outside the generated types until they are regenerated.
    const touches = createAdminClient() as unknown as SupabaseClient;
    logWriteError(
      await touches
        .from("lead_touches")
        .update({ lead_source_id: touchSourceId })
        .eq("id", payload.touchId)
        .eq("business_id", business.businessId)
        .is("lead_source_id", null),
      "lead.process: attribute touch",
      { businessId: business.businessId, leadId: initial.id },
    );
  }

  if (!initial.service_id) {
    const serviceId = await resolveService(
      business.businessId,
      payload.serviceName,
    );
    if (serviceId) patch.service_id = serviceId;
  }

  if (Object.keys(patch).length > 0) {
    const patched = await admin
      .from("leads")
      .update(patch)
      .eq("id", initial.id)
      .eq("business_id", business.businessId);
    // 23505: the normalised phone already belongs to another live lead
    // (0123 identity index). The lead keeps its raw number and is processed
    // anyway; ingestLead() is where such conflicts go to review.
    if (patched.error?.code === "23505" && patch.phone_normalized) {
      delete patch.phone_normalized;
      if (Object.keys(patch).length > 0) {
        assertWrite(
          await admin.from("leads").update(patch).eq("id", initial.id).eq("business_id", business.businessId),
          "lead.process: lead patch",
          { businessId: business.businessId, leadId: initial.id },
        );
      }
    } else {
      assertWrite(patched, "lead.process: lead patch", {
        businessId: business.businessId,
        leadId: initial.id,
      });
    }
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

  // The lead's own id is the event id, so this handler re-running — which it is
  // built to survive — cannot deliver the same lead to a customer's CRM twice.
  // ingestLead() emits the same event through the outbox under the same id,
  // so whichever runs first delivers it and the other is a no-op. A repeat
  // enquiry from an existing lead is `lead.touched` (outbox), never a second
  // `lead.created`.
  if (payload.newLead) await emitWebhookEvent({
    businessId: business.businessId,
    type: "lead.created",
    eventId: lead.id,
    data: {
      lead_id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      postcode: lead.postcode,
      status: lead.status,
      source: payload.source?.provider ?? null,
    },
  });

  // `opted_out` is derived from the suppression list (0123) and true only for
  // an all-channel opt-out. A destination suppressed on just the channel
  // follow-up would use is still never contacted: it is treated as opted out
  // for this run, and follow-up is switched off rather than the flag written.
  let suppressedOnChannel = lead.opted_out;
  if (contact && !lead.opted_out) {
    if (await isSuppressed(business.businessId, contact, business.defaultChannel)) {
      assertWrite(
        await admin
          .from("leads")
          .update({ automation_active: false })
          .eq("id", lead.id)
          .eq("business_id", business.businessId),
        "lead.process: stop follow-up for a suppressed destination",
        { businessId: business.businessId, leadId: lead.id },
      );
      suppressedOnChannel = true;
    }
  }

  // RECORD_ONLY (ingest/plan.ts processModeFor): attribution, permission and
  // the integration event are done; score it and stop. A merged repeat
  // enquiry must never restart a sequence, and a suppressed, review, DM or
  // unmessaged-import lead is not followed up from here.
  if (payload.mode === "RECORD_ONLY") {
    if (payload.newLead) await queueScore(business.businessId, lead.id);
    return;
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

  // Score after qualification, so the first score sees the qualification
  // result. Queued rather than inline: scoring must never delay first contact,
  // and a scoring failure must not fail lead processing. Every lead is scored,
  // including the blocked ones below — an out-of-area lead is still a lead.
  await queueScore(business.businessId, lead.id);

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

  if (suppressedOnChannel) {
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

  // A lead created with follow-up off (an import, an API or MCP create, a
  // wizard lead the operator chose not to message) is not started here.
  if (!lead.automation_active) return;

  await startFollowUp(business, lead);
}

/**
 * `lead.processed`: the first score of a new lead, keyed as it always has
 * been. A repeat touch is re-scored by the outbox's `lead.touched` instead.
 */
async function queueScore(businessId: string, leadId: string) {
  try {
    await enqueue(
      "lead.score",
      { leadId, triggerEvent: "lead.processed" },
      {
        businessId,
        priority: 60,
        idempotencyKey: `lead.score:${leadId}:lead.processed`,
      },
    );
  } catch (error) {
    console.error("lead.process: could not queue lead.score", { leadId, error });
  }
}
