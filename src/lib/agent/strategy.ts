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
import { objectionGoalFor, pickResponsePattern, renderResponsePattern } from "../sales-library/objection-responses.ts";
import {
  matchWorkspaceObjection,
  renderWorkspaceObjection,
  type WorkspaceObjectionSet,
} from "../sales-library/workspace-objections.ts";
import { closeLine, detectBuyingSignal, TRIAL_CLOSE_LINE, type CloseRoute } from "./closing.ts";
import { CHANNEL_PREFERENCE_LINE } from "./channel-preference.ts";
import { ASK_CRAFT_LINE, askCraftLine, craftedAsk } from "./question-craft.ts";
import { QUALIFICATION_CATALOGUE } from "../sales-library/qualification-dimensions.ts";
import type { ObjectionKey, SalesMethod, SalesMotion } from "../sales-library/types.ts";
import type { KnownQuestion, QuestionRecord, StopReason } from "../qualification/next-question.ts";
import type { AgentMode, AssistReason } from "./types.ts";
import {
  GOAL_LABEL,
  NBA_STRATEGY_BLOCK_MAX_TOKENS,
  UNMAPPED_DIMENSION,
  type NextBestAction,
} from "../qualification-intelligence/types.ts";

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
  /**
   * Manual booking mode (story H3): no calendar and no link, so a booking is a
   * pending request for the lead's own time, confirmed by a person.
   */
  manualBooking?: boolean;
  /** Settings -> AI & selling. Honoured only where the method router allows. */
  preferredMethods?: readonly SalesMethod[];
  /** Who started the relationship (`leadDirection`). Absent = INBOUND. */
  direction?: "INBOUND" | "OUTBOUND";
  /** People identified on the buyer's side (opportunity memory). Absent = 0. */
  stakeholderCount?: number;
  /**
   * The business's own objections and reassurance (Settings -> AI & selling
   * -> Objections). Preferred over the generic playbook; paraphrased, never
   * added to.
   */
  workspaceObjections?: WorkspaceObjectionSet;
  /** The lead raised this objection before in the conversation (reframe, do not re-clarify). */
  objectionSeenBefore?: boolean;
  /** The lead asked for a phone call and a booking route exists: a warm close (closing.ts). */
  callRequested?: boolean;
  /** How a booking close is taken this turn, when the orchestrator knows. */
  bookingRoute?: CloseRoute;
  /** The orchestrator judged this the one turn to ask the channel question (channel-preference.ts). */
  askChannelPreference?: boolean;
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
  /** A legal or contract question anywhere in the message: a person takes it. */
  handoverRequired: boolean;
  /** Security or procurement: a colleague provides it in the background; the AI keeps going. */
  assistRequired: boolean;
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
  /** The response pattern used for the objection (objection-responses.ts). */
  objectionPattern?: string | null;
  /** The business's own objection answered this turn: its row key. */
  workspaceObjectionKey?: string | null;
  /** A buying signal skipped an optional question for a trial close. */
  trialClose?: boolean;
  /** The lead asked for a call and was offered one (closing.ts). */
  callClose?: boolean;
  /** The channel-preference question was planned this turn. */
  channelPreferenceAsked?: boolean;
  /**
   * Set when the qualification engine planned the turn (engine LIVE): the
   * question intent the NBA chose, and the NBA action. The strategy and the
   * NBA are one source of truth: `nextQuestionId` is the NBA's
   * `question_intent.question_id` and nothing else (design 08 §C.5).
   */
  questionIntentKey?: string | null;
  nbaAction?: NextBestAction["next_action"] | null;
};

export type Strategy = {
  text: string;
  record: StrategyRecord;
  objection: StrategyObjection | null;
  /**
   * The objection lines an engine-planned turn reuses: the response shape and
   * the business's own answer, when there is one. Empty otherwise.
   */
  objectionLines?: string[];
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
  let objectionPattern: string | null = null;
  const objectionLines: string[] = [];
  const lines: string[] = ["STRATEGY FOR THIS TURN (internal plan; never mention it)"];

  lines.push(`Motion: ${motionDef.name}.${input.motion ? "" : " (default: not configured by the workspace)"}`);
  lines.push(`Close target: ${motionDef.closeTargetDescription}`);
  lines.push(`Objective: ${objective(input.mode, motionDef.closeTargetDescription)}`);
  lines.push(`How to ask: ${STYLE_TEXT[method.questionStyle]}`);

  if (input.mode === "OBJECTION_HANDLING") {
    const matches = input.latestMessage ? matchObjection(input.latestMessage) : [];
    const match = matches[0];
    if (match) {
      const entry = OBJECTIONS[match.key];
      // Owner decision 2026-09-27: only a legal or contract question hands
      // over, wherever it sits in the message; a security or procurement step
      // is provided by a colleague while the conversation stays with the AI.
      const handoverRequired = matches.some((m) => m.handoverRequired);
      objection = {
        key: match.key,
        label: entry.label,
        matched: match.matched,
        handoverRequired,
        assistRequired: !handoverRequired && match.assistRequired,
        respectAsRefusal: entry.respectAsRefusal,
      };
      lines.push(`Objection: ${entry.label}.`);
      if (entry.respectAsRefusal) {
        lines.push(
          "Treat this as a refusal: acknowledge it politely, stop selling, and ask nothing further.",
        );
      } else if (handoverRequired) {
        lines.push("This is a person's job. Propose REQUEST_HANDOVER; do not answer it yourself.");
      } else if (match.assistRequired) {
        lines.push(
          "A colleague has been asked to send the approved information for this. Say so in one short clause, " +
            "promise nothing about it (no certificate, document or date), then carry on with the plan. The conversation stays with you.",
        );
        lines.push(`Response strategy: ${entry.responseStrategy.join(" ")}`);
      } else {
        const repeat = input.objectionSeenBefore === true;
        const pattern = pickResponsePattern(match.key, { seenBefore: repeat, text: input.latestMessage });
        objectionPattern = pattern.name;
        // The next step is the motion's own (objection matrix pass): a
        // direct-sale or trial lead is never steered back to a meeting.
        const shape = renderResponsePattern(pattern, { goal: objectionGoalFor(motionDef.closeTarget), repeat });
        lines.push(`It may mean: ${entry.underlyingConcerns.join(" ")}`);
        lines.push(shape);
        objectionLines.push(`Objection: ${entry.label}. ${shape}`);
        if (pattern.clarify) lines.push(`Clarifying question (the one question this turn): ${entry.clarifyingQuestion}`);
        lines.push(`Response strategy: ${entry.responseStrategy.join(" ")}`);
        if (entry.handover.when.length) {
          lines.push(`Propose REQUEST_HANDOVER with handover_reason POLICY if: ${entry.handover.when.join(" ")}`);
        }
        if (entry.assist?.when.length) {
          lines.push(
            `If ${entry.assist.when.join(" ").replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}: say a colleague will confirm that detail ` +
              "(REQUEST_HANDOVER with handover_reason OUT_OF_SCOPE and your message), and carry on. The conversation stays with you.",
          );
        }
      }
    } else {
      lines.push(
        "No known objection matched. Ask one clarifying question to understand the concern. " +
          "Never invent a discount, guarantee, statistic, customer name or deadline.",
      );
    }
  }

  // The business's own answer (elite-closer brief): its phrases match in any
  // mode; its refinement of a library objection only while handling one.
  // Never on a refusal or a matter a person must answer.
  const libraryKeys = input.mode === "OBJECTION_HANDLING" && objection && !objection.respectAsRefusal && !objection.handoverRequired
    ? [objection.key]
    : [];
  const workspaceMatch =
    input.workspaceObjections && input.latestMessage && !objection?.respectAsRefusal && !objection?.handoverRequired
      ? matchWorkspaceObjection(input.latestMessage, input.workspaceObjections, libraryKeys)
      : null;
  if (workspaceMatch) {
    lines.push(...renderWorkspaceObjection(workspaceMatch));
    objectionLines.push(...renderWorkspaceObjection(workspaceMatch));
  }

  // A security or procurement step outside objection handling: a colleague
  // sends it and the conversation stays with the assistant (owner decision
  // 2026-09-27). Only rendered when the lead's words match, so no other turn
  // pays for the line.
  if (input.mode !== "OBJECTION_HANDLING" && input.latestMessage && matchObjection(input.latestMessage).some((m) => m.assistRequired)) {
    lines.push(
      "If they need security documents or procurement steps, a colleague sends them: say so in one short clause, " +
        "promise nothing about them, and carry on (REQUEST_HANDOVER with handover_reason OUT_OF_SCOPE and your message).",
    );
  }

  // ---- next step: one question, or stop and propose the close target
  let nextQuestionId: string | null = null;
  const route: CloseRoute =
    input.bookingRoute ?? (input.bookingAvailable ? "SLOTS" : input.manualBooking ? "ASK_PREFERRED_TIME" : "TEAM_FOLLOW_UP");
  const callClose = input.callRequested === true && route !== "TEAM_FOLLOW_UP";
  // A ready buyer is never over-qualified: an optional question gives way to
  // a trial close. A required question is still asked.
  const trialClose =
    !NO_QUALIFYING.has(input.mode) &&
    Boolean(input.selection.question && !input.selection.question.required) &&
    detectBuyingSignal(input.latestMessage);
  let channelPreferenceAsked = false;
  if (callClose) {
    // Name the tool as well as the wording (see buildNbaStrategyBlock).
    lines.push(`Stop qualifying: they asked for a call. ${LEGACY_CALL_ACTION[route]}`);
    lines.push(closeLine(motionDef.closeTarget, route, { callRequested: true }));
  } else if (NO_QUALIFYING.has(input.mode)) {
    if (input.mode !== "OBJECTION_HANDLING") {
      lines.push("Do not ask qualification questions this turn.");
    }
    if (input.mode === "BOOKING_ASSISTANCE") lines.push(closeLine(motionDef.closeTarget, route));
  } else if (trialClose) {
    lines.push(`${TRIAL_CLOSE_LINE} ${closeLine(motionDef.closeTarget, route)}`);
  } else if (input.selection.question) {
    nextQuestionId = input.selection.question.id;
    lines.push(questionLine(input.selection.question));
    // Its own line, never appended to the question: an instruction must not
    // be read as part of the words to ask (question-craft.ts).
    lines.push(ASK_CRAFT_LINE);
  } else {
    // BUSINESS_CASE (ENTERPRISE) closes on a meeting with the person who
    // builds it: the meeting is the hand-off (owner decision 2026-09-27).
    const how =
      motionDef.closeTarget === "BOOK_MEETING" ||
      motionDef.closeTarget === "CONSULTATION" ||
      motionDef.closeTarget === "BUSINESS_CASE"
        ? input.bookingAvailable
          ? " Offer to find a time (CHECK_AVAILABILITY) or share the booking link."
          : input.manualBooking
            ? " Offer to arrange a time: propose CHECK_AVAILABILITY and the system will ask which day and time suits them."
            : " No booking method is configured: offer for the team to follow up."
        : "";
    lines.push(
      `${input.selection.stopReason === "THRESHOLD_MET" ? "Stop qualifying: enough is known." : "No further questions."} ` +
        `Propose the next step: ${motionDef.closeTargetDescription}${how}`,
    );
    // How to phrase the close for the motion's goal (closing.ts). The line
    // above says which tool; this one says how a good closer words it.
    if (!how || route !== "TEAM_FOLLOW_UP") lines.push(closeLine(motionDef.closeTarget, route));
  }
  // The channel question: only on a turn that asks nothing else, never the
  // first question and never twice (the orchestrator decides eligibility).
  if (input.askChannelPreference && !nextQuestionId && !trialClose && !callClose && !objection && input.mode !== "BOOKING_ASSISTANCE") {
    lines.push(CHANNEL_PREFERENCE_LINE);
    channelPreferenceAsked = true;
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
    objectionPattern,
    workspaceObjectionKey: workspaceMatch?.objection.key ?? null,
    trialClose,
    callClose,
    channelPreferenceAsked,
  };

  return { text: lines.join("\n"), record, objection, objectionLines };
}

/** The booking tool a call close uses on each route (the legacy block). */
const LEGACY_CALL_ACTION: Record<CloseRoute, string> = {
  SLOTS: "Offer times: SEND_BOOKING_OPTIONS when confirmed times are shown, otherwise CHECK_AVAILABILITY.",
  LINK: "Share the booking link.",
  ASK_PREFERRED_TIME: "Propose CHECK_AVAILABILITY; the system asks which day and time suits them.",
  TEAM_FOLLOW_UP: "Say the team will be in touch.",
};

// --------------------------------------------------- engine-planned turns

/** How a booking CTA can be taken this turn (the orchestrator decides). */
export type NbaBookingRoute = "SLOTS" | "LINK" | "ASK_PREFERRED_TIME" | "TEAM_FOLLOW_UP";

const DIMENSION_WORDS = (dimension: string): string =>
  dimension === UNMAPPED_DIMENSION
    ? "a configured question"
    : (QUALIFICATION_CATALOGUE as Record<string, { label: string } | undefined>)[dimension]?.label.toLowerCase() ??
      dimension.toLowerCase().replace(/_/g, " ");

/**
 * The strategy block when the qualification engine planned the turn
 * (engine LIVE, design 08 §B.9, §B.16).
 *
 * Rendered from the structured NBA only, never from the conversation history,
 * and held under NBA_STRATEGY_BLOCK_MAX_TOKENS: the NBA has already decided
 * what to do, so the model is told the one move and the one question (or that
 * there is none) in plain words. What is known is summarised by dimension,
 * not by question text. Method names still never reach the prompt.
 */
export function buildNbaStrategyBlock(
  input: StrategyInput,
  nba: NextBestAction,
  options: {
    booking: NbaBookingRoute;
    /** A lead with several interests: which offer the move is for, and the one light touch (interests.ts). */
    interestLines?: readonly string[];
  },
): Strategy {
  const legacy = buildStrategyBlock({ ...input, selection: { question: null, stopReason: null, known: [] } });
  const question = nba.question_intent;
  const lines: string[] = [
    "STRATEGY FOR THIS TURN (internal plan; never mention it)",
    `Goal: ${GOAL_LABEL[nba.current_goal]}.`,
    ...(options.interestLines ?? []),
  ];

  const ask = question ? craftedAsk(question.rendering) : null;
  const motionTarget = MOTIONS[input.motion ?? DEFAULT_MOTION].closeTarget;
  const route: CloseRoute = options.booking;
  // A call request is a warm close (closing.ts): offered as bookable call
  // times whatever the plan was, unless nothing can be booked.
  const callClose = input.callRequested === true && route !== "TEAM_FOLLOW_UP" && !nba.handover_reason;
  if (callClose) {
    // The move names the booking tool, as CTA_BOOK's does: without it the
    // model is told how to word a close it has no way to take (the slots
    // were fetched, but SEND_BOOKING_OPTIONS was never proposed).
    lines.push(`Move: stop qualifying and propose a meeting: ${nbaBookingHow(route)}.`);
    lines.push(closeLine(motionTarget === "BUSINESS_CASE" ? "BUSINESS_CASE" : "BOOK_MEETING", route, { callRequested: true }));
  } else switch (nba.next_action) {
    case "ASK":
      lines.push(`Move: acknowledge briefly, then ${ask}`);
      if (question) lines.push(askCraftLine(question.key));
      break;
    case "ANSWER_AND_ASK":
      lines.push(`Move: answer their question from the offer card first, then ${ask}`);
      if (question) lines.push(askCraftLine(question.key));
      break;
    case "ANSWER":
      lines.push("Move: answer their question from the offer card only. Ask no qualifying question.");
      break;
    case "INFORM":
      lines.push("Move: share one useful point from the offer card and a gentle next step. Ask no qualifying question.");
      break;
    case "NURTURE":
      lines.push("Move: re-engage briefly with one useful point. No pressure. Ask no qualifying question.");
      break;
    case "CTA_BOOK": {
      lines.push(`Move: stop qualifying and propose a meeting: ${nbaBookingHow(options.booking)}.`);
      if (question) lines.push(`Before that, ${ask}`);
      else lines.push(closeLine(motionTarget === "BUSINESS_CASE" ? "BUSINESS_CASE" : "BOOK_MEETING", route));
      break;
    }
    case "CTA_CHECKOUT":
    case "CTA_SIGNUP":
      lines.push("Move: stop qualifying. They are ready: propose PROPOSE_CHECKOUT with the approved link.");
      lines.push(closeLine(nba.next_action === "CTA_SIGNUP" ? "TRIAL_OR_SIGNUP" : "CHECKOUT", route));
      break;
    default:
      lines.push("Move: no sales reply this turn.");
  }

  // A background task a person was asked to do this turn (owner decision
  // 2026-09-27): the lead hears that a colleague will confirm it, and the
  // conversation carries on.
  const assist = nba.assist_reason ? ASSIST_MOVE[nba.assist_reason] : null;
  if (assist) lines.push(assist);
  // The objection shape and the business's own answer (elite-closer brief).
  if (!callClose && legacy.objectionLines?.length) lines.push(...legacy.objectionLines);
  // The channel question, once, only on a turn that asks nothing else.
  const channelPreferenceAsked =
    input.askChannelPreference === true && !question && !callClose && (nba.next_action === "ANSWER" || nba.next_action === "INFORM");
  if (channelPreferenceAsked) lines.push(CHANNEL_PREFERENCE_LINE);

  const known = nba.known_dimensions
    .filter((entry) => entry.state === "CONFIRMED" || entry.state === "INFERRED")
    .map((entry) => `${DIMENSION_WORDS(entry.dimension)}${entry.state === "INFERRED" ? " (inferred)" : ""}`);
  if (known.length) lines.push(`Known, never ask: ${known.join(", ")}.`);
  lines.push("One question at most in the whole reply.");

  const NEWLINE = "\n";
  let text = lines.join(NEWLINE);
  // Hard ceiling: drop the known-list first, never the move.
  if (estimateTokens(text) > NBA_STRATEGY_BLOCK_MAX_TOKENS && known.length) {
    text = lines.filter((line) => !line.startsWith("Known, never ask")).join(NEWLINE);
  }

  return {
    text,
    record: {
      ...legacy.record,
      nextQuestionId: question?.question_id ?? null,
      stopReason: null,
      questionIntentKey: question?.key ?? null,
      nbaAction: nba.next_action,
      callClose,
      channelPreferenceAsked,
    },
    objection: legacy.objection,
    objectionLines: legacy.objectionLines,
  };
}

/** How an engine-planned meeting close is taken on this booking route. */
function nbaBookingHow(route: NbaBookingRoute): string {
  switch (route) {
    case "SLOTS":
      return "offer the confirmed slots (SEND_BOOKING_OPTIONS)";
    case "LINK":
      return "share the booking link";
    case "ASK_PREFERRED_TIME":
      return "ask which day and time suits them";
    default:
      return "say the team will be in touch to arrange a time";
  }
}

/** The one line an NBA assist adds to the model's plan. Null = nothing to say to the lead. */
const ASSIST_MOVE: Record<AssistReason, string | null> = {
  QUALIFICATION_REVIEW: null,
  CONFIRM_DETAIL: "A colleague will confirm the detail you cannot answer: say so in one short clause, then carry on.",
  CONFIRM_PRICE: "A colleague will confirm the price: say so in one short clause, never state a figure, then carry on.",
  SPECIALIST_REVIEW:
    "A colleague will send the approved security or procurement information: say so in one short clause, promise nothing about it, then carry on.",
  SEND_ORDER_DETAILS: "They are ready: a colleague will send the details to get started. Say so warmly; no link, no price.",
  ARRANGE_TIME: "A colleague will arrange a time: say so in one short clause.",
  MEETING_BRIEF: null,
  QUOTE_REVIEW: "A colleague is checking their quote before it goes out: say so in one short clause, no figure, then carry on.",
};

/** ~4 characters per token (offer-card.ts, billing/tokens.ts). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Whether the lead raised the same objection earlier in the conversation, so
 * the response pattern reframes instead of asking the clarifying question
 * again (objection-responses.ts pickResponsePattern).
 */
export function objectionRaisedBefore(latest: string | null, priorLeadMessages: readonly string[]): boolean {
  const key = latest ? matchObjection(latest)[0]?.key : undefined;
  if (!key) return false;
  return priorLeadMessages.some((message) => matchObjection(message).some((match) => match.key === key));
}
