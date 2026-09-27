/**
 * Golden-conversation eval format (Phase 4, brief §§91-95).
 *
 * One JSON file per case in tests/evals/cases/. Each case is a short
 * conversation ending on the lead's latest message, plus what the product must
 * do with it. `tests/agent-evals.test.ts` runs the deterministic parts today
 * (classification, the tool gate, the outbound validator); the `live` block is
 * scored only when EVAL_LIVE=1 and a live runner is wired (live-hook.ts).
 */

import type { SalesMotion } from "../../src/lib/sales-library/types.ts";
import type { AgentChannel, LeadIntent, RiskLevel } from "../../src/lib/agent/types.ts";
import type { ValidationCode } from "../../src/lib/agent/validate.ts";
import type { AgentMode } from "../../src/lib/agent/types.ts";
import type { ObjectionKey } from "../../src/lib/sales-library/types.ts";
import type { CloseRoute } from "../../src/lib/agent/closing.ts";

export type EvalTurn = { role: "agent" | "lead"; text: string };

export type EvalToolGate = {
  /** The tool as named in agent/tools.ts, for the report only. */
  tool: string;
  riskLevel: RiskLevel;
  confidence?: number | null;
  requirements: {
    requiresContactability?: boolean;
    requiresConfirmedAvailability?: boolean;
    requiresQualifiedState?: boolean;
    requiresRecognisedOptOut?: boolean;
    requiresBookingEnabled?: boolean;
  };
  allowed: boolean;
};

export type EvalCandidate = {
  /** A reply a model might produce. */
  text: string;
  valid: boolean;
  /** Codes that must be among the failures when `valid` is false. */
  codes?: ValidationCode[];
  /** True when this candidate asks a question the agent already asked. */
  repeatsQuestion?: boolean;
  /** A known product gap: reported as a todo rather than failing the run. */
  knownGap?: string;
  /** An accepted reply must also grade at least this on the reply grader (reply-grader.ts). */
  gradeAtLeast?: number;
};

export type EvalCase = {
  id: string;
  /** Which brief section this exercises, e.g. "§92 unsubscribe mid-flow". */
  scenario: string;
  motion: SalesMotion;
  channel: AgentChannel;
  turns: EvalTurn[];
  /** Workspace facts the validator runs against. Defaults: nothing published. */
  facts?: {
    publishedPriceText?: string[];
    confirmedSlots?: string[];
    allowedUrls?: string[];
    bookingConfirmed?: boolean;
    serviceAreaConfirmed?: boolean;
    contactable?: boolean;
    bookingEnabled?: boolean;
    availabilityConfirmed?: boolean;
    lifecycle?: string;
    /** Workspace prohibited claims (voice profile), linted on every candidate. */
    prohibitedClaims?: string[];
  };
  /**
   * The business's own objections and reassurance, as stored rows
   * (workspace_sales_overrides kind OBJECTION, workspace-objections.ts).
   */
  workspaceObjections?: { key: string; payload: unknown }[];
  /** Approved claims and reassurance available this turn (the reply grader's GROUNDED check). */
  approvedClaims?: string[];
  expectations: {
    /** Binding deterministic verdict on the last lead turn; null = none. */
    deterministic: { intent: LeadIntent; binding: true } | null;
    /** Non-binding heuristic hint, when one is expected. */
    heuristic?: { intent: LeadIntent } | null;
    injectionDetected?: boolean;
    /** The objection playbook the last lead turn loads (matchObjection); null = none. */
    objection?: ObjectionKey | null;
    /** The per-turn strategy block for the last lead turn (strategy.ts). */
    strategy?: {
      mode: AgentMode;
      bookingRoute?: CloseRoute;
      callRequested?: boolean;
      mustInclude: string[];
      mustExclude?: string[];
    };
    toolGates?: EvalToolGate[];
    candidates?: EvalCandidate[];
    /** Scored only in live mode. */
    live?: {
      mustHandOver?: boolean;
      mustNotContain?: string[];
      maxQuestions?: number;
    };
  };
};
