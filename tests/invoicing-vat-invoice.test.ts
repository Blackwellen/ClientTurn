import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkVatInvoice, isValidUkVatNumber, normaliseVatNumber, type VatInvoiceDocument } from "../src/lib/invoicing/vat-invoice.ts";
import type { InvoiceLine } from "../src/lib/invoicing/types.ts";

const line = (overrides: Partial<InvoiceLine> = {}): InvoiceLine => ({
  description: "Website build",
  quantityMilli: 1000,
  unitNetMinor: 500000,
  discountMinor: 0,
  discountBps: null,
  netMinor: 500000,
  vatRate: "STANDARD",
  vatBps: 2000,
  vatMinor: 100000,
  grossMinor: 600000,
  apportioned: false,
  ...overrides,
});

const doc = (overrides: Partial<VatInvoiceDocument> = {}): VatInvoiceDocument => ({
  number: "INV-00001",
  issueDate: "2026-10-02",
  supplyDate: null,
  currency: "GBP",
  seller: { name: "Studio Ltd", address: ["1 High St", "London"], vatRegistered: true, vatNumber: "GB 123 4567 89" },
  buyer: { name: "Buyer Co", address: ["2 Low Rd"] },
  lines: [line()],
  vatByRate: [{ vatRate: "STANDARD", vatBps: 2000, netMinor: 500000, vatMinor: 100000, grossMinor: 600000 }],
  netMinor: 500000,
  vatMinor: 100000,
  totalMinor: 600000,
  ...overrides,
});

const plain = (overrides: Partial<VatInvoiceDocument> = {}): VatInvoiceDocument =>
  doc({
    seller: { name: "Sole Studio", address: ["1 High St"], vatRegistered: false, vatNumber: null },
    lines: [line({ vatMinor: 0, vatBps: 0, grossMinor: 500000 })],
    vatByRate: [],
    vatMinor: 0,
    totalMinor: 500000,
    ...overrides,
  });

describe("HMRC full VAT invoice fields", () => {
  test("a complete VAT invoice passes", () => {
    assert.deepEqual(checkVatInvoice(doc()), { compliant: true, issues: [] });
  });

  const cases: [string, Partial<VatInvoiceDocument>, string][] = [
    ["no number", { number: null }, "NUMBER_MISSING"],
    ["no date", { issueDate: null }, "ISSUE_DATE_MISSING"],
    ["no seller name", { seller: { name: " ", address: ["x"], vatRegistered: true, vatNumber: "GB123456789" } }, "SELLER_NAME_MISSING"],
    ["no seller address", { seller: { name: "S", address: [], vatRegistered: true, vatNumber: "GB123456789" } }, "SELLER_ADDRESS_MISSING"],
    ["no VAT number while registered", { seller: { name: "S", address: ["x"], vatRegistered: true, vatNumber: null } }, "SELLER_VAT_NUMBER_MISSING"],
    ["a malformed VAT number", { seller: { name: "S", address: ["x"], vatRegistered: true, vatNumber: "GB12345" } }, "SELLER_VAT_NUMBER_INVALID"],
    ["no buyer name", { buyer: { name: "", address: ["x"] } }, "BUYER_NAME_MISSING"],
    ["no buyer address", { buyer: { name: "B", address: [" "] } }, "BUYER_ADDRESS_MISSING"],
    ["no lines", { lines: [], vatByRate: [], netMinor: 0, vatMinor: 0, totalMinor: 0 }, "NO_LINES"],
    ["a line with no description", { lines: [line({ description: "" })] }, "LINE_DESCRIPTION_MISSING"],
    ["a line with no quantity", { lines: [line({ quantityMilli: 0 })] }, "LINE_QUANTITY_MISSING"],
    ["a line with no unit price", { lines: [line({ unitNetMinor: null, quantityMilli: 3000 })] }, "LINE_UNIT_PRICE_MISSING"],
    ["a line with the wrong rate", { lines: [line({ vatBps: 1750 })] }, "LINE_VAT_RATE_MISMATCH"],
    ["a line whose VAT is off by a penny", { lines: [line({ vatMinor: 100001, grossMinor: 600001 })], vatMinor: 100001, totalMinor: 600001 }, "LINE_VAT_MISCALCULATED"],
    ["line arithmetic broken", { lines: [line({ grossMinor: 1 })] }, "LINE_ARITHMETIC"],
    ["VAT per rate not matching lines", { vatByRate: [{ vatRate: "STANDARD", vatBps: 2000, netMinor: 1, vatMinor: 1, grossMinor: 2 }] }, "VAT_BY_RATE_MISMATCH"],
    ["a missing rate row", { vatByRate: [] }, "VAT_BY_RATE_MISMATCH"],
    ["totals not adding up", { totalMinor: 600001 }, "TOTALS_MISMATCH"],
    ["a euro invoice with no sterling VAT total", { currency: "EUR" }, "GBP_VAT_TOTAL_MISSING"],
  ];
  for (const [label, overrides, issue] of cases) {
    test(`flags ${label}`, () => {
      const result = checkVatInvoice(doc(overrides));
      assert.equal(result.compliant, false);
      assert.ok(result.issues.includes(issue as never), JSON.stringify(result.issues));
    });
  }

  test("a euro invoice with the sterling VAT total passes", () => {
    assert.equal(checkVatInvoice(doc({ currency: "EUR", vatTotalGbpMinor: 86000 })).compliant, true);
  });

  test("apportioned deposit lines are checked through the totals, not line arithmetic", () => {
    const deposit = line({ description: "Deposit for quote Q-1", netMinor: 999, vatMinor: 50, grossMinor: 1049, unitNetMinor: 999, vatRate: "REDUCED", vatBps: 500, apportioned: true });
    const result = checkVatInvoice(
      doc({ lines: [deposit], vatByRate: [{ vatRate: "REDUCED", vatBps: 500, netMinor: 999, vatMinor: 50, grossMinor: 1049 }], netMinor: 999, vatMinor: 50, totalMinor: 1049 }),
    );
    assert.deepEqual(result, { compliant: true, issues: [] });
  });
});

describe("not VAT-registered", () => {
  test("no VAT shown: passes", () => {
    assert.deepEqual(checkVatInvoice(plain()), { compliant: true, issues: [] });
  });
  test("a buyer address is not required", () => {
    assert.equal(checkVatInvoice(plain({ buyer: { name: "B", address: [] } })).compliant, true);
  });
  test("charging VAT is flagged", () => {
    assert.ok(checkVatInvoice(plain({ lines: [line()], vatMinor: 100000, totalMinor: 600000 })).issues.includes("VAT_CHARGED_WHEN_NOT_REGISTERED"));
    assert.ok(
      checkVatInvoice(plain({ vatByRate: [{ vatRate: "STANDARD", vatBps: 2000, netMinor: 500000, vatMinor: 0, grossMinor: 500000 }] })).issues.includes(
        "VAT_CHARGED_WHEN_NOT_REGISTERED",
      ),
    );
  });
  test("showing a VAT number is flagged", () => {
    assert.ok(
      checkVatInvoice(plain({ seller: { name: "S", address: ["x"], vatRegistered: false, vatNumber: "GB123456789" } })).issues.includes("VAT_NUMBER_WHEN_NOT_REGISTERED"),
    );
  });
});

describe("UK VAT numbers", () => {
  test("formats", () => {
    assert.equal(normaliseVatNumber("gb 123.456-789"), "GB123456789");
    for (const ok of ["GB123456789", "GB123456789012", "GBGD001", "GBHA599", "gb 123 4567 89"]) assert.equal(isValidUkVatNumber(ok), true, ok);
    for (const bad of ["123456789", "GB12345678", "XI123456789", "GBGD01"]) assert.equal(isValidUkVatNumber(bad), false, bad);
  });
});
