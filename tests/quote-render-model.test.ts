import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { buildQuoteRenderModel, dueLabel, intervalLabel, renderModelHash, type RenderModelInput } from "../src/lib/quotes/render-model.ts";
import { canonicalJson } from "../src/lib/quotes/canonical.ts";
import type { QuoteCalculation } from "../src/lib/quotes/types.ts";

const item = (o: Record<string, unknown>) => ({ currency: "GBP", unit: "unit", vatRate: "STANDARD", chargeType: "ONE_OFF", ...o });
const catalogue = {
  currency: "GBP",
  items: [
    item({ id: "build", name: "Website build", unit: "project", unitPriceMinor: 500000, costPriceMinor: 300000 }),
    item({ id: "hosting", name: "Hosting", chargeType: "RECURRING", interval: { unit: "MONTH" }, unitPriceMinor: 4999, costPriceMinor: 1500 }),
    item({ id: "emails", name: "Email sends", unit: "1,000 emails", chargeType: "USAGE", unitPriceMinor: 100, costPriceMinor: 20 }),
  ],
};

function quote(vatRegistered: boolean): QuoteCalculation {
  const result = calculateQuote({
    currency: "GBP",
    vatRegistered,
    catalogue,
    lines: [
      { lineId: "a", kind: "ITEM", itemId: "build", quantity: 1, discount: { type: "PERCENT", bps: 1000 } },
      { lineId: "h", kind: "ITEM", itemId: "hosting", quantity: 1 },
      { lineId: "u", kind: "ITEM", itemId: "emails", quantity: 50 },
    ],
    payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "INSTALMENTS", count: 2, firstDueDays: 30, intervalDays: 30 } },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.quote;
}

const input = (calculation: QuoteCalculation, extra: Record<string, unknown> = {}): RenderModelInput =>
  ({
    quote: { number: "Q-00042", revision: 2, title: "New website", issuedOn: "2026-10-01", validUntil: "2026-10-31" },
    seller: { name: "Studio Ltd", legalName: "Studio Limited", address: ["1 High St", "London"], companyNumber: "12345678", vatNumber: "GB123456789", email: "hi@studio.test" },
    buyer: { name: "Sam Buyer", company: "Buyer Co", email: "sam@buyer.test", address: ["2 Low Rd"] },
    calculation,
    terms: "Payment within 14 days.",
    customerNote: "Thanks for the call.",
    poweredBy: true,
    ...extra,
  }) as RenderModelInput;

describe("customer-facing render model", () => {
  const model = buildQuoteRenderModel(input(quote(true)));

  test("golden page content", () => {
    assert.deepEqual(model.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.discount, l.netAmount, l.vatRate, l.vatAmount, l.billing]), [
      ["Website build", "1", "£5,000.00", "10% (£500.00)", "£4,500.00", "20%", "£900.00", "One-off"],
      ["Hosting", "1", "£49.99", null, "£49.99", "20%", "£10.00", "Recurring, per month"],
    ]);
    assert.deepEqual(model.oneOff, { label: "One-off", net: "£4,500.00", vat: "£900.00", gross: "£5,400.00", vatByRate: [{ rate: "20%", net: "£4,500.00", vat: "£900.00" }] });
    assert.equal(model.recurring[0].label, "Recurring, per month");
    assert.equal(model.recurring[0].gross, "£59.99");
    assert.equal(model.deposit, "£2,700.00");
    assert.equal(model.firstPayment, "£2,759.99");
    assert.deepEqual(model.schedule, [
      { label: "Deposit", due: "On acceptance", amount: "£2,700.00" },
      { label: "Instalment 1", due: "30 days after acceptance", amount: "£1,350.00" },
      { label: "Instalment 2", due: "60 days after acceptance", amount: "£1,350.00" },
    ]);
    assert.equal(model.usage?.lines[0], "Email sends: estimated 50 1,000 emails = £50.00 + VAT");
    assert.equal(model.seller.vatNumber, "GB123456789");
    assert.equal(model.vatNotice, null);
    assert.equal(model.poweredBy, true);
  });

  test("excludes cost, margin, internal notes and AI reasoning even when passed in", () => {
    const leaky = buildQuoteRenderModel(
      input(quote(true), { internalNote: "Push hard, they have budget", aiReasoning: "Lead said £10k budget", margin: { marginBps: 4000 } }),
    );
    const text = canonicalJson(leaky);
    for (const forbidden of ["cost", "margin", "internal", "aiReasoning", "Push hard", "budget", "£3,000.00", "£15.00", "40%", "costPrice"]) {
      assert.ok(!text.includes(forbidden), `render model leaks "${forbidden}"`);
    }
    const walkKeys = (value: unknown, keys: Set<string>) => {
      if (Array.isArray(value)) value.forEach((v) => walkKeys(v, keys));
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walkKeys(v, keys);
        }
      }
      return keys;
    };
    const keys = walkKeys(leaky, new Set());
    for (const key of keys) assert.ok(!/cost|margin|note$|reason/i.test(key) || key === "customerNote", `unexpected key ${key}`);
  });

  test("not VAT-registered: no VAT column, no VAT number, a notice instead", () => {
    const plain = buildQuoteRenderModel(input(quote(false)));
    assert.equal(plain.showVat, false);
    assert.ok(plain.lines.every((l) => l.vatRate === null && l.vatAmount === null && l.grossAmount === null));
    assert.equal(plain.seller.vatNumber, null);
    assert.equal(plain.oneOff?.vat, null);
    assert.equal(plain.oneOff?.gross, "£4,500.00");
    assert.equal(plain.vatNotice, "The seller is not registered for VAT. No VAT is charged.");
    assert.equal(plain.usage?.lines[0], "Email sends: estimated 50 1,000 emails = £50.00");
  });

  test("page and PDF share one model: same input, same bytes, same hash", () => {
    const again = buildQuoteRenderModel(input(quote(true)));
    assert.equal(canonicalJson(again), canonicalJson(model));
    assert.equal(renderModelHash(again), renderModelHash(model));
    assert.match(renderModelHash(model), /^[0-9a-f]{64}$/);
  });

  test("any visible change changes the hash", () => {
    const changed = buildQuoteRenderModel(input(quote(true), { terms: "Payment within 30 days." }));
    assert.notEqual(renderModelHash(changed), renderModelHash(model));
  });

  test("labels", () => {
    assert.equal(intervalLabel({ unit: "MONTH", count: 1 }), "per month");
    assert.equal(intervalLabel({ unit: "MONTH", count: 3 }), "every 3 months");
    assert.equal(dueLabel({ type: "DAYS_AFTER_ACCEPTANCE", days: 1 }), "1 day after acceptance");
    assert.equal(dueLabel({ type: "ON_COMPLETION" }), "On completion");
  });
});
