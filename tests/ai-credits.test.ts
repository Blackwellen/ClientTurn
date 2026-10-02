import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  AI_CREDIT_UNIT,
  AI_TOKENS_PER_CREDIT,
  CREDITS_PER_REPLY,
  creditTileText,
  creditsPerPound,
  creditsToTokens,
  formatCreditAmount,
  formatCredits,
  summariseCredits,
  TOKEN_PACKS,
  tokensToCredits,
} from "../src/lib/billing/tokens.ts";
import { PLANS } from "../src/lib/billing/plans.ts";
import {
  creditLimitFromRow,
  penceToCredits,
  platformDefaultCredits,
  REFERENCE_PENCE_PER_CREDIT,
  rowForCreditLimit,
} from "../src/lib/ai/credit-limits.ts";
import { DEFAULT_LEAD_TOKEN_CEILING, remainingFromBudgets } from "../src/lib/ai/budget.ts";
import {
  budgetProblems,
  budgetUpdateSchema,
  formatCreditLimit,
  parseBudgetForm,
  parseCreditLimit,
} from "../src/lib/settings/ai-selling.ts";

/**
 * AI credits (owner decision, 2026-09-30): customers see AI usage in
 * ClientTurn's own unit, never money and never model tokens. 1 credit is
 * 1,000 ledger tokens; customer limits are stored as `ceiling_tokens`; a limit
 * saved in pounds before credits existed reads back as credits.
 */

describe("credit display maths", () => {
  test("the unit and rate", () => {
    assert.equal(AI_CREDIT_UNIT, "AI credits");
    assert.equal(AI_TOKENS_PER_CREDIT, 1_000);
    assert.equal(tokensToCredits(2_750), 2.75);
    assert.equal(creditsToTokens(500), 500_000);
    assert.equal(tokensToCredits(-5), 0);
    assert.equal(CREDITS_PER_REPLY, 2.75);
  });

  test("plan allowances and packs are round numbers of credits", () => {
    assert.equal(tokensToCredits(PLANS.starter.aiTokenAllowance), 1_000);
    assert.equal(tokensToCredits(PLANS.growth.aiTokenAllowance), 4_000);
    assert.equal(formatCreditAmount(TOKEN_PACKS.top_up_medium.tokens), "2,000 AI credits");
    // A price ratio, not a serving cost: £49 buys 2,000 credits.
    assert.equal(creditsPerPound(TOKEN_PACKS.top_up_medium), 41);
  });

  test("formatting: grouped integers, one decimal under 10, never a used call shown as 0", () => {
    assert.equal(formatCredits(1234.5), "1,235");
    assert.equal(formatCredits(7.25), "7.3");
    assert.equal(formatCredits(0.04), "0.1");
    assert.equal(formatCredits(0), "0");
    assert.equal(formatCredits(Number.NaN), "0");
  });

  test("summary: used of included plus top-ups, top-up balance, percent and state", () => {
    const summary = summariseCredits({
      includedTokens: 1_000_000,
      purchasedTokens: 500_000,
      usedTokens: 1_200_000,
      reservedTokens: 0,
    });
    assert.equal(summary.includedCredits, 1_000);
    assert.equal(summary.grantedCredits, 1_500);
    assert.equal(summary.usedCredits, 1_200);
    assert.equal(summary.remainingCredits, 300);
    // Included credits are used first, so all 300 left are topped-up ones.
    assert.equal(summary.topUpBalanceCredits, 300);
    assert.equal(summary.percentUsed, 80);
    assert.equal(summary.state, "APPROACHING");
    assert.equal(creditTileText(summary), "1,200 of 1,500 (80%)");
    // Nothing in the summary is a model-token or money field.
    assert.doesNotMatch(Object.keys(summary).join(","), /token|cost|gbp|minor/i);
  });

  test("an untouched top-up is the whole pack; a used-up allowance is exhausted", () => {
    const fresh = summariseCredits({ includedTokens: 1_000_000, purchasedTokens: 500_000, usedTokens: 100_000, reservedTokens: 0 });
    assert.equal(fresh.topUpBalanceCredits, 500);
    const gone = summariseCredits({ includedTokens: 1_000_000, purchasedTokens: 0, usedTokens: 1_000_000, reservedTokens: 0 });
    assert.equal(gone.state, "EXHAUSTED");
    assert.equal(gone.remainingCredits, 0);
    assert.equal(creditTileText(gone), "1,000 of 1,000 (100%)");
  });
});

describe("pound limits to credits", () => {
  test("the reference rate is the typical mix: about 1,215 credits per pound", () => {
    assert.ok(REFERENCE_PENCE_PER_CREDIT > 0.08 && REFERENCE_PENCE_PER_CREDIT < 0.085);
    assert.equal(penceToCredits(100), 1_215);
    assert.equal(penceToCredits(0), 0);
    assert.equal(penceToCredits(-1), 0);
  });

  test("a stored £ limit reads back as credits, rounded down (never looser)", () => {
    assert.equal(creditLimitFromRow({ ceilingMinor: 200, ceilingTokens: null }), 2_430);
    assert.ok(penceToCredits(200) * REFERENCE_PENCE_PER_CREDIT <= 200);
    // A credit limit is stored as tokens and reads back exactly.
    assert.equal(creditLimitFromRow({ ceilingMinor: null, ceilingTokens: 150_000 }), 150);
    // Both set: the tighter one is the limit.
    assert.equal(creditLimitFromRow({ ceilingMinor: 200, ceilingTokens: 150_000 }), 150);
    assert.equal(creditLimitFromRow({ ceilingMinor: null, ceilingTokens: null }), null);
    assert.equal(creditLimitFromRow(null), null);
  });

  test("platform defaults in credits: LEAD carries its token cap even with only a £ row", () => {
    assert.equal(platformDefaultCredits("LEAD", { ceilingMinor: 200, ceilingTokens: null }), DEFAULT_LEAD_TOKEN_CEILING / 1_000);
    assert.equal(platformDefaultCredits("PRE_REPLY", { ceilingMinor: 20, ceilingTokens: null }), 243);
    assert.equal(platformDefaultCredits("OPPORTUNITY", { ceilingMinor: 1_000, ceilingTokens: null }), 12_153);
    assert.equal(platformDefaultCredits("WORKSPACE_MONTH", null), null);
  });

  test("saving a credit limit writes tokens, with the platform £ backstop on per-lead scopes only", () => {
    assert.deepEqual(rowForCreditLimit("LEAD", 100, 200), { ceiling_tokens: 100_000, ceiling_minor: 200 });
    assert.deepEqual(rowForCreditLimit("WORKSPACE_MONTH", 5_000, null), { ceiling_tokens: 5_000_000, ceiling_minor: null });
  });

  test("a credit limit is enforced in tokens by the budget manager", () => {
    const remaining = remainingFromBudgets({
      budgets: [
        { scope: "WORKSPACE_MONTH", businessId: "b1", planKey: null, ceilingMinor: null, ceilingTokens: 5_000_000 },
        { scope: "LEAD", businessId: "b1", planKey: null, ceilingMinor: 200, ceilingTokens: 100_000 },
      ],
      plan: "starter",
      spend: { workspaceMinor: 0, workspaceTokens: 4_000_000, leadMinor: 0, leadTokens: 90_000 },
      hasLead: true,
    });
    assert.equal(remaining.WORKSPACE_MONTH?.remainingTokens, 1_000_000);
    assert.equal(remaining.WORKSPACE_MONTH?.remainingMinor, null);
    assert.equal(remaining.LEAD?.remainingTokens, 10_000);
    assert.equal(remaining.LEAD?.remainingMinor, 200);
  });

  test("a legacy £-only workspace row keeps being enforced in pounds", () => {
    const remaining = remainingFromBudgets({
      budgets: [{ scope: "WORKSPACE_MONTH", businessId: "b1", planKey: null, ceilingMinor: 1_500, ceilingTokens: null }],
      plan: "starter",
      spend: { workspaceMinor: 1_000, workspaceTokens: 0, leadMinor: 0, leadTokens: 0 },
      hasLead: false,
    });
    assert.equal(remaining.WORKSPACE_MONTH?.remainingMinor, 500);
  });
});

describe("the limit form is in credits", () => {
  test("parse: whole credits, commas and a trailing unit allowed, money refused", () => {
    assert.equal(parseCreditLimit("1,500"), 1_500);
    assert.equal(parseCreditLimit(" 250 credits "), 250);
    assert.equal(parseCreditLimit(""), null);
    for (const bad of ["£12", "12.5", "-3", "abc"]) assert.equal(parseCreditLimit(bad), "invalid", bad);
  });

  test("form, schema and rules", () => {
    const parsed = parseBudgetForm({ WORKSPACE_MONTH: "5000", LEAD: "two", PRE_REPLY: "", OPPORTUNITY: "500" });
    assert.equal(parsed.ok, false);
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: 150 }).success, true);
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: 1.5 }).success, false);
    const defaults = { LEAD: 250, PRE_REPLY: 243, OPPORTUNITY: 12_153, WORKSPACE_MONTH: null };
    assert.deepEqual(budgetProblems({ LEAD: 200, PRE_REPLY: 100 }, defaults), {});
    assert.match(budgetProblems({ LEAD: 300 }, defaults).LEAD ?? "", /250 AI credits/);
    assert.ok(budgetProblems({ LEAD: 100, PRE_REPLY: 150 }, defaults).PRE_REPLY);
    assert.equal(formatCreditLimit(null), "No limit");
    assert.doesNotMatch(formatCreditLimit(1_000), /£/);
  });
});
