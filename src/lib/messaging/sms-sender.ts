/**
 * Where an SMS goes out from, and under which Twilio account. Pure.
 *
 * The rule is `voice/numbers/sender.ts` `resolveSmsSender` (owner requirement
 * 2026-09-27): a workspace with an ACTIVE (or release-scheduled) dedicated
 * number sends from its OWN Messaging Service, so replies land on the same
 * number the AI calls from; every other workspace uses the platform sender
 * exactly as before (TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID).
 *
 * A workspace's Messaging Service lives in its Twilio SUBACCOUNT, so the send
 * is made under that subaccount's path (`/Accounts/{sub}/Messages.json`),
 * authenticated with the parent credentials (Twilio lets a parent act on its
 * subaccounts' resources). Without a known subaccount the dedicated sender is
 * not used and the platform sender is: a message is never sent to a
 * Messaging Service under the wrong account.
 */

import { resolveSmsSender, type PlatformSender, type WorkspaceNumber } from "../voice/numbers/sender.ts";

export type SmsSendTarget = {
  kind: "DEDICATED" | "PLATFORM_SHARED" | "NONE";
  /** The account path segment for the Messages API. */
  accountSid: string | null;
  /** Exactly one of these is set when kind is not NONE. */
  from: string | null;
  messagingServiceSid: string | null;
};

export function smsSendTarget(input: {
  number: WorkspaceNumber | null;
  subaccountSid: string | null;
  platform: PlatformSender;
  platformAccountSid: string;
}): SmsSendTarget {
  const sender = resolveSmsSender(input.number, input.platform);
  if (sender.kind === "DEDICATED" && input.subaccountSid) {
    return { kind: "DEDICATED", accountSid: input.subaccountSid, from: null, messagingServiceSid: sender.messagingServiceSid };
  }
  const platform = sender.kind === "DEDICATED" ? resolveSmsSender(null, input.platform) : sender;
  if (platform.kind === "NONE") return { kind: "NONE", accountSid: null, from: null, messagingServiceSid: null };
  const shared = platform as Extract<typeof platform, { kind: "PLATFORM_SHARED" }>;
  // The platform's own configured sender, unchanged: a From number wins,
  // else its Messaging Service (the pre-existing behaviour).
  return shared.from
    ? { kind: "PLATFORM_SHARED", accountSid: input.platformAccountSid, from: shared.from, messagingServiceSid: null }
    : { kind: "PLATFORM_SHARED", accountSid: input.platformAccountSid, from: null, messagingServiceSid: shared.messagingServiceSid };
}
