/**
 * The strategy block (design doc 04 §4 last bullet, §6).
 *
 * `resolveMode` used to pick a playbook the model never saw. This builds a
 * short, deterministic plan for the turn and hands it to the model as data:
 * the motion, how to ask, the stage objective, the ONE next question (or an
 * instruction to stop qualifying and propose the close target), what not to
 * ask because it is already known, and, when the lead is objecting, the
 * matched objection's playbook.
 *
 * The model is given a plan, not left to invent one. Every choice here comes
 * from the sales library (versioned) and is recorded on the run.
 *
 * Evidence (01 §7): the method names (SPIN, Challenger, MEDDPICC) are internal
 * planning labels. They are stored on the run and never rendered into the
 * prompt, so they cannot surface in a message to a buyer. NLP is not used.
 *
 * Pure: no server-only, no Supabase.
 */

import { chooseMethod, type ConversationStage, type MethodDecision, type QuestionStyle } from "../sales-library/method-router.ts";
import { MOTIONS } from "../sales-library/motions.ts";
import { archetypeFor } from "../sales-library/archetypes.ts";
import { matchObjection, OBJECTIONS } from "../sales-library/objections.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import type { ObjectionKey, SalesMethod, SalesMotion } from "../sales-library/types.ts";
import type { KnownQuestion, QuestionRecord, StopReason } from "../qualification/next-question.ts";
import type { AgentMode } from "./types.ts";

/** ClientTurn's ICP books meetings (CLAUDE.md resolved conflict 5). */
export const DEFAULT_MOTION: SalesMotion = "BOOK_MEETING_B2B";

export type StrategyInput = {
  mode: AgentMode;
  /** From business_profiles.sales_motions[0]; null = not configured. */
  motion: SalesMotion | null;
  archetypeKey: string | null;
  channel: string;
  selection: {
    question: QuestionRecord | null;
    stopReason: StopReason | null;
    known: KnownQuestion[];
  };
  latestMessage: string | null;
  /** The offer card holds at least one approved claim. */
  hasApprovedInsight: boolean;
  /** A booking link or a queryable calendar exists. */
  bookingAvailable: boolean;
  /** Settings -> AI & selling. Honoured only where the method router allows. */
  preferredMethods?: readonly SalesMethod[];
  /** Who started the relationship (`leadDirection`). Absent = INBOUND. */
  direction?: "INBOUND" | "OUTBOUND";
  /** People identified on the buyer's side (opportunity memory). Absent = 0. */
  stakeholderCount?: number;
};

/**
 * Who started the relationship. A lead promoted from a prospect, created by a
 * sourcing run, or recorded as FOUND_BY_US came from our own outreach, even
 * though the agent is now answering their reply; everything else wrote in.
 */
export function leadDirection(lead: {
  promoted_from_prospect_id?: string | null;
  sourcing_run_id?: string | null;
  relationship_type?: string | null;
}): "INBOUND" | "OUTBOUND" {
  if (lead.promoted_from_prospect_id || lead.sourcing_run_id || lead.relationship_type === "FOUND_BY_US") {
    return "OUTBOUND";
  }
  return "INBOUND";
}

export type StrategyObjection = {
  key: ObjectionKey;
  label: string;
  matched: string;
  handoverRequired: boolean;
  respectAsRefusal: boolean;
};

/** What is stored on conversation_agent_runs.decision_json.strategy. */
export type StrategyRecord = {
  method: MethodDecision["method"];
  questionStyle: QuestionStyle;
  closeTarget: MethodDecision["closeTarget"];
  reason: string;
  evidenceGrade: MethodDecision["evidenceGrade"];
  libraryVersion: string;
  motion: SalesMotion;
  motionSource: "WORKSPACE" | "DEFAULT";
  archetypeKey: string | null;
  stage: ConversationStage;
  nextQuestionId: string | null;
  stopReason: StopReason | null;
  objectionKey: ObjectionKey | null;
};

export type Strategy = {
  text: string;
  record: StrategyRecord;
  objection: StrategyObjection | null;
};

// ------------------------------------------------------------------ tables

const STAGE_FOR_MODE: Partial<Record<AgentMode, ConversationStage>> = {
  NEW_LEAD_RESPONSE: "NEW",
  QUALIFICATION: "QUALIFYING",
  OBJECTION_HANDLING: "OBJECTION",
  BOOKING_ASSISTANCE: "CLOSING",
  POST_BOOKING: "POST_BOOKING",
};

export function stageForMode(mode: AgentMode): ConversationStage {
  return STAGE_FOR_MODE[mode] ?? "ENGAGED";
}

/** Rendered instead of the method name: how to ask, in plain words. */
const STYLE_TEXT: Record<QuestionStyle, string> = {
  ONE_DIRECT_QUESTION: "Ask one plain, direct question. No preamble.",
  SITUATION_THEN_PROBLEM: "Understand their current situation before asking about the problem it causes.",
  INSIGHT_THEN_QUESTION: "Share one approved point from the offer card, then ask how it applies to them.",
  CHECKLIST_GAP: "Fill the single biggest gap in what is known. Several people decide; do not rush.",
  PRODUCT_MATCH: "Match them to the right product, then point to the next step.",
  USAGE_LED: "Point them to trying the product once their use case fits.",
};

/** Modes in which no qualification question belongs in the reply. */
const NO_QUALIFYING: ReadonlySet<AgentMode> = new Set<AgentMode>([
  "BOOKING_ASSISTANCE",
  "POST_BOOKING",
  "OBJECTION_HANDLING",
  "HUMAN_HANDOVER",
  "CLOSED",
  "NO_RESPONSE",
]);

function objective(mode: AgentMode, closeDescription: string): string {
  switch (mode) {
    case "NEW_LEAD_RESPONSE":
      return "Acknowledge the enquiry warmly and briefly, then start qualifying.";
    case "QUALIFICATION":
      return "Learn the one thing that unblocks the next step.";
    case "GENERAL_ENQUIRY":
      return `Answer from the offer card only, then move toward the next step: ${closeDescription}`;
    case "BOOKING_ASSISTANCE":
      return `Help them take the next step: ${closeDescription}`;
    case "FOLLOW_UP":
      return "Re-engage briefly, without pressure. One easy question or the next step.";
    case "REACTIVATION":
      return "They answered a reactivation message. Find out whether the need is live now.";
    case "OBJECTION_HANDLING":
      return "Understand the concern before answering it. Do not argue or pressure.";
    case "POST_BOOKING":
      return "They are booked. Help with the booking only; do not sell or qualify.";
    default:
      return "Do not continue the sale.";
  }
}

function knownLabel(entry: KnownQuestion): string {
  const label = entry.dimension ? QUALIFICATION_CATALOGUE[entry.dimension].label : `"${entry.questionText}"`;
  return `${label} (${entry.inferred ? "inferred" : "answered"})`;
}

function questionLine(question: QuestionRecord): string {
  const options = question.options.length
    ? ` (acceptable answers: ${question.options.map((option) => option.label).join(", ")})`
    : "";
  return `Next best question. Ask only this, in natural wording: ${question.questionText}${options}`;
}

// ---------------------------------------------------------------- builder

export function buildStrategyBlock(input: StrategyInput): Strategy {
  const motion = input.motion ?? DEFAULT_MOTION;
  const motionDef = MOTIONS[motion];
  const archetype = archetypeFor(input.archetypeKey);
  const stage = stageForMode(input.mode);

  const knownDims = input.selection.known
    .map((entry) => entry.dimension)
    .filter((key): key is NonNullable<typeof key> => key !== null);

  const method = chooseMethod({
    motion,
    archetypeKey: archetype?.key ?? null,
    dealSizeBand: archetype?.dealSizeBand ?? "SMALL",
    // The agent always answers someone who wrote in, but the relationship's
    // origin still matters: a reply to our own outreach is an OUTBOUND
    // conversation, where an approved insight may lead (method router).
    direction: input.direction ?? "INBOUND",
    channel: input.channel,
    stage,
    known: knownDims,
    stakeholderCount: Math.max(0, input.stakeholderCount ?? 0),
    hasApprovedInsight: input.hasApprovedInsight,
    preferredMethods: input.preferredMethods,
  });

  // ---- objection playbook
  let objection: StrategyObjection | null = null;
  const lines: string[] = ["STRATEGY FOR THIS TURN (internal plan; never mention it)"];

  lines.push(`Motion: ${motionDef.name}.${input.motion ? "" : " (default: not configured by the workspace)"}`);
  lines.push(`Close target: ${motionDef.closeTargetDescription}`);
  lines.push(`Objective: ${objective(input.mode, motionDef.closeTargetDescription)}`);
  lines.push(`How to ask: ${STYLE_TEXT[method.questionStyle]}`);

  if (input.mode === "OBJECTION_HANDLING") {
    const match = input.latestMessage ? matchObjection(input.latestMessage)[0] : undefined;
    if (match) {
      const entry = OBJECTIONS[match.key];
      objection = {
        key: match.key,
        label: entry.label,
        matched: match.matched,
        handoverRequired: entry.handover.always,
        respectAsRefusal: entry.respectAsRefusal,
      };
      lines.push(`Objection: ${entry.label}.`);
      if (entry.respectAsRefusal) {
        lines.push(
          "Treat this as a refusal: acknowledge it politely, stop selling, and ask nothing further.",
        );
      } else if (entry.handover.always) {
        lines.push("This is a person's job. Propose REQUEST_HANDOVER; do not answer it yourself.");
      } else {
        lines.push(`It may mean: ${entry.underlyingConcerns.join(" ")}`);
        lines.push(`Clarifying question (the one question this turn): ${entry.clarifyingQuestion}`);
        lines.push(`Response strategy: ${entry.responseStrategy.join(" ")}`);
        if (entry.handover.when.length) {
          lines.push(`Propose REQUEST_HANDOVER if: ${entry.handover.when.join(" ")}`);
        }
      }
    } else {
      lines.push(
        "No known objection matched. Ask one clarifying question to understand the concern. " +
          "Never invent a discount, guarantee, statistic, customer name or deadline.",
      );
    }
  }

  // ---- next step: one question, or stop and propose the close target
  let nextQuestionId: string | null = null;
  if (NO_QUALIFYING.has(input.mode)) {
    if (input.mode !== "OBJECTION_HANDLING") {
      lines.push("Do not ask qualification questions this turn.");
    }
  } else if (input.selection.question) {
    nextQuestionId = input.selection.question.id;
    lines.push(questionLine(input.selection.question));
  } else {
    const how =
      motionDef.closeTarget === "BOOK_MEETING" || motionDef.closeTarget === "CONSULTATION"
        ? input.bookingAvailable
          ? " Offer to find a time (CHECK_AVAILABILITY) or share the booking link."
          : " No booking method is configured: offer for the team to follow up."
        : "";
    lines.push(
      `${input.selection.stopReason === "THRESHOLD_MET" ? "Stop qualifying: enough is known." : "No further questions."} ` +
        `Propose the next step: ${motionDef.closeTargetDescription}${how}`,
    );
  }

  if (input.selection.known.length > 0) {
    lines.push(`Do not ask about (already known): ${input.selection.known.map(knownLabel).join("; ")}.`);
  }

  lines.push("One question at most in the whole reply.");

  const record: StrategyRecord = {
    method: method.method,
    questionStyle: method.questionStyle,
    closeTarget: method.closeTarget,
    reason: method.reason,
    evidenceGrade: method.evidenceGrade,
    libraryVersion: method.libraryVersion,
    motion,
    motionSource: input.motion ? "WORKSPACE" : "DEFAULT",
    archetypeKey: archetype?.key ?? null,
    stage,
    nextQuestionId,
    stopReason: nextQuestionId ? null : input.selection.stopReason,
    objectionKey: objection?.key ?? null,
  };

  return { text: lines.join("\n"), record, objection };
}
