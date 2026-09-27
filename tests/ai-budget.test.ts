import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideSpend,
  DEFAULT_LEAD_TOKEN_CEILING,
  estimateCostMinor,
  expectedValueMinor,
  remainingFromBudgets,
  tierFromDecision,
  type BudgetRemaining,
  type DecideSpendInput,
} from "../src/lib/ai/budget.ts";
import {
  buildTierConfig,
  FALLBACK_TIER_CONFIG,
  FALLBACK_TIERS,
  TASK_TOKEN_ENVELOPES,
  type TierConfig,
} from "../src/lib/ai/tiers.ts";

/**
 * The budget manager (Phase 4). Pure: every rule in budget.ts's header is
 * exercised here without a database.
 */

/** Routes that allow downgrade and upgrade, with tier 3 enabled. */
const WIDE: TierConfig = buildTierConfig(
  [
    { tier: 3, provider: "azure_openai", deploymentAlias: "mini", deploymentName: "gpt-big", inputPricePer1m: 2, cachedInputPricePer1m: 0.2, outputPricePer1m: 10, enabled: true },
  ],
  [
    { taskType: "reply_generation", defaultTier: 2, allowedTiers: [1, 2] },
    { taskType: "agent_decision", defaultTier: 2, allowedTiers: [1, 2, 3] },
    { taskType: "research_summary", defaultTier: 2, allowedTiers: [1, 2, 3] },
  ],
);

function decide(overrides: Partial<DecideSpendInput> = {}) {
  return decideSpend({
    taskType: "reply_generation",
    config: FALLBACK_TIER_CONFIG,
    remaining: {},
    ...overrides,
  });
}

describe("fallback: an empty database behaves as before", () => {
  test("structured tasks run on tier 1 (nano), generation on tier 2 (mini)", () => {
    assert.equal(decide({ taskType: "intent_classification" }).decision, "TIER_1");
    assert.equal(decide({ taskType: "answer_extraction" }).decision, "TIER_1");
    assert.equal(decide({ taskType: "website_contacts" }).decision, "TIER_1");
    assert.equal(decide({ taskType: "reply_generation" }).decision, "TIER_2");
    assert.equal(decide({ taskType: "agent_decision" }).decision, "TIER_2");
  });

  test("no value facts and no budgets = the default tier", () => {
    const result = decide({ taskType: "variant_generation" });
    assert.equal(result.decision, "TIER_2");
    assert.equal(result.reason, "DEFAULT_TIER");
    assert.equal(result.expectedValueMinor, null);
  });

  test("tier 3 without a deployment name is never enabled", () => {
    const config = buildTierConfig([{ tier: 3, deploymentAlias: "mini", enabled: true }], []);
    assert.equal(config.tiers[3].enabled, false);
  });

  test("a route pointing at a disabled tier is ignored", () => {
    const config = buildTierConfig([], [{ taskType: "reply_generation", defaultTier: 4, allowedTiers: [4] }]);
    assert.deepEqual(config.routes.reply_generation, FALLBACK_TIER_CONFIG.routes.reply_generation);
  });
});

describe("EMERGENCY is a hard stop", () => {
  const exhausted: BudgetRemaining = { EMERGENCY: { remainingMinor: 0, remainingTokens: null } };

  test("a live conversation goes to a person", () => {
    const result = decide({ taskType: "agent_decision", stage: "ENGAGED", remaining: exhausted });
    assert.equal(result.decision, "HUMAN");
    assert.equal(result.reason, "EMERGENCY_CEILING");
  });

  test("background work is skipped", () => {
    const result = decide({ taskType: "research_summary", stage: "PRE_REPLY", remaining: exhausted });
    assert.equal(result.decision, "SKIP");
    assert.equal(result.reason, "EMERGENCY_CEILING");
  });

  test("even safety classification stops", () => {
    const result = decide({ taskType: "intent_classification", stage: "ENGAGED", remaining: exhausted });
    assert.equal(result.decision, "SKIP");
    assert.equal(result.reason, "EMERGENCY_CEILING");
  });
});

describe("safety classification floor", () => {
  test("never below tier 1, whatever the value or the soft budgets", () => {
    const result = decide({
      taskType: "social_reply_classification",
      stage: "PRE_REPLY",
      dealSizeBand: "MICRO",
      grade: "D",
      remaining: {
        LEAD: { remainingMinor: -5, remainingTokens: null },
        PRE_REPLY: { remainingMinor: 0, remainingTokens: 0 },
        PLAN: { remainingMinor: 0, remainingTokens: null },
      },
    });
    assert.equal(result.decision, "TIER_1");
    assert.equal(result.reason, "SAFETY_FLOOR");
  });
});

describe("soft budgets", () => {
  test("a lead past its ceiling in a live conversation goes to a person", () => {
    const result = decide({
      stage: "ENGAGED",
      remaining: { LEAD: { remainingMinor: 0, remainingTokens: null } },
    });
    assert.equal(result.decision, "HUMAN");
    assert.equal(result.reason, "BUDGET_LEAD");
  });

  test("pre-reply spend past its ceiling is skipped, not escalated", () => {
    const result = decide({
      taskType: "research_summary",
      stage: "PRE_REPLY",
      remaining: { PRE_REPLY: { remainingMinor: 0, remainingTokens: null } },
    });
    assert.equal(result.decision, "SKIP");
    assert.equal(result.reason, "BUDGET_PRE_REPLY");
  });

  test("a tight budget downgrades to a cheaper allowed tier", () => {
    const tier2 = estimateCostMinor(WIDE.tiers[2], TASK_TOKEN_ENVELOPES.reply_generation);
    const tier1 = estimateCostMinor(WIDE.tiers[1], TASK_TOKEN_ENVELOPES.reply_generation);
    const result = decide({
      config: WIDE,
      remaining: { PLAN: { remainingMinor: (tier1 + tier2) / 2, remainingTokens: null } },
    });
    assert.equal(result.decision, "TIER_1");
    assert.equal(result.reason, "DOWNGRADED_BUDGET");
  });

  test("an opportunity uses its own, larger ceiling instead of the lead's", () => {
    const result = decide({
      stage: "OPPORTUNITY",
      remaining: {
        LEAD: { remainingMinor: 0, remainingTokens: null },
        OPPORTUNITY: { remainingMinor: 500, remainingTokens: null },
      },
    });
    assert.equal(result.decision, "TIER_2");
  });

  test("a token ceiling is enforced as well as a money one", () => {
    const result = decide({
      stage: "ENGAGED",
      remaining: { WORKSPACE_MONTH: { remainingMinor: null, remainingTokens: 10 } },
    });
    assert.equal(result.decision, "HUMAN");
    assert.equal(result.reason, "BUDGET_WORKSPACE_MONTH");
  });
});

describe("value-aware routing", () => {
  test("expected value = band value x grade probability x stage factor", () => {
    // MID = £15,000; grade B = 0.2; ENGAGED = 1 -> £3,000 = 300,000p.
    assert.equal(expectedValueMinor({ dealSizeBand: "MID", grade: "B", stage: "ENGAGED" }), 300_000);
    // A score stands in for a missing grade.
    assert.equal(expectedValueMinor({ dealSizeBand: "MID", score: 65, stage: "ENGAGED" }), 300_000);
    assert.equal(expectedValueMinor({ dealSizeBand: null, grade: "A" }), null);
    assert.equal(expectedValueMinor({ dealSizeBand: "MID" }), null);
  });

  test("spend is refused when EV x lift does not beat the cost", () => {
    const result = decide({
      stage: "ENGAGED",
      dealSizeBand: "MICRO",
      grade: "D",
      lift: 0.000001,
    });
    assert.equal(result.decision, "SKIP");
    assert.equal(result.reason, "LOW_VALUE");
  });

  test("the channel cost counts against the value", () => {
    const base = { stage: "ENGAGED" as const, dealSizeBand: "MICRO" as const, grade: "D" as const };
    assert.equal(decide(base).decision, "TIER_2");
    assert.equal(decide({ ...base, channelCostMinor: 1_000 }).decision, "SKIP");
  });

  test("low value downgrades before it refuses", () => {
    const tier2 = estimateCostMinor(WIDE.tiers[2], TASK_TOKEN_ENVELOPES.reply_generation);
    const ev = expectedValueMinor({ dealSizeBand: "MICRO", grade: "D", stage: "ENGAGED" })!;
    // Pick a lift where tier 2 fails and tier 1 passes.
    const lift = (tier2 * 0.5) / ev;
    const result = decide({ config: WIDE, stage: "ENGAGED", dealSizeBand: "MICRO", grade: "D", lift });
    assert.equal(result.decision, "TIER_1");
    assert.equal(result.reason, "DOWNGRADED_VALUE");
  });

  test("a valuable opportunity may upgrade to a higher allowed tier", () => {
    const result = decide({
      config: WIDE,
      taskType: "agent_decision",
      stage: "OPPORTUNITY",
      dealSizeBand: "ENTERPRISE",
      grade: "A",
    });
    assert.equal(result.decision, "TIER_3");
    assert.equal(result.reason, "UPGRADED_VALUE");
  });

  test("pre-reply work is never upgraded past the pre-reply cap", () => {
    const result = decide({
      config: WIDE,
      taskType: "research_summary",
      stage: "PRE_REPLY",
      dealSizeBand: "ENTERPRISE",
      grade: "A",
    });
    assert.equal(tierFromDecision(result.decision)! <= 2, true);
  });
});

describe("remainingFromBudgets", () => {
  const budgets = [
    { scope: "PLAN" as const, businessId: null, planKey: "starter", ceilingMinor: 1_500, ceilingTokens: null },
    { scope: "PLAN" as const, businessId: null, planKey: "pro", ceilingMinor: 15_000, ceilingTokens: null },
    { scope: "LEAD" as const, businessId: null, planKey: null, ceilingMinor: 200, ceilingTokens: null },
    { scope: "LEAD" as const, businessId: "biz", planKey: null, ceilingMinor: 50, ceilingTokens: null },
    { scope: "EMERGENCY" as const, businessId: null, planKey: null, ceilingMinor: 50_000, ceilingTokens: null },
  ];
  const spend = { workspaceMinor: 1_000, workspaceTokens: 0, leadMinor: 20, leadTokens: 0 };

  test("the plan row matches the workspace's plan; a workspace row overrides the default", () => {
    const remaining = remainingFromBudgets({ budgets, plan: "starter", spend, hasLead: true });
    assert.equal(remaining.PLAN?.remainingMinor, 500);
    assert.equal(remaining.LEAD?.remainingMinor, 30);
    assert.equal(remaining.EMERGENCY?.remainingMinor, 49_000);
  });

  test("lead scopes do not apply without a lead", () => {
    const remaining = remainingFromBudgets({ budgets, plan: "enterprise", spend, hasLead: false });
    assert.equal(remaining.LEAD, undefined);
    assert.equal(remaining.PLAN, undefined);
  });
});

test("cost estimate uses the tier's prices in pence", () => {
  // 1M in + 1M out on mini: $0.75 + $4.50 = $5.25 x 0.8 = £4.20 = 420p.
  assert.equal(
    Math.round(estimateCostMinor(FALLBACK_TIERS[2], { input: 1_000_000, output: 1_000_000 })),
    420,
  );
});

describe("per-lead token ceiling (DEFAULT_LEAD_TOKEN_CEILING, an abuse ceiling)", () => {
  const leadRow = { scope: "LEAD" as const, businessId: null, planKey: null, ceilingMinor: 200, ceilingTokens: null };
  const spend = (leadTokens: number) => ({ workspaceMinor: 0, workspaceTokens: 0, leadMinor: 1, leadTokens });

  test("an abuse ceiling far past any real conversation (~90 turns of ~2,750 tokens)", () => {
    // Owner rule 2026-09-27: never cap a live conversation with an engaged
    // lead. A golden conversation has 2.04 model turns; 90 is abuse.
    assert.equal(DEFAULT_LEAD_TOKEN_CEILING, 250_000);
    assert.ok(Math.floor(DEFAULT_LEAD_TOKEN_CEILING / 2_750) >= 90);
  });

  test("a LEAD row without ceiling_tokens gets the default token cap; its £ ceiling is kept", () => {
    const remaining = remainingFromBudgets({ budgets: [leadRow], plan: null, spend: spend(10_000), hasLead: true });
    assert.equal(remaining.LEAD?.remainingTokens, 240_000);
    assert.equal(remaining.LEAD?.remainingMinor, 199);
  });

  test("a row's own ceiling_tokens wins (a workspace can raise it)", () => {
    const own = { ...leadRow, businessId: "biz", ceilingTokens: 100_000 };
    const remaining = remainingFromBudgets({ budgets: [leadRow, own], plan: null, spend: spend(50_000), hasLead: true });
    assert.equal(remaining.LEAD?.remainingTokens, 50_000);
  });

  test("applies with no LEAD row at all, and never without a lead", () => {
    const withLead = remainingFromBudgets({ budgets: [], plan: null, spend: spend(1_000), hasLead: true });
    assert.deepEqual(withLead.LEAD, { remainingMinor: null, remainingTokens: 249_000 });
    const noLead = remainingFromBudgets({ budgets: [], plan: null, spend: spend(1_000), hasLead: false });
    assert.equal(noLead.LEAD, undefined);
  });

  test("a long engaged conversation still runs; only a runaway past the ceiling goes to a person", () => {
    const at = (leadTokens: number) =>
      remainingFromBudgets({ budgets: [leadRow], plan: null, spend: spend(leadTokens), hasLead: true });
    const early = decide({ taskType: "agent_decision", stage: "ENGAGED", remaining: at(5_500) });
    assert.equal(early.decision, "TIER_2");
    // 40 turns in: still answered by the model.
    const long = decide({ taskType: "agent_decision", stage: "ENGAGED", remaining: at(110_000) });
    assert.equal(long.decision, "TIER_2");
    const spent = decide({ taskType: "agent_decision", stage: "ENGAGED", remaining: at(248_000) });
    assert.equal(spent.decision, "HUMAN");
    assert.equal(spent.reason, "BUDGET_LEAD");
  });

  test("the cap never blocks safety classification", () => {
    const remaining = remainingFromBudgets({ budgets: [leadRow], plan: null, spend: spend(1_000_000), hasLead: true });
    const result = decide({ taskType: "intent_classification", stage: "ENGAGED", remaining });
    assert.equal(result.decision, "TIER_1");
    assert.equal(result.reason, "SAFETY_FLOOR");
  });

  test("an opportunity is bounded by its own ceiling, not the lead token cap", () => {
    const opp = { scope: "OPPORTUNITY" as const, businessId: null, planKey: null, ceilingMinor: 1_000, ceilingTokens: null };
    const remaining = remainingFromBudgets({ budgets: [leadRow, opp], plan: null, spend: spend(300_000), hasLead: true });
    const result = decide({ taskType: "agent_decision", stage: "OPPORTUNITY", remaining });
    assert.equal(result.decision, "TIER_2");
  });
});
