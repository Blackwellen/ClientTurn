import type { CampaignStatus } from "./types.ts";

/**
 * The acquisition campaign state machine (V4 section 17.9).
 *
 * Pure and exhaustive. Every write that changes a campaign's status goes
 * through `assertTransition`, so "a stopped campaign cannot be restarted" is a
 * property of one table rather than a condition repeated at each call site and
 * eventually forgotten at one of them.
 *
 * Archiving is deliberately not a status. A campaign can be archived from any
 * resting state without changing what it is, and un-archived without implying
 * it should start sending again.
 */

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["READY", "ACTIVE", "STOPPED"],
  READY: ["ACTIVE", "STOPPED"],
  ACTIVE: ["PAUSED", "OPTIMIZING", "COMPLETED", "STOPPED"],
  PAUSED: ["ACTIVE", "STOPPED", "COMPLETED"],
  OPTIMIZING: ["ACTIVE", "PAUSED", "COMPLETED", "STOPPED"],
  // Terminal. A finished campaign keeps its history; sending again is a new
  // campaign, which is what makes historical reporting reconcilable.
  COMPLETED: [],
  STOPPED: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: CampaignStatus): CampaignStatus[] {
  return TRANSITIONS[from] ?? [];
}

export class CampaignTransitionError extends Error {
  // Assigned in the body rather than declared as constructor parameter
  // properties: this module is unit-tested directly by the node test runner,
  // which strips types without transforming that syntax.
  readonly from: CampaignStatus;
  readonly to: CampaignStatus;

  constructor(from: CampaignStatus, to: CampaignStatus) {
    super(transitionMessage(from, to));
    this.name = "CampaignTransitionError";
    this.from = from;
    this.to = to;
  }
}

function transitionMessage(from: CampaignStatus, to: CampaignStatus): string {
  if (from === "STOPPED") {
    return "This campaign has been stopped. Duplicate it to send again.";
  }
  if (from === "COMPLETED") {
    return "This campaign has finished. Duplicate it to send again.";
  }
  if (to === "ACTIVE" && from === "DRAFT") {
    return "A draft has to pass launch validation before it can go active.";
  }
  return `A ${from.toLowerCase()} campaign cannot move to ${to.toLowerCase()}.`;
}

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransition(from, to)) throw new CampaignTransitionError(from, to);
}

/** Statuses in which the scheduler may actually put a message on the wire. */
export function isSendingStatus(status: CampaignStatus): boolean {
  return status === "ACTIVE" || status === "OPTIMIZING";
}

/** A campaign that is still capable of reaching ACTIVE. */
export function isLive(status: CampaignStatus): boolean {
  return status !== "COMPLETED" && status !== "STOPPED";
}

/**
 * Conditions that pause a running campaign without asking (V4 section 18.29).
 *
 * Ordered by severity, and every one of them is about protecting recipients or
 * the sending domain rather than about the campaign's own performance. The
 * first match wins so the recorded reason is the most serious one.
 */
export type AutoPauseSignals = {
  bounceRate: number;
  complaintRate: number;
  senderHealthy: boolean;
  senderVerified: boolean;
  suppressionAvailable: boolean;
  contactabilityAvailable: boolean;
  providerHealthy: boolean;
  budgetExhausted: boolean;
};

export const HARD_BOUNCE_RATE_LIMIT = 0.05;
export const COMPLAINT_RATE_LIMIT = 0.003;

export type AutoPauseReason = { code: string; message: string };

export function autoPauseReason(signals: AutoPauseSignals): AutoPauseReason | null {
  if (!signals.suppressionAvailable) {
    return {
      code: "SUPPRESSION_UNAVAILABLE",
      message:
        "The suppression service is unavailable, so we cannot confirm who has opted out. Sending is paused.",
    };
  }
  if (!signals.contactabilityAvailable) {
    return {
      code: "CONTACTABILITY_UNAVAILABLE",
      message:
        "Contact rules could not be evaluated, so sending is paused until they can be.",
    };
  }
  if (signals.complaintRate > COMPLAINT_RATE_LIMIT) {
    return {
      code: "COMPLAINT_THRESHOLD",
      message: "Spam complaints passed the safe threshold. Sending is paused to protect your domain.",
    };
  }
  if (signals.bounceRate > HARD_BOUNCE_RATE_LIMIT) {
    return {
      code: "BOUNCE_THRESHOLD",
      message: "Hard bounces passed the safe threshold. Sending is paused to protect your domain.",
    };
  }
  if (!signals.senderVerified) {
    return {
      code: "SENDER_UNVERIFIED",
      message: "The sending identity is no longer verified. Sending is paused.",
    };
  }
  if (!signals.senderHealthy) {
    return {
      code: "SENDER_UNHEALTHY",
      message: "Mailbox health is degraded. Sending is paused until it recovers.",
    };
  }
  if (!signals.providerHealthy) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      message: "A provider this campaign depends on is unavailable. Sending is paused.",
    };
  }
  if (signals.budgetExhausted) {
    return {
      code: "BUDGET_EXHAUSTED",
      message: "This campaign has reached its budget. Sending is paused.",
    };
  }
  return null;
}
