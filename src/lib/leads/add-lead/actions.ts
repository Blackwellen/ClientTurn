"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { recordPermission } from "@/lib/policy/service";
import { companyDedupeKey } from "@/lib/prospects/dedupe";
import { assessContactability } from "./contactability";
import { findDuplicates } from "./duplicate-check";
import { channelCapabilities } from "./queries";
import {
  blockingDuplicates,
  classifyRelationship,
  companyKey,
  contactabilityCheckSchema,
  createManualLeadSchema,
  duplicateCheckSchema,
  followUpEligibility,
  normaliseCompany,
  normaliseEmail,
  normalisePhoneValue,
  normalisePostcode,
  parseEstimatedValue,
  permittedMessagingChannels,
  sourceProviderSlug,
  type ContactabilityAssessment,
  type CreateLeadOutcome,
  type DuplicateMatch,
  type ProspectHandoffOutcome,
} from "./types";

/**
 * Add Lead wizard — server actions.
 *
 * Three rules govern this module:
 *
 *  1. The workspace comes from the session. Never from the payload.
 *  2. Every decision the client made — duplicates, contactability, the
 *     warm/prospect boundary, follow-up eligibility — is made again here. The
 *     client's copy is a preview.
 *  3. A manual lead joins the *same* `lead.process` orchestration an inbound
 *     Meta lead does. There is no parallel path for hand-typed leads.
 */

type Guard =
  | { ok: true; workspace: ActiveWorkspace }
  | { ok: false; error: string };

async function requireLeadWriter(): Promise<Guard> {
  try {
    return { ok: true, workspace: await requireRole("member") };
  } catch {
    return {
      ok: false,
      error: "You do not have permission to add leads in this workspace.",
    };
  }
}

function refresh() {
  revalidatePath("/app");
  revalidatePath("/app/leads");
}

/* ------------------------------------------------------- duplicate check */

export async function checkLeadDuplicates(input: {
  email: string;
  mobile: string;
  telephone: string;
  company: string;
  firstName: string;
  lastName: string;
}): Promise<{ ok: true; matches: DuplicateMatch[] } | { ok: false; error: string }> {
  const parsed = duplicateCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not run the check." };

  const guard = await requireLeadWriter();
  if (!guard.ok) return { ok: false, error: guard.error };

  try {
    const matches = await findDuplicates(guard.workspace.businessId, parsed.data);
    return { ok: true, matches };
  } catch {
    return { ok: false, error: "The duplicate check could not be completed." };
  }
}

/* ---------------------------------------------------- contactability check */

export async function checkContactability(input: {
  email: string;
  mobile: string;
  telephone: string;
  postcode: string;
  relationship: string;
  evidence: string;
}): Promise<
  { ok: true; assessment: ContactabilityAssessment } | { ok: false; error: string }
> {
  const parsed = contactabilityCheckSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose how you know this person first." };
  }

  const guard = await requireLeadWriter();
  if (!guard.ok) return { ok: false, error: guard.error };

  try {
    const capabilities = await channelCapabilities(guard.workspace.businessId);
    const assessment = await assessContactability({
      businessId: guard.workspace.businessId,
      capabilities,
      ...parsed.data,
    });
    return { ok: true, assessment };
  } catch {
    // A failed policy lookup is never read as permission.
    return {
      ok: false,
      error: "Contactability could not be assessed. Try again in a moment.",
    };
  }
}

/* --------------------------------------------------- add allowed service */

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  averageValue: z.string().trim().max(12),
});

export async function addAllowedService(input: {
  name: string;
  averageValue: string;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a service name." };

  let workspace: ActiveWorkspace;
  try {
    // Creating a service changes what the whole workspace can sell, so it is
    // an admin action even though it is reachable from a member's wizard.
    workspace = await requireRole("admin");
  } catch {
    return {
      ok: false,
      error: "Only an owner or admin can add a service.",
    };
  }

  const value = parsed.data.averageValue
    ? Number(parsed.data.averageValue.replace(/[,\s£]/g, ""))
    : null;
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) {
    return { ok: false, error: "Enter an average value between 0 and 1,000,000." };
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId);

  const { data, error } = await admin
    .from("services")
    .insert({
      business_id: workspace.businessId,
      name: parsed.data.name,
      average_value: value,
      active: true,
      position: count ?? 0,
    })
    .select("id, name")
    .single();

  if (error || !data) return { ok: false, error: "Could not create that service." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "service.created",
    entityType: "service",
    entityId: data.id,
    metadata: { name: data.name, via: "add_lead_wizard" },
  });

  refresh();
  return { ok: true, id: data.id, name: data.name };
}

/* ------------------------------------------------------------ provenance */

/**
 * One `lead_sources` row per manual provider per workspace, so a hand-typed
 * lead's origin sits in the same table an inbound lead's does and the existing
 * source filters and badges work on it unchanged.
 */
async function resolveManualSource(
  businessId: string,
  provider: string,
  label: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("lead_sources")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider", provider)
    .is("form_id", null)
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created } = await admin
    .from("lead_sources")
    .insert({ business_id: businessId, provider, source_name: label })
    .select("id")
    .single();

  return created?.id ?? null;
}

/* -------------------------------------------------------- create the lead */

export async function createManualLead(
  input: unknown,
): Promise<CreateLeadOutcome> {
  const parsed = createManualLeadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "ERROR",
      error: parsed.error.issues[0]?.message ?? "Check the details you entered.",
    };
  }

  const guard = await requireLeadWriter();
  if (!guard.ok) return { status: "ERROR", error: guard.error };
  const { workspace } = guard;

  const { contact, enquiry, permission, routing, acknowledgedDuplicates } =
    parsed.data;

  /* 1 — normalise ------------------------------------------------------- */

  const email = normaliseEmail(contact.email);
  const mobile = normalisePhoneValue(contact.mobile);
  const telephone = normalisePhoneValue(contact.telephone);
  const company = normaliseCompany(contact.company);
  const postcode = normalisePostcode(contact.postcode);

  if (!email && !mobile && !telephone) {
    return { status: "ERROR", error: "Add at least one way to contact them." };
  }

  /* 2 — the warm-lead boundary, decided from the relationship ------------ */

  const classification = classifyRelationship(
    permission.relationship,
    permission.evidence,
  );
  if (classification === "PROSPECT") {
    return {
      status: "PROSPECT_REQUIRED",
      message:
        "People you found yourself are Prospects, not warm leads. Add them to Find Leads instead.",
    };
  }

  /* 3 — duplicates, re-run server-side ----------------------------------- */

  let matches: DuplicateMatch[];
  try {
    matches = await findDuplicates(workspace.businessId, {
      email: contact.email,
      mobile: contact.mobile,
      telephone: contact.telephone,
      company: contact.company,
      firstName: contact.firstName,
      lastName: contact.lastName,
    });
  } catch {
    return {
      status: "ERROR",
      error: "The duplicate check could not be completed, so nothing was created.",
    };
  }

  const blocking = blockingDuplicates(matches);
  if (blocking.length > 0) {
    // An exact email or phone match is the same person. The operator is shown
    // the record rather than being allowed to create a second one.
    return { status: "DUPLICATE", matches: blocking };
  }
  if (matches.length > 0 && !acknowledgedDuplicates) {
    return { status: "DUPLICATE", matches };
  }

  /* 4 — the service must still exist and still be sellable --------------- */

  const admin = createAdminClient();
  const { data: service } = await admin
    .from("services")
    .select("id, name, active")
    .eq("id", enquiry.serviceId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!service || !service.active) {
    return {
      status: "ERROR",
      error: "That service is no longer available. Choose another one.",
    };
  }

  /* 5 — the assignee must still be a member ------------------------------ */

  let assigneeId: string | null = null;
  if (routing.assigneeId) {
    const { data: member } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", workspace.businessId)
      .eq("user_id", routing.assigneeId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) {
      return {
        status: "ERROR",
        error: "That person is no longer a member of this workspace.",
      };
    }
    assigneeId = routing.assigneeId;
  }

  /* 6 — contactability, re-evaluated server-side ------------------------- */

  let assessment: ContactabilityAssessment;
  let capabilities: Awaited<ReturnType<typeof channelCapabilities>>;
  try {
    capabilities = await channelCapabilities(workspace.businessId);
    assessment = await assessContactability({
      businessId: workspace.businessId,
      email: contact.email,
      mobile: contact.mobile,
      telephone: contact.telephone,
      postcode: contact.postcode,
      relationship: permission.relationship,
      evidence: permission.evidence,
      capabilities,
    });
  } catch {
    return {
      status: "ERROR",
      error: "Contactability could not be confirmed, so nothing was created.",
    };
  }

  if (assessment.prospectRedirect) {
    return {
      status: "PROSPECT_REQUIRED",
      message: "This record must be added as a Prospect, not a warm lead.",
    };
  }
  if (assessment.suppression.some((issue) => issue.tone === "danger")) {
    return {
      status: "ERROR",
      error:
        "This contact is suppressed or has an invalid address. Resolve that before adding them.",
    };
  }

  /* 7 — follow-up eligibility, decided here not in the UI ---------------- */

  const { data: definition } = await admin
    .from("automation_definitions")
    .select("id, enabled")
    .eq("business_id", workspace.businessId)
    .eq("type", "new_lead")
    .maybeSingle();

  let automationReady = false;
  if (definition?.enabled) {
    const { data: version } = await admin
      .from("automation_versions")
      .select("id")
      .eq("business_id", workspace.businessId)
      .eq("automation_id", definition.id)
      .eq("status", "PUBLISHED")
      .maybeSingle();
    automationReady = Boolean(version);
  }

  const eligibility = followUpEligibility(assessment, {
    automationReady,
    reason: null,
  });
  const startFollowUp = routing.startFollowUp && eligibility.eligible;
  const followUpWarning =
    routing.startFollowUp && !eligibility.eligible ? eligibility.reason : null;

  /* 8 — conversion goal --------------------------------------------------- */

  const { data: goal } = await admin
    .from("conversion_goals")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("type", enquiry.conversionGoal)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  /* 9 — write ------------------------------------------------------------ */

  const sourceId = await resolveManualSource(
    workspace.businessId,
    sourceProviderSlug(enquiry.source),
    enquiry.sourceDetail || `Added manually (${enquiry.source})`,
  );

  const notes = [
    enquiry.enquiryText,
    enquiry.notes ? `\n\nInternal notes: ${enquiry.notes}` : "",
    contact.address ? `\n\nAddress: ${contact.address}` : "",
  ]
    .join("")
    .slice(0, 4000);

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      business_id: workspace.businessId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      company_name: company,
      email,
      // `phone` is the messaging destination; a landline is never one.
      phone: mobile ?? null,
      phone_normalized: mobile ?? null,
      telephone: telephone ?? null,
      postcode,
      service_id: service.id,
      source_id: sourceId,
      status: routing.initialStatus,
      assigned_user_id: assigneeId,
      needs_attention: routing.needsAttention,
      attention_reason: routing.needsAttention
        ? routing.attentionReason || "manual_flag"
        : null,
      // A lead with no follow-up must not have an automation quietly waiting.
      automation_active: startFollowUp,
      human_takeover: !startFollowUp,
      notes,
      estimated_value: parseEstimatedValue(enquiry.estimatedValue),
      conversion_goal_id: goal?.id ?? null,
      conversion_goal_type: enquiry.conversionGoal,
      intake_method: enquiry.source,
      intake_detail: enquiry.sourceDetail || null,
      created_via: "MANUAL_WIZARD",
      created_by_user_id: workspace.userId,
      relationship_type: permission.relationship,
      subscriber_type: company ? "CORPORATE" : "INDIVIDUAL",
    })
    .select("id")
    .single();

  if (error || !lead) {
    return { status: "ERROR", error: "The lead could not be created." };
  }

  /* 10 — permission evidence, assignment and the audit trail -------------- */
  //
  // Past this point the lead exists. A failure in any of the steps below is
  // logged and surfaced as a warning: deleting a real lead because a
  // bookkeeping write failed would be the worse outcome.

  const warnings: string[] = [];

  try {
    await recordPermission({
      businessId: workspace.businessId,
      subject: { type: "LEAD", id: lead.id },
      relationshipType: permission.relationship,
      relationshipDetail: enquiry.sourceDetail || null,
      consentStatus:
        permission.relationship === "EXPLICIT_MARKETING_CONSENT" &&
        permission.evidence.trim()
          ? "GRANTED"
          : "UNKNOWN",
      consentEvidence: permission.evidence || null,
      consentSource: `add_lead_wizard:${enquiry.source}`,
      subscriberType: company ? "CORPORATE" : "INDIVIDUAL",
      country: "GB",
      email,
      phone: mobile ?? telephone,
      recordedBy: workspace.userId,
    });
  } catch {
    warnings.push("The permission record could not be saved.");
  }

  if (assigneeId) {
    await admin.from("lead_assignments").insert({
      business_id: workspace.businessId,
      lead_id: lead.id,
      user_id: assigneeId,
      assigned_by: workspace.userId,
    });
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "lead.assigned",
      entityType: "lead",
      entityId: lead.id,
      metadata: { assigned_user_id: assigneeId, via: "add_lead_wizard" },
    });
  }

  if (routing.needsAttention) {
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "lead.attention_changed",
      entityType: "lead",
      entityId: lead.id,
      metadata: { needs_attention: true, reason: routing.attentionReason },
    });
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.created_manually",
    entityType: "lead",
    entityId: lead.id,
    metadata: {
      source: enquiry.source,
      source_detail: enquiry.sourceDetail || null,
      relationship_type: permission.relationship,
      classification: assessment.classification,
      channels: Object.fromEntries(
        Object.entries(assessment.channels).map(([key, value]) => [
          key,
          value.permission,
        ]),
      ),
      suppression: assessment.suppression.map((issue) => issue.code),
      service_id: service.id,
      conversion_goal: enquiry.conversionGoal,
      qualification_flow: routing.qualificationFlow,
      initial_status: routing.initialStatus,
      start_follow_up: startFollowUp,
      follow_up_declined_reason: followUpWarning,
      company_key: companyKey(company),
    },
  });

  /* 11 — the same orchestration inbound leads use ------------------------ */

  try {
    await enqueue(
      "lead.process",
      {
        leadId: lead.id,
        serviceName: service.name,
        source: {
          provider: "manual" as const,
          sourceName: enquiry.sourceDetail || `Manual (${enquiry.source})`,
        },
      },
      {
        businessId: workspace.businessId,
        priority: 10,
        idempotencyKey: `lead.process:${lead.id}`,
      },
    );
    if (startFollowUp) {
      await recordAudit({
        businessId: workspace.businessId,
        actorUserId: workspace.userId,
        action: "lead.follow_up_started",
        entityType: "lead",
        entityId: lead.id,
        metadata: {
          channels: permittedMessagingChannels(assessment),
          via: "add_lead_wizard",
        },
      });
    }
  } catch {
    // The lead is real and correct; only its routing did not start.
    warnings.push(
      "The lead was created but follow-up could not be queued. Open the lead to retry.",
    );
  }

  refresh();

  const warning = [followUpWarning, ...warnings].filter(Boolean).join(" ");
  return {
    status: "CREATED",
    leadId: lead.id,
    followUpStarted: startFollowUp,
    warning: warning || undefined,
  };
}

/* ------------------------------------------------------- prospect handoff */

const prospectHandoffSchema = z.object({
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
  company: z.string().trim().max(160),
  email: z.string().trim().max(200),
  mobile: z.string().trim().max(40),
  telephone: z.string().trim().max(40),
  enquirySummary: z.string().trim().max(1000),
  sourceDetail: z.string().trim().max(300),
});

/**
 * "Add to Find Leads instead". Creates a Prospect — never a Lead — from what
 * the operator already typed. Identity and enquiry transfer; the relationship
 * and any permission claim deliberately do not, because a record that reached
 * this path has no permission behind it.
 */
export async function createProspectFromWizard(input: {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  mobile: string;
  telephone: string;
  enquirySummary: string;
  sourceDetail: string;
}): Promise<ProspectHandoffOutcome> {
  const parsed = prospectHandoffSchema.safeParse(input);
  if (!parsed.success) return { status: "ERROR", error: "Check the details." };

  const guard = await requireLeadWriter();
  if (!guard.ok) return { status: "ERROR", error: guard.error };
  const { workspace } = guard;

  const admin = createAdminClient();
  const company = normaliseCompany(parsed.data.company);
  // The same key sourcing writes, so a hand-added company and a discovered one
  // collapse onto one `prospect_companies` row rather than duplicating.
  const key = company
    ? companyDedupeKey({
        name: company,
        domain: normaliseEmail(parsed.data.email)?.split("@")[1] ?? null,
      })
    : null;

  let companyId: string | null = null;
  if (company && key) {
    const { data: existing } = await admin
      .from("prospect_companies")
      .select("id")
      .eq("business_id", workspace.businessId)
      .eq("dedupe_key", key)
      .maybeSingle();

    if (existing?.id) {
      companyId = existing.id;
    } else {
      const { data: created } = await admin
        .from("prospect_companies")
        .insert({
          business_id: workspace.businessId,
          name: company,
          dedupe_key: key,
        })
        .select("id")
        .single();
      companyId = created?.id ?? null;
    }
  }

  const { data: prospect, error } = await admin
    .from("prospects")
    .insert({
      business_id: workspace.businessId,
      company_id: companyId,
      first_name: parsed.data.firstName || null,
      last_name: parsed.data.lastName || null,
      email: normaliseEmail(parsed.data.email),
      phone_e164:
        normalisePhoneValue(parsed.data.mobile) ??
        normalisePhoneValue(parsed.data.telephone),
      status: "DISCOVERED",
      // Nothing about being typed by hand makes a found contact contactable.
      outreach_eligibility: "REVIEW",
      eligibility_reason:
        "Added by hand as a found contact. Cold-outreach policy applies before any message.",
      source_provider: "manual_prospect",
      subscriber_type: company ? "CORPORATE" : "UNKNOWN",
    })
    .select("id")
    .single();

  if (error || !prospect?.id) {
    return { status: "ERROR", error: "Could not add this person to Find Leads." };
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.prospect_redirect",
    entityType: "prospect",
    entityId: prospect.id,
    metadata: {
      via: "add_lead_wizard",
      source_detail: parsed.data.sourceDetail || null,
      enquiry_summary: parsed.data.enquirySummary || null,
    },
  });

  refresh();
  return { status: "CREATED", prospectId: prospect.id };
}
