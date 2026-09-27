/**
 * Goal routing A-G (08 §B.10, brief §12).
 *
 * What the conversation is *for*: qualify and hand over (A), book a meeting
 * (B), sell directly (C), start a signup or trial (D), hand to a human closer
 * (E), nurture (F) or disqualify (G). The goal decides the NBA's close action
 * (nba.ts rule R10) and, through `goalMotion`, which threshold applies.
 *
 * Resolution (first match wins, §B.10 "Order"; CD-16):
 *   state        engine NOT_QUALIFIED / a confirmed disqualifier -> G;
 *                intent NOT_NOW -> F (the plan resumes from stored facts)
 *   lead         leads.conversion_goal_type (HUMAN_HANDOVER / CUSTOM -> A only
 *                with qualification_required, otherwise E)
 *   offer        the offer profile's goal
 *   policy       the workspace QUALIFICATION_POLICY goal
 *   default      the workspace's default conversion goal
 *   motion       MOTION_DEFAULT_GOAL
 * then a deal value above the policy's humanCloserAboveValue upgrades B/C/D
 * to E (never downgrades A, F or G).
 *
 * Pure.
 */

import {
  CONVERSION_GOAL_TO_GOAL,
  GOAL_CLOSE_TARGET,
  GOAL_MOTIONS,
  MOTION_DEFAULT_GOAL,
  type GoalKey,
  type GoalSource,
  type IntentState,
  type NbaAction,
  type ResolvedGoal,
} from "./types.ts";
import type { ConversionGoalType } from "../business-profile/types.ts";
import type { HandoverReason } from "../agent/types.ts";
import type { ConversationStage } from "../sales-library/method-router.ts";
import type { SalesMotion } from "../sales-library/types.ts";

export type GoalResolutionInput = {
  /** The offer's (or workspace's) resolved motion. */
  motion: SalesMotion;
  lead?: { conversionGoalType: ConversionGoalType | null; qualificationRequired?: boolean | null } | null;
  offerGoal?: GoalKey | null;
  policyGoal?: GoalKey | null;
  workspaceDefaultGoal?: { type: ConversionGoalType; qualificationRequired: boolean } | null;
  /** State overrides. */
  engineVerdict?: "PENDING" | "QUALIFIED" | "NOT_QUALIFIED" | "REVIEW" | null;
  confirmedDisqualifier?: boolean;
  intentState?: IntentState | null;
  dealValueGbp?: number | null;
  humanCloserAboveValue?: number | null;
};

/** A conversion goal type -> goal, applying the qualification_required rule (CD-16). */
export function goalForConversionType(type: ConversionGoalType, qualificationRequired: boolean | null | undefined): GoalKey {
  const mapped = CONVERSION_GOAL_TO_GOAL[type];
  if (mapped === "A_QUALIFY_ONLY" && qualificationRequired === false) return "E_HUMAN_CLOSER";
  return mapped;
}

/** Resolves the lead's goal. Deterministic and total. */
export function resolveGoal(input: GoalResolutionInput): ResolvedGoal {
  const withMotion = (goal: GoalKey, source: GoalSource): ResolvedGoal => ({ goal, source, motion: goalMotion(goal, input.motion) });

  if (input.engineVerdict === "NOT_QUALIFIED" || input.confirmedDisqualifier) return withMotion("G_DISQUALIFY", "STATE");
  if (input.intentState === "NOT_NOW") return withMotion("F_NURTURE", "STATE");

  let resolved: ResolvedGoal;
  if (input.lead?.conversionGoalType) {
    resolved = withMotion(goalForConversionType(input.lead.conversionGoalType, input.lead.qualificationRequired), "LEAD_CONVERSION_GOAL");
  } else if (input.offerGoal) {
    resolved = withMotion(input.offerGoal, "OFFER_PROFILE");
  } else if (input.policyGoal) {
    resolved = withMotion(input.policyGoal, "WORKSPACE_POLICY");
  } else if (input.workspaceDefaultGoal) {
    resolved = withMotion(
      goalForConversionType(input.workspaceDefaultGoal.type, input.workspaceDefaultGoal.qualificationRequired),
      "WORKSPACE_DEFAULT_GOAL",
    );
  } else {
    resolved = withMotion(MOTION_DEFAULT_GOAL[input.motion], "MOTION");
  }

  const threshold = input.humanCloserAboveValue;
  if (
    typeof threshold === "number" &&
    typeof input.dealValueGbp === "number" &&
    input.dealValueGbp > threshold &&
    (resolved.goal === "B_BOOK_MEETING" || resolved.goal === "C_DIRECT_SALE" || resolved.goal === "D_SIGNUP_TRIAL")
  ) {
    return { goal: "E_HUMAN_CLOSER", source: "STATE", motion: resolved.motion };
  }
  return resolved;
}

/**
 * The motion a goal runs under: the workspace's own when the goal is designed
 * for it (or for any motion), otherwise the goal's first designed motion. A
 * lead whose goal is a direct sale is not qualified with a meeting threshold.
 */
export function goalMotion(goal: GoalKey, workspaceMotion: SalesMotion): SalesMotion {
  const designed = GOAL_MOTIONS[goal];
  if (designed.length === 0 || designed.includes(workspaceMotion)) return workspaceMotion;
  return designed[0];
}

/** Rule R10: the action a goal closes with once its threshold is met. */
export function goalCloseAction(goal: GoalKey): { action: NbaAction; handoverReason: HandoverReason | null } {
  switch (goal) {
    case "A_QUALIFY_ONLY":
      return { action: "ESCALATE", handoverReason: "POLICY" };
    case "B_BOOK_MEETING":
      return { action: "CTA_BOOK", handoverReason: null };
    case "C_DIRECT_SALE":
      return { action: "CTA_CHECKOUT", handoverReason: null };
    case "D_SIGNUP_TRIAL":
      return { action: "CTA_SIGNUP", handoverReason: null };
    case "E_HUMAN_CLOSER":
      // Owner decision 2026-09-27: a person closes, and the AI books the
      // meeting with them. The meeting (with its hand-off brief) is the
      // hand-off; the conversation is not taken from the AI before it.
      return { action: "CTA_BOOK", handoverReason: null };
    case "F_NURTURE":
      return { action: "NURTURE", handoverReason: null };
    case "G_DISQUALIFY":
      return { action: "DISQUALIFY", handoverReason: null };
  }
}

/** The agent tools each goal's close uses (§B.10 "Close target / tool"). Names match agent/tools.ts. */
export const GOAL_AGENT_TOOLS: Record<GoalKey, readonly string[]> = {
  A_QUALIFY_ONLY: ["request_human_handover"],
  B_BOOK_MEETING: ["get_calendar_availability", "send_booking_link", "create_booking"],
  C_DIRECT_SALE: ["send_message"],
  D_SIGNUP_TRIAL: ["send_message"],
  E_HUMAN_CLOSER: ["get_calendar_availability", "send_booking_link", "create_booking"],
  F_NURTURE: ["send_message"],
  G_DISQUALIFY: ["stop_follow_up"],
};

/** opportunities.close_target for a goal (null = no close). */
export function goalCloseTarget(goal: GoalKey) {
  return GOAL_CLOSE_TARGET[goal];
}

/* ------------------------------------------------------------------ stage */

const STAGE_ORDER: readonly ConversationStage[] = ["NEW", "ENGAGED", "QUALIFYING", "OBJECTION", "CLOSING", "POST_BOOKING"];

export function stageRank(stage: ConversationStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function stageAtLeast(stage: ConversationStage, floor: ConversationStage): boolean {
  return stageRank(stage) >= stageRank(floor);
}

/**
 * The real conversation stage from the lead's own state (defect F2: the stage
 * was binary NEW / QUALIFYING). An explicit agent-mode stage, when the caller
 * has one (strategy.ts stageForMode), wins.
 */
export function deriveConversationStage(input: {
  leadStatus?: string | null;
  firstRepliedAt?: string | null;
  answeredCount?: number;
  bookingScheduled?: boolean;
  lastReplyObjection?: boolean;
  thresholdMet?: boolean;
  explicit?: ConversationStage | null;
}): ConversationStage {
  if (input.explicit) return input.explicit;
  if (input.bookingScheduled || input.leadStatus === "BOOKED" || input.leadStatus === "WON") return "POST_BOOKING";
  if (!input.firstRepliedAt) return "NEW";
  if (input.lastReplyObjection) return "OBJECTION";
  if (input.thresholdMet || input.leadStatus === "QUALIFIED") return "CLOSING";
  if ((input.answeredCount ?? 0) > 0) return "QUALIFYING";
  return "ENGAGED";
}
