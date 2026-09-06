"use server";

/**
 * Write operations for the assistant surfaces.
 *
 * Three rules hold across every action here.
 *
 * 1. **A person is always the actor.** Each action starts with `requireRole`,
 *    re-reads the target scoped to that person's workspace, and records who
 *    did it. None of these are reachable by the agent itself.
 *
 * 2. **Ownership moves explicitly, never implicitly.** The agent may hand a
 *    conversation to a person, but only a person can hand it back. That is why
 *    `returnConversationToAi` exists as a deliberate action rather than as a
 *    timeout somewhere in the runtime.
 *
 * 3. **A draft is a message, not a suggestion blob.** Sending one goes through
 *    the same `message.send` pipeline and the same send guard as everything
 *    else, so suppression, stop conditions and quiet hours apply identically.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { emitAutomationEvent } from "@/lib/automation/events";
import type { AgentActionResult } from "./views";

function fail(error: string): AgentActionResult {
  return { ok: false, error };
}

function done(): AgentActionResult {
  revalidatePath("/app/inbox");
  revalidatePath("/app/leads");
  return { ok: true };
}

// ==================================================================
// Handoffs
// ==================================================================

const handoffIdSchema = z.object({ handoffId: z.uuid() });

/**
 * Marks a handover as being dealt with, and claims it for the acting user
 * unless it is already assigned to someone else.
 */
export async function acknowledgeHandoff(input: unknown): Promise<AgentActionResult> {
  const parsed = handoffIdSchema.safeParse(input);
  if (!parsed.success) return fail("That handover could not be identified.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: handoff } = await admin
    .from("agent_handoffs")
    .select("id, status, assigned_user_id, lead_id")
    .eq("id", parsed.data.handoffId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!handoff) return fail("That handover no longer exists.");
  if (handoff.status !== "OPEN") return fail("That handover has already been picked up.");

  const { error } = await admin
    .from("agent_handoffs")
    .update({
      status: "ACKNOWLEDGED",
      acknowledged_at: new Date().toISOString(),
      assigned_user_id: handoff.assigned_user_id ?? workspace.userId,
    })
    .eq("id", handoff.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("The handover could not be updated.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.handover_acknowledged",
    entityType: "agent_handoff",
    entityId: handoff.id,
    metadata: { leadId: handoff.lead_id },
  });

  return done();
}

const assignSchema = z.object({
  handoffId: z.uuid(),
  /** null unassigns. */
  userId: z.uuid().nullable(),
});

export async function assignHandoff(input: unknown): Promise<AgentActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail("That assignment is not valid.");

  const workspace = await requireRole("admin").catch(() => null);
  if (!workspace) return fail("Only an admin can reassign a handover.");

  const admin = createAdminClient();

  // The assignee must be a live member of *this* workspace, checked here
  // rather than trusted from the form.
  if (parsed.data.userId) {
    const { data: member } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", workspace.businessId)
      .eq("user_id", parsed.data.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return fail("That person is not an active member of this workspace.");
  }

  const { data: updated, error } = await admin
    .from("agent_handoffs")
    .update({ assigned_user_id: parsed.data.userId })
    .eq("id", parsed.data.handoffId)
    .eq("business_id", workspace.businessId)
    .in("status", ["OPEN", "ACKNOWLEDGED"])
    .select("id")
    .maybeSingle();

  if (error) return fail("The handover could not be reassigned.");
  if (!updated) return fail("That handover is closed and cannot be reassigned.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.handover_assigned",
    entityType: "agent_handoff",
    entityId: parsed.data.handoffId,
    metadata: { assignedTo: parsed.data.userId },
  });

  return done();
}

const resolveSchema = z.object({
  handoffId: z.uuid(),
  note: z.string().trim().max(500).optional(),
  /**
   * Hand the conversation back to the assistant on resolution. Off by
   * default: after a person has intervened, the assistant resuming is a
   * decision, never an assumption.
   */
  returnToAi: z.boolean().default(false),
});

export async function resolveHandoff(input: unknown): Promise<AgentActionResult> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail("Check the resolution note and try again.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: handoff } = await admin
    .from("agent_handoffs")
    .select("id, status, lead_id, conversation_id")
    .eq("id", parsed.data.handoffId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!handoff) return fail("That handover no longer exists.");
  if (handoff.status === "RESOLVED") return fail("That handover is already resolved.");

  const { error } = await admin
    .from("agent_handoffs")
    .update({
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
      resolved_by: workspace.userId,
      resolution_note: parsed.data.note ?? null,
    })
    .eq("id", handoff.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("The handover could not be resolved.");

  // Clearing the lead's attention flag is part of resolving: leaving it set
  // would keep the lead in the "needs a person" queue forever.
  await admin
    .from("leads")
    .update({ needs_attention: false, attention_reason: null })
    .eq("id", handoff.lead_id)
    .eq("business_id", workspace.businessId);

  if (parsed.data.returnToAi && handoff.conversation_id) {
    await handBackToAi(workspace.businessId, workspace.userId, handoff.conversation_id);
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.handover_resolved",
    entityType: "agent_handoff",
    entityId: handoff.id,
    metadata: { leadId: handoff.lead_id, returnedToAi: parsed.data.returnToAi },
  });

  return done();
}

/**
 * Withdraws a handover that should not have been raised. Distinct from
 * resolving: nothing was done about it, and the distinction matters when
 * reading back why the assistant escalated.
 */
export async function cancelHandoff(input: unknown): Promise<AgentActionResult> {
  const parsed = handoffIdSchema.safeParse(input);
  if (!parsed.success) return fail("That handover could not be identified.");

  const workspace = await requireRole("admin").catch(() => null);
  if (!workspace) return fail("Only an admin can cancel a handover.");

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("agent_handoffs")
    .update({ status: "CANCELLED", resolved_at: new Date().toISOString(), resolved_by: workspace.userId })
    .eq("id", parsed.data.handoffId)
    .eq("business_id", workspace.businessId)
    .in("status", ["OPEN", "ACKNOWLEDGED"])
    .select("id")
    .maybeSingle();

  if (error) return fail("The handover could not be cancelled.");
  if (!updated) return fail("That handover is already closed.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.handover_cancelled",
    entityType: "agent_handoff",
    entityId: parsed.data.handoffId,
  });

  return done();
}

// ==================================================================
// Drafts
// ==================================================================

const draftEditSchema = z.object({
  draftId: z.uuid(),
  body: z.string().trim().min(1).max(1200),
});

/** Edits a suggested reply in place, before anyone sends it. */
export async function updateDraft(input: unknown): Promise<AgentActionResult> {
  const parsed = draftEditSchema.safeParse(input);
  if (!parsed.success) return fail("A reply needs between 1 and 1200 characters.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("messages")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.draftId)
    .eq("business_id", workspace.businessId)
    // Only a draft may be edited. A sent message is a historical record.
    .eq("status", "DRAFT")
    .select("id")
    .maybeSingle();

  if (error) return fail("The draft could not be saved.");
  if (!updated) return fail("That draft has already been sent or discarded.");

  return done();
}

const draftIdSchema = z.object({ draftId: z.uuid() });

/**
 * Approves a suggested reply. The draft becomes a QUEUED message and goes
 * through the ordinary send pipeline -- the guard re-checks suppression, stop
 * conditions and quiet hours against live state before it leaves, exactly as
 * it would for any other outbound message.
 */
export async function sendDraft(input: unknown): Promise<AgentActionResult> {
  const parsed = draftIdSchema.safeParse(input);
  if (!parsed.success) return fail("That draft could not be identified.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("messages")
    .select("id, lead_id, send_key, status")
    .eq("id", parsed.data.draftId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!draft || draft.status !== "DRAFT") {
    return fail("That draft has already been sent or discarded.");
  }
  if (!draft.lead_id) return fail("That draft is not attached to a lead.");

  const { error } = await admin
    .from("messages")
    .update({ status: "QUEUED", scheduled_for: new Date().toISOString() })
    .eq("id", draft.id)
    .eq("business_id", workspace.businessId)
    .eq("status", "DRAFT");

  if (error) return fail("The reply could not be queued.");

  await enqueue(
    "message.send",
    { messageId: draft.id, leadId: draft.lead_id, sendKey: draft.send_key },
    {
      businessId: workspace.businessId,
      idempotencyKey: `message.send:${draft.send_key ?? draft.id}`,
    },
  );

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.draft_sent",
    entityType: "message",
    entityId: draft.id,
    metadata: { leadId: draft.lead_id },
  });

  return done();
}

/**
 * Rejects a suggested reply. The row is kept as DISCARDED rather than deleted:
 * what the assistant proposed and a person declined is the most useful record
 * there is for judging whether to trust it with more.
 */
export async function discardDraft(input: unknown): Promise<AgentActionResult> {
  const parsed = draftIdSchema.safeParse(input);
  if (!parsed.success) return fail("That draft could not be identified.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("messages")
    .update({ status: "DISCARDED" })
    .eq("id", parsed.data.draftId)
    .eq("business_id", workspace.businessId)
    .eq("status", "DRAFT")
    .select("id")
    .maybeSingle();

  if (error) return fail("The draft could not be discarded.");
  if (!updated) return fail("That draft has already been sent or discarded.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.draft_discarded",
    entityType: "message",
    entityId: parsed.data.draftId,
  });

  return done();
}

// ==================================================================
// Conversation ownership
// ==================================================================

const conversationSchema = z.object({ conversationId: z.uuid() });

/**
 * A person takes the conversation. The assistant stops immediately -- the run
 * gate refuses every subsequent turn while `owner` is HUMAN_ACTIVE, so there
 * is no window in which both could reply.
 */
export async function takeOverConversation(input: unknown): Promise<AgentActionResult> {
  const parsed = conversationSchema.safeParse(input);
  if (!parsed.success) return fail("That conversation could not be identified.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, lead_id")
    .eq("id", parsed.data.conversationId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!conversation) return fail("That conversation no longer exists.");

  const { error } = await admin
    .from("conversations")
    .update({
      owner: "HUMAN_ACTIVE",
      owner_changed_at: new Date().toISOString(),
      owner_changed_by: workspace.userId,
    })
    .eq("id", conversation.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("The conversation could not be taken over.");

  if (conversation.lead_id) {
    await admin
      .from("leads")
      .update({ human_takeover: true, automation_active: false })
      .eq("id", conversation.lead_id)
      .eq("business_id", workspace.businessId);

    await emitAutomationEvent({
      businessId: workspace.businessId,
      leadId: conversation.lead_id,
      eventType: "lead.human_takeover",
      payload: { reason: "manual_takeover" },
    });
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.conversation_taken_over",
    entityType: "conversation",
    entityId: conversation.id,
  });

  return done();
}

/**
 * Hands the conversation back. Only a person can do this -- the runtime never
 * reclaims a conversation on a timer, because "the human went quiet" and "the
 * human is done" are not the same thing.
 */
export async function returnConversationToAi(input: unknown): Promise<AgentActionResult> {
  const parsed = conversationSchema.safeParse(input);
  if (!parsed.success) return fail("That conversation could not be identified.");

  const workspace = await requireRole("member").catch(() => null);
  if (!workspace) return fail("You do not have permission to do that.");

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, lead_id")
    .eq("id", parsed.data.conversationId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!conversation) return fail("That conversation no longer exists.");

  // An opted-out lead never goes back to the assistant, whatever the UI says.
  if (conversation.lead_id) {
    const { data: lead } = await admin
      .from("leads")
      .select("opted_out")
      .eq("id", conversation.lead_id)
      .eq("business_id", workspace.businessId)
      .maybeSingle();

    if (lead?.opted_out) {
      return fail("This contact has opted out, so the assistant cannot resume.");
    }
  }

  const handed = await handBackToAi(workspace.businessId, workspace.userId, conversation.id);
  if (!handed) return fail("The assistant could not be resumed.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "agent.conversation_returned_to_ai",
    entityType: "conversation",
    entityId: conversation.id,
  });

  return done();
}

/** Shared by `resolveHandoff` and `returnConversationToAi`. */
async function handBackToAi(
  businessId: string,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: conversation, error } = await admin
    .from("conversations")
    .update({
      owner: "AI_ACTIVE",
      owner_changed_at: new Date().toISOString(),
      owner_changed_by: userId,
      state: "active",
      // The lock is cleared so the next inbound message is not held behind a
      // turn that never completed before the human stepped in.
      agent_locked_until: null,
    })
    .eq("id", conversationId)
    .eq("business_id", businessId)
    .select("lead_id")
    .maybeSingle();

  if (error || !conversation) return false;

  if (conversation.lead_id) {
    await admin
      .from("leads")
      .update({ human_takeover: false, needs_attention: false, attention_reason: null })
      .eq("id", conversation.lead_id)
      .eq("business_id", businessId);
  }

  return true;
}
