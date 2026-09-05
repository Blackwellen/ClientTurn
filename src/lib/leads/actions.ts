"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { normalisePhone } from "@/lib/messaging/provider";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { LEAD_STATUSES, QUALIFICATION_RESULTS } from "./filters";

export type ActionResult = { ok: true } | { ok: false; error: string };

const leadIdSchema = z.uuid();

const assignSchema = z.object({
  leadId: leadIdSchema,
  userId: z.union([z.uuid(), z.literal("")]).nullish(),
});

const statusSchema = z.object({
  leadId: leadIdSchema,
  status: z.enum(LEAD_STATUSES),
});

const messageSchema = z.object({
  leadId: leadIdSchema,
  channel: z.enum(["sms", "whatsapp"]),
  body: z.string().trim().min(1).max(1200),
});

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/app");
  revalidatePath("/app/leads");
}

async function loadLead(workspace: ActiveWorkspace, leadId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select(
      "id, business_id, status, phone, phone_normalized, opted_out, automation_active, human_takeover, first_name, last_name",
    )
    .eq("id", leadId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  return data;
}

export async function assignLead(input: {
  leadId: string;
  userId: string | null;
}): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail("That assignment is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to assign leads.");
  }

  const userId = parsed.data.userId ? parsed.data.userId : null;
  const admin = createAdminClient();

  if (userId) {
    const { data: member } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", workspace.businessId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return fail("That person is not a member of this workspace.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  const { error } = await admin
    .from("leads")
    .update({ assigned_user_id: userId })
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update the assignment.");

  await admin
    .from("lead_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("lead_id", lead.id)
    .is("unassigned_at", null);

  if (userId) {
    await admin.from("lead_assignments").insert({
      business_id: workspace.businessId,
      lead_id: lead.id,
      user_id: userId,
      assigned_by: workspace.userId,
    });
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.assigned",
    entityType: "lead",
    entityId: lead.id,
    metadata: { assigned_user_id: userId },
  });

  refresh();
  return { ok: true };
}

const STATUS_TIMESTAMPS: Partial<Record<string, "qualified_at" | "booked_at" | "won_at" | "lost_at">> = {
  QUALIFIED: "qualified_at",
  BOOKED: "booked_at",
  WON: "won_at",
  LOST: "lost_at",
};

export async function updateLeadStatus(input: {
  leadId: string;
  status: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("That status is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change lead status.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["leads"]["Update"] = { status: parsed.data.status };
  const stamp = STATUS_TIMESTAMPS[parsed.data.status];
  if (stamp) patch[stamp] = now;

  if (parsed.data.status === "QUALIFIED") patch.qualification_state = "QUALIFIED";
  if (parsed.data.status === "LOST") {
    patch.automation_active = false;
    patch.needs_attention = false;
  }
  if (parsed.data.status === "WON") patch.automation_active = false;

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update the lead.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.status_changed",
    entityType: "lead",
    entityId: lead.id,
    metadata: { from: lead.status, to: parsed.data.status },
  });

  if (["QUALIFIED", "BOOKED", "WON"].includes(parsed.data.status)) {
    await enqueueCrmPushes(workspace.businessId, lead.id);
  }

  refresh();
  return { ok: true };
}

export async function markWon(leadId: string) {
  return updateLeadStatus({ leadId, status: "WON" });
}

export async function markLost(leadId: string) {
  return updateLeadStatus({ leadId, status: "LOST" });
}

export async function markQualification(input: {
  leadId: string;
  qualified: boolean;
}): Promise<ActionResult> {
  const parsed = z
    .object({ leadId: leadIdSchema, qualified: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return fail("That request is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change qualification.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update(
      parsed.data.qualified
        ? {
            qualification_state: "QUALIFIED",
            qualified_at: new Date().toISOString(),
            status: lead.status === "NEW" || lead.status === "CONTACTED" || lead.status === "RESPONDED"
              ? "QUALIFIED"
              : lead.status,
          }
        : { qualification_state: "NOT_QUALIFIED" },
    )
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update qualification.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.status_changed",
    entityType: "lead",
    entityId: lead.id,
    metadata: {
      qualification_state: parsed.data.qualified ? "QUALIFIED" : "NOT_QUALIFIED",
      manual: true,
    },
  });

  if (parsed.data.qualified) {
    await enqueueCrmPushes(workspace.businessId, lead.id);
  }

  refresh();
  return { ok: true };
}

/** Stops automated follow-up and hands the conversation to a person. */
export async function humanTakeover(leadId: string): Promise<ActionResult> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return fail("Lead not found.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to take over this conversation.");
  }

  const lead = await loadLead(workspace, parsed.data);
  if (!lead) return fail("Lead not found.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update({
      human_takeover: true,
      automation_active: false,
      needs_attention: true,
      attention_reason: "human_requested",
    })
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not take over this conversation.");

  await admin
    .from("automation_runs")
    .update({
      state: "STOPPED",
      stopped_at: new Date().toISOString(),
      stopped_reason: "human_takeover",
    })
    .eq("lead_id", lead.id)
    .eq("business_id", workspace.businessId)
    .eq("state", "ACTIVE");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.human_takeover",
    entityType: "lead",
    entityId: lead.id,
  });

  refresh();
  return { ok: true };
}

export async function resumeAutomation(leadId: string): Promise<ActionResult> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return fail("Lead not found.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to resume automation.");
  }

  const lead = await loadLead(workspace, parsed.data);
  if (!lead) return fail("Lead not found.");
  if (lead.opted_out) {
    return fail("This lead opted out. Automation cannot be resumed.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update({
      human_takeover: false,
      automation_active: true,
      needs_attention: false,
      attention_reason: null,
    })
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not resume automation.");

  await enqueue(
    "automation.advance",
    { leadId: lead.id },
    { businessId: workspace.businessId },
  );

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.automation_resumed",
    entityType: "lead",
    entityId: lead.id,
  });

  refresh();
  return { ok: true };
}

export async function setFollowUpPaused(input: {
  leadId: string;
  paused: boolean;
}): Promise<ActionResult> {
  if (input.paused) return humanTakeover(input.leadId);
  return resumeAutomation(input.leadId);
}

/**
 * Queues an outbound message. Provider dispatch happens in the worker so a
 * browser can never talk to Twilio and every send is metered and auditable.
 */
export async function sendManualMessage(input: {
  leadId: string;
  channel: string;
  body: string;
}): Promise<ActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a message before sending.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to send messages.");
  }

  try {
    await assertEntitlement(
      workspace.businessId,
      parsed.data.channel === "whatsapp" ? "whatsapp" : undefined,
    );
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Messaging is unavailable right now.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");
  if (lead.opted_out) return fail("This lead has opted out and cannot be messaged.");

  const to = lead.phone_normalized ?? normalisePhone(lead.phone ?? "");
  if (!to) return fail("This lead has no usable phone number.");

  const admin = createAdminClient();

  const { data: suppression } = await admin
    .from("contact_suppressions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("normalized_contact", to)
    .in("channel", [parsed.data.channel, "all"])
    .maybeSingle();
  if (suppression) return fail("This number is suppressed and cannot be messaged.");

  let conversationId: string | null = null;
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("lead_id", lead.id)
    .eq("channel", parsed.data.channel)
    .maybeSingle();

  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error: conversationError } = await admin
      .from("conversations")
      .insert({
        business_id: workspace.businessId,
        lead_id: lead.id,
        channel: parsed.data.channel,
      })
      .select("id")
      .single();
    if (conversationError || !created) return fail("Could not open a conversation.");
    conversationId = created.id;
  }

  const sendKey = crypto.randomUUID();
  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      business_id: workspace.businessId,
      conversation_id: conversationId,
      lead_id: lead.id,
      direction: "outbound",
      channel: parsed.data.channel,
      body: parsed.data.body,
      status: "QUEUED",
      origin: "manual",
      send_key: sendKey,
    })
    .select("id")
    .single();

  if (messageError || !message) return fail("Could not queue the message.");

  await enqueue(
    "message.send",
    { messageId: message.id, leadId: lead.id, sendKey },
    { businessId: workspace.businessId, idempotencyKey: `message.send:${sendKey}` },
  );

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.message_queued",
    entityType: "message",
    entityId: message.id,
    metadata: { lead_id: lead.id, channel: parsed.data.channel },
  });

  refresh();
  return { ok: true };
}

const bookingLinkSchema = z.object({ leadId: leadIdSchema });

/** Sends the workspace's booking link on the lead's existing channel. */
export async function sendBookingLink(input: {
  leadId: string;
}): Promise<ActionResult> {
  const parsed = bookingLinkSchema.safeParse(input);
  if (!parsed.success) return fail("Lead not found.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to send a booking link.");
  }

  const admin = createAdminClient();
  const [{ data: settings }, { data: integrations }] = await Promise.all([
    admin
      .from("business_settings")
      .select("booking_mode, booking_url, default_channel")
      .eq("business_id", workspace.businessId)
      .maybeSingle(),
    admin
      .from("integrations")
      .select("provider_type, status, config")
      .eq("business_id", workspace.businessId)
      .in("provider_type", ["calendly", "google_calendar"]),
  ]);

  const provider = (integrations ?? []).find(
    (row) => row.provider_type === settings?.booking_mode,
  );
  const url =
    settings?.booking_url ??
    (provider?.config as { booking_url?: string } | null)?.booking_url;
  if (!url) {
    return fail(
      "No booking link is configured. Connect a calendar in Integrations first.",
    );
  }

  return sendManualMessage({
    leadId: parsed.data.leadId,
    channel: settings?.default_channel ?? "sms",
    body: `You can book a time that suits you here: ${url}`,
  });
}

/* -------------------------------------------------- qualification & attention */

const qualificationSchema = z.object({
  leadId: leadIdSchema,
  result: z.enum(QUALIFICATION_RESULTS),
});

/**
 * Sets the qualification result directly. The deterministic engine remains the
 * system of record for automated decisions; this is the human override, and it
 * is audited as such.
 */
export async function setQualificationResult(input: {
  leadId: string;
  result: string;
}): Promise<ActionResult> {
  const parsed = qualificationSchema.safeParse(input);
  if (!parsed.success) return fail("That qualification result is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change qualification.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["leads"]["Update"] = {
    qualification_state: parsed.data.result,
  };

  if (parsed.data.result === "QUALIFIED") {
    patch.qualified_at = now;
    // Only advance the status from an earlier stage — never walk a booked or
    // closed lead backwards.
    if (["NEW", "CONTACTED", "RESPONDED"].includes(lead.status)) {
      patch.status = "QUALIFIED";
    }
  }

  // A review decision is exactly the case a person must look at, so it raises
  // the attention flag rather than relying on the operator to remember.
  if (parsed.data.result === "REVIEW") {
    patch.needs_attention = true;
    patch.attention_reason = "review_required";
  }

  if (parsed.data.result === "NOT_QUALIFIED") {
    patch.automation_active = false;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update qualification.");

  if (parsed.data.result === "NOT_QUALIFIED") {
    await admin
      .from("automation_runs")
      .update({
        state: "STOPPED",
        stopped_at: now,
        stopped_reason: "not_qualified",
      })
      .eq("lead_id", lead.id)
      .eq("business_id", workspace.businessId)
      .eq("state", "ACTIVE");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.status_changed",
    entityType: "lead",
    entityId: lead.id,
    metadata: { qualification_state: parsed.data.result, manual: true },
  });

  if (parsed.data.result === "QUALIFIED") {
    await enqueueCrmPushes(workspace.businessId, lead.id);
  }

  refresh();
  return { ok: true };
}

const attentionSchema = z.object({
  leadId: leadIdSchema,
  needsAttention: z.boolean(),
});

/**
 * Manual attention override. Clearing it also clears the machine reason, so a
 * stale system warning cannot linger after a person has dealt with it.
 */
export async function setNeedsAttention(input: {
  leadId: string;
  needsAttention: boolean;
}): Promise<ActionResult> {
  const parsed = attentionSchema.safeParse(input);
  if (!parsed.success) return fail("That request is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change this lead.");
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("leads")
    .update(
      parsed.data.needsAttention
        ? { needs_attention: true, attention_reason: "manual" }
        : { needs_attention: false, attention_reason: null },
    )
    .eq("id", lead.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update this lead.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.attention_changed",
    entityType: "lead",
    entityId: lead.id,
    metadata: { needs_attention: parsed.data.needsAttention },
  });

  refresh();
  return { ok: true };
}
