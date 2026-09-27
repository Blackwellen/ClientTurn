import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALL_BUDGET_SEC,
  evaluateExtension,
  governTime,
  MAX_EXTENSION_SEC,
  PROVIDER_MAX_DURATION_SEC,
  ROUTE_TARGETS,
  thresholdsFor,
  VOICE_ROUTES,
} from "../src/lib/voice/time-governor.ts";

test("5-minute budget and the brief's route targets", () => {
  assert.equal(CALL_BUDGET_SEC, 300);
  assert.deepEqual(
    Object.fromEntries(VOICE_ROUTES.map((r) => [r, [ROUTE_TARGETS[r].minSec, ROUTE_TARGETS[r].maxSec]])),
    {
      QUALIFICATION: [180, 240], // about 3 to 4 min
      BOOKING_CLOSE: [150, 210], // about 3 min
      DIRECT_CLOSE: [240, 300], // about 5 min
      NURTURE: [90, 150], // about 2 min
      REACTIVATION: [120, 180], // about 2 to 3 min
    },
  );
  for (const r of VOICE_ROUTES) {
    const t = ROUTE_TARGETS[r];
    assert.ok(t.minSec <= t.targetSec && t.targetSec <= t.maxSec && t.maxSec <= CALL_BUDGET_SEC, r);
  }
});

test("thresholds per route: amber at 75% of target, red at target or budget less wrap-up", () => {
  assert.deepEqual(thresholdsFor("QUALIFICATION"), { amberAtSec: 158, redAtSec: 210, hardStopSec: 300 });
  assert.deepEqual(thresholdsFor("BOOKING_CLOSE"), { amberAtSec: 135, redAtSec: 180, hardStopSec: 300 });
  assert.deepEqual(thresholdsFor("DIRECT_CLOSE"), { amberAtSec: 225, redAtSec: 255, hardStopSec: 300 });
  assert.deepEqual(thresholdsFor("NURTURE"), { amberAtSec: 90, redAtSec: 120, hardStopSec: 300 });
  assert.deepEqual(thresholdsFor("REACTIVATION"), { amberAtSec: 113, redAtSec: 150, hardStopSec: 300 });
  // Extensions move red and the hard stop, bounded at 120 s.
  assert.deepEqual(thresholdsFor("DIRECT_CLOSE", 60), { amberAtSec: 225, redAtSec: 315, hardStopSec: 360 });
  assert.equal(thresholdsFor("DIRECT_CLOSE", 999).hardStopSec, 300 + MAX_EXTENSION_SEC);
});

test("levels and actions as the call runs", () => {
  const rows: [number, string, string[]][] = [
    [0, "GREEN", ["CONTINUE"]],
    [157, "GREEN", ["CONTINUE"]],
    [158, "TIME_AMBER", ["SUMMARISE_PROGRESS", "NO_NEW_TOPICS", "STEER_TO_NEXT_STEP"]],
    [210, "TIME_RED", ["SUMMARISE", "BOOK_NOW", "OFFER_FOLLOW_UP"]],
    [299, "TIME_RED", ["SUMMARISE", "BOOK_NOW", "OFFER_FOLLOW_UP"]],
    [300, "OVER", ["END_POLITELY"]],
    [900, "OVER", ["END_POLITELY"]],
  ];
  for (const [sec, level, actions] of rows) {
    const s = governTime({ route: "QUALIFICATION", elapsedSec: sec });
    assert.equal(s.level, level, String(sec));
    assert.deepEqual(s.actions, actions, String(sec));
  }
  assert.deepEqual(governTime({ route: "DIRECT_CLOSE", elapsedSec: 260 }).actions, ["SUMMARISE", "CLOSE_NOW", "OFFER_FOLLOW_UP"]);
  assert.deepEqual(governTime({ route: "NURTURE", elapsedSec: 125 }).actions, ["SUMMARISE", "OFFER_FOLLOW_UP"]);
  assert.equal(governTime({ route: "NURTURE", elapsedSec: 125 }).remainingSec, 175);
  assert.equal(governTime({ route: "NURTURE", elapsedSec: -5 }).elapsedSec, 0);
});

test("valuable-close extension: granted only while closing with an engaged lead", () => {
  const base: Parameters<typeof evaluateExtension>[0] = {
    route: "BOOKING_CLOSE",
    elapsedSec: 200,
    extensionsUsed: 0,
    closeInProgress: "CONFIRMING_BOOKING_SLOT",
    leadEngaged: true,
    leadAskedToEnd: false,
    reservedSec: 420,
  };
  assert.deepEqual(evaluateExtension(base), { granted: true, extensionSec: 60, newHardStopSec: 360 });
  assert.deepEqual(evaluateExtension({ ...base, extensionsUsed: 1, elapsedSec: 250 }), { granted: true, extensionSec: 120, newHardStopSec: 420 });
  const denied: [Partial<typeof base>, string][] = [
    [{ route: "NURTURE" }, "ROUTE_NOT_ELIGIBLE"],
    [{ route: "REACTIVATION" }, "ROUTE_NOT_ELIGIBLE"],
    [{ leadAskedToEnd: true }, "LEAD_ASKED_TO_END"],
    [{ closeInProgress: null }, "NO_CLOSE_IN_PROGRESS"],
    [{ leadEngaged: false }, "LEAD_NOT_ENGAGED"],
    [{ extensionsUsed: 2 }, "MAX_EXTENSIONS_REACHED"],
    [{ elapsedSec: 100 }, "NOT_YET_RED"],
    [{ reservedSec: 300 }, "EXCEEDS_RESERVATION"],
  ];
  for (const [over, reason] of denied) {
    const d = evaluateExtension({ ...base, ...over });
    assert.deepEqual(d, { granted: false, reason }, reason);
  }
});

test("the provider max duration is the absolute ceiling", () => {
  assert.equal(PROVIDER_MAX_DURATION_SEC, 420);
});
