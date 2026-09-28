"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { ingestLead } from "@/lib/ingest/service";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { nextPermittedSendTime } from "@/lib/automation/scheduler";
import {
  createUploadUrl,
  assertUploadAllowed,
  objectKey,
} from "@/lib/storage/r2";
import { loadReactivationAllowance, resolveAudience } from "./queries";
import { reactivationLimitProblem } from "./reactivation-limit";
import { loadTemplate, whatsAppTransportFor } from "@/lib/messaging/template-registry";
import { checkCampaignTemplate } from "./reactivation-channels";
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
  IMPORT_CONTACT_REQUIRED_MESSAGE,
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

/**
 * The plan-limit-reached message for adding `adding` contacts, or null when
 * they fit. A failed allowance read refuses: it must not lift the limit.
 */
async function reactivationLimitFor(businessId: string, adding: number): Promise<string | null> {
  try {
    return reactivationLimitProblem(await loadReactivationAllowance(businessId), adding);
  } catch {
    return "Could not check your reactivation allowance. Try again.";
  }
}

/* --------------------------------------------------------- audience --- */

const channelSchema = z.enum(["sms", "whatsapp", "email"]).default("sms");

/**
 * The estimate is resolved for the channel the campaign will use: an email
 * campaign counts the leads with an email address and the email suppression
 * list, not the ones with a mobile number.
 */
const AUDIENCE_UNAVAILABLE =
  "The audience could not be worked out right now. Nothing was sent. Try again shortly.";

export async function previewAudience(
  input: unknown,
  channel?: unknown,
): Promise<ActionResult<AudiencePreview>> {
  const parsed = audienceFilterSchema.safeParse(input);
  if (!parsed.success) return fail("Those audience filters are not valid.");
  const parsedChannel = channelSchema.safeParse(channel ?? undefined);
  if (!parsedChannel.success) return fail("That channel is not valid.");

  const access = await requireCampaignAccess();
  if (!access.ok) return fail(access.error);

  try {
    const [{ preview }, allowance] = await Promise.all([
      resolveAudience(access.workspace.businessId, parsed.data, parsedChannel.data),
      // Shown beside the estimate; a failed read shows nothing rather than a
      // made-up allowance. Launch re-checks it either way.
      loadReactivationAllowance(access.workspace.businessId).catch(() => null),
    ]);
    return ok({ ...preview, allowance });
  } catch {
    return fail(AUDIENCE_UNAVAILABLE);
  }
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

  // Personalisation rewrites plain text; an email body is formatted markup and
  // is never rewritten, so the flag is not stored on an email campaign.
  const aiPersonalize = draft.aiPersonalize && draft.channel !== "email";

  if (aiPersonalize) {
    try {
      await assertEntitlement(workspace.businessId, "ai_assist");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("AI personalization is unavailable right now.");
    }
  }

  // WhatsApp outside the 24-hour window takes only an approved template, so
  // the campaign's template is checked now against the registry, and again by
  // the send path at send time.
  let whatsappTemplate: { id: string; variables: Record<string, string> } | null = null;
  if (draft.channel === "whatsapp") {
    if (!draft.whatsappTemplateId) {
      return fail("A WhatsApp campaign needs an approved WhatsApp template.");
    }
    try {
      const [template, transport] = await Promise.all([
        loadTemplate(draft.whatsappTemplateId),
        whatsAppTransportFor(workspace.businessId),
      ]);
      const check = checkCampaignTemplate({
        template,
        businessId: workspace.businessId,
        transport,
        variableMap: draft.whatsappTemplateVariables,
      });
      if (!check.ok) return fail(check.message);
      whatsappTemplate = {
        id: draft.whatsappTemplateId,
        variables: draft.whatsappTemplateVariables ?? {},
      };
    } catch {
      return fail("WhatsApp templates could not be checked right now. Try again shortly.");
    }
  }

  let audience: Awaited<ReturnType<typeof resolveAudience>>;
  try {
    audience = await resolveAudience(workspace.businessId, draft.audience, draft.channel);
  } catch {
    return fail(AUDIENCE_UNAVAILABLE);
  }
  const { preview, eligibleLeadIds } = audience;

  if (launch && eligibleLeadIds.length === 0) {
    return fail("No contactable leads match this audience.");
  }
  if (eligibleLeadIds.length > MAX_CAMPAIGN_AUDIENCE) {
    return fail(
      `A single campaign is capped at ${MAX_CAMPAIGN_AUDIENCE.toLocaleString("en-GB")} contacts.`,
    );
  }
  // Plan limit reached: refused before a draft is saved, so nothing is left
  // behind that launch would refuse again.
  if (launch) {
    const limit = await reactivationLimitFor(workspace.businessId, eligibleLeadIds.length);
    if (limit) return fail(limit);
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
      ai_personalize: aiPersonalize,
      estimated_audience_size: eligibleLeadIds.length,
      // 0132 columns, not yet in the generated types.
      ...((whatsappTemplate
        ? {
            whatsapp_template_id: whatsappTemplate.id,
            whatsapp_template_variables: whatsappTemplate.variables,
          }
        : {}) as Record<string, never>),
      timezone: workspace.timezone,
      created_by: workspace.userId,
      updated_by: workspace.userId,
    })
    .select("id")
    .single();

  if (error || !campaign) return fail("Could not save the campaign.");

  // 0146 columns, written separately so a database without them still saves
  // the campaign (and keeps the old behaviour: SMS to all, sent at once).
  {
    const { error: modeError } = await (admin as unknown as SupabaseClient)
      .from("campaigns")
      .update({
        channel_mode: draft.channel === "sms" ? draft.channelMode : "sms",
        send_timing: draft.sendTiming,
      })
      .eq("id", campaign.id)
      .eq("business_id", workspace.businessId);
    if (modeError && !isSchemaLag(modeError)) {
      console.error("[campaign] channel mode not saved", { campaignId: campaign.id, message: modeError.message });
    }
  }

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
    .select("id, status, scheduled_at, estimated_audience_size")
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!campaign) return fail("Campaign not found.");
  if (campaign.status !== "DRAFT" && campaign.status !== "PAUSED") {
    return fail("This campaign has already been launched.");
  }

  // Contacts already in this campaign were counted when they were added; only
  // the rest of the estimated audience is new against the allowance. The
  // expand job re-checks against the audience it actually resolves.
  const { count: existing, error: existingError } = await admin
    .from("campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId)
    .eq("campaign_id", campaign.id);
  if (existingError) return fail("Could not check your reactivation allowance. Try again.");
  const limit = await reactivationLimitFor(
    workspace.businessId,
    Math.max(0, (campaign.estimated_audience_size ?? 0) - (existing ?? 0)),
  );
  if (limit) return fail(limit);

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
  const { data: updated, error } = await admin
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
    .eq("status", campaign.status)
    .select("id");

  if (error) return fail("Could not update the campaign.");
  // No row matched: the campaign moved on between the read and this write.
  if (!updated || updated.length === 0) {
    return fail("This campaign was changed by someone else. Refresh and try again.");
  }

  if (next === "CANCELLED") {
    const { error: stopError } = await admin
      .from("campaign_contacts")
      .update({ state: "stopped", stopped_reason: "campaign_cancelled" })
      .eq("campaign_id", campaign.id)
      .eq("business_id", workspace.businessId)
      .in("state", ["pending", "scheduled"]);
    // The campaign is already CANCELLED, and campaign.send refuses a cancelled
    // campaign, so nothing can go out; the contacts are only left un-stopped
    // in the record. Logged rather than reported as a failed cancel.
    if (stopError) {
      console.error("[campaigns] cancel: contacts not marked stopped", {
        campaignId: campaign.id,
        message: stopError.message,
      });
    }
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
      // An email campaign cannot send without its subject lines.
      subject_template: source.subject_template,
      followup_subject_template: source.followup_subject_template,
      // 0132 columns (absent from the generated types): the WhatsApp template.
      ...(("whatsapp_template_id" in source
        ? {
            whatsapp_template_id: (source as Record<string, unknown>).whatsapp_template_id,
            whatsapp_template_variables: (source as Record<string, unknown>).whatsapp_template_variables,
          }
        : {}) as Record<string, never>),
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
  if (!parsed.success) return fail(IMPORT_CONTACT_REQUIRED_MESSAGE);

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
      console.error("[campaign] csv archive rejected", { status: response.status });
      storageWarning = "The original file could not be archived. The contacts were still imported.";
    }
  } catch (error) {
    console.error("[campaign] csv archive failed", { message: error instanceof Error ? error.message : String(error) });
    storageWarning = "The original file could not be archived. The contacts were still imported.";
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

  // One source row per file. `form_id` carries the import id because 0114
  // made (provider, page, form, campaign, ad set, ad) unique with NULLS NOT
  // DISTINCT: without it every CSV file after the first collided with the
  // first file's row and was imported with no source at all.
  const { data: source } = await admin
    .from("lead_sources")
    .insert({
      business_id: workspace.businessId,
      provider: "csv",
      form_id: importRow?.id ?? null,
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

  // Every row through the one intake path (design 03 §1), so a customer who
  // is already a lead is matched and touched rather than duplicated -- the
  // old batch upsert keyed on (import, phone) created a second lead for them,
  // and a second follow-up history. The touch records this file's source, and
  // the audience filter reads touches as well as leads.source_id
  // (campaigns/queries.ts), so a matched customer still joins the campaign.
  // Rows run a few at a time: sequential would be one round trip per query
  // per row for up to MAX_IMPORT_ROWS rows.
  let imported = 0;
  let failedRows = 0;
  const importKey = importRow?.id ?? "unknown";
  const concurrency = 8;

  for (let index = 0; index < result.rows.length; index += concurrency) {
    const slice = result.rows.slice(index, index + concurrency);
    const outcomes = await Promise.allSettled(
      slice.map((row) =>
        ingestLead(
          {
            businessId: workspace.businessId,
            source: {
              type: "CSV",
              provider: "csv",
              providerRecordId: `${importKey}:${row.phoneNormalized ?? row.email}`,
              caller: { type: "USER", id: workspace.userId },
            },
            person: {
              firstName: row.firstName ?? undefined,
              lastName: row.lastName ?? undefined,
              phone: row.phone ?? undefined,
              email: row.email ?? undefined,
              postcode: row.postcode ?? undefined,
            },
            // A list of past contacts uploaded by the workspace: imported, not
            // "they contacted us". The reactivation policy reads it as such.
            relationship: "IMPORTED",
            serviceId: row.service
              ? (serviceByName.get(row.service.toLowerCase()) ?? undefined)
              : undefined,
          },
          {
            insertExtras: {
              source_id: source?.id ?? null,
              // Imported history must never trigger the new-lead follow-up sequence.
              automation_active: false,
              is_test: false,
            },
            leadSourceId: source?.id ?? null,
            permission: { source: "REACTIVATION_IMPORT", recordedBy: workspace.userId },
            process: { mode: "RECORD_ONLY" },
          },
        ),
      ),
    );

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value.leadId) imported += 1;
      else failedRows += 1;
    }
  }

  if (failedRows > 0) {
    console.error("[reactivation import] rows not imported", {
      businessId: workspace.businessId,
      importId: importRow?.id ?? null,
      failedRows,
    });
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
