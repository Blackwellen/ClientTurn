import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  PLANS,
  SMS_CREDIT_BUNDLES,
  SYSTEM_EMAIL_DAILY_CAP,
  TRIAL,
  VOICE_ADDON,
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  allowancesFor,
} from "../src/lib/billing/plans.ts";
import { TOKEN_PACK_LIST } from "../src/lib/billing/tokens.ts";
import { WHATSAPP_TOKEN_PACKS } from "../src/lib/billing/whatsapp-tokens.ts";
import {
  MIN_GROSS_MARGIN,
  UNIT_COST_GBP,
  VERIFIED_PROSPECT_HARD_LIMIT,
  WHATSAPP_MIN_MARKUP_ON_COST,
  bundleMargin,
  planCost,
  smsSegmentAllInCost,
  trialWorstCase,
  voiceAddonMargin,
  voiceMarginReport,
  voiceNumberMargin,
  voicePackMargin,
  whatsappAllInCost,
  whatsappMessageEconomics,
  type Interval,
  type Usage,
} from "../src/lib/billing/unit-costs.ts";

/**
 * The owner's margin rule (2026-09-27): every plan and billing interval at
 * least 75% gross margin at MAXIMUM use of every included allowance, on the
 * economics.md §1.1 method (Stripe fees and the £2 infra allocation in).
 * Recomputed from plans.ts, so an allowance or price change that breaks it
 * fails here rather than on an invoice.
 */

const SELF_SERVE = ["starter", "growth", "pro"] as const;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function planInput(plan: (typeof SELF_SERVE)[number]) {
  const definition = PLANS[plan];
  return {
    monthlyPrice: definition.monthlyPrice as number,
    yearlyPrice: definition.yearlyPrice,
    leadLimit: definition.leadLimit,
    smsSegmentAllowance: definition.smsSegmentAllowance,
    whatsappMessageAllowance: definition.whatsappMessageAllowance,
    aiTokenAllowance: definition.aiTokenAllowance,
    verifiedProspects: VERIFIED_PROSPECT_HARD_LIMIT[plan],
  };
}

describe("plan margins >= 75% at maximum and typical usage", () => {
  for (const plan of SELF_SERVE) {
    for (const interval of ["monthly", "annual"] as Interval[]) {
      for (const usage of ["max", "typical"] as Usage[]) {
        test(`${plan} ${interval} at ${usage} usage`, () => {
          const cost = planCost(planInput(plan), interval, usage);
          assert.ok(
            cost.margin >= MIN_GROSS_MARGIN,
            `${plan} ${interval} ${usage}: ${pct(cost.margin)} (cost £${cost.total.toFixed(2)} on £${cost.revenue.toFixed(2)})`,
          );
        });
      }
    }
  }

  test("prices are unchanged by the margin work (£99 / £199 / £399)", () => {
    assert.equal(PLANS.starter.monthlyPrice, 99);
    assert.equal(PLANS.growth.monthlyPrice, 199);
    assert.equal(PLANS.pro.monthlyPrice, 399);
  });

  test("every plan still covers an instant first text for every lead at its lead cap", () => {
    for (const plan of SELF_SERVE) {
      assert.ok(
        PLANS[plan].smsSegmentAllowance >= PLANS[plan].leadLimit,
        `${plan}: ${PLANS[plan].smsSegmentAllowance} segments < ${PLANS[plan].leadLimit} leads`,
      );
    }
  });
});

describe("WhatsApp is a paid add-on", () => {
  test("no plan and not the trial includes WhatsApp messages", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal(PLANS[plan].whatsappMessageAllowance, 0, plan);
    }
    assert.equal(TRIAL.whatsappMessageAllowance, 0);
    assert.equal(TRIAL.whatsappEnabled, false);
  });

  test("the existing plan gate still decides who may buy it", () => {
    assert.equal(PLANS.starter.whatsappEnabled, false);
    assert.equal(PLANS.growth.whatsappEnabled, true);
    assert.equal(PLANS.pro.whatsappEnabled, true);
    assert.equal(allowancesFor("trial").whatsappEnabled, false);
  });

  /*
   * WhatsApp is sold as prepaid WhatsApp tokens priced to be competitive with
   * WhatsApp specialists (owner, 2026-09-27: ~50% target, never below cost x
   * 1.25). It is deliberately exempt from MIN_GROSS_MARGIN, which binds plans,
   * SMS and AI token packs.
   */
  test("every WhatsApp token pack clears the cost floor on every category, after Stripe", () => {
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      for (const category of ["MARKETING", "UTILITY", "SERVICE"] as const) {
        const economics = whatsappMessageEconomics(pack, category);
        assert.ok(
          economics.markupOnCost >= WHATSAPP_MIN_MARKUP_ON_COST,
          `${pack.tokens} tokens ${category}: x${economics.markupOnCost.toFixed(2)} on cost`,
        );
      }
    }
  });

  test("WhatsApp tokens hold the owner's ~40%+ margin on the Twilio route", () => {
    for (const pack of WHATSAPP_TOKEN_PACKS) {
      for (const category of ["MARKETING", "UTILITY", "SERVICE"] as const) {
        const { margin } = whatsappMessageEconomics(pack, category);
        assert.ok(margin >= 0.39, `${pack.tokens} tokens ${category}: ${pct(margin)}`);
      }
    }
  });

  test("the 1 October 2026 service charge is priced in", () => {
    assert.ok(UNIT_COST_GBP.whatsappMetaServiceFromOct2026 > 0);
    assert.ok(whatsappAllInCost("SERVICE") < whatsappAllInCost("MARKETING"));
  });
});

describe("no overage: prepaid bundles only", () => {
  test("no plan carries an overage price (owner rule 2026-09-27: top up instead)", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal("smsOveragePence" in PLANS[plan], false, `${plan} sms`);
      assert.equal("whatsappOveragePence" in PLANS[plan], false, `${plan} whatsapp`);
    }
  });

  test("every SMS credit bundle clears 75% after Stripe", () => {
    for (const bundle of SMS_CREDIT_BUNDLES) {
      const margin = bundleMargin(bundle.priceGbp, bundle.credits, smsSegmentAllInCost());
      assert.ok(margin >= MIN_GROSS_MARGIN, `${bundle.credits} segments: ${pct(margin)}`);
    }
  });

  test("AI token packs clear 75% even at the absolute (all-output) token cost", () => {
    for (const pack of TOKEN_PACK_LIST) {
      const margin = bundleMargin(pack.amountMinor / 100, pack.tokens / 1e6, UNIT_COST_GBP.aiPerMillionTokensAbsolute);
      assert.ok(margin >= MIN_GROSS_MARGIN, `${pack.key}: ${pct(margin)}`);
    }
  });
});

/*
 * Voice (OD-2). Asserted on the STANDARD UK card model (research doc §8
 * method, made stricter by charging Stripe's percentage on the VAT-inclusive
 * amount): 1.5% + 20p for a one-off pack; 1.5% + 0.7% Billing for a
 * subscription item, no extra 20p as an invoice line. Under the premium-card
 * MAX model several items fall just below 75% under stress; the last test
 * pins that gap so it stays visible rather than forgotten (unit-costs.ts).
 */
describe("voice clears 75% under stress, after Stripe", () => {
  for (const pack of VOICE_MINUTE_PACKS) {
    test(`${pack.minutes} minute pack (£${pack.priceGbp}) at stressed COGS`, () => {
      const { margin } = voicePackMargin(pack, "stress");
      assert.ok(margin >= MIN_GROSS_MARGIN, `${pack.minutes} min: ${pct(margin)}`);
    });
  }

  test("the £100 Pro voice item (200 minutes + the number) at stressed COGS", () => {
    assert.equal(VOICE_ADDON.monthlyPriceGbp, 100);
    const { margin } = voiceAddonMargin("stress");
    assert.ok(margin >= MIN_GROSS_MARGIN, `Pro voice item: ${pct(margin)}`);
  });

  test("the £11.99 number, charged on its own and as an invoice line", () => {
    assert.equal(VOICE_NUMBER_MONTHLY_GBP, 11.99);
    for (const mode of ["own_payment", "invoice_line"] as const) {
      const { margin } = voiceNumberMargin(VOICE_NUMBER_MONTHLY_GBP, "stress", mode);
      assert.ok(margin >= MIN_GROSS_MARGIN, `number ${mode}: ${pct(margin)}`);
    }
  });

  test("the £100 voice item carries no annual discount", () => {
    assert.equal(VOICE_ADDON.annualDiscount, false);
  });

  test("voice prices are unchanged (£49 / £115 / £225 / £449, £11.99, £100)", () => {
    assert.deepEqual(
      VOICE_MINUTE_PACKS.map((pack) => [pack.minutes, pack.priceGbp]),
      [[100, 49], [250, 115], [500, 225], [1000, 449]],
    );
  });

  test("the premium-card gap is reported, not hidden", () => {
    const report = voiceMarginReport();
    assert.equal(report.length, VOICE_MINUTE_PACKS.length + 3);
    for (const row of report) {
      assert.ok(row.standard.stress >= MIN_GROSS_MARGIN, `${row.item} standard stress ${pct(row.standard.stress)}`);
      assert.ok(row.premium.stress < row.standard.stress, row.item);
    }
    const belowOnPremium = report.filter((row) => row.premium.stress < MIN_GROSS_MARGIN).map((row) => row.item);
    assert.ok(belowOnPremium.includes("Pro voice item"), belowOnPremium.join(", "));
  });
});

describe("the trial costs no more than 50p to run", () => {
  test("worst-case marginal cost <= £0.50", () => {
    const cost = trialWorstCase({
      days: TRIAL.days,
      leadLimit: TRIAL.leadLimit,
      smsSegmentAllowance: TRIAL.smsSegmentAllowance,
      aiTokenAllowance: TRIAL.aiTokenAllowance,
      aiCeilingPence: TRIAL.aiSpendCeilingPence,
      systemEmailDailyCap: SYSTEM_EMAIL_DAILY_CAP.trial,
    });
    assert.ok(cost.total <= 0.5, `trial worst case £${cost.total.toFixed(3)}`);
  });

  test("the trial has no overage, so nothing can run past the allowance", () => {
    const trial = allowancesFor("trial");
    assert.equal("smsOveragePence" in trial, false);
    assert.equal("whatsappOveragePence" in trial, false);
  });
});

/* ------------------------------------------------ pinned to the migrations */

describe("the catalogue agrees with the latest seed", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(dir, name), "utf8"));

  /** The latest seeded row: [soft, hard, overage_allowed, overage_price]. */
  function seeded(plan: string, metric: string) {
    const pattern = new RegExp(
      `\\('${plan}',\\s*'${metric}',\\s*(\\d+),\\s*(\\d+),\\s*(true|false),\\s*(null|[\\d.]+),`,
    );
    let row: { hard: number; overagePrice: number | null } | null = null;
    for (const sql of migrations) {
      const match = sql.match(pattern);
      if (match) row = { hard: Number(match[2]), overagePrice: match[4] === "null" ? null : Number(match[4]) };
    }
    assert.ok(row, `no seed for ${plan}/${metric}`);
    return row;
  }

  for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
    test(`${plan}: the latest seed has no SMS / WhatsApp overage price`, () => {
      assert.equal(seeded(plan, "sms_outbound_segment").overagePrice, null);
      assert.equal(seeded(plan, "whatsapp_message").overagePrice, null);
    });
    test(`${plan}: verified prospect hard limit matches the cost model`, () => {
      assert.equal(seeded(plan, "verified_prospect").hard, VERIFIED_PROSPECT_HARD_LIMIT[plan]);
    });
  }

  test("the trial AI spend ceiling is seeded at TRIAL.aiSpendCeilingPence", () => {
    const latest = migrations.filter((sql) => /plan_key = 'trial'[\s\S]*?scope = 'PLAN'/.test(sql)).pop() ?? "";
    const match = latest.match(/set ceiling_minor = (\d+)\s+where business_id is null\s+and plan_key = 'trial'/);
    assert.ok(match, "0138 sets the trial PLAN ceiling");
    assert.equal(Number(match[1]), TRIAL.aiSpendCeilingPence);
  });

  test("Meta's WhatsApp category rates are in the price book", () => {
    const all = migrations.join("\n");
    for (const product of ["whatsapp_marketing_template", "whatsapp_utility_template", "whatsapp_service"]) {
      assert.match(all, new RegExp(`'meta', '${product}'`), product);
    }
  });
});
