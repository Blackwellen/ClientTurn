import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CALCULATION_VERSION, calculateQuote, splitAcrossBuckets, verifyCalculation } from "../src/lib/quotes/calculate.ts";
import type { CalculateQuoteInput, QuoteCalculation } from "../src/lib/quotes/types.ts";

/* -------------------------------------------------------------- fixture */

const item = (o: Record<string, unknown>) => ({ currency: "GBP", unit: "unit", vatRate: "STANDARD", chargeType: "ONE_OFF", ...o });

const catalogue = {
  currency: "GBP",
  items: [
    item({ id: "web-build", name: "Website build", unit: "project", unitPriceMinor: 500000, costPriceMinor: 300000, addOnItemIds: ["support-addon"] }),
    item({
      id: "dev-hour",
      name: "Development",
      unit: "hour",
      unitPriceMinor: 9500,
      costPriceMinor: 4000,
      minQuantity: 0.25,
      maxQuantity: 500,
      options: [{ id: "rush", name: "Rush", unitPriceDeltaMinor: 2000, unitCostDeltaMinor: 500 }],
    }),
    item({ id: "hosting", name: "Hosting", chargeType: "RECURRING", interval: { unit: "MONTH" }, unitPriceMinor: 4999, costPriceMinor: 1500 }),
    item({ id: "seo", name: "SEO retainer", chargeType: "RECURRING", interval: { unit: "MONTH" }, unitPriceMinor: 75000 }),
    item({ id: "licence", name: "Annual licence", chargeType: "RECURRING", interval: { unit: "YEAR" }, unitPriceMinor: 120000, costPriceMinor: 20000 }),
    item({
      id: "seats",
      name: "Seats",
      unit: "seat",
      chargeType: "RECURRING",
      interval: { unit: "MONTH" },
      unitPriceMinor: 0,
      costPriceMinor: 200,
      tierMode: "VOLUME",
      tiers: [
        { upTo: 10, unitPriceMinor: 1500 },
        { upTo: 50, unitPriceMinor: 1200 },
        { upTo: null, unitPriceMinor: 1000 },
      ],
    }),
    item({
      id: "emails",
      name: "Email sends",
      unit: "1,000 emails",
      chargeType: "USAGE",
      unitPriceMinor: 0,
      tierMode: "GRADUATED",
      tiers: [
        { upTo: 100, unitPriceMinor: 100 },
        { upTo: 1000, unitPriceMinor: 80 },
        { upTo: null, unitPriceMinor: 50 },
      ],
    }),
    item({ id: "print-guide", name: "Printed guide", unitPriceMinor: 1999, vatRate: "REDUCED" }),
    item({ id: "book", name: "Book", unitPriceMinor: 1250, vatRate: "ZERO" }),
    item({ id: "exam", name: "Exam fee", unitPriceMinor: 10000, vatRate: "EXEMPT" }),
    item({ id: "micro", name: "Micro", unitPriceMinor: 3 }),
    item({ id: "tenp", name: "Ten pence reduced", unitPriceMinor: 10, vatRate: "REDUCED" }),
    item({ id: "support-addon", name: "Priority support", unitPriceMinor: 25000, costPriceMinor: 10000, addOnOnly: true }),
    item({ id: "retired", name: "Retired", unitPriceMinor: 100, active: false }),
  ],
  bundles: [
    { id: "launch-pack", name: "Launch pack", currency: "GBP", components: [{ itemId: "web-build", quantity: 1 }, { itemId: "dev-hour", quantity: 10 }], pricing: { type: "FIXED", priceMinor: 550000 } },
    { id: "growth-pack", name: "Growth pack", currency: "GBP", components: [{ itemId: "hosting", quantity: 1 }, { itemId: "seo", quantity: 1 }], pricing: { type: "PERCENT_OFF", bps: 1000 } },
    { id: "seat-pack", name: "Ten seats", currency: "GBP", components: [{ itemId: "seats", quantity: 10 }], pricing: { type: "FIXED", priceMinor: 14000 } },
  ],
};

type Line = CalculateQuoteInput["lines"][number];
const line = (lineId: string, itemId: string, quantity = 1, extra: Record<string, unknown> = {}): Line =>
  ({ lineId, kind: "ITEM", itemId, quantity, ...extra }) as Line;

function calc(lines: Line[], extra: Partial<CalculateQuoteInput> = {}): QuoteCalculation {
  const result = calculateQuote({ currency: "GBP", vatRegistered: true, catalogue, lines, ...extra });
  if (!result.ok) assert.fail(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result.quote;
}

function issues(lines: Line[], extra: Partial<CalculateQuoteInput> = {}): string[] {
  const result = calculateQuote({ currency: "GBP", vatRegistered: true, catalogue, lines, ...extra });
  assert.equal(result.ok, false, "expected the calculation to be refused");
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

/* -------------------------------------------------------- golden values */

describe("single lines (golden)", () => {
  const golden: [string, Line, { list: number; net: number; vat: number; gross: number }][] = [
    ["standard-rated project", line("a", "web-build"), { list: 500000, net: 500000, vat: 100000, gross: 600000 }],
    ["fractional hours rounded half up", line("a", "dev-hour", 0.333), { list: 3164, net: 3164, vat: 633, gross: 3797 }],
    ["7.5 hours", line("a", "dev-hour", 7.5), { list: 71250, net: 71250, vat: 14250, gross: 85500 }],
    ["option delta per unit", line("a", "dev-hour", 2, { optionIds: ["rush"] }), { list: 23000, net: 23000, vat: 4600, gross: 27600 }],
    ["reduced rate 99.95p VAT -> 100", line("a", "print-guide"), { list: 1999, net: 1999, vat: 100, gross: 2099 }],
    ["reduced rate exact half (0.5p -> 1p)", line("a", "tenp"), { list: 10, net: 10, vat: 1, gross: 11 }],
    ["reduced rate 1.5p -> 2p", line("a", "tenp", 3), { list: 30, net: 30, vat: 2, gross: 32 }],
    ["zero-rated", line("a", "book"), { list: 1250, net: 1250, vat: 0, gross: 1250 }],
    ["exempt", line("a", "exam"), { list: 10000, net: 10000, vat: 0, gross: 10000 }],
    ["0.6p VAT rounds up", line("a", "micro"), { list: 3, net: 3, vat: 1, gross: 4 }],
    ["0.4p VAT rounds down", line("a", "micro", 0.667), { list: 2, net: 2, vat: 0, gross: 2 }],
  ];
  for (const [label, input, expected] of golden) {
    test(label, () => {
      const [only] = calc([input]).lines;
      assert.deepEqual(
        { list: only.listMinor, net: only.netMinor, vat: only.vatMinor, gross: only.grossMinor },
        expected,
      );
    });
  }
});

describe("VAT rounding rule: per line, half up", () => {
  test("three 3p lines carry 1p VAT each (3p), not 20% of 9p (2p)", () => {
    const quote = calc([line("a", "micro"), line("b", "micro"), line("c", "micro")]);
    assert.equal(quote.oneOff.netMinor, 9);
    assert.equal(quote.oneOff.vatMinor, 3);
    assert.equal(quote.oneOff.grossMinor, 12);
  });

  test("VAT per rate sums its lines, rates kept apart", () => {
    const quote = calc([line("a", "web-build"), line("b", "print-guide"), line("c", "book"), line("d", "exam")]);
    assert.deepEqual(
      quote.oneOff.vatByRate.map((b) => [b.vatRate, b.netMinor, b.vatMinor, b.grossMinor]),
      [
        ["STANDARD", 500000, 100000, 600000],
        ["REDUCED", 1999, 100, 2099],
        ["ZERO", 1250, 0, 1250],
        ["EXEMPT", 10000, 0, 10000],
      ],
    );
    assert.equal(quote.oneOff.vatMinor, 100100);
    assert.equal(quote.oneOff.grossMinor, 613349);
  });

  test("not VAT-registered: no VAT charged, no VAT buckets", () => {
    const quote = calc([line("a", "web-build"), line("b", "print-guide")], { vatRegistered: false });
    assert.equal(quote.oneOff.vatMinor, 0);
    assert.equal(quote.oneOff.grossMinor, 501999);
    assert.deepEqual(quote.oneOff.vatByRate, []);
    assert.ok(quote.lines.every((l) => l.vatBps === 0 && l.vatMinor === 0));
    assert.ok(quote.warnings.some((w) => w.startsWith("NOT_VAT_REGISTERED")));
  });
});

describe("tiers in a quote", () => {
  const cases: [number, number][] = [
    [10, 15000],
    [11, 13200],
    [51, 51000],
  ];
  for (const [qty, amount] of cases) {
    test(`${qty} seats (volume) = ${amount}/month`, () => {
      const quote = calc([line("s", "seats", qty)]);
      assert.equal(quote.recurring[0].netMinor, amount);
      assert.equal(quote.recurring[0].intervalKey, "MONTH:1");
    });
  }
  test("graduated usage is an estimate outside every total", () => {
    const quote = calc([line("a", "web-build"), line("u", "emails", 150)]);
    assert.equal(quote.usageEstimate.netMinor, 14000);
    assert.equal(quote.usageEstimate.vatMinor, 2800);
    assert.equal(quote.totals.netMinor, 500000);
    assert.equal(quote.firstPaymentMinor, 600000);
    assert.ok(quote.warnings.some((w) => w.startsWith("USAGE_ESTIMATE")));
  });
});

describe("bundles (golden)", () => {
  test("fixed-price bundle: saving split by list amount", () => {
    const quote = calc([{ lineId: "b", kind: "BUNDLE", bundleId: "launch-pack", quantity: 1 }]);
    assert.deepEqual(
      quote.lines.map((l) => [l.lineId, l.listMinor, l.bundleDiscountMinor, l.netMinor, l.vatMinor]),
      [
        ["b#0", 500000, 37815, 462185, 92437],
        ["b#1", 95000, 7185, 87815, 17563],
      ],
    );
    assert.equal(quote.oneOff.netMinor, 550000);
    assert.equal(quote.oneOff.discountMinor, 45000);
    assert.equal(quote.oneOff.grossMinor, 660000);
    assert.equal(quote.lines[0].bundleName, "Launch pack");
  });

  test("percent-off recurring bundle", () => {
    const quote = calc([{ lineId: "g", kind: "BUNDLE", bundleId: "growth-pack", quantity: 1 }]);
    assert.deepEqual(
      quote.lines.map((l) => [l.bundleDiscountMinor, l.netMinor, l.vatMinor]),
      [
        [500, 4499, 900],
        [7500, 67500, 13500],
      ],
    );
    assert.deepEqual([quote.recurring[0].netMinor, quote.recurring[0].vatMinor, quote.recurring[0].grossMinor], [71999, 14400, 86399]);
  });

  test("bundle quantity multiplies components; line discount on the bundle is split", () => {
    const quote = calc([{ lineId: "b", kind: "BUNDLE", bundleId: "launch-pack", quantity: 2, discount: { type: "PERCENT", bps: 1000 } }]);
    assert.equal(quote.lines[1].quantityMilli, 20000);
    assert.equal(quote.oneOff.netMinor, 990000); // 1,100,000 less 10%
    assert.equal(quote.lines.reduce((t, l) => t + l.lineDiscountMinor, 0), 110000);
  });

  test("a fixed bundle that would cost more than its tiered parts at quantity is refused", () => {
    assert.equal(calc([{ lineId: "p", kind: "BUNDLE", bundleId: "seat-pack", quantity: 1 }]).recurring[0].netMinor, 14000);
    assert.deepEqual(issues([{ lineId: "p", kind: "BUNDLE", bundleId: "seat-pack", quantity: 2 }]), ["BUNDLE_ABOVE_COMPONENTS"]);
  });
});

describe("discounts (golden)", () => {
  test("line percent discount", () => {
    const [l] = calc([line("a", "web-build", 1, { discount: { type: "PERCENT", bps: 1000 } })]).lines;
    assert.deepEqual([l.lineDiscountMinor, l.lineDiscountBps, l.netMinor, l.vatMinor], [50000, 1000, 450000, 90000]);
  });

  test("line amount discount", () => {
    const [l] = calc([line("a", "dev-hour", 1, { discount: { type: "AMOUNT", minor: 501 } })]).lines;
    assert.deepEqual([l.netMinor, l.vatMinor], [8999, 1800]);
  });

  test("quote discount computed once, split across one-off and recurring", () => {
    const quote = calc([line("a", "web-build"), line("h", "hosting")], { quoteDiscount: { type: "PERCENT", bps: 1000, scope: "ALL" } });
    assert.deepEqual(
      quote.lines.map((l) => [l.quoteDiscountMinor, l.netMinor, l.vatMinor]),
      [
        [50000, 450000, 90000],
        [500, 4499, 900],
      ],
    );
    assert.deepEqual(quote.totals, { listMinor: 504999, discountMinor: 50500, netMinor: 454499, vatMinor: 90900, grossMinor: 545399 });
    assert.equal(quote.firstPaymentMinor, 545399);
  });

  test("scoped quote discount leaves other charges alone", () => {
    const quote = calc([line("a", "web-build"), line("h", "hosting")], { quoteDiscount: { type: "AMOUNT", minor: 10000, scope: "ONE_OFF" } });
    assert.equal(quote.lines[0].netMinor, 490000);
    assert.equal(quote.lines[1].quoteDiscountMinor, 0);
  });

  test("quote discount after line discounts, before VAT", () => {
    const quote = calc([line("a", "web-build", 1, { discount: { type: "PERCENT", bps: 1000 } })], {
      quoteDiscount: { type: "PERCENT", bps: 1000, scope: "ONE_OFF" },
    });
    assert.equal(quote.lines[0].netMinor, 405000);
    assert.equal(quote.lines[0].vatMinor, 81000);
  });

  test("100% discount gives a zero line", () => {
    const [l] = calc([line("a", "dev-hour", 1, { discount: { type: "PERCENT", bps: 10000 } })]).lines;
    assert.deepEqual([l.netMinor, l.vatMinor, l.marginBps], [0, 0, null]);
  });

  const refused: [string, Line[], Partial<CalculateQuoteInput>, string][] = [
    ["line amount above the line", [line("a", "dev-hour", 1, { discount: { type: "AMOUNT", minor: 9501 } })], {}, "LINE_DISCOUNT_EXCEEDS"],
    ["quote amount above the subtotal", [line("a", "dev-hour")], { quoteDiscount: { type: "AMOUNT", minor: 9501, scope: "ALL" } }, "QUOTE_DISCOUNT_EXCEEDS"],
    [
      "an amount off across one-off and monthly",
      [line("a", "web-build"), line("h", "hosting")],
      { quoteDiscount: { type: "AMOUNT", minor: 100, scope: "ALL" } },
      "AMBIGUOUS_AMOUNT_DISCOUNT",
    ],
    ["scope with no lines", [line("a", "web-build")], { quoteDiscount: { type: "PERCENT", bps: 500, scope: "RECURRING" } }, "QUOTE_DISCOUNT_NO_LINES"],
    ["a percent above 100", [line("a", "web-build", 1, { discount: { type: "PERCENT", bps: 10001 } })], {}, "INVALID_INPUT"],
    ["a float amount", [line("a", "web-build", 1, { discount: { type: "AMOUNT", minor: 10.5 } })], {}, "INVALID_INPUT"],
  ];
  for (const [label, lines, extra, code] of refused) {
    test(`refuses ${label}`, () => {
      assert.ok(issues(lines, extra).includes(code));
    });
  }
});

describe("recurring + one-off", () => {
  test("groups by interval, month before year; first payment includes one period of each", () => {
    const quote = calc([line("a", "web-build"), line("h", "hosting"), line("s", "seo"), line("l", "licence")]);
    assert.deepEqual(
      quote.recurring.map((r) => [r.intervalKey, r.netMinor, r.vatMinor, r.grossMinor]),
      [
        ["MONTH:1", 79999, 16000, 95999],
        ["YEAR:1", 120000, 24000, 144000],
      ],
    );
    assert.equal(quote.totals.grossMinor, 600000 + 95999 + 144000);
    assert.equal(quote.firstPaymentMinor, 839999);
  });

  test("recurring billed in arrears is not in the first payment", () => {
    const quote = calc([line("a", "web-build"), line("h", "hosting")], {
      payment: { remainder: { type: "SINGLE", due: { type: "ON_ACCEPTANCE" } }, recurringBilledUpfront: false },
    });
    assert.equal(quote.firstPaymentMinor, 600000);
  });
});

describe("deposits and schedules (golden)", () => {
  test("25% deposit, balance on completion", () => {
    const quote = calc([line("a", "web-build")], {
      payment: { deposit: { type: "PERCENT", bps: 2500 }, remainder: { type: "SINGLE", due: { type: "ON_COMPLETION" } } },
    });
    assert.equal(quote.depositMinor, 150000);
    assert.deepEqual(
      quote.schedule.map((r) => [r.kind, r.due.type, r.grossMinor, r.netMinor, r.vatMinor]),
      [
        ["DEPOSIT", "ON_ACCEPTANCE", 150000, 125000, 25000],
        ["BALANCE", "ON_COMPLETION", 450000, 375000, 75000],
      ],
    );
    assert.equal(quote.firstPaymentMinor, 150000);
  });

  test("fixed deposit plus a recurring first period", () => {
    const quote = calc([line("a", "web-build"), line("h", "hosting")], {
      payment: { deposit: { type: "FIXED", minor: 100000 }, remainder: { type: "SINGLE", due: { type: "DAYS_AFTER_ACCEPTANCE", days: 30 } } },
    });
    assert.deepEqual(quote.schedule.map((r) => r.grossMinor), [100000, 500000]);
    assert.equal(quote.firstPaymentMinor, 100000 + 5999);
  });

  test("33.33% deposit and three instalments with the odd penny first", () => {
    const quote = calc([line("a", "dev-hour")], {
      payment: { deposit: { type: "PERCENT", bps: 3333 }, remainder: { type: "INSTALMENTS", count: 3, firstDueDays: 30, intervalDays: 30 } },
    });
    assert.deepEqual(
      quote.schedule.map((r) => [r.kind, r.grossMinor, r.due.type === "DAYS_AFTER_ACCEPTANCE" ? r.due.days : r.due.type]),
      [
        ["DEPOSIT", 3800, "ON_ACCEPTANCE"],
        ["INSTALMENT", 2534, 30],
        ["INSTALMENT", 2533, 60],
        ["INSTALMENT", 2533, 90],
      ],
    );
    assert.equal(quote.firstPaymentMinor, 3800);
  });

  test("instalments starting on acceptance count toward the first payment", () => {
    const quote = calc([line("a", "web-build")], { payment: { remainder: { type: "INSTALMENTS", count: 4, firstDueDays: 0, intervalDays: 30 } } });
    assert.deepEqual(quote.schedule.map((r) => r.grossMinor), [150000, 150000, 150000, 150000]);
    assert.equal(quote.schedule[0].due.type, "ON_ACCEPTANCE");
    assert.equal(quote.firstPaymentMinor, 150000);
  });

  test("mixed-rate deposit splits every rate and reconciles to the penny", () => {
    const quote = calc([line("a", "web-build"), line("b", "print-guide"), line("c", "book")], {
      payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "SINGLE", due: { type: "ON_COMPLETION" } } },
    });
    assert.deepEqual(
      quote.schedule.map((r) => r.vatByRate.map((b) => [b.vatRate, b.netMinor, b.vatMinor, b.grossMinor])),
      [
        [
          ["STANDARD", 250000, 50000, 300000],
          ["REDUCED", 1000, 50, 1050],
          ["ZERO", 625, 0, 625],
        ],
        [
          ["STANDARD", 250000, 50000, 300000],
          ["REDUCED", 999, 50, 1049],
          ["ZERO", 625, 0, 625],
        ],
      ],
    );
    assert.deepEqual(quote.schedule.map((r) => r.grossMinor), [301675, 301674]);
  });

  test("full payment when no deposit", () => {
    const quote = calc([line("a", "web-build")]);
    assert.deepEqual(quote.schedule.map((r) => [r.kind, r.grossMinor]), [["FULL", 600000]]);
  });

  test("a recurring-only quote has no one-off schedule", () => {
    const quote = calc([line("h", "hosting")]);
    assert.deepEqual(quote.schedule, []);
    assert.equal(quote.firstPaymentMinor, 5999);
  });

  const refused: [string, Line[], Partial<CalculateQuoteInput>, string][] = [
    ["a deposit above the total", [line("a", "dev-hour")], { payment: { deposit: { type: "FIXED", minor: 11401 } } as never }, "DEPOSIT_EXCEEDS_TOTAL"],
    ["a deposit with nothing one-off", [line("h", "hosting")], { payment: { deposit: { type: "PERCENT", bps: 5000 } } as never }, "DEPOSIT_WITHOUT_ONE_OFF"],
    [
      "a deposit that rounds to nothing",
      [line("a", "micro")],
      { vatRegistered: false, payment: { deposit: { type: "PERCENT", bps: 1 } } as never },
      "DEPOSIT_ROUNDS_TO_ZERO",
    ],
    [
      "more instalments than pennies",
      [line("a", "micro")],
      { vatRegistered: false, payment: { remainder: { type: "INSTALMENTS", count: 4, firstDueDays: 0, intervalDays: 7 } } as never },
      "INSTALMENTS_TOO_SMALL",
    ],
  ];
  for (const [label, lines, extra, code] of refused) {
    test(`refuses ${label}`, () => {
      assert.deepEqual(issues(lines, extra), [code]);
    });
  }

  test("a full deposit leaves no balance row", () => {
    const quote = calc([line("a", "dev-hour")], { payment: { deposit: { type: "PERCENT", bps: 10000 } } as never });
    assert.deepEqual(quote.schedule.map((r) => [r.kind, r.grossMinor]), [["DEPOSIT", 11400]]);
  });
});

describe("margin", () => {
  test("per line and in total where cost is known", () => {
    const quote = calc([line("a", "web-build"), line("b", "dev-hour", 0.333)]);
    assert.deepEqual([quote.lines[0].marginMinor, quote.lines[0].marginBps], [200000, 4000]);
    assert.deepEqual([quote.lines[1].costMinor, quote.lines[1].marginMinor, quote.lines[1].marginBps], [1332, 1832, 5790]);
    assert.deepEqual(quote.margin, { complete: true, costMinor: 301332, netMinor: 503164, marginMinor: 201832, marginBps: 4011 });
  });

  test("a discount below cost gives a negative margin", () => {
    const [l] = calc([line("a", "web-build", 1, { discount: { type: "PERCENT", bps: 5000 } })]).lines;
    assert.deepEqual([l.marginMinor, l.marginBps], [-50000, -2000]);
  });

  test("unknown cost: margin incomplete, computed over known lines only", () => {
    const quote = calc([line("a", "web-build"), line("s", "seo")]);
    assert.equal(quote.margin.complete, false);
    assert.equal(quote.margin.costMinor, 300000);
    assert.equal(quote.margin.netMinor, 500000);
    assert.equal(quote.lines[1].marginBps, null);
    assert.ok(quote.warnings.some((w) => w.startsWith("MARGIN_INCOMPLETE")));
  });
});

describe("line rules", () => {
  const refused: [string, Line[], Partial<CalculateQuoteInput>, string][] = [
    ["another currency", [line("a", "web-build")], { currency: "EUR" }, "CURRENCY_MISMATCH"],
    ["an unknown item", [line("a", "ghost")], {}, "UNKNOWN_ITEM"],
    ["a retired item", [line("a", "retired")], {}, "INACTIVE_ITEM"],
    ["below the minimum", [line("a", "dev-hour", 0.1)], {}, "QUANTITY_OUT_OF_RANGE"],
    ["above the maximum", [line("a", "dev-hour", 501)], {}, "QUANTITY_OUT_OF_RANGE"],
    ["an unknown option", [line("a", "dev-hour", 1, { optionIds: ["gold"] })], {}, "UNKNOWN_OPTION"],
    ["an add-on alone", [line("s", "support-addon")], {}, "ADD_ON_NEEDS_PARENT"],
    ["an add-on under the wrong parent", [line("a", "dev-hour"), line("s", "support-addon", 1, { parentLineId: "a" })], {}, "INVALID_ADD_ON"],
    ["an add-on under a missing parent", [line("s", "support-addon", 1, { parentLineId: "zz" })], {}, "INVALID_ADD_ON"],
    ["a duplicate line id", [line("a", "web-build"), line("a", "dev-hour")], {}, "DUPLICATE_LINE"],
    ["an unknown bundle", [{ lineId: "b", kind: "BUNDLE", bundleId: "ghost", quantity: 1 }], {}, "UNKNOWN_BUNDLE"],
    ["four-decimal quantity", [line("a", "dev-hour", 1.0001)], {}, "INVALID_INPUT"],
    ["no lines", [], {}, "INVALID_INPUT"],
  ];
  for (const [label, lines, extra, code] of refused) {
    test(`refuses ${label}`, () => {
      assert.ok(issues(lines, extra).includes(code), `expected ${code}`);
    });
  }

  test("an add-on under its parent is priced", () => {
    const quote = calc([line("a", "web-build"), line("s", "support-addon", 1, { parentLineId: "a" })]);
    assert.equal(quote.lines[1].parentLineId, "a");
    assert.equal(quote.oneOff.netMinor, 525000);
  });

  test("a malformed catalogue is never priced", () => {
    const result = calculateQuote({
      currency: "GBP",
      vatRegistered: true,
      catalogue: { currency: "GBP", items: [item({ id: "x", name: "X", unitPriceMinor: 1, addOnItemIds: ["ghost"] })] },
      lines: [line("a", "x")],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues[0].path[0], "catalogue");
  });
});

describe("determinism and the calculation hash", () => {
  const input = {
    currency: "GBP",
    vatRegistered: true,
    catalogue,
    lines: [line("a", "web-build"), line("h", "hosting")],
    quoteDiscount: { type: "PERCENT", bps: 1000, scope: "ALL" },
  } as CalculateQuoteInput;

  test("same input, same hash; version is in the breakdown", () => {
    const one = calculateQuote(input);
    const two = calculateQuote(structuredClone(input));
    assert.ok(one.ok && two.ok);
    if (one.ok && two.ok) {
      assert.equal(one.quote.calculationHash, two.quote.calculationHash);
      assert.match(one.quote.calculationHash, /^[0-9a-f]{64}$/);
      assert.equal(one.quote.version, CALCULATION_VERSION);
      assert.equal(verifyCalculation(input, one.quote), true);
    }
  });

  test("any price change changes the hash", () => {
    const one = calculateQuote(input);
    const two = calculateQuote({ ...input, quoteDiscount: { type: "PERCENT", bps: 1001, scope: "ALL" } });
    assert.ok(one.ok && two.ok);
    if (one.ok && two.ok) {
      assert.notEqual(one.quote.calculationHash, two.quote.calculationHash);
      assert.equal(verifyCalculation({ ...input, lines: [line("a", "web-build", 2)] }, one.quote), false);
    }
  });

  test("no float ever appears in a money field", () => {
    const quote = calc([line("a", "dev-hour", 0.333), line("b", "print-guide", 3), { lineId: "g", kind: "BUNDLE", bundleId: "growth-pack", quantity: 1 }], {
      quoteDiscount: { type: "PERCENT", bps: 777, scope: "ALL" },
      payment: { deposit: { type: "PERCENT", bps: 3333 }, remainder: { type: "INSTALMENTS", count: 7, firstDueDays: 7, intervalDays: 7 } } as never,
    });
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "number") assert.ok(Number.isSafeInteger(value), `${path} = ${value}`);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(quote, "quote");
  });
});

describe("invariants over generated quotes", () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pool = ["web-build", "dev-hour", "hosting", "seo", "licence", "seats", "print-guide", "book", "exam", "micro", "tenp"];

  test("250 random quotes reconcile exactly", () => {
    for (let run = 0; run < 250; run += 1) {
      const lines: Line[] = Array.from({ length: 1 + rand(5) }, (_, i) => {
        const itemId = pool[rand(pool.length)];
        const quantity = itemId === "dev-hour" ? 0.25 + rand(4000) / 1000 : 1 + rand(60);
        const discount = rand(3) === 0 ? { type: "PERCENT", bps: rand(10001) } : undefined;
        return line(`l${i}`, itemId, quantity, discount ? { discount } : {});
      });
      const extra: Partial<CalculateQuoteInput> = {
        vatRegistered: rand(4) !== 0,
        quoteDiscount: rand(2) === 0 ? { type: "PERCENT", bps: rand(3000), scope: "ALL" } : undefined,
        payment: {
          deposit: rand(2) === 0 ? { type: "PERCENT", bps: 1000 + rand(9000) } : undefined,
          remainder: rand(2) === 0 ? { type: "INSTALMENTS", count: 2 + rand(5), firstDueDays: rand(30), intervalDays: 1 + rand(30) } : { type: "SINGLE", due: { type: "ON_COMPLETION" } },
        } as never,
      };
      const result = calculateQuote({ currency: "GBP", catalogue, lines, vatRegistered: true, ...extra });
      if (!result.ok) {
        // Only the documented refusals may occur on random input.
        for (const issue of result.issues) {
          assert.ok(["DEPOSIT_WITHOUT_ONE_OFF", "INSTALMENTS_TOO_SMALL", "DEPOSIT_ROUNDS_TO_ZERO"].includes(issue.code), issue.code);
        }
        continue;
      }
      const q = result.quote;
      for (const l of q.lines) {
        assert.equal(l.listMinor - l.bundleDiscountMinor - l.lineDiscountMinor - l.quoteDiscountMinor, l.netMinor);
        assert.equal(l.netMinor + l.vatMinor, l.grossMinor);
        assert.ok(l.netMinor >= 0 && l.vatMinor >= 0);
      }
      const oneOff = q.lines.filter((l) => l.chargeType === "ONE_OFF");
      assert.equal(oneOff.reduce((t, l) => t + l.grossMinor, 0), q.oneOff.grossMinor);
      assert.equal(q.oneOff.vatByRate.reduce((t, b) => t + b.vatMinor, 0), q.oneOff.vatMinor);
      assert.equal(q.schedule.reduce((t, r) => t + r.grossMinor, 0), q.oneOff.grossMinor);
      for (const bucket of q.oneOff.vatByRate) {
        const rows = q.schedule.map((r) => r.vatByRate.find((b) => b.vatRate === bucket.vatRate));
        assert.equal(rows.reduce((t, b) => t + (b?.netMinor ?? 0), 0), bucket.netMinor);
        assert.equal(rows.reduce((t, b) => t + (b?.vatMinor ?? 0), 0), bucket.vatMinor);
        assert.ok(rows.every((b) => !b || (b.netMinor >= 0 && b.vatMinor >= 0)));
      }
      assert.equal(q.totals.netMinor + q.totals.vatMinor, q.totals.grossMinor);
    }
  });

  test("splitAcrossBuckets with no buckets passes gross through", () => {
    assert.deepEqual(splitAcrossBuckets([5, 7], []), [
      { netMinor: 5, vatMinor: 0, vatByRate: [] },
      { netMinor: 7, vatMinor: 0, vatByRate: [] },
    ]);
  });
});
