/**
 * What "resume follow-up" releases (business-story failure H3b).
 *
 * A manual takeover sets only `leads.human_takeover`, so clearing it was enough
 * to hand the lead back. An agent hand-off also sets the conversation's
 * `owner` to HANDED_OVER and opens an `agent_handoffs` row, and the run gate
 * refuses every turn while the owner is human (HUMAN_OWNS_CONVERSATION). So a
 * resume that cleared the lead flag alone left the assistant silent.
 *
 * `lead.resume_follow_up` therefore also releases the lead's human-owned
 * conversations and resolves its open hand-offs, the same writes the inbox's
 * "Return to assistant" (agent/actions.ts `handBackToAi`) makes. A CLOSED
 * conversation stays closed: resuming follow-up is not reopening a finished
 * thread.
 *
 * Pure: no `server-only`, no Supabase, so the rule is unit-testable.
 */

import type { ConversationOwner } from "../agent/types.ts";

/** Owners a resume hands back to the assistant. */
export const RELEASABLE_CONVERSATION_OWNERS = ["HUMAN_ACTIVE", "HANDED_OVER"] as const satisfies readonly ConversationOwner[];

/** Hand-off statuses still waiting on a person. */
export const OPEN_HANDOFF_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;

export const RESUME_RESOLUTION_NOTE = "Resolved when automated follow-up was resumed.";

export function ownerAfterResume(owner: ConversationOwner): ConversationOwner {
  return (RELEASABLE_CONVERSATION_OWNERS as readonly string[]).includes(owner) ? "AI_ACTIVE" : owner;
}

/** The conversations update, identical in shape to `handBackToAi`. */
export function conversationReleasePatch(now: string, userId: string | null) {
  return {
    owner: "AI_ACTIVE" as const,
    owner_changed_at: now,
    owner_changed_by: userId,
    state: "active" as const,
    // Cleared so the next inbound message is not held behind a turn that never
    // completed before the person stepped in.
    agent_locked_until: null,
  };
}

/** The agent_handoffs update for every open hand-off on the lead. */
export function handoffReleasePatch(now: string, userId: string | null) {
  return {
    status: "RESOLVED" as const,
    resolved_at: now,
    resolved_by: userId,
    resolution_note: RESUME_RESOLUTION_NOTE,
  };
}
