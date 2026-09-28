import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertVoiceAllowed,
  DENIAL_PRODUCT_STATE,
  VOICE_DENIAL_REASONS,
  type VoiceEntitlementSnapshot,
} from "../src/lib/voice/entitlement.ts";

function readyPro(over: Partial<VoiceEntitlementSnapshot> = {}): VoiceEntitlementSnapshot {
  return {
    plan: "pro",
    subscriptionStatus: "active",
    isDemoWorkspace: false,
    voiceCapability: true,
    packaging: { proVoiceItem: true, addonPacksHeld: false, dedicatedNumberItem: false },
    minutes: { includedRemainingSec: 200 * 60, packRemainingSec: 0 },
    killSwitch: { platform: false, workspace: false },
    settings: { voiceEnabled: true },
    identity: { callingAsName: "Acme", legalEntityName: "Acme Studio Ltd", identificationContact: "0800 123 4567" },
    number: { state: "ACTIVE", e164: "+447700900001" },
    ...over,
  };
}

function readyAddon(over: Partial<VoiceEntitlementSnapshot> = {}): VoiceEntitlementSnapshot {
  return readyPro({
    plan: "growth",
    packaging: { proVoiceItem: false, addonPacksHeld: true, dedicatedNumberItem: true },
    minutes: { includedRemainingSec: 0, packRemainingSec: 100 * 60 },
    ...over,
  });
}

test("Pro with the voice item is allowed; source is the item", () => {
  const d = assertVoiceAllowed(readyPro());
  assert.deepEqual(d, { allowed: true, source: "PRO_VOICE_ITEM", availableSec: 12000 });
});

test("Starter and Growth are allowed only with packs and the number item (add-on)", () => {
  for (const plan of ["starter", "growth"] as const) {
    const d = assertVoiceAllowed(readyAddon({ plan }));
    assert.ok(d.allowed && d.source === "ADDON", plan);
  }
  const noPack = assertVoiceAllowed(readyAddon({ packaging: { proVoiceItem: false, addonPacksHeld: false, dedicatedNumberItem: true } }));
  assert.ok(!noPack.allowed && noPack.reason === "NO_VOICE_PACKAGE");
  const noNumberItem = assertVoiceAllowed(readyAddon({ packaging: { proVoiceItem: false, addonPacksHeld: true, dedicatedNumberItem: false } }));
  assert.ok(!noNumberItem.allowed && noNumberItem.reason === "NO_NUMBER");
  // Growth cannot use the Pro item.
  const growthItem = assertVoiceAllowed(readyAddon({ packaging: { proVoiceItem: true, addonPacksHeld: false, dedicatedNumberItem: true } }));
  assert.ok(!growthItem.allowed && growthItem.reason === "NO_VOICE_PACKAGE");
});

test("Pro without the item may use the add-on route (packs + number)", () => {
  const d = assertVoiceAllowed(readyPro({ packaging: { proVoiceItem: false, addonPacksHeld: true, dedicatedNumberItem: true }, minutes: { includedRemainingSec: 0, packRemainingSec: 600 } }));
  assert.ok(d.allowed && d.source === "ADDON");
});

test("every denial reason, with its product state", () => {
  const rows: [string, VoiceEntitlementSnapshot, string, string][] = [
    ["platform kill switch", readyPro({ killSwitch: { platform: true, workspace: false } }), "KILL_SWITCH_PLATFORM", "error"],
    ["workspace kill switch", readyPro({ killSwitch: { platform: false, workspace: true } }), "KILL_SWITCH_WORKSPACE", "error"],
    ["trial plan", readyPro({ plan: "trial", subscriptionStatus: "trialing" }), "TRIAL_ACCOUNT", "plan-limit-reached"],
    ["trialling Pro", readyPro({ subscriptionStatus: "trialing" }), "TRIAL_ACCOUNT", "plan-limit-reached"],
    ["demo", readyPro({ isDemoWorkspace: true }), "DEMO_ACCOUNT", "plan-limit-reached"],
    ["free", readyPro({ plan: "free", subscriptionStatus: "none" }), "FREE_ACCOUNT", "plan-limit-reached"],
    ["past due", readyPro({ subscriptionStatus: "past_due" }), "SUBSCRIPTION_INACTIVE", "plan-limit-reached"],
    ["canceled", readyPro({ subscriptionStatus: "canceled" }), "SUBSCRIPTION_INACTIVE", "plan-limit-reached"],
    ["no capability", readyPro({ voiceCapability: false }), "CAPABILITY_MISSING", "plan-limit-reached"],
    ["no package", readyPro({ packaging: { proVoiceItem: false, addonPacksHeld: false, dedicatedNumberItem: false } }), "NO_VOICE_PACKAGE", "plan-limit-reached"],
    ["no minutes", readyPro({ minutes: { includedRemainingSec: 0, packRemainingSec: 0 } }), "NO_MINUTES", "plan-limit-reached"],
    ["voice off in settings", readyPro({ settings: { voiceEnabled: false } }), "VOICE_DISABLED_IN_SETTINGS", "integration-required"],
    // Second live call 2026-09-28: the assistant off, so every call tool was refused.
    ["AI assistant off", readyPro({ settings: { voiceEnabled: true, aiAssistantOn: false } }), "AI_ASSISTANT_OFF", "integration-required"],
    ["identity missing", readyPro({ identity: { callingAsName: "Acme" } }), "IDENTITY_INCOMPLETE", "integration-required"],
    ["no number", readyPro({ number: null }), "NO_NUMBER", "integration-required"],
    ["number in review", readyPro({ number: { state: "BUNDLE_IN_REVIEW", e164: null } }), "NO_NUMBER", "integration-required"],
    ["number release scheduled", readyPro({ number: { state: "RELEASE_SCHEDULED", e164: "+447700900001" } }), "NO_NUMBER", "integration-required"],
  ];
  const seen = new Set<string>();
  for (const [label, snap, reason, state] of rows) {
    const d = assertVoiceAllowed(snap);
    assert.equal(d.allowed, false, label);
    if (!d.allowed) {
      assert.equal(d.reason, reason, label);
      assert.equal(d.productState, state, label);
      seen.add(d.reason);
    }
  }
  const ins = assertVoiceAllowed(readyPro({ minutes: { includedRemainingSec: 60, packRemainingSec: 0 } }), { requiredSec: 420 });
  assert.ok(!ins.allowed && ins.reason === "INSUFFICIENT_MINUTES" && ins.productState === "plan-limit-reached");
  seen.add("INSUFFICIENT_MINUTES");
  for (const r of VOICE_DENIAL_REASONS) assert.ok(seen.has(r), `reason ${r} has a test`);
  for (const r of VOICE_DENIAL_REASONS) assert.ok(DENIAL_PRODUCT_STATE[r], r);
});

test("reasons are listed in precedence order, kill switch first", () => {
  const d = assertVoiceAllowed(
    readyPro({ plan: "trial", subscriptionStatus: "trialing", killSwitch: { platform: true, workspace: false }, number: null, identity: {} }),
  );
  assert.ok(!d.allowed);
  if (!d.allowed) {
    assert.equal(d.reason, "KILL_SWITCH_PLATFORM");
    assert.deepEqual(d.reasons.slice(0, 2), ["KILL_SWITCH_PLATFORM", "TRIAL_ACCOUNT"]);
    assert.ok(d.reasons.includes("IDENTITY_INCOMPLETE") && d.reasons.includes("NO_NUMBER"));
    assert.ok(d.identityProblems && d.identityProblems.length === 3);
  }
});

test("a trial never places a live call, whatever else is in place", () => {
  const d = assertVoiceAllowed(readyPro({ subscriptionStatus: "trialing" }), { entryPoint: "TEST_CALL" });
  assert.equal(d.allowed, false);
});

test("included minutes and pack minutes both count as available", () => {
  const d = assertVoiceAllowed(readyPro({ minutes: { includedRemainingSec: 100, packRemainingSec: 400 } }), { requiredSec: 420 });
  assert.ok(d.allowed && d.availableSec === 500);
});
