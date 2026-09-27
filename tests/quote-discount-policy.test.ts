import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOUNT_POLICY,
  discountPolicySchema,
  evaluateDiscount,
  policyFromAuthority,
  type DiscountPolicyInput,
  type DiscountProposal,
} from "../src/lib/quotes/discount-policy.ts";
import { DISABLED_AUTHORITY } from "../src/lib/commercial/authority.ts";

const policy: DiscountPolicyInput = {
  restraint: "ONLY_AFTER_OBJECTION",
  aiMaxBps: 1000, // 10%
  aiMaxMinor: 50000, // £500
  firstConcessionMaxBps: 500, // 5% first step
  marginFloorBps: 2000, // 20%
  approvalRules: [
    { id: "big-deal", valueAboveMinor: 2_000_000, role: "admin" },
    { id: "deep-cut", discountAboveBps: 1500, role: "owner" },
    { id: "thin", marginBelowBps: 3000, role: "admin" },
  ],
};

const proposal = (overrides: Partial<DiscountProposal> = {}): DiscountProposal => ({
  actor: { kind: "AI" },
  baseMinor: 500000,
  discountMinor: 25000, // exactly 5%
  valueAfterMinor: 475000,
  marginAfterBps: 3500,
  afterObjection: true,
  priorAiConcessions: 0,
  ...overrides,
});

describe("policy shape", () => {
  test("defaults are the safest: the AI never discounts", () => {
    assert.equal(DEFAULT_DISCOUNT_POLICY.restraint, "NEVER");
    assert.equal(DEFAULT_DISCOUNT_POLICY.aiMaxBps, 0);
    assert.equal(evaluateDiscount(DEFAULT_DISCOUNT_POLICY, proposal()).outcome, "DENY");
  });
  test("first concession cannot exceed the AI maximum", () => {
    assert.equal(discountPolicySchema.safeParse({ aiMaxBps: 500, firstConcessionMaxBps: 600 }).success, false);
  });
  test("an approval rule needs a condition", () => {
    assert.equal(discountPolicySchema.safeParse({ approvalRules: [{ id: "x", role: "admin" }] }).success, false);
  });
});

describe("discount-policy matrix", () => {
  const rows: [string, Partial<DiscountProposal>, Partial<DiscountPolicyInput>, string, string, string?][] = [
    // label, proposal, policy override, outcome, reason, role
    ["no discount", { discountMinor: 0 }, {}, "ALLOW", "NO_DISCOUNT"],
    ["AI first step exactly at 5%", {}, {}, "ALLOW", "WITHIN_POLICY"],
    ["AI first step 1p over 5%", { discountMinor: 25001 }, {}, "DENY", "FIRST_CONCESSION_TOO_LARGE"],
    ["AI above the 10% maximum", { discountMinor: 50001, baseMinor: 500000 }, {}, "DENY", "ABOVE_AI_MAX_PERCENT"],
    ["AI above the £500 cap on a big base", { baseMinor: 2_000_000, discountMinor: 60000, valueAfterMinor: 1_940_000 }, {}, "DENY", "ABOVE_AI_MAX_AMOUNT"],
    ["AI before any objection", { afterObjection: false }, {}, "DENY", "NO_OBJECTION_YET"],
    ["AI proactive mode before objection", { afterObjection: false }, { restraint: "PROACTIVE" }, "ALLOW", "WITHIN_POLICY"],
    ["AI when restraint is NEVER", {}, { restraint: "NEVER" }, "DENY", "RESTRAINT_NEVER"],
    ["AI second concession escalates", { priorAiConcessions: 1, discountMinor: 5000 }, {}, "REQUIRE_APPROVAL", "TWO_STEP_ESCALATION", "owner"],
    ["AI below the margin floor", { marginAfterBps: 1999 }, {}, "DENY", "MARGIN_FLOOR"],
    ["AI with a floor but unknown cost", { marginAfterBps: null }, {}, "DENY", "MARGIN_UNKNOWN"],
    ["AI with no floor and unknown cost", { marginAfterBps: null }, { marginFloorBps: null }, "ALLOW", "WITHIN_POLICY"],
    ["AI within limits on a big deal", { baseMinor: 2_100_000, discountMinor: 50000, valueAfterMinor: 2_050_000 }, {}, "REQUIRE_APPROVAL", "APPROVAL_THRESHOLD", "admin"],
    ["AI within limits on thin margin", { marginAfterBps: 2500 }, {}, "REQUIRE_APPROVAL", "APPROVAL_THRESHOLD", "admin"],
    ["member proposing 20% needs the owner", { actor: { kind: "HUMAN", role: "member" }, discountMinor: 100000 }, {}, "REQUIRE_APPROVAL", "APPROVAL_THRESHOLD", "owner"],
    ["admin proposing 20% still needs the owner", { actor: { kind: "HUMAN", role: "admin" }, discountMinor: 100000 }, {}, "REQUIRE_APPROVAL", "APPROVAL_THRESHOLD", "owner"],
    ["owner proposing 20% is within authority", { actor: { kind: "HUMAN", role: "owner" }, discountMinor: 100000 }, {}, "ALLOW", "WITHIN_APPROVER_AUTHORITY"],
    ["admin on a big deal approves themself", { actor: { kind: "HUMAN", role: "admin" }, valueAfterMinor: 3_000_000 }, {}, "ALLOW", "WITHIN_APPROVER_AUTHORITY"],
    ["member 12% (above AI max, no rule) is allowed", { actor: { kind: "HUMAN", role: "member" }, discountMinor: 60000 }, {}, "ALLOW", "WITHIN_POLICY"],
    ["member below the margin floor needs the owner", { actor: { kind: "HUMAN", role: "member" }, marginAfterBps: 1000 }, {}, "REQUIRE_APPROVAL", "MARGIN_FLOOR", "owner"],
    ["owner below the margin floor still meets the thin-margin rule", { actor: { kind: "HUMAN", role: "owner" }, marginAfterBps: 1000 }, {}, "ALLOW", "WITHIN_APPROVER_AUTHORITY"],
    ["a discount larger than the base", { discountMinor: 500001 }, {}, "DENY", "INVALID_DISCOUNT"],
    ["a negative discount", { discountMinor: -1 }, {}, "DENY", "INVALID_DISCOUNT"],
    ["a float discount", { discountMinor: 10.5 }, {}, "DENY", "INVALID_DISCOUNT"],
  ];
  for (const [label, overrides, policyOverride, outcome, reason, role] of rows) {
    test(label, () => {
      const decision = evaluateDiscount({ ...policy, ...policyOverride }, proposal(overrides));
      assert.equal(decision.outcome, outcome, JSON.stringify(decision));
      assert.equal(decision.reason, reason);
      if (role) assert.equal(decision.outcome === "REQUIRE_APPROVAL" ? decision.role : null, role);
    });
  }

  test("a denied AI discount says the largest it could offer", () => {
    const decision = evaluateDiscount(policy, proposal({ discountMinor: 40000 }));
    assert.equal(decision.outcome, "DENY");
    if (decision.outcome === "DENY") assert.equal(decision.maxAllowedMinor, 25000);
    const capped = evaluateDiscount(policy, proposal({ baseMinor: 2_000_000, discountMinor: 60000 }));
    if (capped.outcome === "DENY") assert.equal(capped.maxAllowedMinor, 50000);
  });

  test("percentages are compared exactly, not via a rounded percent", () => {
    // 1/3 base: 33.333...% vs a 33.33% cap
    const tight = { ...policy, restraint: "PROACTIVE" as const, aiMaxBps: 3333, firstConcessionMaxBps: 3333, approvalRules: [], marginFloorBps: null };
    assert.equal(evaluateDiscount(tight, proposal({ baseMinor: 3, discountMinor: 1 })).outcome, "DENY");
    assert.equal(evaluateDiscount(tight, proposal({ baseMinor: 30000, discountMinor: 9999 })).outcome, "ALLOW");
  });

  test("matched rule ids are reported", () => {
    const decision = evaluateDiscount(policy, proposal({ actor: { kind: "HUMAN", role: "member" }, discountMinor: 100000, valueAfterMinor: 3_000_000 }));
    assert.equal(decision.outcome, "REQUIRE_APPROVAL");
    if (decision.outcome === "REQUIRE_APPROVAL") assert.deepEqual(decision.matchedRuleIds, ["big-deal", "deep-cut"]);
  });
});

describe("bridge from commercial_authority (0125)", () => {
  test("disabled authority: no AI discount", () => {
    const bridged = policyFromAuthority(DISABLED_AUTHORITY);
    assert.equal(bridged.restraint, "NEVER");
    assert.equal(bridged.aiMaxBps, 0);
  });
  test("max_discount_percent 12.5 becomes 1250 bps after objection, value ceiling becomes admin approval", () => {
    const bridged = policyFromAuthority({
      enabled: true,
      approved_checkout_links: [],
      max_discount_percent: 12.5,
      requires_human_above_value_minor: 1_000_000,
    });
    assert.equal(bridged.restraint, "ONLY_AFTER_OBJECTION");
    assert.equal(bridged.aiMaxBps, 1250);
    assert.deepEqual(bridged.approvalRules, [{ id: "authority-value-ceiling", valueAboveMinor: 1_000_000, role: "admin" }]);
  });
});
