import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planNextBestAction, type PlanTurnInput } from "../src/lib/qualification-intelligence/nba.ts";
import { resolveOffer } from "../src/lib/qualification-intelligence/offer-profile.ts";
import { resolveGoal } from "../src/lib/qualification-intelligence/goals.ts";
import { interpret } from "../src/lib/qualification-intelligence/interpret.ts";
import { lockInReconnectAt, LOCK_IN_RECONNECT_LEAD_DAYS, extractTextSignals } from "../src/lib/qualification-intelligence/signals.ts";
import { NBA_ACTION_NEEDS_MODEL, type GoalKey, type IntentAssessment } from "../src/lib/qualification-intelligence/types.ts";
import {
  planNotNowResume,
  reengagementReasonLine,
  reengagementReasonOf,
} from "../src/lib/reengagement/triggers.ts";
import { planFor } from "../src/lib/agent/qi-turn.ts";
import { buildNbaStrategyBlock } from "../src/lib/agent/strategy.ts";
import { intentFixture, MESSAGE_ID, NOW } from "./qualification-intel/matrix.ts";
import { TURN_FIXTURES } from "./fixtures/qi-turn-fixtures.ts";

/**
 * Integration regressions (2026-09-27):
 *   - story R1: a due "not now" check-in (FOLLOW_UP_DUE from reengage.trigger)
 *     composed nothing, because the NBA answered it with another WAIT (R6 on a
 *     NOT_NOW whose resume date had passed, R11 on a lead who has not replied);
 *   - the agent was not told WHY it was checking in;
 *   - the NBA gaps recorded as todo golden cases: a clear buying signal, and
 *     a dated lock-in reconnected before the contract ends.
 */

const MSP = resolveOffer({ archetypeKey: "MSP" });
const DAY = 86_400_000;

function plan(extra: Partial<PlanTurnInput> & { goalKey?: GoalKey; intent?: IntentAssessment } = {}) {
  const intent = extra.intent ?? intentFixture("MEDIUM", 55);
  const goal = resolveGoal({ motion: MSP.motion, offerGoal: extra.goalKey ?? "B_BOOK_MEETING", intentState: intent.state });
  return planNextBestAction({
    now: NOW,
    channel: "sms",
    stage: "QUALIFYING",
    resolved: MSP,
    goal,
    intent,
    dimensions: [],
    facts: [],
    engineVerdict: "PENDING",
    qualificationScore: 40,
    suppressed: false,
    interpretation: null,
    bindingVerdict: null,
    policy: {},
    checkoutAllowed: false,
    bookingScheduled: false,
    dealValueGbp: null,
    ...extra,
  }).nba;
}

describe("a due re-engagement check-in composes a message (story R1)", () => {
  const past = new Date(Date.parse(NOW) - 2 * 3_600_000).toISOString();
  const future = new Date(Date.parse(NOW) + 30 * DAY).toISOString();

  test("NOT_NOW whose resume date has passed: NURTURE on the check-in, WAIT otherwise", () => {
    const notNow = intentFixture("NOT_NOW", 20, { resumeAt: past });
    assert.equal(plan({ intent: notNow }).next_action, "WAIT", "an ordinary turn still waits");
    const due = plan({ intent: notNow, checkInDue: true });
    assert.equal(due.next_action, "NURTURE");
    assert.equal(due.question_intent, null, "never a new discovery question");
    assert.equal(planFor(due, { manual: false }).kind, "COMPOSE");
    assert.equal(NBA_ACTION_NEEDS_MODEL.NURTURE, true);
  });

  test("a NOT_NOW the lead renewed (resume still ahead) still waits, check-in or not", () => {
    assert.equal(plan({ intent: intentFixture("NOT_NOW", 20, { resumeAt: future }), checkInDue: true }).next_action, "WAIT");
  });

  test("a lead whose NOT_NOW has lapsed to LOW intent is re-engaged, not parked for 7 more days", () => {
    // Everything the MSP threshold needs is known, so no question is worth
    // asking (R9); the workspace closes only on MEDIUM intent (R10), so a
    // LOW-intent lead who has not replied reaches R11.
    const known = ["USE_CASE", "COMPANY_SIZE", "TIMING", "TEAM_SIZE"].map((dimension) => ({
      dimension, status: "CONFIRMED", fact_ids: [], material: false, required: false, stale: false,
    })) as never;
    const medium = { thresholds: { booking: { minIntentState: "MEDIUM" } } } as never;
    for (const state of ["LOW", "NO_DETECTED_INTENT"] as const) {
      const ordinary = plan({ intent: intentFixture(state, 20), dimensions: known, policy: medium });
      assert.equal(ordinary.next_action, "WAIT", `${state}: ${ordinary.rule} ${ordinary.reason}`);
      const due = plan({ intent: intentFixture(state, 20), dimensions: known, policy: medium, checkInDue: true });
      assert.equal(due.next_action, "NURTURE", state);
      assert.equal(due.rule, "R11_LOW_INTENT");
    }
  });

  test("a negative or suppressed lead is never re-engaged by a check-in", () => {
    assert.equal(plan({ intent: intentFixture("NEGATIVE", 5), checkInDue: true }).next_action, "NO_ACTION");
    assert.equal(plan({ suppressed: true, checkInDue: true }).next_action, "NO_ACTION");
  });

  test("the NURTURE block re-engages without a qualifying question", () => {
    const due = plan({ intent: intentFixture("NOT_NOW", 20, { resumeAt: past }), checkInDue: true });
    const block = buildNbaStrategyBlock(TURN_FIXTURES[0].legacy, due, { booking: "TEAM_FOLLOW_UP" });
    assert.match(block.text, /Move: re-engage briefly/);
    assert.doesNotMatch(block.text, /ask only this/i);
  });

  test("the orchestrator and the qi runtime wire the check-in", () => {
    const runtime = readFileSync("src/lib/agent/qi-runtime.ts", "utf8");
    assert.match(runtime, /checkInDue: event\.eventType === "FOLLOW_UP_DUE" && reengagementReasonOf\(event\.payload\) !== null/);
    const orchestrator = readFileSync("src/lib/agent/orchestrator.ts", "utf8");
    assert.match(orchestrator, /reengagementReasonLine\(reengagement\)/);
    const handler = readFileSync("src/lib/jobs/handlers/reengage.ts", "utf8");
    assert.match(handler, /reengagementDate:/);
  });
});

describe("a deferral is not a refusal (story R1)", () => {
  test("'not right now, try me in March' is NOT_NOW only, never NOT_INTERESTED", () => {
    const now = new Date(NOW);
    for (const text of ["Thanks, but not right now. Try me again in March please.", "Not at the moment, maybe next month"]) {
      const types = extractTextSignals(text, now).map((s) => s.type);
      assert.ok(types.includes("NOT_NOW"), `${text}: ${types}`);
      assert.ok(!types.includes("NOT_INTERESTED"), `${text}: ${types}`);
    }
    // An explicit refusal still is one.
    assert.ok(extractTextSignals("Not interested, thanks", now).some((s) => s.type === "NOT_INTERESTED"));
  });
});

describe("the agent is told why it is checking in", () => {
  test("each trigger renders one short reason line from structured facts", () => {
    const notNow = reengagementReasonLine({ trigger: "NOT_NOW_RESUME", date: "2027-03-01T00:00:00.000Z" });
    assert.match(notNow, /they asked to be contacted around 1 March 2027/);
    assert.match(reengagementReasonLine({ trigger: "DEADLINE_PASSED", date: "2026-10-15" }), /the date they gave \(15 October 2026\) has passed/);
    assert.match(reengagementReasonLine({ trigger: "NO_SHOW_REBOOK" }), /missed their booked meeting/);
    assert.match(reengagementReasonLine({ trigger: "WIN_BACK", lossCategory: "Price" }), /win-back after a lost deal \(reason: price\)/);
    assert.match(reengagementReasonLine({ trigger: "NOT_NOW_RESUME", date: null }), /around now/);
    for (const trigger of ["NOT_NOW_RESUME", "DEADLINE_PASSED", "NO_SHOW_REBOOK", "NO_SHOW_NUDGE", "WIN_BACK"] as const) {
      const line = reengagementReasonLine({ trigger, date: "2027-03-01", lossCategory: "No response" });
      // Inside the strategy budget: one line, well under the NBA block's own cap.
      assert.ok(Math.ceil(line.length / 4) <= 40, `${trigger}: ${line.length} chars`);
      assert.doesNotMatch(line, /\n/);
    }
  });

  test("the reason is read only from a real trigger payload", () => {
    assert.deepEqual(reengagementReasonOf({ reengagement: "NOT_NOW_RESUME", sourceId: "x", reengagementDate: "2027-03-01" }), {
      trigger: "NOT_NOW_RESUME",
      date: "2027-03-01",
      lossCategory: null,
    });
    assert.equal(reengagementReasonOf({ kind: "checkout_nudge" }), null);
    assert.equal(reengagementReasonOf({ reengagement: "SOMETHING_ELSE" }), null);
    assert.equal(reengagementReasonOf(null), null);
  });
});

describe("NBA gaps closed (golden studio-04, msp-05)", () => {
  const reply = (text: string) => interpret(text, { messageId: MESSAGE_ID, now: NOW, dimensions: [] });

  test("a clear buying signal closes instead of asking an optional question", () => {
    const signal = reply("Ok that makes sense, what's the next step?");
    assert.equal(signal.close_instead, true);
    const planned = plan({ interpretation: signal });
    assert.equal(planned.next_action, "CTA_BOOK", planned.reason);
    assert.match(planned.reason, /clear buying signal/);
    // Without the signal the same lead is still qualified.
    assert.notEqual(plan({ interpretation: reply("We have about 20 staff.") }).next_action, "CTA_BOOK");
    // A deferral is never a buying signal.
    assert.equal(reply("Sounds good, but not right now").close_instead, false);
  });

  test("a buying signal never turns a booking request into a checkout", () => {
    const book = reply("Sounds good, can we book a call?");
    const planned = plan({ interpretation: book, goalKey: "C_DIRECT_SALE", checkoutAllowed: true });
    assert.notEqual(planned.next_action, "CTA_CHECKOUT");
  });

  test("tied in until March: a dated NOT_NOW resumed six weeks before the contract ends", () => {
    const text = "We're tied into a contract with our IT company until March so can't do anything yet.";
    const now = new Date(NOW);
    const lock = lockInReconnectAt(text, now)!;
    assert.ok(lock, "lock-in with a date");
    assert.equal(lock.endsAt.slice(0, 10), "2027-03-01");
    assert.equal(Date.parse(lock.endsAt) - Date.parse(lock.resumeAt), LOCK_IN_RECONNECT_LEAD_DAYS * DAY);
    assert.equal(lockInReconnectAt("We're tied in with someone else at the moment.", now), null, "no date: no planned reconnect");

    // The turn: a NOT_NOW signal with that resume date, never a hand-over.
    const turn = reply(text);
    const notNow = turn.signals.find((s) => s.signal_type === "NOT_NOW");
    assert.equal(notNow?.resume_at, lock.resumeAt);
    assert.equal(turn.requested_action, "LATER");
    // The lead.score path records the same dated NOT_NOW.
    const stored = extractTextSignals(text, now).find((s) => s.type === "NOT_NOW");
    assert.equal(stored?.resumeAt, lock.resumeAt);

    // The re-engagement trigger plans the reconnect from that signal, before March.
    const trigger = planNotNowResume({ id: "sig-1", type: "NOT_NOW", resume_at: lock.resumeAt });
    assert.ok(trigger);
    assert.equal(trigger.trigger, "NOT_NOW_RESUME");
    assert.ok(trigger.dueAt.getTime() < Date.parse(lock.endsAt), "reconnect before the contract ends");
  });
});
