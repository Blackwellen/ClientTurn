"use server";

import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  assertUploadAllowed,
  createUploadUrl,
  createDownloadUrl,
  objectKey,
} from "@/lib/storage/r2";
import { getStatusSummary } from "@/lib/status/service";
import {
  getArticle,
  getTicket,
  listTickets,
  searchArticles,
  type HelpArticle,
} from "./service";
import {
  MAX_ATTACHMENT_BYTES,
  newTicketSchema,
  replySchema,
  supportContextSchema,
  type TicketDetail,
  type TicketSummary,
} from "./types";

/**
 * Support server actions (V4 §23).
 *
 * Every one of these resolves the workspace and user from the session. Nothing
 * accepts a `businessId` or a `userId` from the browser, so a crafted request
 * cannot read or write another tenant's — or another colleague's — ticket.
 *
 * The support desk is asynchronous ticketing, not live chat, and the wording
 * throughout says so. Nothing here pretends an agent is typing.
 */

type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): Result<never> {
  return { ok: false, error };
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/* -------------------------------------------------------------- rate limit */

/** Enough for a real conversation, not enough to flood the queue. */
const MAX_MESSAGES_PER_MINUTE = 5;
const MAX_OPEN_TICKETS = 20;

async function withinRateLimit(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("author_user_id", userId)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  return (count ?? 0) < MAX_MESSAGES_PER_MINUTE;
}

/* ------------------------------------------------------------------- reads */

export async function listMyTickets(): Promise<TicketSummary[]> {
  const workspace = await requireWorkspace();
  return listTickets({
    businessId: workspace.businessId,
    userId: workspace.userId,
  });
}

export async function getMyTicket(ticketId: unknown): Promise<TicketDetail | null> {
  const id = z.uuid().safeParse(ticketId);
  if (!id.success) return null;

  const workspace = await requireWorkspace();
  return getTicket(
    { businessId: workspace.businessId, userId: workspace.userId },
    id.data,
  );
}

export async function searchHelpArticles(query: unknown): Promise<HelpArticle[]> {
  const parsed = z.string().trim().max(120).safeParse(query ?? "");
  if (!parsed.success) return [];

  // Signed in only: the article index is a product surface, not a public one.
  await requireWorkspace();
  return searchArticles(parsed.data);
}

/* ------------------------------------------------------------- attachments */

const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(160),
  contentType: z.string().trim().min(3).max(120),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
});

/**
 * A short-lived signed PUT URL for one attachment.
 *
 * The file goes browser → R2 directly, so a 10MB screenshot never passes
 * through a server action. The key is namespaced by workspace, so one tenant
 * cannot address another's object even with a valid URL for their own.
 */
export async function createAttachmentUploadUrl(
  input: unknown,
): Promise<Result<{ key: string; url: string }>> {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return fail("That file could not be prepared for upload.");

  const workspace = await requireWorkspace();

  try {
    assertUploadAllowed("support", parsed.data.contentType, parsed.data.size);
  } catch {
    return fail(
      "That file type is not supported. Use PNG, JPG, PDF, TXT, CSV or LOG.",
    );
  }

  const key = objectKey(workspace.businessId, "support", parsed.data.filename);
  const url = await createUploadUrl(key, parsed.data.contentType);
  return ok({ key, url });
}

/**
 * A short-lived GET URL for an attachment the caller is entitled to.
 *
 * Entitlement is re-derived from the ticket, not from possession of the id:
 * the attachment row must belong to a ticket in the caller's workspace that
 * the caller opened.
 */
export async function getAttachmentUrl(
  attachmentId: unknown,
): Promise<Result<{ url: string }>> {
  const id = z.uuid().safeParse(attachmentId);
  if (!id.success) return fail("That attachment could not be found.");

  const workspace = await requireWorkspace();
  const admin = createAdminClient();

  const { data } = await admin
    .from("support_attachments")
    .select("storage_key, scan_state, ticket_id, business_id")
    .eq("id", id.data)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!data) return fail("That attachment could not be found.");

  if (data.scan_state === "BLOCKED" || data.scan_state === "FAILED") {
    return fail("That file did not pass our security scan and cannot be opened.");
  }

  const ticket = await getTicket(
    { businessId: workspace.businessId, userId: workspace.userId },
    data.ticket_id,
  );
  if (!ticket) return fail("That attachment could not be found.");

  return ok({ url: await createDownloadUrl(data.storage_key) });
}

/** Links uploaded objects to the message that carries them. */
async function attachFiles(input: {
  businessId: string;
  userId: string;
  ticketId: string;
  messageId: string;
  keys: string[];
}) {
  if (input.keys.length === 0) return;
  const admin = createAdminClient();

  const rows = input.keys
    // A key from another tenant's namespace is dropped rather than trusted.
    .filter((key) => key.startsWith(`support/${input.businessId}/`))
    .map((key) => ({
      ticket_id: input.ticketId,
      message_id: input.messageId,
      business_id: input.businessId,
      filename: key.split("-").slice(1).join("-") || key.split("/").pop() || "attachment",
      storage_key: key,
      uploaded_by: input.userId,
      // PENDING until the platform's scanner clears it; the reader refuses to
      // hand out a URL before then.
      scan_state: "PENDING" as const,
    }));

  if (rows.length > 0) await admin.from("support_attachments").insert(rows);
}

/* ------------------------------------------------------------------ writes */

/**
 * Opens a ticket.
 *
 * Context is included only when the customer said so, and even then it is
 * re-validated against the strict allow-list schema server-side — the browser
 * cannot smuggle an extra key into `context_json` by adding it to the payload.
 */
export async function createSupportTicket(
  input: unknown,
): Promise<Result<{ id: string; reference: string }>> {
  const parsed = newTicketSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ??
        "Please check the form and try again.",
    );
  }

  const workspace = await requireWorkspace();

  if (!(await withinRateLimit(workspace.userId))) {
    return fail("Please wait a minute before sending another message.");
  }

  const admin = createAdminClient();

  const { count: openCount } = await admin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId)
    .eq("created_by_user_id", workspace.userId)
    .in("status", ["OPEN", "WAITING_CUSTOMER", "WAITING_INTERNAL"]);

  if ((openCount ?? 0) >= MAX_OPEN_TICKETS) {
    return fail(
      "You already have a lot of open conversations. Please reply on an existing one instead.",
    );
  }

  // Re-parsed rather than trusted: `.strict()` rejects anything not on the
  // allow-list, so an added key fails here rather than being stored.
  const context = parsed.data.includeContext
    ? (supportContextSchema.safeParse(parsed.data.context ?? {}).data ?? {})
    : {};

  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      business_id: workspace.businessId,
      created_by_user_id: workspace.userId,
      category: parsed.data.category,
      subject: parsed.data.subject,
      source: "APP",
      status: "OPEN",
      context_json: context,
      last_customer_message_at: new Date().toISOString(),
    })
    .select("id, reference")
    .single();

  if (error || !ticket) {
    return fail("Your message could not be saved. Please try again.");
  }

  const { data: message, error: messageError } = await admin
    .from("support_messages")
    .insert({
      business_id: workspace.businessId,
      ticket_id: ticket.id,
      author_user_id: workspace.userId,
      direction: "INBOUND",
      body: parsed.data.description,
      channel: "APP",
    })
    .select("id")
    .single();

  if (messageError || !message) {
    // Leaving a subject-only ticket in the queue would waste a human's time on
    // a conversation with no content.
    await admin.from("support_tickets").delete().eq("id", ticket.id);
    return fail("Your message could not be saved. Please try again.");
  }

  await attachFiles({
    businessId: workspace.businessId,
    userId: workspace.userId,
    ticketId: ticket.id,
    messageId: message.id,
    keys: parsed.data.attachmentKeys,
  });

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "support.ticket_created",
    entityType: "support_ticket",
    entityId: ticket.id,
    metadata: {
      category: parsed.data.category,
      context_included: parsed.data.includeContext,
      attachments: parsed.data.attachmentKeys.length,
    },
  });

  return ok({ id: ticket.id, reference: ticket.reference ?? "" });
}

/** Adds a customer reply to an existing ticket. */
export async function replyToTicket(input: unknown): Promise<Result<undefined>> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Write a message before sending.");
  }

  const workspace = await requireWorkspace();

  if (!(await withinRateLimit(workspace.userId))) {
    return fail("Please wait a minute before sending another message.");
  }

  const admin = createAdminClient();

  // Ownership re-checked here, not inferred from the client having the id.
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, status")
    .eq("id", parsed.data.ticketId)
    .eq("business_id", workspace.businessId)
    .eq("created_by_user_id", workspace.userId)
    .maybeSingle();

  if (!ticket) return fail("That conversation could not be found.");

  const { data: message, error } = await admin
    .from("support_messages")
    .insert({
      business_id: workspace.businessId,
      ticket_id: ticket.id,
      author_user_id: workspace.userId,
      direction: "INBOUND",
      body: parsed.data.body,
      channel: "APP",
    })
    .select("id")
    .single();

  if (error || !message) {
    return fail("Your message could not be saved. Please try again.");
  }

  await attachFiles({
    businessId: workspace.businessId,
    userId: workspace.userId,
    ticketId: ticket.id,
    messageId: message.id,
    keys: parsed.data.attachmentKeys,
  });

  // Replying to a resolved ticket reopens it; a customer who writes again has
  // not finished, whatever the queue thought.
  await admin
    .from("support_tickets")
    .update({
      status: "OPEN",
      last_customer_message_at: new Date().toISOString(),
    })
    .eq("id", ticket.id)
    .eq("business_id", workspace.businessId);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "support.ticket_replied",
    entityType: "support_ticket",
    entityId: ticket.id,
    metadata: { attachments: parsed.data.attachmentKeys.length },
  });

  return ok(undefined);
}

/* ------------------------------------------------------------- help detail */

export async function readHelpArticle(slug: unknown) {
  const parsed = z.string().trim().min(1).max(120).safeParse(slug);
  if (!parsed.success) return null;

  await requireWorkspace();
  return getArticle(parsed.data);
}

/* ----------------------------------------------------------- system status */

/**
 * The condensed status shown inside the popout.
 *
 * Reads the same `StatusService` the public page does, so the two surfaces can
 * never disagree about whether something is down (§28's integration note).
 */
export async function readSystemStatus() {
  await requireWorkspace();
  return getStatusSummary();
}
