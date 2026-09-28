/**
 * The Instagram approval gate for the conversation agent (commercial rules
 * brief, item 4).
 *
 * Until Meta approves `instagram_manage_messages` for the app, the connection
 * comes back without it and every Instagram send is refused by the send path
 * (messaging/meta.ts permissionRefusal). Composing a reply that can never be
 * delivered spends AI tokens and leaves a queued message that fails later, so
 * the orchestrator asks this first: on an Instagram thread whose capability is
 * NEEDS_META_APPROVAL, no reply is composed or queued, and the turn records a
 * hand-over saying why, for a person to answer from the Instagram app.
 *
 * UNVERIFIED (a connection older than recorded scopes) is not blocked, exactly
 * as the send path allows it. Every other channel is untouched.
 *
 * Pure: relative `.ts` imports only.
 */

import type { MetaChannelCapability } from "../social/meta-capability.ts";

export const META_APPROVAL_TRIGGER = "META_APPROVAL_REQUIRED" as const;

export type InstagramGate = { blocked: true; missing: string[]; detail: string } | { blocked: false };

export function instagramReplyGate(channel: string, capability: MetaChannelCapability | null): InstagramGate {
  if (channel !== "instagram" || !capability) return { blocked: false };
  if (capability.state !== "NEEDS_META_APPROVAL") return { blocked: false };
  return {
    blocked: true,
    missing: capability.missing,
    detail:
      `Instagram messaging requires Meta approval (${capability.missing.join(", ")} not granted). ` +
      "No reply was written or queued. Reply to this lead from the Instagram app until Meta approves it for ClientTurn.",
  };
}
