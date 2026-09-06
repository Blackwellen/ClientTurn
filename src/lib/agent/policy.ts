/**
 * The policy engine.
 *
 * Pure functions over a snapshot the caller has already loaded. Nothing in
 * here calls a model, and nothing a model returns can reach it -- these are
 * the gates the runtime must pass before it is allowed to think, and again
 * before it is allowed to speak.
 *
 * Kept free of `server-only` and of database imports so the whole gate set is
 * unit-testable without a database, which is the only way rules like "never
 * message a suppressed contact" stay honest.
 */

import {
  isWithinQuietHours,
  nextPermittedSendTime,
  type QuietHours,
} from "../automation/scheduler.ts";
import {
  CHANNEL_LIMITS,
  type AgentChannel,
  type AgentOperatingMode,
  type ConversationOwner,
  type LifecycleState,
  type RiskLevel,
} from "./types.ts";

// ------------------------------------------------------------- run gates

export type RunGateSnapshot = {
  agentMode: AgentOperatingMode;
  /** business_settings.ai_assist_enabled AND the plan entitles AI assist. */
  aiAssistEnabled: boolean;
  subscriptionActive: boolean;
  /** businesses.status -- a suspended workspace does nothing at all. */
  businessStatus: string;
  channel: AgentChannel;
  allowedChannels: readonly string[];
  conversationOwner: ConversationOwner;
  lifecycle: LifecycleState;
  leadOptedOut: boolean;
  humanTakeover: boolean;
  isTestLead: boolean;
};

export type RunGateResult =
  | { allowed: true }
  | { allowed: false; code: RunDenialCode; detail: string };

export type RunDenialCode =
  | "AGENT_OFF"
  | "AI_ASSIST_DISABLED"
  | "SUBSCRIPTION_INACTIVE"
  | "BUSINESS_SUSPENDED"
  | "CHANNEL_NOT_ALLOWED"
  | "HUMAN_OWNS_CONVERSATION"
  | "CONVERSATION_CLOSED"
  | "LEAD_SUPPRESSED";

/**
 * May the agent take a turn at all? Checked before any context is assembled,
 * so an off workspace costs one cheap query and nothing more.
 */
export function evaluateRunGate(snapshot: RunGateSnapshot): RunGateResult {
  if (snapshot.agentMode === "OFF") {
    return { allowed: false, code: "AGENT_OFF", detail: "The AI agent is off for this workspace." };
  }
  if (!snapshot.aiAssistEnabled) {
    return {
      allowed: false,
      code: "AI_ASSIST_DISABLED",
      detail: "AI assist is disabled or not included in this plan.",
    };
  }
  if (snapshot.businessStatus === "suspended" || snapshot.businessStatus === "cancelled") {
    return {
      allowed: false,
      code: "BUSINESS_SUSPENDED",
      detail: `The workspace is ${snapshot.businessStatus}.`,
    };
  }
  if (!snapshot.subscriptionActive) {
    return {
      allowed: false,
      code: "SUBSCRIPTION_INACTIVE",
      detail: "The subscription is not active.",
    };
  }
  if (!snapshot.allowedChannels.includes(snapshot.channel)) {
    return {
      allowed: false,
      code: "CHANNEL_NOT_ALLOWED",
      detail: `The agent is not enabled for ${snapshot.channel}.`,
    };
  }
  if (snapshot.leadOptedOut || snapshot.lifecycle === "SUPPRESSED") {
    return {
      allowed: false,
      code: "LEAD_SUPPRESSED",
      detail: "The contact has opted out.",
    };
  }
  // A person holding the conversation is absolute: the agent does not draft
  // over the top of them and never takes ownership back by itself.
  if (
    snapshot.humanTakeover ||
    snapshot.conversationOwner === "HUMAN_ACTIVE" ||
    snapshot.conversationOwner === "HANDED_OVER"
  ) {
    return {
      allowed: false,
      code: "HUMAN_OWNS_CONVERSATION",
      detail: "A team member owns this conversation.",
    };
  }
  if (snapshot.conversationOwner === "CLOSED") {
    return {
      allowed: false,
      code: "CONVERSATION_CLOSED",
      detail: "The conversation is closed.",
    };
  }

  return { allowed: true };
}

// ------------------------------------------------------------ send gates

export type SendGateSnapshot = {
  agentMode: AgentOperatingMode;
  channel: AgentChannel;
  /** Result of the existing contactability/suppression check. */
  contactSuppressed: boolean;
  /** Whether the lead has a usable address on this channel. */
  hasDestination: boolean;
  /** Provider connection for this channel is usable. */
  providerHealthy: boolean;
  quietHours: QuietHours;
  now: Date;
};

export type SendGateResult =
  | { decision: "SEND" }
  | { decision: "DRAFT"; detail: string }
  | { decision: "QUEUE"; runAt: Date; detail: string }
  | { decision: "DENY"; code: SendDenialCode; detail: string };

export type SendDenialCode =
  | "CONTACT_SUPPRESSED"
  | "NO_DESTINATION"
  | "PROVIDER_UNHEALTHY";

/**
 * May this turn actually put a message on the wire, and when? Re-evaluated
 * immediately before dispatch, never cached from earlier in the turn.
 */
export function evaluateSendGate(snapshot: SendGateSnapshot): SendGateResult {
  if (snapshot.contactSuppressed) {
    return {
      decision: "DENY",
      code: "CONTACT_SUPPRESSED",
      detail: "The contact is suppressed on this channel.",
    };
  }
  if (!snapshot.hasDestination) {
    return {
      decision: "DENY",
      code: "NO_DESTINATION",
      detail: `The lead has no usable ${snapshot.channel} address.`,
    };
  }
  if (!snapshot.providerHealthy) {
    return {
      decision: "DENY",
      code: "PROVIDER_UNHEALTHY",
      detail: `The ${snapshot.channel} connection is not healthy.`,
    };
  }

  // SUGGEST_ONLY never sends -- but it still draws a draft, which is the
  // whole point of the mode, so it is decided after the hard denials so a
  // workspace does not review drafts it could never have sent.
  if (snapshot.agentMode === "SUGGEST_ONLY") {
    return { decision: "DRAFT", detail: "The agent is in suggest-only mode." };
  }

  // Quiet hours have exactly one owner: the send guard in send-core, which
  // re-checks them against live state immediately before dispatch and
  // reschedules anything inside the window. This is not a second decision --
  // it predicts that one, so the turn reports MESSAGE_QUEUED rather than
  // claiming a send the guard will hold back.
  if (isWithinQuietHours(snapshot.now, snapshot.quietHours)) {
    return {
      decision: "QUEUE",
      runAt: nextPermittedSendTime(snapshot.now, snapshot.quietHours),
      detail: "Held until quiet hours end.",
    };
  }

  return { decision: "SEND" };
}

// ------------------------------------------------------------ tool gates

export type ToolGateSnapshot = {
  riskLevel: RiskLevel;
  confidence: number | null;
  lifecycle: LifecycleState;
  /** Tool-declared prerequisites the runtime has already resolved. */
  requirements: {
    requiresContactability?: boolean;
    requiresConfirmedAvailability?: boolean;
    requiresQualifiedState?: boolean;
    requiresRecognisedOptOut?: boolean;
    requiresBookingEnabled?: boolean;
  };
  facts: {
    contactable: boolean;
    availabilityConfirmed: boolean;
    optOutRecognised: boolean;
    bookingEnabled: boolean;
  };
};

export type ToolGateResult =
  | { allowed: true }
  | {
      allowed: false;
      status: "DENIED_POLICY" | "DENIED_CONFIDENCE" | "DENIED_PERMISSION";
      detail: string;
    };

/**
 * The last gate before a tool runs. A model proposal reaches here as data; if
 * any declared prerequisite is unmet the call is refused and the refusal is
 * what gets audited.
 */
export function evaluateToolGate(snapshot: ToolGateSnapshot): ToolGateResult {
  // CRITICAL is not merely gated -- the conversation agent has no authority
  // for billing, account or credential operations, so no tool may declare it.
  if (snapshot.riskLevel === "CRITICAL") {
    return {
      allowed: false,
      status: "DENIED_PERMISSION",
      detail: "The conversation agent has no authority for critical operations.",
    };
  }

  const needsHighConfidence = snapshot.riskLevel === "HIGH";
  const floor = needsHighConfidence ? 0.9 : 0.6;
  if (snapshot.confidence !== null && snapshot.confidence < floor) {
    return {
      allowed: false,
      status: "DENIED_CONFIDENCE",
      detail: `Confidence ${snapshot.confidence.toFixed(2)} is below the ${floor} floor for ${snapshot.riskLevel} risk.`,
    };
  }

  const { requirements: need, facts } = snapshot;

  if (need.requiresContactability && !facts.contactable) {
    return { allowed: false, status: "DENIED_POLICY", detail: "The contact is not messageable." };
  }
  if (need.requiresConfirmedAvailability && !facts.availabilityConfirmed) {
    return {
      allowed: false,
      status: "DENIED_POLICY",
      detail: "No availability has been confirmed by a calendar tool.",
    };
  }
  if (need.requiresBookingEnabled && !facts.bookingEnabled) {
    return {
      allowed: false,
      status: "DENIED_POLICY",
      detail: "Booking is not configured for this workspace.",
    };
  }
  if (need.requiresQualifiedState) {
    const permitted: LifecycleState[] = ["QUALIFIED", "BOOKING_PENDING", "BOOKED"];
    if (!permitted.includes(snapshot.lifecycle)) {
      return {
        allowed: false,
        status: "DENIED_POLICY",
        detail: `Lifecycle ${snapshot.lifecycle} is not eligible for booking.`,
      };
    }
  }
  if (need.requiresRecognisedOptOut && !facts.optOutRecognised) {
    return {
      allowed: false,
      status: "DENIED_POLICY",
      detail: "Suppression requires a recognised opt-out or an authorised human action.",
    };
  }

  return { allowed: true };
}

// ------------------------------------------------------- message shaping

/**
 * Length policy. Over the preferred length the composer is asked to compress;
 * over the hard limit the candidate is discarded rather than truncated, since
 * truncating a message can cut a fact in half and change its meaning.
 */
export function evaluateLength(
  body: string,
  channel: AgentChannel,
): { verdict: "OK" | "COMPRESS" | "REJECT"; limit: number } {
  const limits = CHANNEL_LIMITS[channel];
  if (body.length > limits.hard) return { verdict: "REJECT", limit: limits.hard };
  if (body.length > limits.preferred) return { verdict: "COMPRESS", limit: limits.preferred };
  return { verdict: "OK", limit: limits.preferred };
}
