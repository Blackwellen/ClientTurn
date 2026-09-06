"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { nextPermittedSendTime } from "@/lib/automation/scheduler";
import {
  createUploadUrl,
  assertUploadAllowed,
  objectKey,
} from "@/lib/storage/r2";
import { resolveAudience } from "./queries";
import { parseCsv, toPreview, validateImport, MAX_IMPORT_ROWS } from "./csv";
import {
  canPerform,
  isFinal,
  type CampaignAction,
} from "./reactivation-types";
import {
  audienceFilterSchema,
  campaignDraftSchema,
  findUnknownMergeFields,
  importMappingSchema,
  MAX_CAMPAIGN_AUDIENCE,
  type ActionResult,
  type AudiencePreview,
  type CampaignStatus,
  type ImportPreview,
} from "./types";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

// The old standalone `/app/campaigns[/id]` routes are gone — campaign detail
// now renders as a `?campaign={id}` drawer on the same `/app/reactivation`
// path, so a single revalidation covers list and detail alike. Callers still
// pass the campaign id for readability at the call site even though this no
// longer needs it.
function refresh() {
  revalidatePath("/app/reactivation");
}

/** Every campaign path clears the same three gates before doing anything. */
async function requireCampaignAccess(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return {
      ok: false,
      error:
        "Only owners and admins can create or run reactivation campaigns.",
    };
  }

  try {
    await assertEntitlement(workspace.businessId, "campaigns");
  } catch (error) {
    if (error instanceof EntitlementError) return { ok: false, error: error.message };
    return { ok: false, error: "Campaigns are unavailable right now." };
  }

  return { ok: true, workspace };
}

async function quietHoursFor(businessId: string, timezone: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_settings")
    .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
    .eq("business_id", businessId)
    .maybeSingle();

  return {
    enabled: data?.quiet_hours_enabled ?? true,
    start: (data?.quiet_hours_start ?? "20:00").slice(0, 5),
    end: (data?.quiet_hours_end ?? "08:00").slice(0, 5),
    timezone,
  };
}

/* --------------------------------------------------------- audience --- */

export async function previewAudience(
  input: unknown,
): Promise<ActionResult<AudiencePreview>> {
  const parsed = audienceFilterSchema.safeParse(input);
  if (!parsed.success) return fail("Those audience filters are not valid.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);

  const { preview } = await resolveAudience(
    access.workspace.businessId,
    parsed.data,
  );
  return ok(preview);
}

/* --------------------------------------------------------- campaigns --- */

export async function createCampaign(
  input: unknown,
  launch: boolean,
): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignDraftSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "That campaign is not valid.",
    );
  }
  const draft = parsed.data;

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const unknownFields = [
    ...findUnknownMergeFields(draft.message),
    ...(draft.followup ? findUnknownMergeFields(draft.followup) : []),
  ];
  if (unknownFields.length > 0) {
    return fail(
      `These merge fields are not available: ${unknownFields.join(", ")}.`,
    );
  }

  if (draft.channel === "whatsapp") {
    try {
      await assertEntitlement(workspace.businessId, "whatsapp");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("WhatsApp is unavailable right now.");
    }
  }

  if (draft.aiPersonalize) {
    try {
      await assertEntitlement(workspace.businessId, "ai_assist");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("AI personalization is unavailable right now.");
    }
  }

  const { preview, eligibleLeadIds } = await resolveAudience(
    workspace.businessId,
    draft.audience,
    draft.channel,
  );

  if (launch && eligibleLeadIds.length === 0) {
    return fail("No contactable leads match this audience.");
  }
  if (eligibleLeadIds.length > MAX_CAMPAIGN_AUDIENCE) {
    return fail(
      `A single campaign is capped at ${MAX_CAMPAIGN_AUDIENCE.toLocaleString("en-GB")} contacts.`,
    );
  }

  const quiet = await quietHoursFor(workspace.businessId, workspace.timezone);

  let scheduledAt: Date;
  if (draft.sendMode === "schedule") {
    const requested = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    if (!requested || Number.isNaN(requested.getTime())) {
      return fail("Choose a valid date and time to send.");
    }
    if (requested.getTime() < Date.now() - 60_000) {
      return fail("The scheduled time is in the past.");
    }
    scheduledAt = nextPermittedSendTime(requested, quiet);
  } else {
    scheduledAt = nextPermittedSendTime(new Date(), quiet);
  }

  const suppressionSummary = Object.fromEntries(
    preview.suppressed.map((group) => [group.reason, group.count]),
  );

  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from("campaigns")
    .insert({
      business_id: workspace.businessId,
      name: draft.name,
      description: draft.description || null,
      audience_label: draft.audienceLabel || null,
      tags: draft.tags,
      channel: draft.channel,
      status: "DRAFT",
      message_template: draft.message,
      followup_template: draft.followup || null,
      // Null on SMS/WhatsApp; the schema has already guaranteed a subject is
      // present when the channel is email.
      subject_template: draft.channel === "email" ? draft.subject : null,
      followup_subject_template:
        draft.channel === "email" ? (draft.followupSubject ?? null) : null,
      followup_delay_seconds: draft.followup
        ? draft.followupDelayHours * 3600
        : null,
      filter_config: draft.audience as never,
      suppression_summary: suppressionSummary as never,
      send_rate_per_minute: draft.sendRatePerMinute,
      scheduled_at: scheduledAt.toISOString(),
      ai_personalize: draft.aiPersonalize,
      estimated_audience_size: eligibleLeadIds.length,
      timezone: workspace.timezone,
      created_by: workspace.userId,
      updated_by: workspace.userId,
    })
    .select("id")
    .single();

  if (error || !campaign) return fail("Could not save the campaign.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "campaign.created",
    entityType: "campaign",
    entityId: campaign.id,
    metadata: {
      audience: eligibleLeadIds.length,
      channel: draft.channel,
      suppressed: suppressionSummary,
    },
  });

  refresh();

  if (!launch) return ok({ id: campaign.id });

  const launched = await launchCampaign(campaign.id);
  if (!launched.ok) return fail(launched.error);
  return ok({ id: campaign.id });
}

export async function launchCampaign(
  campaignId: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(campaignId);
  if (!parsed.success) return fail("Campaign not found.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, status, scheduled_at")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!campaign) return fail("Campaign not found.");
  if (campaign.status !== "DRAFT" && campaign.status !== "PAUSED") {
    return fail("This campaign has already been launched.");
  }

  const scheduled =
    campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date();

  const { error } = await admin
    .from("campaigns")
    .update({
      status: scheduled ? "SCHEDULED" : "RUNNING",
      launched_at: new Date().toISOString(),
      launched_by: workspace.userId,
      started_at: scheduled ? null : new Date().toISOString(),
      paused_at: null,
      updated_by: workspace.userId,
    })
    .eq("id", campaign.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not launch the campaign.");

  await enqueue(
    "campaign.expand",
    { campaignId: campaign.id },
    {
      businessId: workspace.businessId,
      runAt: campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date(),
      idempotencyKey: `campaign.expand:${campaign.id}`,
    },
  );

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: scheduled ? "campaign.scheduled" : "campaign.launched",
    entityType: "campaign",
    entityId: campaign.id,
    metadata: { scheduled_at: campaign.scheduled_at },
  });

  refresh();
  return ok({ id: campaign.id });
}

/* -------------------------------------------------- status transitions --- */

type StateChange = "PAUSED" | "RUNNING" | "CANCELLED";

const CHANGE_ACTION: Record<StateChange, CampaignAction> = {
  PAUSED: "pause",
  RUNNING: "resume",
  CANCELLED: "cancel",
};

/**
 * All four state changes funnel through here so the transition table in
 * `reactivation-types.ts` is enforced on the server, not merely reflected by
 * a disabled button. A request for a transition the current status does not
 * allow is refused even if the UI offered it.
 */
async function setCampaignState(
  campaignId: string,
  next: StateChange,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(campaignId);
  if (!parsed.success) return fail("Campaign not found.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, status, scheduled_at")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!campaign) return fail("Campaign not found.");

  const status = campaign.status as CampaignStatus;
  if (!canPerform(status, CHANGE_ACTION[next])) {
    return fail(
      isFinal(status)
        ? "This campaign has already finished, so it cannot be changed."
        : "That is not something a " +
            status.toLowerCase() +
            " campaign can do.",
    );
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("campaigns")
    .update({
      status: next,
      updated_by: workspace.userId,
      paused_at: next === "PAUSED" ? now : null,
      started_at: next === "RUNNING" ? now : undefined,
      cancelled_at: next === "CANCELLED" ? now : null,
    })
    .eq("id", campaign.id)
    .eq("business_id", workspace.businessId)
    // Optimistic concurrency: if someone else moved the campaign on between
    // the read above and this write, the update matches nothing and we say so
    // rather than silently overwriting their change.
    .eq("status", campaign.status);

  if (error) return fail("Could not update the campaign.");

  if (next === "CANCELLED") {
    await admin
      .from("campaign_contacts")
      .update({ state: "stopped", stopped_reason: "campaign_cancelled" })
      .eq("campaign_id", campaign.id)
      .eq("business_id", workspace.businessId)
      .in("state", ["pending", "scheduled"]);
  }

  if (next === "RUNNING") {
    await enqueue(
      "campaign.send",
      { campaignId: campaign.id },
      { businessId: workspace.businessId },
    );
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action:
      next === "CANCELLED"
        ? "campaign.cancelled"
        : next === "PAUSED"
          ? "campaign.paused"
          : "campaign.resumed",
    entityType: "campaign",
    entityId: campaign.id,
    metadata: { from: campaign.status, to: next },
  });

  refresh();
  return ok({ id: campaign.id });
}

export async function pauseCampaign(campaignId: string) {
  return setCampaignState(campaignId, "PAUSED");
}

export async function resumeCampaign(campaignId: string) {
  return setCampaignState(campaignId, "RUNNING");
}

export async function cancelCampaign(campaignId: string) {
  return setCampaignState(campaignId, "CANCELLED");
}

/* ------------------------------------------------------- duplicate --- */

/**
 * Copies the settings, message templates and audience definition into a new
 * DRAFT. Contacts, results and history are deliberately not copied — a
 * duplicate has sent nothing — and every schedule/lifecycle timestamp is
 * cleared.
 */
export async function duplicateCampaign(
  campaignId: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const parsed = z.uuid().safeParse(campaignId);
  if (!parsed.success) return fail("Campaign not found.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const admin = createAdminClient();
  const { data: source } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!source) return fail("Campaign not found.");

  const name = (source.name + " copy").slice(0, 80);

  const { data: copy, error } = await admin
    .from("campaigns")
    .insert({
      business_id: workspace.businessId,
      name,
      description: source.description,
      status: "DRAFT",
      channel: source.channel,
      audience_label: source.audience_label,
      tags: source.tags ?? [],
      message_template: source.message_template,
      followup_template: source.followup_template,
      followup_delay_seconds: source.followup_delay_seconds,
      filter_config: source.filter_config,
      send_rate_per_minute: source.send_rate_per_minute,
      send_window_start: source.send_window_start,
      send_window_end: source.send_window_end,
      timezone: source.timezone ?? workspace.timezone,
      ai_personalize: source.ai_personalize,
      // Deliberately not copied: suppression_summary, estimated_audience_size,
      // and every scheduling/lifecycle timestamp.
      created_by: workspace.userId,
      updated_by: workspace.userId,
    })
    .select("id, name")
    .single();

  if (error || !copy) return fail("Could not duplicate the campaign.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "campaign.duplicated",
    entityType: "campaign",
    entityId: copy.id,
    metadata: { source_campaign_id: source.id, source_name: source.name },
  });

  refresh();
  return ok({ id: copy.id, name: copy.name });
}

/* ------------------------------------------------------------- edit --- */

const campaignEditSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional(),
  audienceLabel: z.string().trim().max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});

/**
 * The safe subset of fields a campaign can be edited through after creation.
 * Audience definition, templates and schedule are not editable here: changing
 * them mid-flight would make the results already collected meaningless.
 * Finished campaigns are read-only.
 */
export async function updateCampaignDetails(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignEditSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Those details are not valid.");
  }

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, status, name, description, audience_label, tags")
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!campaign) return fail("Campaign not found.");
  if (!canPerform(campaign.status as CampaignStatus, "edit")) {
    return fail("A finished campaign cannot be edited. Duplicate it instead.");
  }

  const { error } = await admin
    .from("campaigns")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      audience_label: parsed.data.audienceLabel || null,
      tags: parsed.data.tags,
      updated_by: workspace.userId,
    })
    .eq("id", campaign.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not save those changes.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "campaign.updated",
    entityType: "campaign",
    entityId: campaign.id,
    metadata: {
      before: {
        name: campaign.name,
        description: campaign.description,
        audience_label: campaign.audience_label,
        tags: campaign.tags,
      },
      after: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        audience_label: parsed.data.audienceLabel ?? null,
        tags: parsed.data.tags,
      },
    },
  });

  refresh();
  return ok({ id: campaign.id });
}

/* ----------------------------------------------------------- delete --- */

/** Only a draft can be deleted, and only because it has no history to lose. */
export async function deleteDraftCampaign(
  campaignId: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(campaignId);
  if (!parsed.success) return fail("Campaign not found.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, status, name")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!campaign) return fail("Campaign not found.");
  if (!canPerform(campaign.status as CampaignStatus, "delete")) {
    return fail(
      "Only a draft can be deleted. Cancel the campaign instead — its results are kept.",
    );
  }

  const { error } = await admin
    .from("campaigns")
    .delete()
    .eq("id", campaign.id)
    .eq("business_id", workspace.businessId)
    .eq("status", "DRAFT");

  if (error) return fail("Could not delete the draft.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "campaign.deleted",
    entityType: "campaign",
    entityId: campaign.id,
    metadata: { name: campaign.name },
  });

  refresh();
  return ok({ id: campaign.id });
}

/* ------------------------------------------------------------ import --- */

const csvSchema = z.object({
  filename: z.string().trim().min(1).max(160),
  csv: z.string().min(1).max(MAX_CSV_BYTES),
});

const SUGGESTIONS: Record<string, string[]> = {
  first_name: ["first_name", "firstname", "first name", "forename", "name"],
  last_name: ["last_name", "lastname", "last name", "surname"],
  phone: ["phone", "mobile", "telephone", "phone_number", "number", "tel"],
  email: ["email", "email_address", "e-mail"],
  service: ["service", "job", "job_type", "enquiry"],
  postcode: ["postcode", "post_code", "zip", "postal_code"],
};

export async function analyseImportFile(
  input: unknown,
): Promise<
  ActionResult<{
    headers: string[];
    rowCount: number;
    mapping: Record<string, string>;
  }>
> {
  const parsed = csvSchema.safeParse(input);
  if (!parsed.success) {
    return fail("That file is empty or larger than the 2MB limit.");
  }

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);

  const table = parseCsv(parsed.data.csv);
  if (table.length < 2) {
    return fail("The file needs a header row and at least one data row.");
  }

  const headers = table[0].map((cell) => cell.trim()).filter(Boolean);
  if (headers.length === 0) return fail("The header row is empty.");

  const mapping: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(SUGGESTIONS)) {
    const match = headers.find((header) =>
      aliases.includes(header.toLowerCase().trim()),
    );
    if (match) mapping[field] = match;
  }

  return ok({ headers, rowCount: table.length - 1, mapping });
}

const previewSchema = csvSchema.extend({ mapping: importMappingSchema });

export async function previewImportFile(
  input: unknown,
): Promise<ActionResult<ImportPreview>> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return fail("Map the mobile number column to continue.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);

  const table = parseCsv(parsed.data.csv);
  return ok(toPreview(validateImport(table, parsed.data.mapping)));
}

export async function confirmImportFile(
  input: unknown,
): Promise<
  ActionResult<{
    imported: number;
    skipped: number;
    storageWarning: string | null;
    sourceId: string | null;
    sourceLabel: string | null;
  }>
> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return fail("That import is not valid.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  const table = parseCsv(parsed.data.csv);
  const result = validateImport(table, parsed.data.mapping);

  if (result.rows.length === 0) {
    return fail("No valid rows were found in this file.");
  }
  if (result.rows.length > MAX_IMPORT_ROWS) {
    return fail(
      `Imports are capped at ${MAX_IMPORT_ROWS.toLocaleString("en-GB")} rows.`,
    );
  }

  const admin = createAdminClient();
  const key = objectKey(workspace.businessId, "import", parsed.data.filename);
  const bytes = new TextEncoder().encode(parsed.data.csv);

  // The archive copy is best-effort: a storage outage must not lose the
  // import the user has already reviewed.
  let storageWarning: string | null = null;
  try {
    assertUploadAllowed("import", "text/csv", bytes.byteLength);
    const uploadUrl = await createUploadUrl(key, "text/csv", 120);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "text/csv" },
    });
    if (!response.ok) {
      storageWarning = `The original file could not be archived (storage returned ${response.status}). The contacts were still imported.`;
    }
  } catch (error) {
    storageWarning = `The original file could not be archived: ${
      error instanceof Error ? error.message : "storage is unavailable"
    }. The contacts were still imported.`;
  }

  const { data: importRow } = await admin
    .from("imports")
    .insert({
      business_id: workspace.businessId,
      file_key: key,
      original_filename: parsed.data.filename,
      status: "importing",
      row_count: result.rowCount,
      valid_count: result.rows.length,
      invalid_count: Math.max(0, result.rowCount - result.rows.length),
      errors: result.errors.slice(0, 200) as never,
      created_by: workspace.userId,
    })
    .select("id")
    .single();

  const { data: source } = await admin
    .from("lead_sources")
    .insert({
      business_id: workspace.businessId,
      provider: "csv",
      source_name: parsed.data.filename,
      raw_metadata: { import_id: importRow?.id ?? null } as never,
    })
    .select("id")
    .single();

  const { data: services } = await admin
    .from("services")
    .select("id, name")
    .eq("business_id", workspace.businessId);

  const serviceByName = new Map(
    (services ?? []).map((service) => [service.name.toLowerCase(), service.id]),
  );

  let imported = 0;
  const batchSize = 250;

  for (let index = 0; index < result.rows.length; index += batchSize) {
    const batch = result.rows.slice(index, index + batchSize).map((row) => ({
      business_id: workspace.businessId,
      first_name: row.firstName,
      last_name: row.lastName,
      phone: row.phone,
      phone_normalized: row.phoneNormalized,
      email: row.email,
      postcode: row.postcode,
      service_id: row.service
        ? (serviceByName.get(row.service.toLowerCase()) ?? null)
        : null,
      source_id: source?.id ?? null,
      status: "NEW",
      // Imported history must never trigger the new-lead follow-up sequence.
      automation_active: false,
      is_test: false,
      external_id: `import:${importRow?.id ?? "unknown"}:${row.phoneNormalized}`,
    }));

    const { data: inserted } = await admin
      .from("leads")
      .upsert(batch, { onConflict: "business_id,external_id" })
      .select("id");

    imported += inserted?.length ?? 0;
  }

  if (importRow) {
    await admin
      .from("imports")
      .update({
        status: "completed",
        imported_count: imported,
      })
      .eq("id", importRow.id)
      .eq("business_id", workspace.businessId);
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "import.performed",
    entityType: "import",
    entityId: importRow?.id,
    metadata: {
      filename: parsed.data.filename,
      rows: result.rowCount,
      imported,
      archived: storageWarning === null,
    },
  });

  revalidatePath("/app/leads");
  refresh();

  return ok({
    imported,
    skipped: Math.max(0, result.rowCount - imported),
    storageWarning,
    sourceId: source?.id ?? null,
    sourceLabel: parsed.data.filename,
  });
}
