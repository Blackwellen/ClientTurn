import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AI_TOKEN_ALLOWANCE,
  approximateTurns,
  estimateTokensForCall,
  formatTokens,
  isTokenPackKey,
  nextWarningThreshold,
  summariseTokens,
  TOKEN_CRITICAL_PERCENT,
  TOKEN_PACK_LIST,
  TOKEN_PACKS,
  TOKEN_WARN_PERCENT,
  tokensPerPound,
  type TokenBalance,
} from "../src/lib/billing/tokens.ts";
import { PLANS } from "../src/lib/billing/plans.ts";

function balance(overrides: Partial<TokenBalance> = {}): TokenBalance {
  return {
    includedTokens: 1_000_000,
    purchasedTokens: 0,
    usedTokens: 0,
    reservedTokens: 0,
    ...overrides,
  };
}

// =====================================================================
// Allowances
// =====================================================================

describe("AI_TOKEN_ALLOWANCE", () => {
  test("every tier has an allowance", () => {
    for (const plan of ["trial", "starter", "growth", "pro", "enterprise"] as const) {
      assert.ok(AI_TOKEN_ALLOWANCE[plan] > 0, plan);
    }
  });

  test("each paid tier grants strictly more than the one below", () => {
    const ladder = ["trial", "starter", "growth", "pro", "enterprise"] as const;
    for (let index = 1; index < ladder.length; index += 1) {
      assert.ok(
        AI_TOKEN_ALLOWANCE[ladder[index]] > AI_TOKEN_ALLOWANCE[ladder[index - 1]],
        `${ladder[index]} should exceed ${ladder[index - 1]}`,
      );
    }
  });

  test("the trial allowance is small enough to be a trial", () => {
    assert.ok(AI_TOKEN_ALLOWANCE.trial < AI_TOKEN_ALLOWANCE.starter / 5);
  });
});

// =====================================================================
// Summary and state
// =====================================================================

describe("summariseTokens", () => {
  test("a fresh period is healthy and fully available", () => {
    const summary = summariseTokens(balance());
    assert.equal(summary.granted, 1_000_000);
    assert.equal(summary.remaining, 1_000_000);
    assert.equal(summary.available, 1_000_000);
    assert.equal(summary.percentUsed, 0);
    assert.equal(summary.state, "HEALTHY");
  });

  test("purchased tokens add to the grant", () => {
    const summary = summariseTokens(balance({ purchasedTokens: 500_000 }));
    assert.equal(summary.granted, 1_500_000);
    assert.equal(summary.purchasedTokens, 500_000);
  });

  test("reservations reduce what is available but not what remains", () => {
    const summary = summariseTokens(balance({ reservedTokens: 200_000 }));
    assert.equal(summary.remaining, 1_000_000);
    assert.equal(summary.available, 800_000);
  });

  test("bands move through the thresholds", () => {
    assert.equal(summariseTokens(balance({ usedTokens: 500_000 })).state, "HEALTHY");
    assert.equal(summariseTokens(balance({ usedTokens: 850_000 })).state, "APPROACHING");
    assert.equal(summariseTokens(balance({ usedTokens: 960_000 })).state, "CRITICAL");
    assert.equal(summariseTokens(balance({ usedTokens: 1_000_000 })).state, "EXHAUSTED");
  });

  test("overspend never reports a negative balance", () => {
    const summary = summariseTokens(balance({ usedTokens: 1_400_000 }));
    assert.equal(summary.remaining, 0);
    assert.equal(summary.available, 0);
    assert.equal(summary.percentUsed, 100);
    assert.equal(summary.state, "EXHAUSTED");
  });

  test("no allowance at all reads as exhausted, not as untouched", () => {
    // A workspace with nothing granted cannot do AI work, and a meter showing
    // "0% used" would say the opposite of the truth.
    const summary = summariseTokens(balance({ includedTokens: 0 }));
    assert.equal(summary.percentUsed, 100);
    assert.equal(summary.state, "EXHAUSTED");
  });

  test("reserved tokens cannot make available exceed remaining", () => {
    const summary = summariseTokens(
      balance({ usedTokens: 900_000, reservedTokens: 500_000 }),
    );
    assert.equal(summary.remaining, 100_000);
    assert.equal(summary.available, 0);
  });
});

// =====================================================================
// Warnings
// =====================================================================

describe("nextWarningThreshold", () => {
  test("warns once when crossing 80%", () => {
    assert.equal(nextWarningThreshold(82, 0), TOKEN_WARN_PERCENT);
  });

  test("does not warn again at the same threshold", () => {
    assert.equal(nextWarningThreshold(85, TOKEN_WARN_PERCENT), null);
  });

  test("warns again on crossing 95%", () => {
    assert.equal(nextWarningThreshold(97, TOKEN_WARN_PERCENT), TOKEN_CRITICAL_PERCENT);
  });

  test("says nothing once both thresholds are spent", () => {
    assert.equal(nextWarningThreshold(100, TOKEN_CRITICAL_PERCENT), null);
  });

  test("stays quiet below the first threshold", () => {
    assert.equal(nextWarningThreshold(40, 0), null);
  });

  test("a jump straight past both reports the higher one first", () => {
    assert.equal(nextWarningThreshold(99, 0), TOKEN_CRITICAL_PERCENT);
  });
});

// =====================================================================
// Estimation
// =====================================================================

describe("estimateTokensForCall", () => {
  test("scales with context length and reserves the output budget", () => {
    // 4,000 characters is ~1,000 tokens, plus the 400-token output budget.
    assert.equal(estimateTokensForCall(400, 4000), 1400);
  });

  test("never under-estimates a small call to zero", () => {
    assert.ok(estimateTokensForCall(200, 0) >= 200);
  });

  test("is an over-estimate, which is the safe direction", () => {
    // Real calls reuse cached input, so the true cost lands below the hold.
    const estimate = estimateTokensForCall(400, 8000);
    assert.ok(estimate >= 2000);
  });
});

describe("approximateTurns", () => {
  test("converts an allowance into conversations", () => {
    assert.equal(approximateTurns(17_000), 10);
  });

  test("rounds down, so nobody is promised a turn they cannot have", () => {
    assert.equal(approximateTurns(1_699), 0);
  });

  test("never returns a negative count", () => {
    assert.equal(approximateTurns(-500), 0);
  });
});

// =====================================================================
// Packs
// =====================================================================

describe("token packs", () => {
  test("every pack is well formed", () => {
    for (const pack of TOKEN_PACK_LIST) {
      assert.ok(pack.tokens > 0, pack.key);
      assert.ok(pack.amountMinor > 0, pack.key);
      assert.equal(pack.currency, "GBP");
      assert.ok(pack.name.length > 0);
      assert.ok(pack.description.length > 0);
    }
  });

  test("a bigger pack is genuinely better value", () => {
    const byValue = TOKEN_PACK_LIST.map(tokensPerPound);
    for (let index = 1; index < byValue.length; index += 1) {
      assert.ok(
        byValue[index] > byValue[index - 1],
        `pack ${index} should beat pack ${index - 1} on tokens per pound`,
      );
    }
  });

  test("exactly one pack is flagged best value", () => {
    assert.equal(TOKEN_PACK_LIST.filter((pack) => pack.bestValue).length, 1);
  });

  test("the smallest pack is a meaningful top-up, not a token", () => {
    const smallest = TOKEN_PACK_LIST[0];
    assert.ok(approximateTurns(smallest.tokens) >= 100);
  });

  test("pack keys are validated, never trusted", () => {
    assert.equal(isTokenPackKey("top_up_medium"), true);
    assert.equal(isTokenPackKey("top_up_free"), false);
    assert.equal(isTokenPackKey("__proto__"), false);
    assert.equal(isTokenPackKey(""), false);
  });

  test("the catalogue and the list agree", () => {
    for (const pack of TOKEN_PACK_LIST) {
      assert.deepEqual(TOKEN_PACKS[pack.key], pack);
    }
  });
});

// =====================================================================
// Formatting
// =====================================================================

describe("formatTokens", () => {
  test("renders millions, thousands and units", () => {
    assert.equal(formatTokens(1_250_000), "1.25M");
    assert.equal(formatTokens(12_000_000), "12M");
    assert.equal(formatTokens(4_300), "4.3k");
    assert.equal(formatTokens(45_000), "45k");
    assert.equal(formatTokens(720), "720");
  });

  test("degrades safely on nonsense", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(-10), "0");
    assert.equal(formatTokens(Number.NaN), "0");
  });
});

// =====================================================================
// The catalogue and the allowance table must not drift apart
// =====================================================================

describe("plan catalogue consistency", () => {
  test("every self-serve plan advertises the allowance it actually grants", () => {
    for (const plan of Object.values(PLANS)) {
      assert.equal(
        plan.aiTokenAllowance,
        AI_TOKEN_ALLOWANCE[plan.id],
        `${plan.id} advertises a different allowance from the one enforced`,
      );
    }
  });

  test("the advertised feature line matches the granted allowance", () => {
    for (const plan of Object.values(PLANS)) {
      const line = plan.features.find((feature) => feature.includes("AI tokens"));
      assert.ok(line, `${plan.id} does not mention its AI token allowance`);
      assert.ok(
        line.includes(formatTokens(plan.aiTokenAllowance)),
        `${plan.id} advertises "${line}" but grants ${formatTokens(plan.aiTokenAllowance)}`,
      );
    }
  });
});
