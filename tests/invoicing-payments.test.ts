import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { amountDueMinor, applyPayment, isOverdue, issueInvoice, markUncollectible, statusFromPayments, voidInvoice } from "../src/lib/invoicing/status.ts";
import { addCreditNote, createCreditNote, creditableMinor } from "../src/lib/invoicing/credit-notes.ts";
import type { InvoiceState } from "../src/lib/invoicing/types.ts";

const draft = (overrides: Partial<InvoiceState> = {}): InvoiceState => ({
  id: "inv-1",
  status: "DRAFT",
  number: null,
  currency: "GBP",
  totalMinor: 603349,
  vatByRate: [
    { vatRate: "STANDARD", vatBps: 2000, netMinor: 500000, vatMinor: 100000, grossMinor: 600000 },
    { vatRate: "REDUCED", vatBps: 500, netMinor: 1999, vatMinor: 100, grossMinor: 2099 },
    { vatRate: "ZERO", vatBps: 0, netMinor: 1250, vatMinor: 0, grossMinor: 1250 },
  ],
  payments: [],
  creditNotes: [],
  issueDate: null,
  dueDate: null,
  ...overrides,
});

function open(): InvoiceState {
  const result = issueInvoice(draft(), { number: "INV-00001", issueDate: "2026-10-02", dueDate: "2026-10-16" });
  assert.ok(result.ok);
  return result.ok ? result.invoice : draft();
}

function pay(invoice: InvoiceState, id: string, amountMinor: number): InvoiceState {
  const result = applyPayment(invoice, { id, amountMinor, receivedAt: "2026-10-05T10:00:00.000Z" });
  if (!result.ok) assert.fail(result.detail);
  return result.invoice;
}

describe("issuing", () => {
  test("DRAFT -> OPEN with a number and dates", () => {
    const invoice = open();
    assert.deepEqual([invoice.status, invoice.number, invoice.issueDate, invoice.dueDate], ["OPEN", "INV-00001", "2026-10-02", "2026-10-16"]);
  });
  test("refuses re-issue, zero totals and a due date before issue", () => {
    assert.equal(issueInvoice(open(), { number: "X", issueDate: "2026-10-02", dueDate: "2026-10-02" }).ok, false);
    assert.equal(issueInvoice(draft({ totalMinor: 0 }), { number: "X", issueDate: "2026-10-02", dueDate: "2026-10-02" }).ok, false);
    assert.equal(issueInvoice(draft(), { number: "X", issueDate: "2026-10-02", dueDate: "2026-10-01" }).ok, false);
  });
});

describe("partial payments and status", () => {
  test("OPEN -> PARTIALLY_PAID -> PAID", () => {
    let invoice = pay(open(), "pay-1", 200000);
    assert.equal(invoice.status, "PARTIALLY_PAID");
    assert.equal(amountDueMinor(invoice), 403349);
    invoice = pay(invoice, "pay-2", 403349);
    assert.equal(invoice.status, "PAID");
    assert.equal(amountDueMinor(invoice), 0);
  });

  test("a replayed payment applies once", () => {
    const once = pay(open(), "pay-1", 1000);
    const again = applyPayment(once, { id: "pay-1", amountMinor: 1000, receivedAt: "2026-10-06T00:00:00.000Z" });
    assert.ok(again.ok && again.duplicate === true);
    if (again.ok) assert.equal(again.invoice.payments.length, 1);
  });

  const refused: [string, () => InvoiceState, number, string, string?][] = [
    ["overpayment", open, 603350, "OVERPAYMENT"],
    ["zero", open, 0, "NON_POSITIVE"],
    ["a draft", () => draft(), 100, "NOT_ISSUED"],
    ["a void invoice", () => draft({ status: "VOID" }), 100, "VOID"],
    ["a paid invoice", () => pay(open(), "p", 603349), 1, "ALREADY_PAID"],
    ["a reused id with another amount", () => pay(open(), "dup", 100), 200, "PAYMENT_ID_CONFLICT", "dup"],
  ];
  for (const [label, make, amount, reason, id] of refused) {
    test(`refuses ${label}`, () => {
      const result = applyPayment(make(), { id: id ?? "new", amountMinor: amount, receivedAt: "2026-10-05T00:00:00.000Z" });
      assert.equal(result.ok ? null : result.reason, reason);
    });
  }

  test("a float amount throws before it can be stored", () => {
    assert.throws(() => applyPayment(open(), { id: "f", amountMinor: 10.5, receivedAt: "2026-10-05T00:00:00.000Z" }));
  });

  test("statusFromPayments", () => {
    assert.equal(statusFromPayments(100, 0), "OPEN");
    assert.equal(statusFromPayments(100, 1), "PARTIALLY_PAID");
    assert.equal(statusFromPayments(100, 100), "PAID");
  });

  test("uncollectible can still be paid; void cannot", () => {
    const written = markUncollectible(pay(open(), "p1", 100));
    assert.ok(written.ok);
    if (written.ok) {
      assert.equal(written.invoice.status, "UNCOLLECTIBLE");
      assert.equal(pay(written.invoice, "p2", 603249).status, "PAID");
    }
    assert.equal(markUncollectible(draft()).ok, false);
  });

  test("void only with nothing paid", () => {
    assert.equal(voidInvoice(open()).ok, true);
    assert.equal(voidInvoice(draft()).ok, true);
    assert.equal(voidInvoice(pay(open(), "p", 1)).ok, false);
    assert.equal(voidInvoice(pay(open(), "p", 603349)).ok, false);
  });

  test("overdue", () => {
    const invoice = open();
    assert.equal(isOverdue(invoice, "2026-10-16"), false);
    assert.equal(isOverdue(invoice, "2026-10-17"), true);
    assert.equal(isOverdue(pay(invoice, "p", 603349), "2026-12-01"), false);
  });
});

describe("credit notes never exceed the paid amount", () => {
  const note = (invoice: InvoiceState, amountMinor: number, id = "cn-1") =>
    createCreditNote(invoice, { id, number: `CN-${id}`, amountMinor, reason: "Scope reduced", issuedAt: "2026-10-10T00:00:00.000Z" });

  test("nothing paid: nothing creditable", () => {
    const result = note(open(), 1);
    assert.equal(result.ok ? null : result.reason, "NOTHING_PAID");
  });

  test("bounded by paid, then by what is left after earlier credits", () => {
    let invoice = pay(open(), "p1", 200000);
    assert.equal(creditableMinor(invoice), 200000);
    const tooMuch = note(invoice, 200001);
    assert.equal(tooMuch.ok ? null : tooMuch.reason, "EXCEEDS_PAID");
    if (!tooMuch.ok) assert.equal(tooMuch.maxMinor, 200000);

    const first = note(invoice, 150000);
    assert.ok(first.ok);
    if (first.ok) invoice = addCreditNote(invoice, first.creditNote);
    assert.equal(creditableMinor(invoice), 50000);
    const second = note(invoice, 50001, "cn-2");
    assert.equal(second.ok ? null : second.reason, "EXCEEDS_PAID");
    assert.equal(note(invoice, 50000, "cn-2").ok, true);
  });

  const refused: [string, () => InvoiceState, number, string][] = [
    ["a draft", () => draft(), 1, "NOT_ISSUED"],
    ["a void invoice", () => draft({ status: "VOID", payments: [{ id: "p", amountMinor: 1, receivedAt: "x" }] }), 1, "NOT_ISSUED"],
    ["a zero amount", () => pay(open(), "p", 100), 0, "NON_POSITIVE"],
  ];
  for (const [label, make, amount, reason] of refused) {
    test(`refuses ${label}`, () => {
      const result = note(make(), amount);
      assert.equal(result.ok ? null : result.reason, reason);
    });
  }

  test("a reason is required", () => {
    const result = createCreditNote(pay(open(), "p", 100), { id: "c", number: "CN-1", amountMinor: 10, reason: "  ", issuedAt: "x" });
    assert.equal(result.ok ? null : result.reason, "REASON_REQUIRED");
  });

  test("VAT split by rate; crediting in full in pieces returns exactly the invoice's VAT per rate", () => {
    let invoice = pay(open(), "p", 603349);
    const amounts = [100000, 1, 250000, 3333, 250015];
    amounts.forEach((amount, i) => {
      const result = note(invoice, amount, `cn-${i}`);
      if (!result.ok) assert.fail(result.detail);
      const cn = result.creditNote;
      assert.equal(cn.netMinor + cn.vatMinor, cn.amountMinor);
      assert.equal(cn.vatByRate.reduce((t, b) => t + b.grossMinor, 0), cn.amountMinor);
      assert.ok(cn.vatByRate.every((b) => b.netMinor >= 0 && b.vatMinor >= 0));
      invoice = addCreditNote(invoice, cn);
    });
    assert.equal(creditableMinor(invoice), 0);
    for (const bucket of invoice.vatByRate) {
      const credited = invoice.creditNotes.flatMap((cn) => cn.vatByRate.filter((b) => b.vatRate === bucket.vatRate));
      assert.equal(credited.reduce((t, b) => t + b.vatMinor, 0), bucket.vatMinor, bucket.vatRate);
      assert.equal(credited.reduce((t, b) => t + b.netMinor, 0), bucket.netMinor, bucket.vatRate);
    }
  });

  test("golden: a 20%-only invoice credited £120 returns £20 VAT", () => {
    const simple = issueInvoice(draft({ totalMinor: 60000, vatByRate: [{ vatRate: "STANDARD", vatBps: 2000, netMinor: 50000, vatMinor: 10000, grossMinor: 60000 }] }), {
      number: "INV-2",
      issueDate: "2026-10-02",
      dueDate: "2026-10-16",
    });
    assert.ok(simple.ok);
    if (!simple.ok) return;
    const result = note(pay(simple.invoice, "p", 60000), 12000);
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual([result.creditNote.netMinor, result.creditNote.vatMinor], [10000, 2000]);
  });

  test("not VAT-registered: a credit carries no VAT", () => {
    const plain = issueInvoice(draft({ totalMinor: 5000, vatByRate: [] }), { number: "INV-3", issueDate: "2026-10-02", dueDate: "2026-10-02" });
    assert.ok(plain.ok);
    if (!plain.ok) return;
    const result = note(pay(plain.invoice, "p", 5000), 2500);
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual([result.creditNote.netMinor, result.creditNote.vatMinor, result.creditNote.vatByRate], [2500, 0, []]);
  });
});
