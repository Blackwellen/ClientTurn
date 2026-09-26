import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { helpCategory } from "@/lib/help/categories";
import type { HelpImageSize, HelpScreenshot } from "@/lib/help/contract";
import { getHelpArticleForRender, recordHelpView, searchHelp } from "@/lib/help/service";
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
  /** A help-centre category slug (`@/lib/help/categories`). */
  category: string;
  /** Icon key for the category, resolved to a component by the popout. */
  icon: string | null;
};

export type HelpArticleDetail = HelpArticle & {
  body: string;
  updated: string | null;
  screenshots: HelpScreenshot[];
  imageSizes: Record<string, HelpImageSize>;
};

/**
 * Help article search (V4 §23.11, Phase 8.5).
 *
 * Delegates to the HelpService, which merges the bundled markdown articles
 * with published `support_articles` overrides and ranks them over title,
 * summary, keywords and body. There is deliberately no web search here: a
 * support surface that answers from the open internet will eventually tell a
 * customer something about ClientTurn that is not true.
 */
export async function searchArticles(
  query: string,
  limit = 8,
): Promise<HelpArticle[]> {
  const results = await searchHelp(query, limit);
  return results.map((article) => ({
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category: article.category,
    icon: helpCategory(article.category)?.icon ?? null,
  }));
}

/** One article for the popout, counted as a view. */
export async function getArticle(slug: string): Promise<HelpArticleDetail | null> {
  const found = await getHelpArticleForRender(slug);
  if (!found) return null;
  const { article, imageSizes } = found;
  await recordHelpView(article.slug);
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category: article.category,
    icon: helpCategory(article.category)?.icon ?? null,
    body: article.body,
    updated: article.updated,
    screenshots: article.screenshots,
    imageSizes,
  };
}
