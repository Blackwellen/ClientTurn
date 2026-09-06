import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { bundledArticle, searchBundled } from "./help";
import type { TicketDetail, TicketSummary } from "./types";

/**
 * SupportService — the customer's own view of their tickets (V4 §23).
 *
 * Two scoping rules, applied on every read, in this order:
 *
 *   1. `business_id` must be the caller's workspace.
 *   2. `created_by_user_id` must be the caller.
 *
 * The second is not redundant. A support thread routinely contains billing
 * detail, account problems and screenshots the author would not post in a team
 * channel, so a colleague with the same workspace membership must not be able
 * to read it. `support.read_own` is exactly that scope.
 *
 * The service-role client is used because `support_attachments` has no RLS
 * policy for `authenticated`; the two filters above are therefore the
 * enforcement, and they are never derived from anything the browser sent.
 */

export type SupportScope = { businessId: string; userId: string };

export async function listTickets(
  scope: SupportScope,
  limit = 25,
): Promise<TicketSummary[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("support_tickets")
    .select(
      "id, reference, subject, category, status, updated_at, last_customer_message_at, last_admin_message_at",
    )
    .eq("business_id", scope.businessId)
    .eq("created_by_user_id", scope.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Your support conversations could not be loaded.");

  return (data ?? []).map((row) => ({
    id: row.id,
    reference: row.reference ?? "",
    subject: row.subject,
    category: row.category,
    status: row.status,
    updatedAt: row.updated_at,
    // "Unread" here means support has said something since you last did —
    // which is the thing worth a dot, and needs no per-user read receipts.
    unread:
      Boolean(row.last_admin_message_at) &&
      (!row.last_customer_message_at ||
        row.last_admin_message_at! > row.last_customer_message_at),
  }));
}

export async function getTicket(
  scope: SupportScope,
  ticketId: string,
): Promise<TicketDetail | null> {
  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("support_tickets")
    .select(
      "id, reference, subject, category, status, updated_at, last_customer_message_at, last_admin_message_at",
    )
    .eq("id", ticketId)
    .eq("business_id", scope.businessId)
    .eq("created_by_user_id", scope.userId)
    .maybeSingle();

  if (!ticket) return null;

  const [messages, attachments] = await Promise.all([
    admin
      .from("support_messages")
      .select("id, direction, author_name, body, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("support_attachments")
      .select("id, message_id, filename, size_bytes, scan_state")
      .eq("ticket_id", ticket.id)
      .limit(60),
  ]);

  const byMessage = new Map<string, TicketDetail["messages"][number]["attachments"]>();
  for (const row of attachments.data ?? []) {
    // A file that has not passed scanning is not offered for download. It is
    // simply absent rather than shown as a broken link.
    if (row.scan_state === "BLOCKED" || row.scan_state === "FAILED") continue;
    if (!row.message_id) continue;
    const list = byMessage.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      sizeBytes: Number(row.size_bytes),
    });
    byMessage.set(row.message_id, list);
  }

  return {
    id: ticket.id,
    reference: ticket.reference ?? "",
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    updatedAt: ticket.updated_at,
    unread: false,
    messages: (messages.data ?? []).map((row) => ({
      id: row.id,
      direction: row.direction as "INBOUND" | "OUTBOUND",
      authorName: row.author_name,
      body: row.body,
      createdAt: row.created_at,
      attachments: byMessage.get(row.id) ?? [],
    })),
  };
}

/* ------------------------------------------------------------- help search */

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string | null;
  category: string;
  /** Icon key for the bundled set; null for published articles. */
  icon: string | null;
};

/**
 * Help article search (V4 §23.11).
 *
 * Searches the platform's own published article index and nothing else. There
 * is deliberately no web search here: a support surface that answers from the
 * open internet will eventually tell a customer something about ClientTurn that
 * is not true.
 */
export async function searchArticles(
  query: string,
  limit = 8,
): Promise<HelpArticle[]> {
  const admin = createAdminClient();

  const base = admin
    .from("support_articles")
    .select("slug, title, summary, category, view_count")
    .eq("status", "PUBLISHED");

  const trimmed = query.trim();

  const { data } = trimmed
    ? await base
        // Title, summary and keywords, so a search for "mailbox" finds
        // "Setting up email outreach".
        .or(
          `title.ilike.%${escapeLike(trimmed)}%,summary.ilike.%${escapeLike(trimmed)}%`,
        )
        .limit(limit)
    : await base.order("view_count", { ascending: false }).limit(limit);

  const published: HelpArticle[] = (data ?? []).map((row) => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    icon: null,
  }));

  // The bundled index is the floor, not the ceiling: a published article with
  // the same slug replaces its bundled version rather than appearing twice.
  const slugs = new Set(published.map((article) => article.slug));
  const bundled = searchBundled(trimmed)
    .filter((article) => !slugs.has(article.slug))
    .map((article) => ({
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      category: article.category,
      icon: article.icon,
    }));

  return [...published, ...bundled].slice(0, limit);
}

export async function getArticle(slug: string): Promise<
  (HelpArticle & { body: string }) | null
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_articles")
    .select("slug, title, summary, category, body_markdown")
    .eq("slug", slug)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (data) {
    return {
      slug: data.slug,
      title: data.title,
      summary: data.summary,
      category: data.category,
      icon: null,
      body: data.body_markdown,
    };
  }

  const fallback = bundledArticle(slug);
  if (!fallback) return null;
  return {
    slug: fallback.slug,
    title: fallback.title,
    summary: fallback.summary,
    category: fallback.category,
    icon: fallback.icon,
    body: fallback.body,
  };
}

/** `%` and `_` are wildcards in ILIKE; a customer typing them means them. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`).slice(0, 80);
}
