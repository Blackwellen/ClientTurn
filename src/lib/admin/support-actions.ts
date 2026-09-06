"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * Admin → Support writes (V4 §39).
 *
 * Every one goes through `guarded`, so it is authorised, step-up protected and
 * audited by the same path as suspending a workspace. Nothing here performs
 * provider I/O: a reply is stored and the mail worker delivers it, so a slow
 * SMTP call can never make an operator think their reply was lost.
 */

const TICKET_STATUSES = [
  "OPEN",
  "WAITING_CUSTOMER",
  "WAITING_INTERNAL",
  "RESOLVED",
  "CLOSED",
] as const;

const bodyInput = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2).max(5000),
});

export async function replyToTicket(input: {
  ticketId: string;
  body: string;
}): Promise<AdminActionResult> {
  return guarded("admin.support_replied", async (operator) => {
    const parsed = bodyInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Write a reply first." };

    const db = createAdminClient();
    const { data: ticket } = await db
      .from("support_tickets")
      .select("id, business_id, status, first_response_at")
      .eq("id", parsed.data.ticketId)
      .maybeSingle();

    if (!ticket) return { ok: false, error: "That ticket no longer exists." };
    if (ticket.status === "CLOSED") {
      return { ok: false, error: "This ticket is closed. Reopen it before replying." };
    }

    const { error } = await db.from("support_messages").insert({
      ticket_id: ticket.id,
      business_id: ticket.business_id,
      direction: "OUTBOUND",
      author_user_id: operator.id,
      author_email: operator.email,
      body: parsed.data.body,
      channel: "APP",
      delivery_state: "STORED",
    });
    if (error) return { ok: false, error: "The reply could not be saved." };

    const now = new Date().toISOString();
    await db
      .from("support_tickets")
      .update({
        status: "WAITING_CUSTOMER",
        last_admin_message_at: now,
        // Written once and never again: a ticket that reopens when the customer
        // replies must not be able to rewrite its first-response time.
        first_response_at: ticket.first_response_at ?? now,
      })
      .eq("id", ticket.id);

    await recordAudit({
      businessId: ticket.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.support_replied",
      entityType: "support_ticket",
      entityId: ticket.id,
    });

    revalidatePath("/admin/support");
    return { ok: true, message: "Reply sent." };
  });
}

export async function addInternalNote(input: {
  ticketId: string;
  body: string;
}): Promise<AdminActionResult> {
  return guarded("admin.support_note_added", async (operator) => {
    const parsed = bodyInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Write a note first." };

    const db = createAdminClient();
    const { error } = await db.from("support_notes").insert({
      ticket_id: parsed.data.ticketId,
      author_user_id: operator.id,
      body: parsed.data.body,
      is_ai_draft: false,
    });
    if (error) return { ok: false, error: "The note could not be saved." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.support_note_added",
      entityType: "support_ticket",
      entityId: parsed.data.ticketId,
    });

    revalidatePath("/admin/support");
    return { ok: true, message: "Note added. The customer cannot see it." };
  });
}

export async function setTicketStatus(input: {
  ticketId: string;
  status: string;
}): Promise<AdminActionResult> {
  return guarded("admin.support_status_changed", async (operator) => {
    const parsed = z
      .object({ ticketId: z.string().uuid(), status: z.enum(TICKET_STATUSES) })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "That is not a valid status." };

    const db = createAdminClient();
    const closing =
      parsed.data.status === "RESOLVED" || parsed.data.status === "CLOSED";
    const now = new Date().toISOString();

    const { error } = await db
      .from("support_tickets")
      .update({
        status: parsed.data.status,
        // Reopening clears the resolution stamps, so "time to resolve" is
        // measured from the reply that actually finished the job.
        resolved_at: closing ? now : null,
        closed_at: parsed.data.status === "CLOSED" ? now : null,
      })
      .eq("id", parsed.data.ticketId);
    if (error) return { ok: false, error: "The ticket could not be updated." };

    await db.from("support_assignments").insert({
      ticket_id: parsed.data.ticketId,
      admin_user_id: operator.id,
      assigned_by: operator.id,
      action: "STATUS_CHANGED",
      detail: parsed.data.status,
    });

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.support_status_changed",
      entityType: "support_ticket",
      entityId: parsed.data.ticketId,
      metadata: { status: parsed.data.status },
    });

    revalidatePath("/admin/support");
    return { ok: true, message: "Ticket updated." };
  });
}

export async function assignTicketToMe(input: {
  ticketId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.support_assigned", async (operator) => {
    const parsed = z.string().uuid().safeParse(input.ticketId);
    if (!parsed.success) return { ok: false, error: "That ticket is not valid." };

    const db = createAdminClient();
    const { error } = await db
      .from("support_tickets")
      .update({ assigned_admin_id: operator.id })
      .eq("id", parsed.data);
    if (error) return { ok: false, error: "The ticket could not be assigned." };

    await db.from("support_assignments").insert({
      ticket_id: parsed.data,
      admin_user_id: operator.id,
      assigned_by: operator.id,
      action: "ASSIGNED",
    });

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.support_assigned",
      entityType: "support_ticket",
      entityId: parsed.data,
    });

    revalidatePath("/admin/support");
    return { ok: true, message: "Assigned to you." };
  });
}
