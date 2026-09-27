import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateSend, type SendGuardSnapshot } from "../src/lib/jobs/send-core.ts";

/**
 * Business-story failures from the live E2E run, each pinned by a test that
 * failed before its fix (design 08 Wave 2, A3).
 */

const MIDDAY = new Date("2026-09-24T12:00:00.000Z");

function snapshot(overrides: Partial<SendGuardSnapshot> = {}): SendGuardSnapshot {
  return {
    lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: true },
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
    quietHours: { enabled: false, start: "21:00", end: "08:00", timezone: "Europe/London" },
    origin: "agent",
    ...overrides,
  };
}

describe("I3: a lead with follow-up off can still be answered", () => {
  // A lead created via the API starts with automation_active = false.
  const apiLead = { status: "NEW", optedOut: false, humanTakeover: false, automationActive: false, hasReplied: true };

  test("the agent's reply to an inbound message is not stopped as 'paused'", () => {
    assert.deepEqual(evaluateSend(snapshot({ lead: apiLead }), MIDDAY), { action: "send" });
  });

  test("automated follow-up steps keep the 'paused' meaning", () => {
    assert.deepEqual(
      evaluateSend(snapshot({ origin: "automation", lead: { ...apiLead, hasReplied: false } }), MIDDAY),
      { action: "abort", reason: "paused" },
    );
  });

  test("a booked lead can still be helped with their booking (POST_BOOKING)", () => {
    assert.deepEqual(evaluateSend(snapshot({ lead: { ...apiLead, status: "BOOKED" } }), MIDDAY), { action: "send" });
  });

  test("explicit stops still bind the agent: opt-out, suppression, takeover, won, lost", () => {
    assert.deepEqual(evaluateSend(snapshot({ lead: { ...apiLead, optedOut: true } }), MIDDAY), { action: "abort", reason: "opted_out" });
    assert.deepEqual(
      evaluateSend(snapshot({ lead: apiLead, channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: true } }), MIDDAY),
      { action: "abort", reason: "suppressed" },
    );
    assert.deepEqual(evaluateSend(snapshot({ lead: { ...apiLead, humanTakeover: true } }), MIDDAY), { action: "abort", reason: "human_takeover" });
    assert.deepEqual(evaluateSend(snapshot({ lead: { ...apiLead, status: "WON" } }), MIDDAY), { action: "abort", reason: "won" });
    assert.deepEqual(evaluateSend(snapshot({ lead: { ...apiLead, status: "LOST" } }), MIDDAY), { action: "abort", reason: "lost" });
  });

  test("quiet hours still apply to an agent reply", () => {
    const night = evaluateSend(
      snapshot({ lead: apiLead, quietHours: { enabled: true, start: "20:00", end: "08:00", timezone: "Europe/London" } }),
      new Date("2026-09-24T22:00:00.000Z"),
    );
    assert.equal(night.action, "reschedule");
  });

  test("the run records the true result: the guard is predicted before the message is queued", () => {
    const source = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");
    // The orchestrator predicts the send guard for the reply it is about to queue,
    // and records NO_ACTION with the guard's reason instead of MESSAGE_SENT.
    assert.match(source, /predictAgentSend\(/);
    assert.match(source, /errorCode: `STOPPED_\$\{/);
    // Non-reply triggers (no inbound message) keep the 'paused' meaning.
    assert.match(source, /isReplyTrigger\(/);
  });
});

import { parsePreferredTime, preferredTimeQuestion } from "../src/lib/agent/availability/preferred-time.ts";

describe("H3: manual booking mode holds a pending booking for the lead's own time", () => {
  // Wednesday 24 Sep 2026, 12:00 UTC = 13:00 in London (BST).
  const opts = { now: MIDDAY, timezone: "Europe/London", durationMinutes: 30 };

  test("'Tuesday at 2pm' is next Tuesday 14:00 London time", () => {
    const parsed = parsePreferredTime("Tuesday at 2pm works for me", opts);
    assert.equal(parsed.kind, "slot");
    if (parsed.kind === "slot") {
      assert.equal(parsed.slot.startsAt, "2026-09-29T13:00:00.000Z");
      assert.equal(parsed.slot.endsAt, "2026-09-29T13:30:00.000Z");
      // formatSlotLabel: the ICU build decides "Sep" or "Sept".
      assert.match(parsed.slot.label, /^Tue 29 Sept?, 2:00pm$/);
    }
  });

  test("tomorrow, a 24-hour clock, a written date and a UK numeric date", () => {
    const tomorrow = parsePreferredTime("tomorrow 10:30 please", opts);
    assert.equal(tomorrow.kind === "slot" && tomorrow.slot.startsAt, "2026-09-25T09:30:00.000Z");
    const written = parsePreferredTime("How about 3rd October at 11am?", opts);
    assert.equal(written.kind === "slot" && written.slot.startsAt, "2026-10-03T10:00:00.000Z");
    const numeric = parsePreferredTime("6/10 at 3", opts);
    assert.equal(numeric.kind === "slot" && numeric.slot.startsAt, "2026-10-06T14:00:00.000Z");
  });

  test("GMT after the clocks change is handled", () => {
    const parsed = parsePreferredTime("2nd November at 9am", opts);
    assert.equal(parsed.kind === "slot" && parsed.slot.startsAt, "2026-11-02T09:00:00.000Z");
  });

  test("anything short of one day and one time is ambiguous, and the past is never booked", () => {
    assert.deepEqual(parsePreferredTime("Tuesday works", opts), { kind: "ambiguous", missing: "time" });
    assert.deepEqual(parsePreferredTime("2pm is good", opts), { kind: "ambiguous", missing: "day" });
    assert.deepEqual(parsePreferredTime("sometime next week", opts), { kind: "ambiguous", missing: "both" });
    assert.deepEqual(parsePreferredTime("Tuesday or Wednesday at 2pm", opts), { kind: "ambiguous", missing: "several" });
    assert.deepEqual(parsePreferredTime("Tuesday afternoon", opts), { kind: "ambiguous", missing: "time" });
    assert.deepEqual(parsePreferredTime("today at 9am", opts), { kind: "ambiguous", missing: "past" });
  });

  test("the question is one question, and the second attempt gives an example", () => {
    assert.equal((preferredTimeQuestion("Sam", 1).match(/\?/g) ?? []).length, 1);
    assert.match(preferredTimeQuestion(null, 2), /for example Tuesday at 2pm\?$/);
  });

  test("the orchestrator asks, parses, books pending, and asks at most once more before handing over", () => {
    const source = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");
    assert.match(source, /askPreferredTime\(/);
    assert.match(source, /parsePreferredTime\(/);
    assert.match(source, /preferredTimeAsked/);
    // Two attempts, then a person.
    assert.match(source, /attempt >= 2/);
  });
});

import { answerProvenance } from "../src/lib/jobs/handlers/answer-provenance.ts";

describe("Q-D1: an AI-matched answer keeps its provenance", () => {
  test("a deterministic match is a reply, with full confidence", () => {
    assert.deepEqual(answerProvenance({ matchedBy: "rules" }), { source: "reply", confidence: 1 });
  });

  test("an AI-assisted match is ai_assist, with the model's confidence", () => {
    assert.deepEqual(answerProvenance({ matchedBy: "ai", confidence: 0.91 }), { source: "ai_assist", confidence: 0.91 });
  });

  test("an AI match with no reported confidence is still ai_assist, never passed off as typed", () => {
    assert.deepEqual(answerProvenance({ matchedBy: "ai", confidence: null }), { source: "ai_assist", confidence: null });
  });

  test("an unmatched reply is stored as the lead's words, confidence 0", () => {
    assert.deepEqual(answerProvenance({ matchedBy: "none" }), { source: "reply", confidence: 0 });
  });

  test("message-inbound records provenance instead of a literal 'reply'", () => {
    const source = readFileSync(new URL("../src/lib/jobs/handlers/message-inbound.ts", import.meta.url), "utf8");
    assert.match(source, /answerProvenance\(/);
    assert.doesNotMatch(source, /source: "reply",\s*\n\s*answered_at/);
  });
});

describe("bookable slots reach the model", () => {
  const source = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");

  test("the model's context carries the turn's real slots, never a hard-coded empty list", () => {
    // Before the fix: renderContextBlock(..., { confirmedSlots: [] }) on every call.
    assert.doesNotMatch(source, /confirmedSlots: \[\],/);
    assert.match(source, /latestMessage: input\.latestMessage,\s*\n\s*confirmedSlots,/);
  });

  test("slots are fetched before the model call when booking is the plan", () => {
    assert.ok(source.indexOf("bookingIsThePlan(input) && context.booking.availabilityQueryable") < source.indexOf("const proposal = await proposeDecision("));
    assert.match(source, /proposeDecision\(input, null, prefetched\?\.labels \?\? \[\]\)/);
  });

  test("slots fetched after the model asked are put in front of it once more, and the retry keeps them", () => {
    assert.match(source, /proposeDecision\(input, null, confirmedSlots, "slots"\)/);
    // Owner decision 2026-09-27: up to three drafts (two corrected retries),
    // each retry still carrying the slots.
    assert.match(source, /proposeDecision\(input, correctionPrompt\(check\.failures\), confirmedSlots, /);
    // Each pass has its own debit key, so a retried job is charged once per pass.
    assert.match(source, /idempotencyKey: `agent:\$\{input\.run\.id\}:\$\{pass\}`/);
  });
});
