import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closingVerdict } from "../src/lib/agents/closing-rules.ts";
import { AGENT_TYPE_DEFINITIONS } from "../src/lib/agents/types.ts";

/**
 * The closing agent (stored type BOOKING) chases each lead to its own goal,
 * not only to a booking (owner feedback 2026-09-28).
 */
const base = { booked: false, openGoals: [], checkoutInFlight: false, quoteInFlight: false } as const;

describe("closing agent: which qualified leads have stalled", () => {
  test("no recorded goal keeps the old meaning: chase until a meeting is booked", () => {
    assert.equal(closingVerdict(base).stalled, true);
    assert.equal(closingVerdict({ ...base, booked: true }).stalled, false);
  });

  test("a direct-sale lead who booked a demo but has not paid is still chased", () => {
    const v = closingVerdict({ ...base, booked: true, openGoals: ["C_DIRECT_SALE"] });
    assert.equal(v.stalled, true);
    assert.equal(v.stalled && v.goal, "C_DIRECT_SALE");
  });

  test("a subscription or trial lead is chased to sign-up, whatever the bookings", () => {
    const v = closingVerdict({ ...base, booked: true, openGoals: ["D_SIGNUP_TRIAL"] });
    assert.equal(v.stalled && v.label, "not signed up yet");
  });

  test("a meeting-goal lead with a booking is left alone", () => {
    assert.equal(closingVerdict({ ...base, booked: true, openGoals: ["B_BOOK_MEETING"] }).stalled, false);
  });

  test("two interests: a booked meeting does not hide an unpaid sale", () => {
    const v = closingVerdict({ ...base, booked: true, openGoals: ["B_BOOK_MEETING", "C_DIRECT_SALE"] });
    assert.equal(v.stalled && v.goal, "C_DIRECT_SALE");
  });

  test("leads a checkout link or quote is already chasing are left to that follow-up", () => {
    assert.equal(closingVerdict({ ...base, openGoals: ["C_DIRECT_SALE"], checkoutInFlight: true }).stalled, false);
    assert.equal(closingVerdict({ ...base, openGoals: ["B_BOOK_MEETING"], quoteInFlight: true }).stalled, false);
  });

  test("qualify-only, nurture and disqualify goals are not this agent's to chase", () => {
    for (const goal of ["A_QUALIFY_ONLY", "F_NURTURE", "G_DISQUALIFY"] as const) {
      assert.equal(closingVerdict({ ...base, openGoals: [goal] }).stalled, false, goal);
    }
  });
});

describe("closing agent: wording", () => {
  test("the agent is described by goal, not only by booking", () => {
    const def = AGENT_TYPE_DEFINITIONS.BOOKING;
    assert.equal(def.label, "Closing agent");
    assert.match(def.description, /bought/);
    assert.match(def.description, /subscription or trial/);
  });

  test("the tick applies the goal rule and no longer requires no booking", () => {
    const ticks = readFileSync("src/lib/agents/ticks.ts", "utf8");
    assert.match(ticks, /closingVerdict\(/);
    assert.doesNotMatch(ticks, /\.is\("booked_at", null\)/);
  });
});
