import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_STATES,
  applyObservedState,
  CALL_STATES,
  CallGuardFailed,
  canTransition,
  IllegalCallTransition,
  isTerminal,
  transition,
  TRANSITIONS,
  type CallState,
  type GuardContext,
} from "../src/lib/voice/state-machine.ts";

const ALL: GuardContext = {
  eligibilityAllowed: true,
  reservationHeld: true,
  openerDelivered: true,
  transferAvailable: true,
  minutesAccounted: true,
};

test("the happy path walks every stage to COMPLETE", () => {
  const path: CallState[] = [
    "ELIGIBILITY_CHECKED",
    "QUEUED",
    "DIALLING",
    "RINGING",
    "ANSWERED",
    "IN_CONVERSATION",
    "WRAPPING_UP",
    "ENDED",
    "POST_PROCESSING",
    "COMPLETE",
  ];
  let s: CallState = "REQUESTED";
  for (const next of path) s = transition(s, next, ALL);
  assert.equal(s, "COMPLETE");
  assert.equal(isTerminal(s), true);
});

test("non-conversation outcomes go through post-processing", () => {
  for (const outcome of ["NO_ANSWER", "BUSY", "FAILED"] as const) {
    let s: CallState = transition("RINGING", outcome, ALL);
    s = transition(s, "POST_PROCESSING", ALL);
    assert.equal(transition(s, "COMPLETE", ALL), "COMPLETE");
  }
  assert.equal(transition(transition("RINGING", "VOICEMAIL"), "ENDED"), "ENDED");
  assert.equal(transition("VOICEMAIL", "POST_PROCESSING"), "POST_PROCESSING");
});

test("transfer: only from a live conversation or wrap-up, and only when available", () => {
  assert.equal(transition("IN_CONVERSATION", "TRANSFERRED", ALL), "TRANSFERRED");
  assert.equal(transition("WRAPPING_UP", "TRANSFERRED", ALL), "TRANSFERRED");
  assert.throws(() => transition("IN_CONVERSATION", "TRANSFERRED", { transferAvailable: false }), CallGuardFailed);
  assert.throws(() => transition("RINGING", "TRANSFERRED", ALL), IllegalCallTransition);
  assert.equal(transition("TRANSFERRED", "ENDED"), "ENDED");
});

test("cancel is possible only before anyone answers", () => {
  for (const s of ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED", "DIALLING", "RINGING"] as const) {
    assert.equal(transition(s, "CANCELLED"), "CANCELLED", s);
  }
  for (const s of ["ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "ENDED", "COMPLETE"] as const) {
    assert.throws(() => transition(s, "CANCELLED"), IllegalCallTransition, s);
  }
});

test("illegal transitions throw, exhaustively", () => {
  let illegal = 0;
  for (const from of CALL_STATES) {
    for (const to of CALL_STATES) {
      if (canTransition(from, to)) continue;
      illegal++;
      assert.throws(() => transition(from, to, ALL), (e: unknown) => e instanceof IllegalCallTransition && e.from === from && e.to === to);
    }
  }
  assert.ok(illegal > 200);
  // Terminal states have no exits.
  assert.deepEqual(TRANSITIONS.COMPLETE, []);
  assert.deepEqual(TRANSITIONS.CANCELLED, []);
  // Specific regressions that must never happen.
  for (const [f, t] of [
    ["ENDED", "IN_CONVERSATION"],
    ["COMPLETE", "REQUESTED"],
    ["RINGING", "DIALLING"],
    ["QUEUED", "IN_CONVERSATION"],
    ["REQUESTED", "DIALLING"],
    ["NO_ANSWER", "RINGING"],
  ] as [CallState, CallState][]) {
    assert.throws(() => transition(f, t, ALL), IllegalCallTransition, `${f}->${t}`);
  }
});

test("guards: eligibility, reservation, opener, minutes", () => {
  assert.throws(() => transition("REQUESTED", "ELIGIBILITY_CHECKED", {}), (e: unknown) => e instanceof CallGuardFailed && e.guard === "eligibilityAllowed");
  assert.throws(() => transition("QUEUED", "DIALLING", { eligibilityAllowed: true }), (e: unknown) => e instanceof CallGuardFailed && e.guard === "reservationHeld");
  assert.throws(() => transition("QUEUED", "DIALLING", { reservationHeld: true }), (e: unknown) => e instanceof CallGuardFailed && e.guard === "eligibilityAllowed");
  assert.throws(() => transition("ANSWERED", "IN_CONVERSATION", {}), (e: unknown) => e instanceof CallGuardFailed && e.guard === "openerDelivered");
  assert.throws(() => transition("POST_PROCESSING", "COMPLETE", {}), (e: unknown) => e instanceof CallGuardFailed && e.guard === "minutesAccounted");
});

test("provider observations: out-of-order events never regress, gaps are walked", () => {
  assert.deepEqual(applyObservedState("DIALLING", "IN_CONVERSATION"), { applied: true, state: "IN_CONVERSATION", path: ["ANSWERED", "IN_CONVERSATION"] });
  assert.deepEqual(applyObservedState("DIALLING", "RINGING"), { applied: true, state: "RINGING", path: ["RINGING"] });
  assert.deepEqual(applyObservedState("DIALLING", "ENDED"), { applied: true, state: "ENDED", path: ["ANSWERED", "ENDED"] });
  // Twilio "ringing" after "in-progress": stale.
  assert.deepEqual(applyObservedState("IN_CONVERSATION", "RINGING"), { applied: false, state: "IN_CONVERSATION", reason: "STALE" });
  assert.deepEqual(applyObservedState("ENDED", "ENDED"), { applied: false, state: "ENDED", reason: "STALE" });
  assert.deepEqual(applyObservedState("COMPLETE", "ENDED"), { applied: false, state: "COMPLETE", reason: "TERMINAL" });
  // An outcome at the same rank is stale (BUSY after NO_ANSWER).
  assert.equal(applyObservedState("NO_ANSWER", "BUSY").applied, false);
  // Unreachable: an answered call cannot be reported cancelled.
  assert.throws(() => applyObservedState("IN_CONVERSATION", "CANCELLED"), IllegalCallTransition);
  // A voicemail reported "transferred" is at the same rank: ignored, not applied.
  assert.equal(applyObservedState("VOICEMAIL", "TRANSFERRED").applied, false);
});

test("active states hold the lead and concurrency slots", () => {
  assert.deepEqual([...ACTIVE_STATES], ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"]);
});
