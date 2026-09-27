import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advisoryLockId,
  canCallLead,
  ELIGIBILITY_DENIALS,
  voiceCallKey,
  voiceLeadLockKey,
  type CanCallLeadInput,
} from "../src/lib/voice/eligibility.ts";

// Monday 28 Sep 2026, 11:00 BST.
const NOW = new Date("2026-09-28T10:00:00Z");

function input(over: Partial<CanCallLeadInput> = {}, lead: Partial<CanCallLeadInput["lead"]> = {}, consent: Partial<CanCallLeadInput["consent"]> = {}): CanCallLeadInput {
  const base: CanCallLeadInput = {
    now: NOW,
    callKind: "AI_AUTOMATED",
    lead: {
      phone: "07700 900123",
      phoneSource: "LEAD_FORM",
      timezone: null,
      ukRegion: "ENGLAND_AND_WALES",
      anonymised: false,
      suppressed: false,
      optedOut: false,
      voiceOptedOut: false,
      subscriberType: "CORPORATE",
      tpsListed: null,
      ctpsListed: null,
    },
    consent: { basis: "CALL_REQUESTED", capturedAt: new Date("2026-09-28T09:30:00Z"), withdrawn: false, evidenceText: null },
    attempts: { total: 0, last24h: 0, lastAttemptAt: null },
    entitlement: { allowed: true, source: "PRO_VOICE_ITEM", availableSec: 12000 },
    workspace: { timezone: "Europe/London" },
    activeCall: false,
  };
  return { ...base, ...over, lead: { ...base.lead, ...lead }, consent: { ...base.consent, ...consent } };
}

test("a fresh call request, in hours, entitled, is allowed", () => {
  const r = canCallLead(input());
  assert.deepEqual(r, {
    allowed: true,
    reason: null,
    basis: "CALL_REQUESTED",
    e164: "+447700900123",
    destinationClass: "UK_MOBILE",
    timezone: "Europe/London",
    timezoneSource: "PHONE_COUNTRY",
  });
});

test("form consent to be called is allowed with its wording stored", () => {
  const ok = canCallLead(input({}, {}, { basis: "FORM_CONSENT_TO_CALL", evidenceText: "Tick to agree we may call you, including by an AI assistant." }));
  assert.equal(ok.allowed, true);
});

test("PHONE_NUMBER_PROVIDED alone never supports an AI call (PECR reg 19)", () => {
  const r = canCallLead(input({}, {}, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.ok(!r.allowed);
  if (!r.allowed) {
    assert.equal(r.reason, "CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL");
    assert.deepEqual(r.alternatives, ["HUMAN_CALL", "ASK_PERMISSION_MESSAGE"]);
  }
});

test("PHONE_NUMBER_PROVIDED supports a HUMAN call once TPS/CTPS is screened clear", () => {
  const human = { callKind: "HUMAN" as const, entitlement: null };
  const clear = canCallLead(input(human, { ctpsListed: false }, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.equal(clear.allowed, true);
  const unscreened = canCallLead(input(human, {}, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.ok(!unscreened.allowed && unscreened.reason === "TPS_NOT_SCREENED");
  const ctps = canCallLead(input(human, { ctpsListed: true }, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.ok(!ctps.allowed && ctps.reason === "CTPS_LISTED");
  const tps = canCallLead(input(human, { subscriberType: "SOLE_TRADER", tpsListed: true }, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.ok(!tps.allowed && tps.reason === "TPS_LISTED");
  // Individuals and partnerships screen TPS, not CTPS.
  const ind = canCallLead(input(human, { subscriberType: "INDIVIDUAL", tpsListed: false, ctpsListed: true }, { basis: "PHONE_NUMBER_PROVIDED" }));
  assert.equal(ind.allowed, true);
});

test("consent overrides a TPS/CTPS listing", () => {
  const r = canCallLead(input({}, { ctpsListed: true, tpsListed: true }));
  assert.equal(r.allowed, true);
  const human = canCallLead(input({ callKind: "HUMAN", entitlement: null }, { tpsListed: true, subscriberType: "SOLE_TRADER" }));
  assert.equal(human.allowed, true);
});

test("every denial reason is reachable, and first in its own case", () => {
  const rows: [string, CanCallLeadInput, string][] = [
    ["anonymised", input({}, { anonymised: true }), "LEAD_ANONYMISED"],
    ["suppressed", input({}, { suppressed: true }), "SUPPRESSED"],
    ["opted out", input({}, { optedOut: true }), "OPTED_OUT"],
    ["voice opt-out", input({}, { voiceOptedOut: true }), "VOICE_OPTED_OUT"],
    ["no phone", input({}, { phone: null }), "NO_PHONE"],
    ["invalid phone", input({}, { phone: "call me" }), "INVALID_PHONE"],
    ["enrichment phone", input({}, { phoneSource: "ENRICHMENT" }), "PHONE_NOT_LEAD_SUPPLIED"],
    ["premium number", input({}, { phone: "0906 123 4567" }), "DESTINATION_BLOCKED"],
    ["non-UK", input({}, { phone: "+1 415 555 0100", timezone: "America/Los_Angeles" }), "DESTINATION_BLOCKED"],
    ["surcharged mobile", input({ destination: { providerRate: 0.32 } }), "RATE_CAP_EXCEEDED"],
    ["no basis", input({}, {}, { basis: null }), "NO_CONSENT_BASIS"],
    ["withdrawn", input({}, {}, { withdrawn: true }), "CONSENT_WITHDRAWN"],
    ["form consent no wording", input({}, {}, { basis: "FORM_CONSENT_TO_CALL", evidenceText: "  " }), "CONSENT_EVIDENCE_MISSING"],
    ["call request undated", input({}, {}, { capturedAt: null }), "CONSENT_EVIDENCE_MISSING"],
    ["stale request", input({}, {}, { capturedAt: new Date("2026-08-01T10:00:00Z") }), "CONSENT_STALE"],
    ["number provided only", input({}, {}, { basis: "PHONE_NUMBER_PROVIDED" }), "CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL"],
    ["tps", input({ callKind: "HUMAN", entitlement: null }, { subscriberType: "SOLE_TRADER", tpsListed: true }, { basis: "PHONE_NUMBER_PROVIDED" }), "TPS_LISTED"],
    ["ctps", input({ callKind: "HUMAN", entitlement: null }, { ctpsListed: true }, { basis: "PHONE_NUMBER_PROVIDED" }), "CTPS_LISTED"],
    ["unscreened", input({ callKind: "HUMAN", entitlement: null }, {}, { basis: "PHONE_NUMBER_PROVIDED" }), "TPS_NOT_SCREENED"],
    ["no entitlement", input({ entitlement: null }), "VOICE_NOT_ENTITLED"],
    [
      "entitlement denied",
      input({ entitlement: { allowed: false, reason: "IDENTITY_INCOMPLETE", productState: "integration-required", reasons: ["IDENTITY_INCOMPLETE"] } }),
      "VOICE_NOT_ENTITLED",
    ],
    ["unresolved tz", input({ workspace: { timezone: null } }, { phone: "+1 415 555 0100", phoneSource: "LEAD_FORM" }), "DESTINATION_BLOCKED"],
    ["out of hours", input({ now: new Date("2026-09-28T20:30:00Z") }), "OUTSIDE_CALLING_HOURS"],
    ["attempt cap", input({ attempts: { total: 3, last24h: 0, lastAttemptAt: null } }), "ATTEMPT_CAP_TOTAL"],
    ["daily cap", input({ attempts: { total: 2, last24h: 2, lastAttemptAt: null } }), "ATTEMPT_CAP_DAILY"],
    ["too soon", input({ attempts: { total: 1, last24h: 1, lastAttemptAt: new Date("2026-09-28T09:30:00Z") } }), "ATTEMPT_TOO_SOON"],
    ["active call", input({ activeCall: true }), "CALL_ALREADY_ACTIVE"],
  ];
  const seen = new Set<string>();
  for (const [label, inp, reason] of rows) {
    const r = canCallLead(inp);
    assert.equal(r.allowed, false, label);
    if (!r.allowed) {
      assert.equal(r.reason, reason, label);
      for (const x of r.reasons) seen.add(x);
    }
  }
  // TIMEZONE_UNRESOLVED on its own: a UK number cannot produce it, so check
  // it is reported alongside the blocked non-UK number above.
  const tz = canCallLead(input({ workspace: { timezone: null } }, { phone: "+1 415 555 0100" }));
  assert.ok(!tz.allowed && tz.reasons.includes("TIMEZONE_UNRESOLVED"));
  seen.add("TIMEZONE_UNRESOLVED");
  for (const r of ELIGIBILITY_DENIALS) assert.ok(seen.has(r), `denial ${r} has a test`);
});

test("details: entitlement reason, calling-hours reason and next eligible time", () => {
  const ent = canCallLead(
    input({ entitlement: { allowed: false, reason: "NO_MINUTES", productState: "plan-limit-reached", reasons: ["NO_MINUTES"] } }),
  );
  assert.ok(!ent.allowed && ent.detail.entitlement === "NO_MINUTES");
  const late = canCallLead(input({ now: new Date("2026-09-28T19:30:00Z") })); // 20:30 BST
  assert.ok(!late.allowed && late.detail.callingHours === "AFTER_WINDOW");
  if (!late.allowed) assert.equal(late.detail.nextEligibleAt?.toISOString(), "2026-09-29T08:00:00.000Z");
  const soon = canCallLead(input({ attempts: { total: 1, last24h: 1, lastAttemptAt: new Date("2026-09-28T09:30:00Z") } }));
  if (!soon.allowed) assert.equal(soon.detail.nextEligibleAt?.toISOString(), "2026-09-28T11:30:00.000Z");
});

test("recipient timezone wins: a Paris lead is not called at 08:30 Paris time", () => {
  // 06:30Z = 08:30 Paris (CEST) / 07:30 London: closed in both, but the lead tz is the one used.
  const r = canCallLead(input({ now: new Date("2026-09-28T06:30:00Z") }, { timezone: "Europe/Paris" }));
  assert.ok(!r.allowed && r.reason === "OUTSIDE_CALLING_HOURS");
  // 07:30Z = 09:30 Paris (open) but 08:30 London (closed): Paris decides.
  const open = canCallLead(input({ now: new Date("2026-09-28T07:30:00Z") }, { timezone: "Europe/Paris" }));
  assert.ok(open.allowed && open.timezone === "Europe/Paris" && open.timezoneSource === "LEAD");
});

test("bank holiday in the lead's region blocks the call", () => {
  const r = canCallLead(input({ now: new Date("2026-08-31T10:00:00Z") }));
  assert.ok(!r.allowed && r.detail.callingHours === "BANK_HOLIDAY");
});

test("many reasons are all listed, ordered, with the first as reason", () => {
  const r = canCallLead(input({ activeCall: true }, { suppressed: true, phoneSource: "IMPORT" }, { basis: null }));
  assert.ok(!r.allowed);
  if (!r.allowed) {
    assert.deepEqual(r.reasons, ["SUPPRESSED", "PHONE_NOT_LEAD_SUPPLIED", "NO_CONSENT_BASIS", "CALL_ALREADY_ACTIVE"]);
    assert.equal(r.reason, "SUPPRESSED");
  }
});

test("lock and call keys are stable and scoped", () => {
  assert.equal(voiceLeadLockKey("b1", "l1"), "voice:lead:b1:l1");
  assert.equal(voiceCallKey("b1", "l1", "QUALIFICATION", 2), "voice:call:b1:l1:QUALIFICATION:2");
  assert.throws(() => voiceCallKey("b1", "l1", "QUALIFICATION", 0));
  assert.equal(advisoryLockId("voice:lead:b1:l1"), advisoryLockId("voice:lead:b1:l1"));
  assert.notEqual(advisoryLockId("voice:lead:b1:l1"), advisoryLockId("voice:lead:b1:l2"));
  const id = advisoryLockId("x");
  assert.ok(Number.isInteger(id) && id >= -(2 ** 31) && id < 2 ** 31);
});
