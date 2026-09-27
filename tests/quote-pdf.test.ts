import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { buildQuoteRenderModel, renderModelHash } from "../src/lib/quotes/render-model.ts";
import { documentStrings, formatDocumentDate, quoteDocumentSections } from "../src/lib/quotes/document.ts";
import { encodeWinAnsi, extractPdfText, renderQuotePdf, wrapText } from "../src/lib/quotes/pdf.ts";
import { CATALOGUE } from "./fixtures/quote-fakes.ts";

/**
 * The PDF and the public page render ONE model through ONE set of sections
 * (document.ts). These tests hold the PDF to every customer-visible string
 * of those sections, prove it deterministic, and check the page component
 * reads the same sections rather than the model directly.
 */

function model(options: { vat?: boolean; manyLines?: boolean; poweredBy?: boolean } = {}) {
  const lines = options.manyLines
    ? Array.from({ length: 45 }, (_, i) => ({ lineId: `c${i}`, kind: "ITEM" as const, itemId: "consulting", quantity: i + 1, description: `Consulting sprint ${i + 1}: discovery, (workshops) and a written report \\ summary` }))
    : [
        { lineId: "l1", kind: "ITEM" as const, itemId: "website", quantity: 1, discount: { type: "PERCENT" as const, bps: 1000 } },
        { lineId: "h1", kind: "ITEM" as const, itemId: "hosting", quantity: 1, parentLineId: "l1" },
      ];
  const calc = calculateQuote({
    currency: "GBP",
    vatRegistered: options.vat ?? true,
    catalogue: CATALOGUE,
    lines,
    payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "SINGLE", due: { type: "ON_COMPLETION" } }, recurringBilledUpfront: true },
  });
  assert.ok(calc.ok, JSON.stringify(!calc.ok && calc.issues));
  return buildQuoteRenderModel({
    quote: { number: "Q-00042", revision: 2, title: "Website rebuild for Acme – phase one", issuedOn: "2026-09-27", validUntil: "2026-10-27" },
    seller: { name: "Studio North", legalName: "Studio North Ltd", address: ["1 High Street", "Leeds LS1 1AA"], companyNumber: "01234567", vatNumber: "GB123456789", email: "hello@studio.test" },
    buyer: { name: "Priya Shah", company: "Acme Ltd", email: "priya@acme.test", address: ["EC1A 1BB"] },
    calculation: calc.quote,
    terms: "Payment within 14 days of each invoice. Work starts on receipt of the deposit.",
    customerNote: "Thanks for the call on Tuesday.",
    poweredBy: options.poweredBy ?? true,
  });
}

const norm = (text: string) => text.replace(/\s+/g, " ");

describe("document sections", () => {
  test("dates are formatted without Intl", () => {
    assert.equal(formatDocumentDate("2026-10-27"), "27 October 2026");
    assert.equal(formatDocumentDate("2026-01-05T10:00:00Z"), "5 January 2026");
  });

  test("the VAT columns follow VAT registration", () => {
    assert.equal(quoteDocumentSections(model()).lineColumns.length, 7);
    const noVat = quoteDocumentSections(model({ vat: false }));
    assert.equal(noVat.lineColumns.length, 5);
    assert.ok(noVat.vatNotice);
  });
});

describe("the PDF", () => {
  test("is a PDF, and deterministic: the same model gives the same bytes", () => {
    const m = model();
    const a = renderQuotePdf(m, { documentHash: renderModelHash(m) });
    const b = renderQuotePdf(structuredClone(m), { documentHash: renderModelHash(m) });
    assert.equal(Buffer.from(a).subarray(0, 8).toString("latin1"), "%PDF-1.4");
    assert.match(Buffer.from(a).toString("latin1"), /%%EOF\n$/);
    assert.equal(createHash("sha256").update(a).digest("hex"), createHash("sha256").update(b).digest("hex"));
  });

  test("contains every customer-visible string of the same sections the page renders", () => {
    for (const m of [model(), model({ vat: false }), model({ manyLines: true })]) {
      const doc = quoteDocumentSections(m, { documentHash: renderModelHash(m) });
      const text = norm(extractPdfText(renderQuotePdf(m, { documentHash: renderModelHash(m) })));
      for (const value of documentStrings(doc)) {
        const expected = norm(value).replace(/–/g, "\u0096");
        assert.ok(text.includes(expected) || text.includes(norm(value)), `PDF is missing "${value}"`);
      }
      assert.ok(text.includes(renderModelHash(m)), "the footer prints the document fingerprint");
    }
  });

  test("a long quote spans pages, and every page carries the footer", () => {
    const m = model({ manyLines: true });
    const source = Buffer.from(renderQuotePdf(m)).toString("latin1");
    const pages = Number(/\/Count (\d+)/.exec(source)?.[1]);
    assert.ok(pages >= 2, `expected several pages, got ${pages}`);
    assert.equal((source.match(/Page \d+ of \d+/g) ?? []).length, pages);
  });

  test("the badge follows the render model", () => {
    assert.ok(extractPdfText(renderQuotePdf(model({ poweredBy: true }))).includes("Powered by ClientTurn"));
    assert.ok(!extractPdfText(renderQuotePdf(model({ poweredBy: false }))).includes("Powered by ClientTurn"));
  });

  test("text is WinAnsi-encoded and wrapped to the column", () => {
    assert.deepEqual(encodeWinAnsi("£€"), [0xa3, 0x80]);
    for (const line of wrapText("a ".repeat(200), 100, 9)) assert.ok(line.length > 0);
    assert.ok(wrapText("Supercalifragilisticexpialidocious".repeat(4), 60, 9).length > 1, "an over-long word is split");
  });
});

describe("the public page reads the same sections", () => {
  test("the page component renders from quoteDocumentSections, not from the model's fields", () => {
    const page = readFileSync("src/components/quotes/public-quote-document.tsx", "utf8");
    assert.match(page, /quoteDocumentSections\(/);
    assert.doesNotMatch(page, /model\.lines|model\.oneOff|model\.schedule/);
  });
});
