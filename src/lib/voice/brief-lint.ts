/**
 * Brief lint (voice AI QA, 2026-09-29). Pure.
 *
 * Reads a finished call brief the way the voice model will, against the
 * permissions it was built with, and names every contradiction, missing piece
 * or unclear instruction a model could act on wrongly. The dry run
 * (scripts/voice-brief-dry-run.mjs --matrix) runs it over the LIVE brief for
 * every route and permission combination; tests/voice-brief-matrix.test.ts
 * runs it over synthetic workspaces.
 *
 * Why it exists: on 2026-09-28 the simulated suites scored 100 while real
 * calls failed, because the real inputs were never read as a model reads
 * them. Every check here is a failure that was seen, in a live call or a live
 * dry run, or its direct sibling.
 */

import { CALL_BRIEF_MAX_TOKENS, estimateTokens, type BriefPermissions, type BriefRoute } from "./call-brief.ts";
import type { CloseRoute } from "../agent/closing.ts";

export type BriefLintFacts = {
  route: BriefRoute;
  direction: "OUTBOUND" | "INBOUND";
  permissions: BriefPermissions;
  booking: CloseRoute;
  recordingEnabled: boolean;
  transferAvailable: boolean;
  /** The brief carries approved offer lines. */
  hasOffer: boolean;
  /** The lead's enquiry text is on file (THEIR ENQUIRY). */
  hasEnquiry: boolean;
};

export type BriefLintFinding = { code: string; detail: string };

/** The rule lines that forbid a tool name; a mention there is not an instruction to use it. */
const FORBID_LINE = /^(BOOKING IS OFF|NO CALENDAR ON THIS CALL)\./;

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Lines that are instructions (not the lines that forbid a tool). */
function instructing(text: string): string {
  return linesOf(text)
    .filter((l) => !FORBID_LINE.test(l))
    .join("\n");
}

export function lintCallBrief(brief: { text: string; timePlan?: string; dropped?: readonly string[] }, facts: BriefLintFacts): BriefLintFinding[] {
  const out: BriefLintFinding[] = [];
  const add = (code: string, detail: string) => out.push({ code, detail });
  const text = brief.text;
  const act = instructing(text);
  const p = facts.permissions;
  const canCheckTimes = p.book && facts.booking === "SLOTS";

  // Budget: the whole brief is read every turn.
  if (estimateTokens(text) > CALL_BRIEF_MAX_TOKENS) add("OVER_BUDGET", `${estimateTokens(text)} tokens`);
  if ((brief.dropped ?? []).includes("hard_cut")) add("HARD_CUT", "the brief was cut mid-rule");

  // Identity.
  if (/YOU ARE the assistant, an AI assistant/.test(text)) add("PERSONA_AWKWARD", "\"the assistant, an AI assistant\"");
  if (!/Never claim to be human/.test(text)) add("NO_HUMAN_RULE", "missing \"Never claim to be human\"");

  // Times: never named as a tool to use unless a calendar can be read.
  if (!canCheckTimes && /check_availability|book_meeting/.test(act)) add("TIMES_WITHOUT_CALENDAR", "check_availability/book_meeting named as an action with no readable calendar");
  if (!canCheckTimes && !/BOOKING IS OFF|NO CALENDAR ON THIS CALL/.test(text)) add("NO_TIMES_RULE", "no rule forbidding times when no calendar can be read");
  if (/WHAT YOU MAY DO:[^.]*\bbook meetings\b/.test(text) && !canCheckTimes) add("MAY_BOOK_CONTRADICTION", "\"may book meetings\" beside a rule forbidding book_meeting");

  // Tools the owner did not allow are never an instruction.
  if (!p.checkout && /send_checkout_link/.test(act)) add("CHECKOUT_NOT_PERMITTED", "send_checkout_link named without the permission");
  if (!p.quote && /calculate_quote/.test(act)) add("QUOTE_NOT_PERMITTED", "calculate_quote named without the permission");
  if (!p.bookingLink && /send_booking_link/.test(act)) add("BOOKING_LINK_NOT_PERMITTED", "send_booking_link named with no booking link");

  // Goal and close agree.
  const goal = /Goal: ([^.]+)\./.exec(text)?.[1] ?? "";
  const close = /^CLOSE\. (.*)$/m.exec(text)?.[1] ?? "";
  if (/Direct sale|Sign-up|trial/i.test(goal) && /Close on a meeting/.test(close)) add("GOAL_CLOSE_MISMATCH", `goal "${goal}" but the close is a meeting`);
  const moveLine = /^YOUR ONE MOVE NOW: (.*)$/m.exec(text)?.[1] ?? "";
  const meetingStep = (s: string) => /Close on a meeting/.test(s);
  const sendStep = (s: string) => /ready to buy|send_checkout_link|Close on the purchase/.test(s);
  if ((meetingStep(moveLine) && sendStep(close)) || (sendStep(moveLine) && meetingStep(close))) add("MOVE_CLOSE_CONFLICT", "the move and the close name different next steps");

  // The move fits the route.
  const move = /^YOUR ONE MOVE NOW: (.*)$/m.exec(text)?.[1] ?? "";
  if (facts.route !== "QUALIFICATION" && /Share one useful point/.test(move)) add("ROUTE_MOVE_LOST", `${facts.route} call opens with a point-only pitch`);
  if (facts.route === "RETURN_CALL" && !/rang/.test(move + text)) add("RETURN_CALL_NOT_HELP_FIRST", "a return call does not start by helping");
  if (facts.direction === "INBOUND" && /You asked if now is a good time/.test(text)) add("INBOUND_PERMISSION_LINE", "an inbound call is told it asked for permission");
  if (facts.route === "QUALIFICATION" && !/QUESTION PLAN\./.test(text) && !/Do not sell|A person should take this lead|not the right time/.test(move)) add("NO_PLAN", "a qualification call without a QUESTION PLAN");
  if ((facts.route === "NURTURE" || facts.route === "REACTIVATION") && /ready to buy|one light trial close/.test(close)) add("HARD_CLOSE_ON_SOFT_ROUTE", `${facts.route} closes hard`);

  // Plan wording a model can misread.
  if (/Ask 1 to \d+ before/.test(text)) add("PLAN_COUNT_AMBIGUOUS", "\"Ask 1 to N\" reads as \"ask one or N questions\"");

  // Claims.
  if (!facts.hasOffer && /(Share|one) (one )?useful point|approved reason from the offer lines/.test(act)) add("CLAIM_WITHOUT_LINES", "told to use offer lines that do not exist");
  if (!facts.hasOffer && !/NO APPROVED CLAIMS/.test(text)) add("NO_CLAIMS_RULE_MISSING", "no offer lines and no NO APPROVED CLAIMS rule");

  // The enquiry is confirmed, never asked for.
  if (facts.hasEnquiry && /(?<!Never )ask what prompted/i.test(move)) add("ASKS_WHAT_PROMPTED", "asks what prompted the enquiry with the enquiry on file");

  // Promises with nothing behind them.
  if (/send the details today|within \d+ (minutes|hours)|by (tomorrow|tonight)/i.test(text)) add("UNBACKED_TIMING_PROMISE", "a send or call-back time no one confirmed");

  // Recording and transfer say what is true on this call.
  const recording = /RECORDING\. [^\n"]*"([^"\n]+)"/.exec(text)?.[1] ?? "";
  if (facts.recordingEnabled && !/\bis recorded\b/i.test(recording)) add("RECORDING_WRONG", `recording on, answer "${recording}"`);
  if (!facts.recordingEnabled && !/\bnot recorded\b/i.test(recording)) add("RECORDING_WRONG", `recording off, answer "${recording}"`);
  const person = /^A PERSON\. (.*)$/m.exec(text)?.[1] ?? "";
  if (facts.transferAvailable && /Live transfer is off/.test(person)) add("TRANSFER_WRONG", "transfer available but the brief says it is off");
  if (!facts.transferAvailable && /transfer_to_human/.test(person)) add("TRANSFER_WRONG", "transfer not available but the brief offers it");
  if (!facts.transferAvailable && !/schedule_callback by PERSON/.test(person)) add("PERSON_CALLBACK_UNCLEAR", "a person's call-back not marked by PERSON");

  // The always-on rules.
  for (const [code, re] of [
    ["NO_STOP_RULE", /^STOP\./m],
    ["NO_MONEY_RULE", /^MONEY, TIMES AND AREAS\./m],
    ["NO_ENDING", /^ENDING\./m],
    ["NO_SPEECH_RULES", /^HOW YOU SPEAK\./m],
  ] as const) {
    if (!re.test(text)) add(code, "missing");
  }
  return out;
}
