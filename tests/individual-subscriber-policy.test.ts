import { test } from "node:test";
import assert from "node:assert/strict";

import { canSend, individualMarketingBasis } from "../src/lib/policy/channel-policy.ts";
import { subscriberTypeForRegistryEntry } from "../src/lib/policy/subscriber-classification.ts";
import { isPromotional, promotionalFindings } from "../src/lib/policy/promotional-content.ts";
import type {
  CompliancePolicyPack,
  PolicyInput,
  RelationshipType,
  SubscriberType,
} from "../src/lib/policy/types.ts";

/**
 * docs/revenue-engine/00 §6 (Q4, §6.1): who is an individual subscriber, and
 * what a relationship with one permits. Written from the refusal side: a false
 * "allowed" is a PECR breach, a false "blocked" is an inconvenience.
 */

// Mirrors uk-2026.09.3 (migration 0110).
const UK: CompliancePolicyPack = {
  version: "uk-2026.09.3",
  name: "United Kingdom",
  countryCodes: ["GB"],
  cold: {
    allowedChannels: ["EMAIL"],
    allowedSubscriberTypes: ["CORPORATE"],
    reviewSubscriberTypes: ["UNKNOWN"],
    blockedSubscriberTypes: ["SOLE_TRADER", "PARTNERSHIP", "INDIVIDUAL"],
    requirePostalFooter: true,
    requireUnsubscribe: true,
  },
  warm: {
    allowedChannels: ["EMAIL", "SMS", "WHATSAPP", "SOCIAL"],
    requireRelationship: true,
    requireUnsubscribe: true,
    individualSubscriberTypes: ["SOLE_TRADER", "PARTNERSHIP", "INDIVIDUAL", "UNKNOWN"],
  },
  quietHours: { start: "20:00", end: "08:00", channels: ["SMS", "WHATSAPP"] },
};

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    channel: "SOCIAL",
    campaignType: "WARM",
    country: "GB",
    subscriberType: "SOLE_TRADER",
    relationshipType: "ACCEPTED_SOCIAL_CONNECTION",
    consentStatus: "UNKNOWN",
    hasConsentEvidence: false,
    sourcePermitted: "PERMITTED",
    destination: "https://www.linkedin.com/in/someone",
    suppression: null,
    optedOut: false,
    businessActive: true,
    senderAvailable: true,
    senderHealth: "HEALTHY",
    withinDailyCap: true,
    withinMonthlyCap: true,
    withinBudget: true,
    localTime: { hour: 10, minute: 0 },
    withinWhatsAppWindow: false,
    pack: UK,
    ...overrides,
  };
}

/* ------------------------------------------------------------ cold (Q4) */

test("cold email to a sole trader or non-Scottish partnership is blocked, not reviewed", () => {
  for (const subscriberType of ["SOLE_TRADER", "PARTNERSHIP", "INDIVIDUAL"] as SubscriberType[]) {
    const decision = canSend(
      input({ channel: "EMAIL", campaignType: "COLD", subscriberType, relationshipType: "FOUND_BY_US", destination: "a@b.co.uk" }),
    );
    assert.equal(decision.outcome, "BLOCKED", subscriberType);
    assert.equal(decision.reasonCode, "BLOCKED_SUBSCRIBER_TYPE");
  }
});

test("cold email to an unknown subscriber type goes to review with its own reason code", () => {
  const decision = canSend(
    input({ channel: "EMAIL", campaignType: "COLD", subscriberType: "UNKNOWN", relationshipType: "FOUND_BY_US", destination: "a@b.co.uk" }),
  );
  assert.equal(decision.outcome, "REVIEW_REQUIRED");
  assert.equal(decision.reasonCode, "REVIEW_SUBSCRIBER_TYPE");
});

test("cold email to a corporate subscriber is still allowed", () => {
  const decision = canSend(
    input({ channel: "EMAIL", campaignType: "COLD", subscriberType: "CORPORATE", relationshipType: "FOUND_BY_US", destination: "a@b.co.uk" }),
  );
  assert.equal(decision.outcome, "ALLOWED");
});

/* ------------------------------------------------------- warm (§6.1) */

test("an individual who accepted our connection may be spoken to, not marketed to", () => {
  const decision = canSend(input());
  assert.equal(decision.outcome, "ALLOWED");
  assert.ok(decision.requirements?.includes("NON_PROMOTIONAL_ONLY"));
});

test("a corporate subscriber who accepted our connection has no conversation-only limit", () => {
  const decision = canSend(input({ subscriberType: "CORPORATE" }));
  assert.equal(decision.outcome, "ALLOWED");
  assert.ok(!decision.requirements?.includes("NON_PROMOTIONAL_ONLY"));
});

test("an unknown subscriber type is treated as an individual, never assumed corporate", () => {
  const decision = canSend(input({ subscriberType: "UNKNOWN" }));
  assert.ok(decision.requirements?.includes("NON_PROMOTIONAL_ONLY"));
});

test("contact, custom, negotiation or evidenced consent permit marketing to an individual", () => {
  const permitting: RelationshipType[] = [
    "THEY_CONTACTED_US",
    "REQUESTED_INFORMATION",
    "EXISTING_CUSTOMER",
    "EXISTING_BUSINESS_RELATIONSHIP",
  ];
  for (const relationshipType of permitting) {
    const decision = canSend(input({ relationshipType, channel: "EMAIL", destination: "a@b.co.uk" }));
    assert.equal(decision.outcome, "ALLOWED", relationshipType);
    assert.ok(!decision.requirements?.includes("NON_PROMOTIONAL_ONLY"), relationshipType);
  }
  const consented = canSend(
    input({ relationshipType: "EXPLICIT_MARKETING_CONSENT", hasConsentEvidence: true, channel: "EMAIL", destination: "a@b.co.uk" }),
  );
  assert.equal(consented.outcome, "ALLOWED");
});

test("referral, import, other and an unevidenced consent claim need consent first", () => {
  for (const relationshipType of ["REFERRAL", "IMPORTED", "OTHER"] as RelationshipType[]) {
    const decision = canSend(input({ relationshipType, channel: "EMAIL", destination: "a@b.co.uk" }));
    assert.equal(decision.outcome, "REQUIRE_CONSENT", relationshipType);
  }
  assert.equal(
    individualMarketingBasis({ relationshipType: "EXPLICIT_MARKETING_CONSENT", consentStatus: "UNKNOWN", hasConsentEvidence: false }),
    "NONE",
  );
});

test("transactional messages are not marketing and are not limited by the individual rule", () => {
  const decision = canSend(input({ campaignType: "TRANSACTIONAL", relationshipType: "IMPORTED", channel: "EMAIL", destination: "a@b.co.uk" }));
  assert.notEqual(decision.outcome, "REQUIRE_CONSENT");
});

test("suppression still beats every relationship", () => {
  const decision = canSend(
    input({ relationshipType: "EXISTING_CUSTOMER", suppression: { reason: "OPT_OUT", scope: "WORKSPACE" } }),
  );
  assert.equal(decision.reasonCode, "BLOCKED_OPT_OUT");
});

/* ------------------------------------------------------- WhatsApp (B25) */

test("a business-initiated WhatsApp message needs an explicit WhatsApp opt-in", () => {
  const base = { channel: "WHATSAPP" as const, subscriberType: "CORPORATE" as const, relationshipType: "THEY_CONTACTED_US" as const, destination: "+447700900000" };
  assert.equal(canSend(input({ ...base, whatsAppOptIn: false })).outcome, "REQUIRE_CONSENT");
  assert.equal(canSend(input({ ...base, whatsAppOptIn: true })).outcome, "REQUIRE_TEMPLATE");
  // Inside the 24-hour window they just messaged us: that is their conversation.
  assert.equal(canSend(input({ ...base, withinWhatsAppWindow: true })).outcome, "ALLOWED");
});

/* ------------------------------------------- Companies House mapping */

test("registry classification: LLP and Scottish partnerships are corporate, English LPs are not", () => {
  assert.equal(subscriberTypeForRegistryEntry("ltd", "01234567"), "CORPORATE");
  assert.equal(subscriberTypeForRegistryEntry("llp", "OC123456"), "CORPORATE");
  assert.equal(subscriberTypeForRegistryEntry("scottish-partnership", "SG000123"), "CORPORATE");
  assert.equal(subscriberTypeForRegistryEntry("limited-partnership", "SL012345"), "CORPORATE");
  assert.equal(subscriberTypeForRegistryEntry("limited-partnership", "LP012345"), "PARTNERSHIP");
  assert.equal(subscriberTypeForRegistryEntry("limited-partnership", "NL000123"), "PARTNERSHIP");
  assert.equal(subscriberTypeForRegistryEntry("some-new-type", "01234567"), "UNKNOWN");
  assert.equal(subscriberTypeForRegistryEntry(null, null), "UNKNOWN");
});

/* ------------------------------------------- promotional content lint */

test("promotional content is detected deterministically", () => {
  for (const text of [
    "We help agencies like yours win more clients.",
    "Fancy a quick call next week?",
    "Our service starts at £99 per month.",
    "Book a demo here: https://example.com/demo",
    "Acme works with SaaS teams on onboarding.",
    "We're running a free trial this month.",
  ]) {
    assert.ok(isPromotional(text), text);
  }
});

test("a genuine conversational message is not flagged", () => {
  for (const text of [
    "Thanks for connecting, Sam. Good to be in touch.",
    "Thanks for the comment, Sam — replying here rather than in the thread.\n\nWas there something specific you wanted to know?",
    "Congrats on the new studio. How are you finding the move?",
  ]) {
    assert.deepEqual(promotionalFindings(text), [], text);
  }
});
