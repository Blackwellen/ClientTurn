import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import type { CalculateQuoteInput, QuoteCalculation } from "../src/lib/quotes/types.ts";
import { invoicesFromQuote, recurringInvoice } from "../src/lib/invoicing/from-quote.ts";
import { checkVatInvoice, type VatInvoiceDocument } from "../src/lib/invoicing/vat-invoice.ts";
import type { InvoiceDraft } from "../src/lib/invoicing/types.ts";

const item = (o: Record<string, unknown>) => ({ currency: "GBP", unit: "unit", vatRate: "STANDARD", chargeType: "ONE_OFF", ...o });
const catalogue = {
  currency: "GBP",
  items: [
    item({ id: "build", name: "Website build", unit: "project", unitPriceMinor: 500000 }),
    item({ id: "guide", name: "Printed guide", unitPriceMinor: 1999, vatRate: "REDUCED" }),
    item({ id: "book", name: "Book", unitPriceMinor: 1250, vatRate: "ZERO" }),
    item({ id: "hosting", name: "Hosting", chargeType: "RECURRING", interval: { unit: "MONTH" }, unitPriceMinor: 4999 }),
  ],
};

function calc(extra: Partial<CalculateQuoteInput> = {}): QuoteCalculation {
  const result = calculateQuote({
    currency: "GBP",
    vatRegistered: true,
    catalogue,
    lines: [
      { lineId: "a", kind: "ITEM", itemId: "build", quantity: 1 },
      { lineId: "b", kind: "ITEM", itemId: "guide", quantity: 1 },
      { lineId: "c", kind: "ITEM", itemId: "book", quantity: 1 },
      { lineId: "h", kind: "ITEM", itemId: "hosting", quantity: 1 },
    ],
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.quote;
}

const meta = { businessId: "biz", quoteRevisionId: "rev-1", quoteNumber: "Q-00042" };

const asDocument = (draft: InvoiceDraft, vatRegistered = true): VatInvoiceDocument => ({
  number: "INV-00001",
  issueDate: "2026-10-02",
  supplyDate: null,
  currency: draft.currency,
  seller: { name: "Studio Ltd", address: ["1 High St", "London"], vatRegistered, vatNumber: vatRegistered ? "GB123456789" : null },
  buyer: { name: "Buyer Co", address: ["2 Low Rd"] },
  lines: draft.lines,
  vatByRate: draft.vatByRate,
  netMinor: draft.netMinor,
  vatMinor: draft.vatMinor,
  totalMinor: draft.totalMinor,
});

describe("invoice from quote", () => {
  test("no deposit: one FULL invoice with the real quote lines", () => {
    const [full, ...rest] = invoicesFromQuote({ ...meta, calculation: calc() });
    assert.equal(rest.length, 0);
    assert.equal(full.kind, "FULL");
    assert.deepEqual(full.lines.map((l) => [l.description, l.netMinor, l.vatMinor, l.apportioned]), [
      ["Website build", 500000, 100000, false],
      ["Printed guide", 1999, 100, false],
      ["Book", 1250, 0, false],
    ]);
    assert.equal(full.totalMinor, 603349);
    assert.deepEqual(checkVatInvoice(asDocument(full)), { compliant: true, issues: [] });
  });

  test("deposit + balance: apportioned per VAT rate and reconciled to the quote", () => {
    const quote = calc({ payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "SINGLE", due: { type: "ON_COMPLETION" } } } as never });
    const [deposit, balance] = invoicesFromQuote({ ...meta, calculation: quote });
    assert.equal(deposit.kind, "DEPOSIT");
    assert.equal(balance.kind, "BALANCE");
    assert.deepEqual(deposit.lines.map((l) => [l.description, l.netMinor, l.vatMinor, l.grossMinor]), [
      ["Deposit for quote Q-00042, 20% items", 250000, 50000, 300000],
      ["Deposit for quote Q-00042, 5% items", 1000, 50, 1050],
      ["Deposit for quote Q-00042, 0% (zero-rated) items", 625, 0, 625],
    ]);
    assert.equal(deposit.totalMinor + balance.totalMinor, quote.oneOff.grossMinor);
    assert.equal(deposit.vatMinor + balance.vatMinor, quote.oneOff.vatMinor);
    assert.equal(deposit.due?.type, "ON_ACCEPTANCE");
    assert.equal(balance.due?.type, "ON_COMPLETION");
    assert.equal(checkVatInvoice(asDocument(deposit)).compliant, true);
    assert.equal(checkVatInvoice(asDocument(balance)).compliant, true);
  });

  test("instalments are numbered and each has its own idempotency key", () => {
    const quote = calc({ payment: { remainder: { type: "INSTALMENTS", count: 3, firstDueDays: 0, intervalDays: 30 } } as never });
    const invoices = invoicesFromQuote({ ...meta, calculation: quote });
    assert.deepEqual(invoices.map((i) => i.lines[0].description.split(",")[0]), [
      "Instalment 1 for quote Q-00042",
      "Instalment 2 for quote Q-00042",
      "Instalment 3 for quote Q-00042",
    ]);
    assert.equal(new Set(invoices.map((i) => i.idempotencyKey)).size, 3);
    assert.equal(invoices.reduce((t, i) => t + i.totalMinor, 0), quote.oneOff.grossMinor);
    assert.deepEqual(invoicesFromQuote({ ...meta, calculation: quote }).map((i) => i.idempotencyKey), invoices.map((i) => i.idempotencyKey));
  });

  test("recurring invoice per period", () => {
    const quote = calc();
    const october = recurringInvoice({ ...meta, calculation: quote, intervalKey: "MONTH:1", periodStart: "2026-10-01" });
    const november = recurringInvoice({ ...meta, calculation: quote, intervalKey: "MONTH:1", periodStart: "2026-11-01" });
    assert.deepEqual([october.netMinor, october.vatMinor, october.totalMinor], [4999, 1000, 5999]);
    assert.notEqual(october.idempotencyKey, november.idempotencyKey);
    assert.equal(checkVatInvoice(asDocument(october)).compliant, true);
    assert.throws(() => recurringInvoice({ ...meta, calculation: quote, intervalKey: "YEAR:1", periodStart: "2026-10-01" }));
    assert.throws(() => recurringInvoice({ ...meta, calculation: quote, intervalKey: "MONTH:1", periodStart: "Oct" }));
  });

  test("not VAT-registered: one gross line, no VAT anywhere", () => {
    const quote = calc({ vatRegistered: false, payment: { deposit: { type: "FIXED", minor: 100000 } } as never });
    const [deposit, full] = invoicesFromQuote({ ...meta, calculation: quote });
    assert.deepEqual(deposit.lines.map((l) => [l.netMinor, l.vatMinor]), [[100000, 0]]);
    assert.deepEqual(deposit.vatByRate, []);
    assert.equal(full.totalMinor, 503249 - 100000);
    assert.deepEqual(checkVatInvoice(asDocument(deposit, false)), { compliant: true, issues: [] });
  });
});
