/**
 * The dial decision: may THIS call be placed NOW? Pure. The one function the
 * manual "Call with AI" operation, the `voice.dial` job and the `voice.retry`
 * job all ask, so the entitlement gate cannot be skipped on any initiation
 * path (a trial, demo or free workspace can never dial).
 *
 * Order (cheapest and most absolute first):
 *   1. The call is still QUEUED (or being created). A call past QUEUED is
 *      never dialled again: that is what makes a double dial impossible.
 *   2. `assertVoiceAllowed` (entitlement.ts): kill switches, account type,
 *      capability, packaging, minutes for a full reservation, identity, number.
 *   3. `canCallVoice` (policy/channel-policy.ts -> canCallLead): consent,
 *      suppression, the number, calling hours in the recipient's time zone,
 *      attempt caps, one live call per lead.
 *   4. A person has taken the lead over: no AI call while a human is on.
 *   5. The caller id (numbers/sender.ts): the workspace's ACTIVE number.
 *   6. The route allocation and the concurrency slot.
 *
 * The outcome is DIAL, DEFER (not now: retry at a time) or CANCEL (not ever,
 * with the reason and the product state the UI shows).
 */

import { assertVoiceAllowed, DENIAL_PRODUCT_STATE, type ProductState, type VoiceEntitlementSnapshot, type VoiceEntryPoint } from "./entitlement.ts";
import type { CanCallLeadInput, ConsentBasis, EligibilityDenial } from "./eligibility.ts";
import { canCallVoice } from "../policy/channel-policy.ts";
import { checkConcurrency, checkRouteAllocation, DEFAULT_RESERVATION_SEC, type RouteAllocations } from "./budget.ts";
import { resolveVoiceCallerId, type WorkspaceNumber } from "./numbers/sender.ts";
import type { VoiceRouteKey } from "./time-governor.ts";

export type DialCallState = { state: string; route: string; attemptNumber: number };

export type DialFacts = {
  now: Date;
  entryPoint: VoiceEntryPoint;
  /** Absent while the call is being requested (no row yet). */
  call: DialCallState | null;
  entitlement: VoiceEntitlementSnapshot;
  /** Everything `canCallLead` reads except the parts this module supplies. */
  eligibility: Omit<CanCallLeadInput, "now" | "callKind" | "entitlement" | "activeCall">;
  /** Another call to this lead is live. */
  activeCallForLead: boolean;
  humanTakeover: boolean;
  number: WorkspaceNumber | null;
  concurrency: { workspaceActive: number; platformActive: number; workspaceLimit?: number; platformLimit?: number };
  allocation?: { allocations: RouteAllocations; periodTotalSec: number; usedByRouteSec: number } | null;
  quietHours?: { start: string; end: string } | null;
  /** The reservation this call needs (default the budget plus the maximum extension). */
  requiredSec?: number;
};

export type DialDecision =
  | {
      kind: "DIAL";
      e164: string;
      callerId: string;
      timezone: string;
      basis: ConsentBasis;
      requiredSec: number;
      destinationClass: string;
    }
  | { kind: "DEFER"; reason: string; runAt: Date }
  | {
      kind: "CANCEL";
      reason: string;
      /** Every eligibility or entitlement reason that applied, first = reason. */
      reasons: string[];
      productState: ProductState | "permission-denied" | "error";
      message: string;
    }
  | { kind: "SKIP"; reason: "NOT_QUEUED" };

/** How long a full concurrency slot or a human take-over defers a call. */
export const CONCURRENCY_RETRY_MS = 60_000;
export const HUMAN_ACTIVE_RETRY_MS = 30 * 60_000;

const DIALLABLE_STATES = ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"];

export const ENTITLEMENT_MESSAGES: Readonly<Record<string, string>> = {
  KILL_SWITCH_PLATFORM: "AI calling is paused across ClientTurn right now.",
  KILL_SWITCH_WORKSPACE: "AI calling has been paused for this workspace by ClientTurn support.",
  TRIAL_ACCOUNT: "Voice is a paid feature: trials don't place live calls.",
  DEMO_ACCOUNT: "Demo workspaces don't place live calls.",
  FREE_ACCOUNT: "Voice is a paid feature.",
  SUBSCRIPTION_INACTIVE: "Your subscription isn't active, so AI calls are paused.",
  CAPABILITY_MISSING: "Voice isn't on this workspace yet. Add voice minutes to start calling.",
  NO_VOICE_PACKAGE: "Add a voice minute pack (or the Pro voice item) to start calling.",
  NO_MINUTES: "You're out of voice minutes. Buy a minute pack to keep calling.",
  INSUFFICIENT_MINUTES: "Not enough voice minutes left for a full call. Buy a minute pack to keep calling.",
  VOICE_DISABLED_IN_SETTINGS: "Voice is switched off in Settings, Voice.",
  AI_ASSISTANT_OFF: "Switch on the AI assistant in Settings, Workspace before AI calls: without it the call can't record answers or arrange anything.",
  IDENTITY_INCOMPLETE: "Complete your calling identity in Settings, Voice before calling.",
  NO_NUMBER: "Your dedicated calling number isn't active yet.",
};

export const ELIGIBILITY_MESSAGES: Readonly<Record<EligibilityDenial | "HUMAN_ACTIVE" | "ROUTE_ALLOCATION_EXHAUSTED" | "NO_CALLER_ID", string>> = {
  LEAD_ANONYMISED: "This lead's details have been erased.",
  SUPPRESSED: "This number is on your suppression list.",
  OPTED_OUT: "This lead has opted out of contact.",
  VOICE_OPTED_OUT: "This lead has asked not to be called.",
  NO_PHONE: "This lead has no phone number.",
  INVALID_PHONE: "This lead's phone number isn't valid.",
  PHONE_NOT_LEAD_SUPPLIED: "Only a number the lead gave you can be called.",
  DESTINATION_BLOCKED: "This kind of number can't be called (premium, personal or special rate).",
  RATE_CAP_EXCEEDED: "Calls to this destination cost more than the per-minute cap.",
  NO_CONSENT_BASIS: "There's no record of this lead agreeing to be called.",
  CONSENT_WITHDRAWN: "This lead withdrew their consent.",
  CONSENT_EVIDENCE_MISSING: "The consent to be called has no evidence on record.",
  CONSENT_STALE: "The lead's request to be called is too old. Ask them again first.",
  CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL:
    "The lead gave their number but didn't ask to be called. An AI call needs a call request or consent to call; a person can call, or you can text to ask.",
  TPS_LISTED: "This number is on the TPS register.",
  CTPS_LISTED: "This number is on the CTPS register.",
  TPS_NOT_SCREENED: "This number hasn't been screened against the TPS.",
  VOICE_NOT_ENTITLED: "Voice isn't available on this workspace right now.",
  TIMEZONE_UNRESOLVED: "We couldn't work out the lead's local time, so we can't respect calling hours.",
  OUTSIDE_CALLING_HOURS: "It's outside calling hours in the lead's time zone.",
  ATTEMPT_CAP_TOTAL: "This lead has had the maximum number of AI call attempts.",
  ATTEMPT_CAP_DAILY: "This lead has had the maximum AI call attempts for today.",
  ATTEMPT_TOO_SOON: "The last attempt was too recent.",
  CALL_ALREADY_ACTIVE: "A call to this lead is already in progress.",
  HUMAN_ACTIVE: "A person has taken over this lead, so the AI won't call.",
  ROUTE_ALLOCATION_EXHAUSTED: "This route has used its share of this month's minutes.",
  NO_CALLER_ID: "Your dedicated calling number isn't active yet.",
};

export function decideDial(f: DialFacts): DialDecision {
  // 1. Never re-dial a call that has left the queue.
  if (f.call && !DIALLABLE_STATES.includes(f.call.state)) return { kind: "SKIP", reason: "NOT_QUEUED" };

  const requiredSec = f.requiredSec ?? DEFAULT_RESERVATION_SEC;

  // 2. Entitlement (every entry point, every time).
  const entitlement = assertVoiceAllowed(f.entitlement, { requiredSec, entryPoint: f.entryPoint });
  if (!entitlement.allowed) {
    return {
      kind: "CANCEL",
      reason: entitlement.reason,
      reasons: entitlement.reasons,
      productState: DENIAL_PRODUCT_STATE[entitlement.reason],
      message: ENTITLEMENT_MESSAGES[entitlement.reason] ?? "Voice isn't available right now.",
    };
  }

  // 3. The lead, now, in their time zone.
  const policy = canCallVoice({
    ...f.eligibility,
    now: f.now,
    callKind: "AI_AUTOMATED",
    entitlement,
    activeCall: f.activeCallForLead,
    quietHours: f.quietHours ?? null,
  });
  if (policy.outcome === "NOT_NOW") {
    const runAt =
      policy.retryAt ?? (policy.reasonCode === "CALL_ALREADY_ACTIVE" ? new Date(f.now.getTime() + HUMAN_ACTIVE_RETRY_MS) : new Date(f.now.getTime() + 60 * 60_000));
    return { kind: "DEFER", reason: policy.reasonCode, runAt };
  }
  if (policy.outcome === "BLOCKED" || !policy.eligibility.allowed) {
    const reasons = policy.eligibility.allowed ? [policy.reasonCode] : policy.eligibility.reasons;
    return {
      kind: "CANCEL",
      reason: policy.reasonCode,
      reasons,
      productState: "permission-denied",
      message: ELIGIBILITY_MESSAGES[policy.reasonCode as EligibilityDenial] ?? "This lead can't be called.",
    };
  }
  const ok = policy.eligibility;

  // 4. No AI call while a person is working the lead.
  if (f.humanTakeover) {
    return { kind: "DEFER", reason: "HUMAN_ACTIVE", runAt: new Date(f.now.getTime() + HUMAN_ACTIVE_RETRY_MS) };
  }

  // 5. The number the workspace speaks from.
  const caller = resolveVoiceCallerId(f.number);
  if (!caller.allowed) {
    return {
      kind: "CANCEL",
      reason: "NO_CALLER_ID",
      reasons: ["NO_CALLER_ID", caller.reason],
      productState: "integration-required",
      message: ELIGIBILITY_MESSAGES.NO_CALLER_ID,
    };
  }

  // 6a. The route's share of the period's minutes.
  if (f.allocation && f.call) {
    const route = f.call.route as VoiceRouteKey;
    const a = checkRouteAllocation({
      route,
      allocations: f.allocation.allocations,
      periodTotalSec: f.allocation.periodTotalSec,
      usedByRouteSec: f.allocation.usedByRouteSec,
      requestSec: requiredSec,
    });
    if (!a.allowed) {
      return {
        kind: "CANCEL",
        reason: a.reason,
        reasons: [a.reason],
        productState: "plan-limit-reached",
        message: ELIGIBILITY_MESSAGES.ROUTE_ALLOCATION_EXHAUSTED,
      };
    }
  }

  // 6b. A concurrency slot (the RPC re-checks under the lock).
  const slot = checkConcurrency(f.concurrency);
  if (!slot.allowed) return { kind: "DEFER", reason: slot.reason, runAt: new Date(f.now.getTime() + CONCURRENCY_RETRY_MS) };

  return {
    kind: "DIAL",
    e164: ok.e164,
    callerId: caller.callerId,
    timezone: ok.timezone,
    basis: ok.basis,
    requiredSec,
    destinationClass: ok.destinationClass,
  };
}

/** The product state the UI should render for a refusal. */
export function productStateFor(decision: DialDecision): string | null {
  return decision.kind === "CANCEL" ? decision.productState : null;
}
