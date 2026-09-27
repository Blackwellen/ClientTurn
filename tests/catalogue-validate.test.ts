import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { listPrice, costAmount } from "../src/lib/catalogue/pricing.ts";
import { parseBundle, parseItem, validateCatalogue } from "../src/lib/catalogue/validate.ts";
import { VAT_RATE_BPS, VAT_RATE_CODES, catalogueItemSchema, type CatalogueItem } from "../src/lib/catalogue/types.ts";
import { toMilli } from "../src/lib/quotes/money.ts";

const base = { currency: "GBP", unit: "unit", vatRate: "STANDARD", chargeType: "ONE_OFF" };
const item = (overrides: Record<string, unknown>): CatalogueItem => catalogueItemSchema.parse({ ...base, ...overrides });

const seats = item({
  id: "seats",
  name: "Seats",
  chargeType: "RECURRING",
  interval: { unit: "MONTH" },
  unitPriceMinor: 0,
  tierMode: "VOLUME",
  tiers: [
    { upTo: 10, unitPriceMinor: 1500 },
    { upTo: 50, unitPriceMinor: 1200 },
    { upTo: null, unitPriceMinor: 1000 },
  ],
});
const emails = item({
  id: "emails",
  name: "Email sends",
  chargeType: "USAGE",
  unit: "1,000 emails",
  unitPriceMinor: 0,
  tierMode: "GRADUATED",
  tiers: [
    { upTo: 100, unitPriceMinor: 100 },
    { upTo: 1000, unitPriceMinor: 80 },
    { upTo: null, unitPriceMinor: 50, flatFeeMinor: 0 },
  ],
});
const setup = item({
  id: "setup",
  name: "Setup",
  unitPriceMinor: 0,
  tierMode: "VOLUME",
  tiers: [
    { upTo: 1, unitPriceMinor: 10000, flatFeeMinor: 5000 },
    { upTo: null, unitPriceMinor: 8000, flatFeeMinor: 5000 },
  ],
});

describe("VAT rate table", () => {
  test("the five UK treatments and their rates", () => {
    assert.deepEqual([...VAT_RATE_CODES], ["STANDARD", "REDUCED", "ZERO", "EXEMPT", "OUTSIDE_SCOPE"]);
    assert.deepEqual(VAT_RATE_BPS, { STANDARD: 2000, REDUCED: 500, ZERO: 0, EXEMPT: 0, OUTSIDE_SCOPE: 0 });
  });
});

describe("tier pricing (golden values)", () => {
  const volume: [number, number, number][] = [
    [1, 1500, 0],
    [10, 15000, 0],
    [11, 13200, 1], // the volume cliff: all 11 at the second tier
    [50, 60000, 1],
    [51, 51000, 2],
    [10.5, 12600, 1],
  ];
  for (const [qty, amount, tier] of volume) {
    test(`VOLUME ${qty} seats = ${amount}`, () => {
      const price = listPrice(seats, toMilli(qty));
      assert.equal(price.amountMinor, amount);
      assert.equal(price.tierIndex, tier);
    });
  }

  const graduated: [number, number][] = [
    [50, 5000],
    [100, 10000],
    [150, 14000], // 100x100 + 50x80
    [1000, 82000], // 100x100 + 900x80
    [1200, 92000], // + 200x50
    [0.5, 50],
  ];
  for (const [qty, amount] of graduated) {
    test(`GRADUATED ${qty} = ${amount}`, () => {
      assert.equal(listPrice(emails, toMilli(qty)).amountMinor, amount);
    });
  }

  test("graduated across bands has no single unit price", () => {
    assert.equal(listPrice(emails, toMilli(150)).unitPriceMinor, null);
    assert.equal(listPrice(emails, toMilli(50)).unitPriceMinor, 100);
  });

  test("flat fee added once for the volume tier", () => {
    assert.equal(listPrice(setup, toMilli(1)).amountMinor, 15000);
    assert.equal(listPrice(setup, toMilli(3)).amountMinor, 29000);
  });

  test("option deltas are per unit", () => {
    const hour = item({ id: "h", name: "Hour", unitPriceMinor: 9500, costPriceMinor: 4000, options: [{ id: "rush", name: "Rush", unitPriceDeltaMinor: 2000, unitCostDeltaMinor: 500 }] });
    assert.equal(listPrice(hour, toMilli(2), hour.options).amountMinor, 23000);
    assert.equal(costAmount(hour, toMilli(2), hour.options), 9000);
  });

  test("cost is unknown when an option that raises the price has no cost", () => {
    const hour = item({ id: "h", name: "Hour", unitPriceMinor: 9500, costPriceMinor: 4000, options: [{ id: "x", name: "X", unitPriceDeltaMinor: 100 }] });
    assert.equal(costAmount(hour, 1000, hour.options), null);
    assert.equal(costAmount(item({ id: "n", name: "N", unitPriceMinor: 1 }), 1000), null);
  });
});

describe("item shape", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["recurring without interval", { id: "a", name: "A", chargeType: "RECURRING", unitPriceMinor: 1 }],
    ["one-off with interval", { id: "a", name: "A", interval: { unit: "MONTH" }, unitPriceMinor: 1 }],
    ["float price", { id: "a", name: "A", unitPriceMinor: 10.5 }],
    ["negative price", { id: "a", name: "A", unitPriceMinor: -1 }],
    ["tiers without a mode", { id: "a", name: "A", unitPriceMinor: 1, tiers: [{ upTo: null, unitPriceMinor: 1 }] }],
    ["mode without tiers", { id: "a", name: "A", unitPriceMinor: 1, tierMode: "VOLUME" }],
    ["last tier capped", { id: "a", name: "A", unitPriceMinor: 1, tierMode: "VOLUME", tiers: [{ upTo: 5, unitPriceMinor: 1 }] }],
    ["open tier not last", { id: "a", name: "A", unitPriceMinor: 1, tierMode: "VOLUME", tiers: [{ upTo: null, unitPriceMinor: 1 }, { upTo: null, unitPriceMinor: 1 }] }],
    ["decreasing ceilings", { id: "a", name: "A", unitPriceMinor: 1, tierMode: "VOLUME", tiers: [{ upTo: 5, unitPriceMinor: 1 }, { upTo: 5, unitPriceMinor: 1 }, { upTo: null, unitPriceMinor: 1 }] }],
    ["min above max", { id: "a", name: "A", unitPriceMinor: 1, minQuantity: 5, maxQuantity: 2 }],
    ["duplicate option", { id: "a", name: "A", unitPriceMinor: 1, options: [{ id: "o", name: "O" }, { id: "o", name: "P" }] }],
    ["own add-on", { id: "a", name: "A", unitPriceMinor: 1, addOnItemIds: ["a"] }],
    ["bad VAT code", { id: "a", name: "A", unitPriceMinor: 1, vatRate: "REVERSE" }],
    ["bad currency", { id: "a", name: "A", unitPriceMinor: 1, currency: "gbp" }],
    ["four-decimal quantity bound", { id: "a", name: "A", unitPriceMinor: 1, minQuantity: 0.0001 }],
  ];
  for (const [label, overrides] of bad) {
    test(`rejects ${label}`, () => {
      assert.equal(parseItem({ ...base, ...overrides }).ok, false);
    });
  }
  test("accepts a full item", () => {
    const parsed = parseItem({ ...base, id: "ok", name: "OK", unitPriceMinor: 100, costPriceMinor: 50, minQuantity: 1, maxQuantity: 10 });
    assert.equal(parsed.ok, true);
  });
  test("bundle pricing shape", () => {
    assert.equal(parseBundle({ id: "b", name: "B", currency: "GBP", components: [{ itemId: "a", quantity: 1 }], pricing: { type: "PERCENT_OFF", bps: 0 } }).ok, false);
    assert.equal(parseBundle({ id: "b", name: "B", currency: "GBP", components: [], pricing: { type: "FIXED", priceMinor: 1 } }).ok, false);
    assert.equal(parseBundle({ id: "b", name: "B", currency: "GBP", components: [{ itemId: "a", quantity: 1 }], pricing: { type: "FIXED", priceMinor: 1 } }).ok, true);
  });
});

describe("catalogue cross-checks", () => {
  const items = [
    { ...base, id: "build", name: "Build", unitPriceMinor: 500000, addOnItemIds: ["support"] },
    { ...base, id: "support", name: "Support", unitPriceMinor: 25000, addOnOnly: true },
    { ...base, id: "hosting", name: "Hosting", chargeType: "RECURRING", interval: { unit: "MONTH" }, unitPriceMinor: 4999 },
    { ...base, id: "usage", name: "Usage", chargeType: "USAGE", unitPriceMinor: 10 },
  ];
  const codes = (raw: unknown) => {
    const result = validateCatalogue(raw);
    return result.ok ? [] : result.issues.map((issue) => issue.code);
  };

  test("a valid catalogue passes", () => {
    const result = validateCatalogue({
      currency: "GBP",
      items,
      bundles: [{ id: "pack", name: "Pack", currency: "GBP", components: [{ itemId: "build", quantity: 1 }, { itemId: "hosting", quantity: 1 }], pricing: { type: "PERCENT_OFF", bps: 500 } }],
    });
    assert.equal(result.ok, true);
  });
  test("duplicate ids", () => {
    assert.ok(codes({ currency: "GBP", items: [...items, items[0]] }).includes("DUPLICATE_ID"));
  });
  test("an item in another currency", () => {
    assert.ok(codes({ currency: "GBP", items: [{ ...items[0], currency: "EUR" }] }).includes("CURRENCY_MISMATCH"));
  });
  test("unknown and nested add-ons", () => {
    assert.ok(codes({ currency: "GBP", items: [{ ...items[0], addOnItemIds: ["ghost"] }] }).includes("UNKNOWN_ADD_ON"));
    assert.ok(
      codes({ currency: "GBP", items: [items[0], { ...items[1], addOnItemIds: ["hosting"] }, items[2]] }).includes("NESTED_ADD_ON"),
    );
  });
  test("bundle rules", () => {
    const bundle = (components: unknown[], pricing: unknown) => ({ currency: "GBP", items, bundles: [{ id: "pack", name: "Pack", currency: "GBP", components, pricing }] });
    assert.ok(codes(bundle([{ itemId: "ghost", quantity: 1 }], { type: "FIXED", priceMinor: 1 })).includes("UNKNOWN_COMPONENT"));
    assert.ok(codes(bundle([{ itemId: "usage", quantity: 1 }], { type: "PERCENT_OFF", bps: 100 })).includes("USAGE_IN_BUNDLE"));
    assert.ok(
      codes(bundle([{ itemId: "build", quantity: 1 }, { itemId: "hosting", quantity: 1 }], { type: "FIXED", priceMinor: 100 })).includes("MIXED_FIXED_BUNDLE"),
    );
    assert.ok(codes(bundle([{ itemId: "build", quantity: 1 }], { type: "FIXED", priceMinor: 500001 })).includes("BUNDLE_ABOVE_COMPONENTS"));
    assert.deepEqual(codes(bundle([{ itemId: "build", quantity: 1 }], { type: "FIXED", priceMinor: 500000 })), []);
  });
  test("bundle component outside its quantity bounds", () => {
    const bounded = [{ ...items[0], minQuantity: 2 }, ...items.slice(1)];
    assert.ok(
      codes({ currency: "GBP", items: bounded, bundles: [{ id: "p", name: "P", currency: "GBP", components: [{ itemId: "build", quantity: 1 }], pricing: { type: "PERCENT_OFF", bps: 100 } }] }).includes(
        "COMPONENT_QUANTITY",
      ),
    );
  });
});
