import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { creditNoteKey, invoiceKey, paymentLinkKey, quoteActionKey, quoteRequestKey } from "../src/lib/quotes/idempotency.ts";

const B = "11111111-1111-1111-1111-111111111111";

describe("idempotency keys", () => {
  test("same request, same quote key; any different part, a different key", () => {
    const base = { businessId: B, opportunityId: "opp-1", leadId: "lead-1", requestId: "msg-1" };
    assert.equal(quoteRequestKey(base), quoteRequestKey({ ...base }));
    assert.notEqual(quoteRequestKey(base), quoteRequestKey({ ...base, requestId: "msg-2" }));
    assert.notEqual(quoteRequestKey(base), quoteRequestKey({ ...base, opportunityId: "opp-2" }));
    assert.notEqual(quoteRequestKey(base), quoteRequestKey({ ...base, businessId: "other" }));
    assert.match(quoteRequestKey(base), /^quote-request:v1:[0-9a-f]{64}$/);
  });

  test("keys carry no raw identifiers", () => {
    const key = quoteRequestKey({ businessId: B, opportunityId: null, leadId: "lead-sam@example.com", requestId: "r" });
    assert.ok(!key.includes("example.com"));
    assert.ok(key.length <= 96);
  });

  test("an accept or sign happens once per revision", () => {
    assert.equal(quoteActionKey({ revisionId: "r1", action: "SIGN" }), quoteActionKey({ revisionId: "r1", action: "SIGN" }));
    assert.notEqual(quoteActionKey({ revisionId: "r1", action: "SIGN" }), quoteActionKey({ revisionId: "r1", action: "ACCEPT" }));
    assert.notEqual(quoteActionKey({ revisionId: "r1", action: "SIGN" }), quoteActionKey({ revisionId: "r2", action: "SIGN" }));
  });

  test("one invoice per revision and schedule slot", () => {
    const deposit = invoiceKey({ businessId: B, quoteRevisionId: "r1", kind: "DEPOSIT", slot: 1 });
    assert.equal(deposit, invoiceKey({ businessId: B, quoteRevisionId: "r1", kind: "DEPOSIT", slot: 1 }));
    assert.notEqual(deposit, invoiceKey({ businessId: B, quoteRevisionId: "r1", kind: "BALANCE", slot: 2 }));
    assert.notEqual(deposit, invoiceKey({ businessId: B, quoteRevisionId: "r2", kind: "DEPOSIT", slot: 1 }));
    assert.notEqual(
      invoiceKey({ businessId: B, quoteRevisionId: "r1", kind: "RECURRING", slot: "MONTH:1@2026-10-01" }),
      invoiceKey({ businessId: B, quoteRevisionId: "r1", kind: "RECURRING", slot: "MONTH:1@2026-11-01" }),
    );
  });

  test("two payment links for the same action collapse to one key", () => {
    const link = { businessId: B, invoiceId: "inv-1", amountMinor: 150000, currency: "GBP", purpose: "INVOICE_FULL" as const };
    assert.equal(paymentLinkKey(link), paymentLinkKey({ ...link }));
    assert.notEqual(paymentLinkKey(link), paymentLinkKey({ ...link, amountMinor: 150001 }));
    assert.notEqual(paymentLinkKey(link), paymentLinkKey({ ...link, purpose: "INVOICE_BALANCE" }));
    assert.throws(() => paymentLinkKey({ ...link, amountMinor: 0 }));
    assert.throws(() => paymentLinkKey({ ...link, amountMinor: 1.5 }));
  });

  test("empty parts are refused", () => {
    assert.throws(() => quoteRequestKey({ businessId: B, opportunityId: null, leadId: null, requestId: " " }));
    assert.throws(() => creditNoteKey({ businessId: "", invoiceId: "i", requestId: "r" }));
    assert.match(creditNoteKey({ businessId: B, invoiceId: "i", requestId: "r" }), /^credit-note:v1:/);
  });
});
