import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSend, type SendGuardSnapshot } from "../src/lib/jobs/send-core.ts";

/**
 * Reactivation sends to imported leads (automation_active = false by design)
 * must not be aborted as "paused"; every safety stop still binds.
 */
function snap(lead: Partial<SendGuardSnapshot["lead"]>, origin: SendGuardSnapshot["origin"] = "campaign"): SendGuardSnapshot {
  return {
    origin,
    lead: {
      status: "CONTACTED",
      optedOut: false,
      humanTakeover: false,
      automationActive: false,
      hasReplied: false,
      ...lead,
    },
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
  } as SendGuardSnapshot;
}
const NOON = new Date("2026-09-26T12:00:00Z");

test("a campaign send to an imported lead with follow-up off is sent", () => {
  assert.equal(evaluateSend(snap({}), NOON).action, "send");
});

test("automation sends still stop when follow-up is paused", () => {
  const d = evaluateSend(snap({}, "automation"), NOON);
  assert.deepEqual(d, { action: "abort", reason: "paused" });
});

test("campaign sends still honour opt-out, takeover, won and lost", () => {
  assert.deepEqual(evaluateSend(snap({ optedOut: true }), NOON), { action: "abort", reason: "opted_out" });
  assert.deepEqual(evaluateSend(snap({ humanTakeover: true }), NOON), { action: "abort", reason: "human_takeover" });
  assert.deepEqual(evaluateSend(snap({ status: "WON" }), NOON), { action: "abort", reason: "won" });
  assert.deepEqual(evaluateSend(snap({ status: "LOST" }), NOON), { action: "abort", reason: "lost" });
});

import { widensAutonomy } from "../src/lib/ai-settings/types.ts";

const SAFE = { enabled: true, agentMode: "SUGGEST_ONLY" as const, allowAiReply: false, agentHandoverOnReview: true };

test("Copilot autonomy guard: widening changes are detected", () => {
  assert.equal(widensAutonomy(SAFE, { ...SAFE, agentMode: "AUTO_REPLY" }), true);
  assert.equal(widensAutonomy(SAFE, { ...SAFE, allowAiReply: true }), true);
  assert.equal(widensAutonomy(SAFE, { ...SAFE, agentHandoverOnReview: false }), true);
  assert.equal(widensAutonomy({ ...SAFE, enabled: false, agentMode: "AUTO_REPLY" }, { ...SAFE, agentMode: "AUTO_REPLY" }), true);
});

test("Copilot autonomy guard: narrowing or neutral changes are allowed", () => {
  assert.equal(widensAutonomy({ ...SAFE, agentMode: "AUTO_REPLY" }, SAFE), false);
  assert.equal(widensAutonomy(SAFE, { ...SAFE, enabled: false }), false);
  assert.equal(widensAutonomy(SAFE, SAFE), false);
});
