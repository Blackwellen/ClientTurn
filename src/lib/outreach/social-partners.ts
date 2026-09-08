import "server-only";
import { serverEnv } from "@/lib/env";
import type { SocialPlatform } from "./social-limits";

/**
 * Partner integrations that can perform a social action server-side.
 *
 * This file exists to be honest about a capability the product does not have,
 * in a shape that lets a workspace acquire it without a rewrite.
 *
 * ## The position
 *
 * There is **no public API** that lets an application send a connection request
 * or a direct message from a person's own LinkedIn account. LinkedIn's
 * messaging and connection endpoints sit behind approved partner programmes
 * with signed agreements. The unofficial route -- driving the member's session
 * with a headless browser or an injected cookie -- is a breach of the User
 * Agreement, and the account that gets restricted is the customer's own.
 *
 * The product therefore ships with **no LinkedIn sender**, and
 * `partnerSenderFor("LINKEDIN")` returns null. Everything upstream of the send
 * -- the finding, the resolving, the eligibility check, the cap arithmetic, the
 * composition, the timing, the stop conditions -- runs unattended around the
 * clock, and a person performs the click. That is the whole of the ASSISTED
 * model, and it is a deliberate product decision rather than an unfinished one.
 *
 * ## What plugging one in looks like
 *
 * A workspace with a genuine partner agreement implements `PartnerSender` and
 * registers it here. Everything else already works: the scheduler queues
 * `social.execute`, the executor calls `send`, `recordSocialAction` re-checks
 * the caps, and the state machine advances. No other file changes.
 *
 * Meta's Messenger and Instagram are a different case and genuinely do have a
 * sending API -- but reaching a *stranger* on them is still gated by the
 * 24-hour messaging window, which only the recipient can open. That transport
 * already exists in `lib/messaging/meta.ts` and is reached through the ordinary
 * message pipeline once a conversation exists, so it is not duplicated here.
 * This module is only for the cold, pre-conversation actions: the invite and
 * the first message that the connect-then-message gate stands in front of.
 */

export type PartnerSendInput = {
  businessId: string;
  prospectId: string;
  accountId: string;
  kind: "INVITE_NOTE" | "OPENER" | "FOLLOW_UP";
  body: string;
};

export type PartnerSendResult =
  | { ok: true; externalRef: string | null }
  | { ok: false; errorMessage: string; permanent: boolean };

export type PartnerSender = {
  readonly platform: SocialPlatform;
  readonly name: string;
  send(input: PartnerSendInput): Promise<PartnerSendResult>;
};

/**
 * The registry. Empty by design.
 *
 * Kept as a mutable map rather than a hardcoded switch so that a deployment
 * with a partner agreement registers its sender at startup -- the same shape as
 * `lib/messaging/registry.ts` and `lib/integrations/providers/*` -- without a
 * fork of this file.
 */
const SENDERS = new Map<SocialPlatform, PartnerSender>();

export function registerPartnerSender(sender: PartnerSender): void {
  SENDERS.set(sender.platform, sender);
}

/**
 * The sender for a platform, or null when there is none.
 *
 * Null is the expected answer, and every caller treats it as an ordinary
 * outcome rather than an error. `SOCIAL_PARTNER_SENDERS` is read as an
 * allow-list rather than as configuration that switches behaviour on: a
 * platform absent from it can never be sent to automatically even if a sender
 * was somehow registered, which keeps an accidental import from turning a
 * customer's personal account into an automated one.
 */
export function partnerSenderFor(platform: SocialPlatform): PartnerSender | null {
  const allowed = (serverEnv.social?.partnerSenders ?? [])
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  if (!allowed.includes(platform)) return null;
  return SENDERS.get(platform) ?? null;
}

/** Whether any sender is configured at all. Used by readiness and settings. */
export function anyPartnerSenderConfigured(): boolean {
  return (serverEnv.social?.partnerSenders ?? []).length > 0 && SENDERS.size > 0;
}
