import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canSend,
  isWithinQuietHours,
  summariseEligibility,
} from "../src/lib/policy/channel-policy.ts";
import type {
  CompliancePolicyPack,
  PolicyInput,
  PolicyChannel,
} from "../src/lib/policy/types.ts";

/**
 * ChannelPolicyService is the gate every outbound message passes through, so
 * these tests are written from the direction that matters: proving the engine
 * REFUSES things, not that it permits them. A false "allowed" here is a
 * compliance incident, a false "blocked" is only an inconvenience.
 */

const UK_PACK: CompliancePolicyPack = {
  version: "uk-test",
  name: "United Kingdom",
  countryCodes: ["GB"],
  cold: {
    allowedChannels: ["EMAIL"],
    allowedSubscriberTypes: ["CORPORATE", "PARTNERSHIP"],
    reviewSubscriberTypes: ["SOLE_TRADER", "UNKNOWN"],
    blockedSubscriberTypes: ["INDIVIDUAL"],
    requirePostalFooter: true,
    requireUnsubscribe: true,
  },
  warm: {
    allowedChannels: ["EMAIL", "SMS", "WHATSAPP"],
    requireRelationship: true,
    requireUnsubscribe: true,
  },
  quietHours: { start: "20:00", end: "08:00", channels: ["SMS", "WHATSAPP"] },
};

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    channel: "EMAIL",
    campaignType: "COLD",
    country: "GB",
    subscriberType: "CORPORATE",
    relationshipType: "FOUND_BY_US",
    consentStatus: "UNKNOWN",
    hasConsentEvidence: false,
    destination: "buyer@acme.co.uk",
    suppression: null,
    optedOut: false,
    businessActive: true,
    senderAvailable: true,
    senderHealth: "HEALTHY",
    withinDailyCap: true,
    withinMonthlyCap: true,
    withinBudget: true,
    localTime: { hour: 10, minute: 0 },
    pack: UK_PACK,
    ...overrides,
  };
}

/* ------------------------------------------------------------ hard blocks */

test("an opted-out contact is blocked on every channel and campaign type", () => {
  for (const channel of ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"] as PolicyChannel[]) {
    for (const campaignType of ["WARM", "COLD", "REACTIVATION", "TRANSACTIONAL"] as const) {
      const result = canSend(input({ channel, campaignType, optedOut: true }));
      assert.equal(result.outcome, "BLOCKED", `${channel}/${campaignType} should be blocked`);
      assert.equal(result.reasonCode, "BLOCKED_OPT_OUT");
    }
  }
});

test("suppression blocks even when everything else is permitted", () => {
  const result = canSend(
    input({
      campaignType: "WARM",
      relationshipType: "EXISTING_CUSTOMER",
      suppression: { reason: "COMPLAINT", scope: "PLATFORM" },
    }),
  );
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reasonCode, "BLOCKED_OPT_OUT");
  assert.match(result.message, /across ClientTurn/);
});

test("suppression is checked before caps, so the message names the real reason", () => {
  const result = canSend(
    input({ suppression: { reason: "OPT_OUT", scope: "WORKSPACE" }, withinBudget: false }),
  );
  assert.equal(result.reasonCode, "BLOCKED_OPT_OUT");
});

test("an inactive subscription stops outbound", () => {
  const result = canSend(input({ businessActive: false }));
  assert.equal(result.reasonCode, "BLOCKED_BUSINESS_STATE");
});

test("a missing destination is blocked rather than attempted", () => {
  assert.equal(canSend(input({ destination: null })).reasonCode, "BLOCKED_INVALID_CONTACT");
  assert.equal(canSend(input({ destination: "   " })).reasonCode, "BLOCKED_INVALID_CONTACT");
});

/* --------------------------------------------------------- cold channels */

test("cold SMS, WhatsApp and social are refused under the UK pack", () => {
  for (const channel of ["SMS", "WHATSAPP", "SOCIAL"] as PolicyChannel[]) {
    const result = canSend(input({ channel, campaignType: "COLD", destination: "+447700900000" }));
    assert.equal(result.outcome, "BLOCKED", `cold ${channel} must be blocked`);
    assert.equal(result.reasonCode, "BLOCKED_COLD_CHANNEL");
  }
});

test("cold email to a corporate subscriber is allowed with its obligations", () => {
  const result = canSend(input());
  assert.equal(result.outcome, "ALLOWED");
  assert.deepEqual(result.requirements, ["UNSUBSCRIBE_LINK", "POSTAL_FOOTER"]);
  assert.equal(result.policyVersion, "uk-test");
});

test("cold email to an individual is blocked, and to an unknown type is a review", () => {
  assert.equal(
    canSend(input({ subscriberType: "INDIVIDUAL" })).reasonCode,
    "BLOCKED_SUBSCRIBER_TYPE",
  );
  const unknown = canSend(input({ subscriberType: "UNKNOWN" }));
  assert.equal(unknown.outcome, "REVIEW_REQUIRED");
  assert.deepEqual(unknown.requirements, ["HUMAN_REVIEW"]);
});

test("a subscriber type outside an exhaustive allow-list becomes a review, not an allow", () => {
  // SOLE_TRADER is in reviewSubscriberTypes; anything absent from every list
  // still must not fall through to ALLOWED.
  const result = canSend(input({ subscriberType: "SOLE_TRADER" }));
  assert.equal(result.outcome, "REVIEW_REQUIRED");
});

/* ------------------------------------------------- relationship & consent */

test("warm channels need a relationship or evidenced consent", () => {
  const noRelationship = canSend(
    input({ campaignType: "WARM", channel: "SMS", destination: "+447700900000", relationshipType: "UNKNOWN" }),
  );
  assert.equal(noRelationship.outcome, "REQUIRE_CONSENT");
  assert.equal(noRelationship.reasonCode, "BLOCKED_NO_PERMISSION");

  const withRelationship = canSend(
    input({
      campaignType: "WARM",
      channel: "SMS",
      destination: "+447700900000",
      relationshipType: "THEY_CONTACTED_US",
    }),
  );
  assert.equal(withRelationship.outcome, "ALLOWED");
});

test("consent without evidence does not satisfy a relationship requirement", () => {
  const result = canSend(
    input({
      campaignType: "WARM",
      channel: "SMS",
      destination: "+447700900000",
      relationshipType: "UNKNOWN",
      consentStatus: "GRANTED",
      hasConsentEvidence: false,
    }),
  );
  assert.equal(result.outcome, "REQUIRE_CONSENT");
});

test("withdrawn consent blocks outright", () => {
  const result = canSend(
    input({ campaignType: "WARM", relationshipType: "EXISTING_CUSTOMER", consentStatus: "WITHDRAWN" }),
  );
  assert.equal(result.outcome, "BLOCKED");
});

test("'I found this person' never counts as a relationship", () => {
  const result = canSend(
    input({ campaignType: "WARM", channel: "SMS", destination: "+447700900000", relationshipType: "FOUND_BY_US" }),
  );
  assert.equal(result.outcome, "REQUIRE_CONSENT");
});

/* ------------------------------------------------------ sender and caps */

test("a paused sender cannot be overridden", () => {
  const result = canSend(input({ senderHealth: "PAUSED" }));
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reasonCode, "BLOCKED_DOMAIN_HEALTH");
});

test("caps report the cheapest binding limit first", () => {
  assert.equal(canSend(input({ withinBudget: false })).reasonCode, "BLOCKED_COST_BUDGET");
  assert.equal(canSend(input({ withinMonthlyCap: false })).reasonCode, "BLOCKED_MONTHLY_LIMIT");
  assert.equal(canSend(input({ withinDailyCap: false })).reasonCode, "BLOCKED_DAILY_LIMIT");
});

/* ------------------------------------------------------------ quiet hours */

test("quiet hours wrap midnight", () => {
  const rule = { start: "20:00", end: "08:00" };
  assert.equal(isWithinQuietHours({ hour: 21, minute: 0 }, rule), true);
  assert.equal(isWithinQuietHours({ hour: 3, minute: 0 }, rule), true);
  assert.equal(isWithinQuietHours({ hour: 7, minute: 59 }, rule), true);
  assert.equal(isWithinQuietHours({ hour: 8, minute: 0 }, rule), false);
  assert.equal(isWithinQuietHours({ hour: 19, minute: 59 }, rule), false);
});

test("quiet hours apply to SMS but not to email", () => {
  const late = { hour: 22, minute: 30 };
  const sms = canSend(
    input({
      campaignType: "WARM",
      channel: "SMS",
      destination: "+447700900000",
      relationshipType: "EXISTING_CUSTOMER",
      localTime: late,
    }),
  );
  assert.equal(sms.reasonCode, "BLOCKED_QUIET_HOURS");

  const email = canSend(
    input({ campaignType: "WARM", relationshipType: "EXISTING_CUSTOMER", localTime: late }),
  );
  assert.equal(email.outcome, "ALLOWED");
});

/* -------------------------------------------------------------- WhatsApp */

test("WhatsApp requires an approved template even when permitted", () => {
  const result = canSend(
    input({
      campaignType: "WARM",
      channel: "WHATSAPP",
      destination: "+447700900000",
      relationshipType: "EXISTING_CUSTOMER",
    }),
  );
  assert.equal(result.outcome, "REQUIRE_TEMPLATE");
  assert.ok(result.requirements?.includes("APPROVED_TEMPLATE"));
});

/* ---------------------------------------------------- fail-closed packs */

test("a pack that allows nothing blocks everything", () => {
  const emptyPack: CompliancePolicyPack = {
    version: "fail-closed",
    name: "Restricted",
    countryCodes: [],
    cold: { allowedChannels: [] },
    warm: { allowedChannels: [] },
    quietHours: null,
  };
  for (const channel of ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"] as PolicyChannel[]) {
    const result = canSend(input({ channel, pack: emptyPack, destination: "x@y.com" }));
    assert.equal(result.outcome, "BLOCKED");
  }
});

/* ------------------------------------------------------------- summary */

test("eligibility summary ranks suppression above everything", () => {
  const suppressed = canSend(input({ optedOut: true }));
  const allowed = canSend(input());
  assert.equal(summariseEligibility([suppressed, allowed]), "SUPPRESSED");
});

test("one allowed channel makes a contact eligible", () => {
  const blocked = canSend(input({ channel: "SMS", destination: "+447700900000" }));
  const allowed = canSend(input());
  assert.equal(summariseEligibility([blocked, allowed]), "ELIGIBLE");
});

test("no decisions at all is a review, never an allow", () => {
  assert.equal(summariseEligibility([]), "REVIEW");
});

test("review outranks consent-required when neither allows", () => {
  const review = canSend(input({ subscriberType: "UNKNOWN" }));
  const consent = canSend(
    input({ campaignType: "WARM", channel: "SMS", destination: "+447700900000", relationshipType: "UNKNOWN" }),
  );
  assert.equal(summariseEligibility([consent, review]), "REVIEW");
});
