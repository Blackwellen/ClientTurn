"use server";

import { workspaceCan } from "@/lib/auth/permissions";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSuppression } from "@/lib/policy/suppression";
import { replyWindow } from "@/lib/inbox/types";
import type { Database } from "@/lib/supabase/database.types";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { manualSendKeys } from "@/lib/jobs/send-core";
import { normalisePhone } from "@/lib/messaging/provider";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { runOperation, type ServiceResult } from "@/lib/services";
import { LEAD_STATUSES, QUALIFICATION_RESULTS } from "./filters";
import { closeReasonSchema, statusNeedsReason } from "./detail-page";
import { leadStatusTransition } from "./status-transitions";

export type ActionResult = { ok: true } | { ok: false; error: string };

const leadIdSchema = z.uuid();

const assignSchema = z.object({
  leadId: leadIdSchema,
  userId: z.union([z.uuid(), z.literal("")]).nullish(),
});

const statusSchema = z.object({
  leadId: leadIdSchema,
  status: z.enum(LEAD_STATUSES),
  /** Required for WON and LOST (decision Q3); ignored otherwise. */
  reason: z.string().optional(),
  /** An admin's reason for overriding a refused status transition (§51). */
  overrideReason: z.string().trim().max(500).optional(),
});

/** The service context for a person acting in the app. */
function uiContext(workspace: ActiveWorkspace, confirmed = false) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    confirmed,
    correlationId: randomUUID(),
  };
}

function fromService(result: ServiceResult): ActionResult {
  return result.success ? { ok: true } : { ok: false, error: result.message };
}

/**
 * A manually-typed reply.
 *
 * The channel list is every channel `message.send` can actually address. That
 * is not the same as every channel in the product: it is the set for which
 * `send-store.load()` can resolve a destination -- `leadContact` for email and
 * phone, `socialThreadAddress` for the platform-scoped ids that a lead row has
 * nowhere to hold. A channel outside this list would queue a message the worker
 * could not deliver, which fails silently in the background rather than in
 * front of the person who typed it.
 */
const messageSchema = z.object({
  leadId: leadIdSchema,
  channel: z.enum(["sms", "whatsapp", "email", "messenger", "instagram"]),
  body: z.string().trim().min(1).max(1200),
  /**
   * The thread being replied to. Required on the platform channels, where a
   * lead can hold several threads and the destination lives on the
   * conversation rather than on the lead.
   */
  conversationId: z.uuid().optional(),
  subject: z.string().trim().max(200).optional(),
});

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/app");
  // "layout" so the lead detail pages under /app/leads/[id] refresh too.
  revalidatePath("/app/leads", "layout");
}

async function loadLead(workspace: ActiveWorkspace, leadId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select(
      "id, business_id, status, phone, phone_normalized, email, opted_out, automation_active, human_takeover, first_name, last_name",
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
      .select("user_id, role")
      .eq("business_id", workspace.businessId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return fail("That person is not a member of this workspace.");
    // Viewers are read-only, so they can't own a lead.
    if (member.role === "viewer") return fail("Viewers can't be assigned leads. Change their role in Settings, Team first.");
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
  reason?: string;
  overrideReason?: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("That status is not valid.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to change lead status.");
  }

  /*
   * WON and LOST live on the opportunity; the lead's status is its projection
   * (decision Q3). They go through `lead.set_status`, which closes the lead's
   * opportunity -- creating one first if it has none -- in the same
   * transaction as the status, with the reason a person gave. The reason is
   * required here: it feeds every won/lost report and the connected CRM.
   */
  if (statusNeedsReason(parsed.data.status)) {
    const reason = closeReasonSchema.safeParse(parsed.data.reason ?? "");
    if (!reason.success) {
      return fail(
        `Say why this lead was ${parsed.data.status === "WON" ? "won" : "lost"} before closing it.`,
      );
    }
    const result = await runOperation(
      "lead.set_status",
      {
        leadId: parsed.data.leadId,
        status: parsed.data.status,
        reason: reason.data,
        ...(parsed.data.overrideReason ? { overrideReason: parsed.data.overrideReason } : {}),
      },
      uiContext(workspace),
    );
    if (result.success) refresh();
    return fromService(result);
  }

  const lead = await loadLead(workspace, parsed.data.leadId);
  if (!lead) return fail("Lead not found.");

  // The state machine (§51). A refused move either fails with its reason or,
  // with an override reason, goes through `lead.set_status`, which checks the
  // role and writes the override into the audit row.
  const transition = leadStatusTransition(lead.status, parsed.data.status);
  if (!transition.allowed) {
    if (!parsed.data.overrideReason) return fail(transition.reason);
    const result = await runOperation(
      "lead.set_status",
      { leadId: lead.id, status: parsed.data.status, overrideReason: parsed.data.overrideReason },
      uiContext(workspace),
    );
    if (result.success) refresh();
    return fromService(result);
  }

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["leads"]["Update"] = { status: parsed.data.status };
  const stamp = STATUS_TIMESTAMPS[parsed.data.status];
  if (stamp) patch[stamp] = now;

  if (parsed.data.status === "QUALIFIED") patch.qualification_state = "QUALIFIED";

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

  if (["QUALIFIED", "BOOKED"].includes(parsed.data.status)) {
    await enqueueCrmPushes(workspace.businessId, lead.id);
  }

  refresh();
  return { ok: true };
}

/** Closes the lead won, with the reason (required). */
export async function markWon(leadId: string, reason: string) {
  return updateLeadStatus({ leadId, status: "WON", reason });
}

/** Closes the lead lost, with the reason (required). */
export async function markLost(leadId: string, reason: string) {
  return updateLeadStatus({ leadId, status: "LOST", reason });
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

/**
 * Stops automated follow-up and hands the conversation to a person. The
 * `lead.takeover` operation is the one implementation, shared with the lead
 * page, Copilot and MCP.
 */
export async function humanTakeover(leadId: string): Promise<ActionResult> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return fail("Lead not found.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to take over this conversation.");
  }

  const result = await runOperation("lead.takeover", { leadId: parsed.data }, uiContext(workspace));
  if (result.success) refresh();
  return fromService(result);
}

/** Hands the lead back to automated follow-up (`lead.resume_follow_up`). */
export async function resumeAutomation(leadId: string): Promise<ActionResult> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return fail("Lead not found.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to resume automation.");
  }

  const result = await runOperation(
    "lead.resume_follow_up",
    { leadId: parsed.data },
    uiContext(workspace),
  );
  if (result.success) refresh();
  return fromService(result);
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
  conversationId?: string;
  subject?: string;
  /** One per composed message, from the composer, so a retry of it is exact. */
  clientNonce?: string;
}): Promise<ActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a message before sending.");

  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return fail("You do not have permission to send messages.");
  }
  if (!(await workspaceCan(workspace, "send_outbound"))) {
    return fail("Your permissions in this workspace do not allow sending. Ask the owner or an admin.");
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

  const channel = parsed.data.channel;
  const social = channel === "messenger" || channel === "instagram";

  const admin = createAdminClient();

  /*
   * The thread first, because on the platform channels it is what carries the
   * destination. A lead row has nowhere to hold a page-scoped recipient id, so
   * `send-store` reads it from the conversation -- which means a social reply
   * without a conversation is a message the worker cannot address.
   */
  let conversationId: string | null = null;

  if (parsed.data.conversationId) {
    const { data: thread } = await admin
      .from("conversations")
      .select("id, channel, lead_id, last_inbound_at")
      .eq("id", parsed.data.conversationId)
      .eq("business_id", workspace.businessId)
      .maybeSingle();

    if (!thread || thread.lead_id !== lead.id || thread.channel !== channel) {
      return fail("That conversation could not be found.");
    }

    // Meta permits a business to answer somebody who wrote to it, for 24 hours
    // after they last did. Accepting a reply after that would take a carefully
    // typed message and silently never deliver it, which is worse than a
    // disabled composer.
    if (social) {
      const window = replyWindow(channel, thread.last_inbound_at);
      if (window.state !== "OPEN") {
        return fail(
          "The 24-hour reply window on this thread has closed, so a reply would not be delivered.",
        );
      }
    }

    conversationId = thread.id;
  } else if (social) {
    return fail("A social reply must be sent from its own conversation.");
  }

  /*
   * The destination, resolved the same way `send-store.load()` will resolve it
   * when the job runs. Checked here so the person who typed the message is told
   * now, rather than the send failing quietly in a worker minutes later.
   */
  let to: string;
  if (channel === "email") {
    to = (lead.email ?? "").trim();
    if (!to) return fail("This lead has no email address.");
  } else if (social) {
    // Addressed from the thread by the worker; there is nothing to check here
    // beyond the thread existing, which is established above.
    to = "";
  } else {
    to = lead.phone_normalized ?? normalisePhone(lead.phone ?? "") ?? "";
    if (!to) return fail("This lead has no usable phone number.");
  }

  // The one list, shared with the cold path. See 0069.
  const suppression = await checkSuppression(
    workspace.businessId,
    channel === "email"
      ? "EMAIL"
      : channel === "whatsapp"
        ? "WHATSAPP"
        : social
          ? "SOCIAL"
          : "SMS",
    channel === "email" ? { email: to } : social ? {} : { phone: to },
  );
  if (suppression) {
    return fail("This contact is suppressed on that channel and cannot be messaged.");
  }

  if (!conversationId) {
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("business_id", workspace.businessId)
      .eq("lead_id", lead.id)
      .eq("channel", channel)
      .maybeSingle();

    if (existing) {
      conversationId = existing.id;
    } else {
      const { data: created, error: conversationError } = await admin
        .from("conversations")
        .insert({
          business_id: workspace.businessId,
          lead_id: lead.id,
          channel,
        })
        .select("id")
        .single();
      if (conversationError || !created) return fail("Could not open a conversation.");
      conversationId = created.id;
    }
  }

  /*
   * Derived, not random. A random key per click made a double-click two
   * messages; this key is the same for the same message pressed twice (see
   * `manualSendKeys`), so the unique (business_id, send_key) index turns the
   * second press into a no-op instead of a second text to the lead.
   */
  const nonce = z.string().trim().min(8).max(80).safeParse(input.clientNonce);
  const { key: sendKey, candidates } = manualSendKeys({
    leadId: lead.id,
    channel,
    body: parsed.data.body,
    subject: channel === "email" ? (parsed.data.subject ?? null) : null,
    nonce: nonce.success ? nonce.data : null,
  });

  const { data: duplicate, error: duplicateError } = await admin
    .from("messages")
    .select("id")
    .eq("business_id", workspace.businessId)
    .in("send_key", candidates)
    .limit(1)
    .maybeSingle();
  if (duplicateError) return fail("Could not queue the message.");
  // Already queued by the first press. Reporting success is the truth.
  if (duplicate) {
    refresh();
    return { ok: true };
  }

  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      business_id: workspace.businessId,
      conversation_id: conversationId,
      lead_id: lead.id,
      direction: "outbound",
      channel,
      body: parsed.data.body,
      // Email threads need one; every other channel has no concept of it.
      subject: channel === "email" ? (parsed.data.subject ?? null) : null,
      status: "QUEUED",
      origin: "manual",
      send_key: sendKey,
    })
    .select("id")
    .single();

  // Lost the race to a concurrent press of the same message.
  if (messageError?.code === "23505") {
    refresh();
    return { ok: true };
  }
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
    metadata: { lead_id: lead.id, channel },
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
  if (!(await workspaceCan(workspace, "send_outbound"))) {
    return fail("Your permissions in this workspace do not allow sending. Ask the owner or an admin.");
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
