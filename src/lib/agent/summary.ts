import "server-only";

/**
 * The memory manager.
 *
 * Four layers, and only four:
 *
 *   1. turn context      -- the last few messages, verbatim
 *   2. rolling summary   -- this module, for everything older
 *   3. structured lead   -- the lead row and qualification answers
 *   4. workspace config  -- business settings, services, booking
 *
 * There is deliberately no free-form long-term memory. Everything persisted
 * here is scoped to one conversation in one workspace, and the structured
 * half of the summary is written by the runtime rather than the model, so the
 * facts that must never be summarised away -- opt-out, booking, handover,
 * qualification -- cannot be lost to a compression pass.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runTask } from "@/lib/ai/model-router";
import { wrapUntrustedContent } from "@/lib/ai/safety";
import type { ConversationSummary } from "@/lib/ai/schemas";
import type { AgentContext } from "./context";
import { SUMMARY_TRIGGER_MESSAGE_COUNT, VERBATIM_MESSAGE_WINDOW } from "./types";

export type StoredSummary = {
  /** Written by the runtime from database state, never by the model. */
  qualificationStatus: string;
  bookingState: "none" | "scheduled";
  handoverState: "none" | "handed_over";
  optedOut: boolean;
  service: string | null;
  keyAnswers: { question: string; value: string }[];
  /** The only model-generated field. */
  conciseNarrative: string;
};

/**
 * Refreshes the rolling summary when a conversation has outgrown the verbatim
 * window. Cheap to call on every turn: it returns immediately unless there is
 * genuinely new history to compress.
 */
export async function maybeRefreshSummary(context: AgentContext): Promise<void> {
  const conversationId = context.conversation.conversationId;
  if (!conversationId) return;
  if (context.conversation.totalMessages < SUMMARY_TRIGGER_MESSAGE_COUNT) return;

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("conversation_summaries")
    .select("message_count")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  // Re-summarise only once per verbatim window's worth of new messages, so a
  // busy conversation does not pay for a summary on every single turn.
  const since = existing?.message_count ?? 0;
  if (context.conversation.totalMessages - since < VERBATIM_MESSAGE_WINDOW) return;

  // Everything older than the verbatim window is what needs compressing.
  const olderCount = Math.max(context.conversation.totalMessages - VERBATIM_MESSAGE_WINDOW, 0);
  const { data: older } = await admin
    .from("messages")
    .select("id, direction, body, created_at")
    .eq("conversation_id", conversationId)
    .eq("business_id", context.business.businessId)
    .in("status", ["QUEUED", "SENT", "DELIVERED", "RECEIVED"])
    .order("created_at", { ascending: true })
    .limit(olderCount);

  if (!older?.length) return;

  const transcript = older
    .map((row) =>
      row.direction === "inbound"
        ? `Lead: ${wrapUntrustedContent(row.body)}`
        : `Business: ${row.body}`,
    )
    .join("\n");

  const result = await runTask<ConversationSummary>({
    taskType: "conversation_summary",
    businessId: context.business.businessId,
    leadId: context.lead.id,
    conversationId,
    context: transcript,
    maxOutputTokens: 250,
  }).catch(() => null);

  // A failed summary is not an error. The turn still has the verbatim window
  // and the structured lead record, which is enough to keep working.
  const narrative = result?.data?.summary?.trim();
  if (!narrative) return;

  const summary: StoredSummary = {
    qualificationStatus: context.lead.qualification_state,
    bookingState: context.booking.liveBooking ? "scheduled" : "none",
    handoverState: context.lead.human_takeover ? "handed_over" : "none",
    optedOut: context.lead.opted_out,
    service: context.leadContext.serviceName,
    keyAnswers: context.qualification.answered.slice(0, 8),
    conciseNarrative: narrative,
  };

  await admin.from("conversation_summaries").upsert(
    {
      conversation_id: conversationId,
      business_id: context.business.businessId,
      summary_json: summary as never,
      last_message_id: older[older.length - 1].id,
      message_count: context.conversation.totalMessages,
    },
    { onConflict: "conversation_id" },
  );
}
