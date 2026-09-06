import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { recordAudit } from "@/lib/audit";

/**
 * Admin → Support (V4 §39).
 *
 * Platform-only. The queue spans every tenant, which is exactly why every read
 * and write here goes through `requirePlatformAdmin` rather than inheriting the
 * layout's guard: an operator reading another company's support thread is a
 * privileged action and is audited as one (§95).
 *
 * Copilot may draft; a human sends. There is no path in this module that emits
 * an external reply without an operator pressing send (§39.3).
 */

export * from "./support-types";

import {
  QUEUE_STATUSES,
  SUPPORT_QUEUES,
  type SupportData,
  type SupportQueue,
  type TicketDetail,
  type TicketRow,
} from "./support-types";

export async function loadSupport(
  queue: SupportQueue,
  ticketId?: string,
): Promise<SupportData> {
  const operator = await requirePlatformAdmin();
  const db = createAdminClient();

  const [tickets, businesses, counts] = await Promise.all([
    db
      .from("support_tickets")
      .select(
        "id, reference, subject, status, priority, category, source, business_id, requester_email, assigned_admin_id, last_customer_message_at, last_admin_message_at, created_at, updated_at",
      )
      .in("status", QUEUE_STATUSES[queue])
      // Oldest waiting first: a support queue sorted newest-first is how the
      // hardest tickets never get answered.
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: true })
      .limit(100),
    db.from("businesses").select("id, name"),
    Promise.all(
      SUPPORT_QUEUES.map((key) =>
        db
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .in("status", QUEUE_STATUSES[key]),
      ),
    ),
  ]);

  const nameById = new Map((businesses.data ?? []).map((row) => [row.id, row.name]));

  const messageCounts = new Map<string, number>();
  const ids = (tickets.data ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const { data: messages } = await db
      .from("support_messages")
      .select("ticket_id")
      .in("ticket_id", ids);
    for (const row of messages ?? []) {
      messageCounts.set(row.ticket_id, (messageCounts.get(row.ticket_id) ?? 0) + 1);
    }
  }

  const rows: TicketRow[] = (tickets.data ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    category: row.category,
    source: row.source,
    businessId: row.business_id,
    businessName: row.business_id ? (nameById.get(row.business_id) ?? null) : null,
    requesterEmail: row.requester_email,
    assignedAdminId: row.assigned_admin_id,
    messageCount: messageCounts.get(row.id) ?? 0,
    lastCustomerMessageAt: row.last_customer_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    awaitingUs:
      Boolean(row.last_customer_message_at) &&
      (!row.last_admin_message_at ||
        new Date(row.last_customer_message_at!).getTime() >
          new Date(row.last_admin_message_at).getTime()),
  }));

  const countMap = Object.fromEntries(
    SUPPORT_QUEUES.map((key, index) => [key, counts[index].count ?? 0]),
  ) as Record<SupportQueue, number>;

  const selected = ticketId ? (rows.find((row) => row.id === ticketId) ?? null) : null;

  return {
    queue,
    counts: countMap,
    tickets: rows,
    detail: selected ? await loadTicketDetail(selected, operator.id) : null,
  };
}

async function loadTicketDetail(
  ticket: TicketRow,
  operatorId: string,
): Promise<TicketDetail> {
  const db = createAdminClient();

  // Opening a thread means reading a tenant's own words. That is a privileged
  // read and is recorded as one, whether or not the operator replies.
  await recordAudit({
    businessId: ticket.businessId,
    actorUserId: operatorId,
    actorType: "platform_admin",
    action: "admin.support_view",
    entityType: "support_ticket",
    entityId: ticket.id,
  });

  const [messages, notes] = await Promise.all([
    db
      .from("support_messages")
      .select("id, direction, author_name, body, channel, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true })
      .limit(200),
    db
      .from("support_notes")
      .select("id, body, is_ai_draft, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  let customer: TicketDetail["customer"] = null;

  if (ticket.businessId) {
    const [subscription, members, failures, integrations] = await Promise.all([
      db
        .from("subscriptions")
        .select("plan, status")
        .eq("business_id", ticket.businessId)
        .maybeSingle(),
      db
        .from("business_members")
        .select("user_id", { count: "exact", head: true })
        .eq("business_id", ticket.businessId)
        .eq("status", "active"),
      db
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", ticket.businessId)
        .eq("state", "dead"),
      db
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", ticket.businessId)
        .in("status", ["ACTION_REQUIRED", "DEGRADED"]),
    ]);

    customer = {
      plan: subscription.data?.plan ?? null,
      status: subscription.data?.status ?? null,
      memberCount: members.count ?? 0,
      openJobFailures: failures.count ?? 0,
      integrationProblems: (integrations.data ?? []).map((row) => row.provider_type),
    };
  }

  return {
    ticket,
    messages: (messages.data ?? []).map((row) => ({
      id: row.id,
      direction: row.direction,
      authorName: row.author_name,
      body: row.body,
      channel: row.channel,
      createdAt: row.created_at,
    })),
    notes: (notes.data ?? []).map((row) => ({
      id: row.id,
      body: row.body,
      isAiDraft: row.is_ai_draft,
      createdAt: row.created_at,
    })),
    customer,
  };
}
