"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendManualMessage } from "@/lib/leads/actions";
import { canReplyOn } from "@/lib/inbox/types";

const schema = z.object({
  id: z.uuid(),
  action: z.enum(["read", "archive", "restore", "reply"]),
  body: z.string().trim().max(1200).optional(),
});

/**
 * The unified inbox's write path.
 *
 * The reply branch used to accept SMS and WhatsApp only, while `canReplyOn` --
 * the function the composer asks whether to render itself -- already permitted
 * Messenger and Instagram. So the product offered a reply box on two channels
 * the server would then refuse, and the customer discovered it after typing.
 *
 * The two are now the same decision: `canReplyOn` is imported and applied here,
 * rather than restated as a channel list that drifts. The client gate is a
 * courtesy; this one is the rule.
 */
export async function inboxAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid conversation action." };

  const workspace = await requireRole("member");
  const db = createAdminClient();

  const { data: conversation } = await db
    .from("conversations")
    .select("id, lead_id, prospect_id, channel, subject")
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!conversation) return { error: "Conversation not found." };

  if (parsed.data.action === "reply") {
    if (!canReplyOn(conversation.channel, Boolean(conversation.lead_id))) {
      // Said precisely, because the two reasons call for different actions. A
      // prospect thread needs promoting; a channel we cannot send on needs the
      // provider's own inbox.
      return {
        error: conversation.prospect_id && !conversation.lead_id
          ? "This is a prospect conversation. Promote them to a lead to reply from here."
          : "Replies cannot be sent on this channel from ClientTurn. Open the original provider to reply.",
      };
    }

    const result = await sendManualMessage({
      leadId: conversation.lead_id as string,
      channel: conversation.channel,
      body: parsed.data.body ?? "",
      conversationId: conversation.id,
      subject: conversation.subject ?? undefined,
    });
    if (!result.ok) return { error: result.error };
  } else {
    const patch =
      parsed.data.action === "read"
        ? { unread_count: 0 }
        : { is_archived: parsed.data.action === "archive" };

    const { error } = await db
      .from("conversations")
      .update(patch)
      .eq("id", conversation.id)
      .eq("business_id", workspace.businessId);

    if (error) return { error: "The conversation could not be updated." };
  }

  revalidatePath("/app/inbox");
  return { ok: true };
}
