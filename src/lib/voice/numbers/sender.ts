/**
 * Sender resolution: which number a workspace speaks from, and which
 * workspace (and lead) an inbound call or SMS belongs to. Pure.
 *
 * Rule (owner requirement 2026-09-27): the dedicated number is used for BOTH
 * SMS and voice.
 *   - ACTIVE dedicated number: SMS goes out through the workspace's own
 *     Messaging Service (from that number); voice presents that number as
 *     caller ID.
 *   - RELEASE_SCHEDULED: the number is still held until the period end, so SMS
 *     keeps using it (replies stay on one thread), but no NEW voice call is
 *     placed (queued calls are cancelled when voice is removed, OD-2).
 *   - Anything else: SMS uses the shared platform sender; voice is not allowed.
 *   - Inbound to a dedicated number resolves to its workspace, then to the lead
 *     by the caller's number within that workspace only. Inbound to a released
 *     or quarantined number resolves to NO workspace.
 */

import { normaliseE164 } from "../destinations.ts";
import type { ProvisioningState } from "./provisioning.ts";

export type WorkspaceNumber = {
  businessId: string;
  state: ProvisioningState;
  e164: string | null;
  messagingServiceSid: string | null;
  quarantineUntil?: string | null;
};

export type PlatformSender = { messagingServiceSid: string | null; from: string | null };

export type SmsSender =
  | { kind: "DEDICATED"; messagingServiceSid: string; from: string }
  | { kind: "PLATFORM_SHARED"; messagingServiceSid: string | null; from: string | null }
  | { kind: "NONE"; reason: "NO_PLATFORM_SENDER" };

const SMS_FROM_DEDICATED: readonly ProvisioningState[] = ["ACTIVE", "RELEASE_SCHEDULED"];

export function resolveSmsSender(number: WorkspaceNumber | null, platform: PlatformSender): SmsSender {
  if (number && SMS_FROM_DEDICATED.includes(number.state) && number.e164 && number.messagingServiceSid) {
    return { kind: "DEDICATED", messagingServiceSid: number.messagingServiceSid, from: number.e164 };
  }
  if (platform.messagingServiceSid || platform.from) {
    return { kind: "PLATFORM_SHARED", messagingServiceSid: platform.messagingServiceSid, from: platform.from };
  }
  return { kind: "NONE", reason: "NO_PLATFORM_SENDER" };
}

export type VoiceCallerId =
  | { allowed: true; callerId: string }
  | { allowed: false; reason: "NO_DEDICATED_NUMBER" | "NUMBER_NOT_ACTIVE" | "RELEASE_SCHEDULED" };

export function resolveVoiceCallerId(number: WorkspaceNumber | null): VoiceCallerId {
  if (!number || !number.e164) return { allowed: false, reason: "NO_DEDICATED_NUMBER" };
  if (number.state === "RELEASE_SCHEDULED") return { allowed: false, reason: "RELEASE_SCHEDULED" };
  if (number.state !== "ACTIVE") return { allowed: false, reason: "NUMBER_NOT_ACTIVE" };
  return { allowed: true, callerId: number.e164 };
}

export type LeadPhone = {
  leadId: string;
  businessId: string;
  phone: string | null;
  anonymised?: boolean;
  /** Most recent activity; the tiebreak when one number matches several leads. */
  lastActivityAt: string;
};

export type InboundResolution =
  | {
      kind: "WORKSPACE";
      businessId: string;
      leadId: string | null;
      /** More than one lead in the workspace has this number. */
      ambiguous: boolean;
      callerE164: string | null;
    }
  | { kind: "UNROUTED"; reason: "UNKNOWN_NUMBER" | "NUMBER_RELEASED" | "NUMBER_QUARANTINED" | "INVALID_NUMBER" };

/**
 * Route an inbound call or SMS. `numbers` is every number record for the
 * dialled e164 (normally one; a quarantined record of a previous tenant may sit
 * beside a new tenant's ACTIVE one, and the ACTIVE one wins).
 */
export function resolveInbound(input: {
  to: string;
  from: string | null;
  now: Date;
  numbers: readonly WorkspaceNumber[];
  leads: readonly LeadPhone[];
}): InboundResolution {
  const to = normaliseE164(input.to);
  if (!to.ok) return { kind: "UNROUTED", reason: "INVALID_NUMBER" };
  const matching = input.numbers.filter((n) => {
    if (!n.e164) return false;
    const e = normaliseE164(n.e164);
    return e.ok && e.e164 === to.e164;
  });
  const live = matching.find((n) => SMS_FROM_DEDICATED.includes(n.state) || n.state === "CONFIGURED");
  if (!live) {
    if (matching.some((n) => n.state === "QUARANTINED" || (n.quarantineUntil && Date.parse(n.quarantineUntil) > input.now.getTime()))) {
      return { kind: "UNROUTED", reason: "NUMBER_QUARANTINED" };
    }
    if (matching.some((n) => n.state === "RELEASED")) return { kind: "UNROUTED", reason: "NUMBER_RELEASED" };
    return { kind: "UNROUTED", reason: "UNKNOWN_NUMBER" };
  }
  const from = input.from ? normaliseE164(input.from) : null;
  const callerE164 = from && from.ok ? from.e164 : null;
  if (!callerE164) return { kind: "WORKSPACE", businessId: live.businessId, leadId: null, ambiguous: false, callerE164: null };

  const candidates = input.leads
    .filter((l) => l.businessId === live.businessId && !l.anonymised && l.phone)
    .filter((l) => {
      const p = normaliseE164(l.phone);
      return p.ok && p.e164 === callerE164;
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || (a.leadId < b.leadId ? -1 : 1));
  return {
    kind: "WORKSPACE",
    businessId: live.businessId,
    leadId: candidates[0]?.leadId ?? null,
    ambiguous: candidates.length > 1,
    callerE164,
  };
}
