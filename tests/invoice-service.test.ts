import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { DEFAULT_QUOTE_SETTINGS } from "../src/lib/quotes/settings.ts";
import {
  createInvoicesFromQuote,
  invoiceIssueDate,
  InvoiceServiceError,
  issueCreditNote,
  issueInvoice,
  recordPayment,
  voidInvoice,
  type InvoiceDeps,
  type InvoiceRecord,
  type InvoiceStore,
  type QuoteForInvoicing,
} from "../src/lib/invoicing/service-core.ts";
import type { CreditNote } from "../src/lib/invoicing/types.ts";
import { CATALOGUE } from "./fixtures/quote-fakes.ts";

/**
 * Customer invoicing over an in-memory store that mirrors the 0154 triggers
 * (payments never exceed the total, credits never exceed what was paid,
 * idempotency keys unique). No Stripe, no email.
 */

const B = "b1";

function fixture(status = "SIGNED", capabilities: Record<string, boolean> = { invoicing_enabled: true }) {
  const calc = calculateQuote({
    currency: "GBP",
    vatRegistered: true,
    catalogue: CATALOGUE,
    lines: [{ lineId: "l1", kind: "ITEM", itemId: "website", quantity: 1 }],
    payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "SINGLE", due: { type: "DAYS_AFTER_ACCEPTANCE", days: 30 } }, recurringBilledUpfront: true },
  });
  assert.ok(calc.ok);
  const quote: QuoteForInvoicing = { id: "q1", number: "Q-00001", status, opportunityId: "o1", leadId: "lead-1", revisionId: "r1", calculation: calc.quote, acceptedAt: "2026-09-27T10:00:00Z" };
  const invoices = new Map<string, InvoiceRecord & { key: string }>();
  const payments = new Set<string>();
  const credits: (CreditNote & { key: string })[] = [];
  const transitions: string[] = [];
  let number = 0;
  let quoteStatus = status;
  const store: InvoiceStore = {
    loadSettings: async () => DEFAULT_QUOTE_SETTINGS,
    loadSeller: async () => ({ name: "Studio North Ltd", address: ["1 High St"] }),
    loadQuoteForInvoicing: async (_b, id) => (id === "q1" ? { ...quote, status: quoteStatus } : null),
    loadBuyer: async () => ({ name: "Acme Ltd", address: ["EC1A 1BB"] }),
    async insertDraft(_b, { draft }) {
      const existing = [...invoices.values()].find((inv) => inv.key === draft.idempotencyKey);
      if (existing) return { id: existing.id, created: false };
      const id = `inv${invoices.size + 1}`;
      invoices.set(id, {
        id,
        key: draft.idempotencyKey,
        opportunityId: "o1",
        quoteId: "q1",
        revisionId: "r1",
        kind: draft.kind,
        status: "DRAFT",
        number: null,
        currency: "GBP",
        totalMinor: draft.totalMinor,
        paidMinor: 0,
        creditedMinor: 0,
        vatByRate: draft.vatByRate,
        issueDate: null,
        dueDate: null,
        scheduleSeq: draft.scheduleSeq,
        dueRule: draft.due,
        buyer: { name: "Acme Ltd", address: [] },
        createdAt: "2026-09-27T10:00:00Z",
      });
      return { id, created: true };
    },
    loadInvoice: async (_b, id) => (invoices.has(id) ? structuredClone(invoices.get(id)!) : null),
    listInvoices: async () => [...invoices.values()].map((inv) => structuredClone(inv)),
    allocateNumber: async (_b, kind) => `${kind === "INVOICE" ? "INV-" : "CN-"}${String(++number).padStart(5, "0")}`,
    async issue(_b, id, fields) {
      const inv = invoices.get(id);
      if (!inv || inv.status !== "DRAFT") return false;
      Object.assign(inv, { status: "OPEN", number: fields.number, issueDate: fields.issueDate, dueDate: fields.dueDate });
      return true;
    },
    async insertPayment(_b, input) {
      if (payments.has(input.externalId)) return "DUPLICATE";
      const inv = invoices.get(input.invoiceId)!;
      if (!["OPEN", "PARTIALLY_PAID"].includes(inv.status) || inv.paidMinor + input.amountMinor > inv.totalMinor) return "REFUSED";
      payments.add(input.externalId);
      inv.paidMinor += input.amountMinor;
      inv.status = inv.paidMinor === inv.totalMinor ? "PAID" : "PARTIALLY_PAID";
      return "RECORDED";
    },
    async voidInvoice(_b, id) {
      const inv = invoices.get(id);
      if (!inv || !["DRAFT", "OPEN"].includes(inv.status) || inv.paidMinor > 0) return false;
      inv.status = "VOID";
      return true;
    },
    loadCreditNotes: async (_b, id) => credits.filter((c) => c.invoiceId === id),
    findCreditNoteByKey: async (_b, key) => {
      const c = credits.find((row) => row.key === key);
      return c ? { number: c.number, amountMinor: c.amountMinor, netMinor: c.netMinor, vatMinor: c.vatMinor } : null;
    },
    async insertCreditNote(_b, note) {
      if (credits.some((c) => c.key === note.idempotencyKey)) return "DUPLICATE";
      const inv = invoices.get(note.invoiceId)!;
      if (inv.creditedMinor + note.amountMinor > inv.paidMinor) return "REFUSED";
      inv.creditedMinor += note.amountMinor;
      credits.push({ ...note, key: note.idempotencyKey });
      return "RECORDED";
    },
    async quoteTransition(_b, _q, action) {
      transitions.push(action);
      quoteStatus = action === "RECORD_DEPOSIT_PAID" ? "DEPOSIT_PAID" : "PAID";
      return { ok: true };
    },
    loadQuoteStatus: async () => quoteStatus,
  };
  const jobs: string[] = [];
  const emitted: string[] = [];
  const delivered: string[] = [];
  const deps: InvoiceDeps = {
    store,
    now: () => new Date("2026-09-27T12:00:00Z"),
    can: async (capability) => ({ allowed: Boolean(capabilities[capability]), message: "Invoicing is not on this plan." }),
    effects: {
      deliverInvoice: async ({ sendKey }) => {
        delivered.push(sendKey);
        return { queued: true, detail: "fake" };
      },
      enqueue: async (type, _p, opts) => {
        jobs.push(`${type}:${opts.idempotencyKey}`);
      },
      emit: async (_b, type) => {
        emitted.push(type);
      },
    },
  };
  return { deps, invoices, jobs, emitted, delivered, transitions };
}

const human = { kind: "HUMAN" as const, userId: "u1" };

async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => e instanceof InvoiceServiceError && e.code === code);
}

describe("invoices from a signed quote", () => {
  test("one draft per schedule row, idempotent, and the on-acceptance one is issued now", async () => {
    const { deps, invoices, jobs } = fixture();
    const first = await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: true });
    assert.equal(first.invoices.length, 2);
    const again = await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: true });
    assert.equal(again.duplicate, true);
    assert.equal(invoices.size, 2);
    const total = [...invoices.values()].reduce((t, i) => t + i.totalMinor, 0);
    assert.equal(total, 600_000, "the invoices sum exactly to the quote's one-off gross");
    assert.equal(jobs.filter((j) => j.startsWith("invoice.issue")).length, 2);
  });

  test("a draft or sent quote cannot be invoiced, and invoicing needs the capability", async () => {
    await rejects(createInvoicesFromQuote(fixture("SENT").deps, B, human, { quoteId: "q1", autoIssue: false }), "CONFLICT");
    await rejects(createInvoicesFromQuote(fixture("SIGNED", {}).deps, B, human, { quoteId: "q1", autoIssue: false }), "PLAN_LIMIT");
  });

  test("an instalment is issued its payment-terms days before it falls due", () => {
    assert.equal(invoiceIssueDate({ type: "DAYS_AFTER_ACCEPTANCE", days: 30 }, "2026-09-27", 14), "2026-10-13");
    assert.equal(invoiceIssueDate({ type: "DAYS_AFTER_ACCEPTANCE", days: 5 }, "2026-09-27", 14), "2026-09-27");
    assert.equal(invoiceIssueDate({ type: "ON_COMPLETION" }, "2026-09-27", 14), null);
  });
});

describe("issue, pay, credit, void", () => {
  test("issuing numbers the invoice once, schedules reminders and emails it", async () => {
    const { deps, invoices, jobs, delivered, emitted } = fixture();
    await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: false });
    const issued = await issueInvoice(deps, B, human, { invoiceId: "inv1", send: true });
    assert.equal(issued.invoice.number, "INV-00001");
    assert.equal(issued.invoice.dueDate, "2026-10-11");
    assert.ok(jobs.some((j) => j.startsWith("invoice.remind")));
    assert.equal(delivered.length, 1);
    assert.ok(emitted.includes("invoice.issued"));
    const again = await issueInvoice(deps, B, human, { invoiceId: "inv1", send: true });
    assert.equal(again.duplicate, true);
    assert.equal(invoices.get("inv1")!.number, "INV-00001");
  });

  test("the deposit paid moves the quote to DEPOSIT_PAID, the balance to PAID; a repeat payment is recorded once", async () => {
    const { deps, transitions, emitted } = fixture();
    await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: false });
    await issueInvoice(deps, B, human, { invoiceId: "inv1", send: false });
    await issueInvoice(deps, B, human, { invoiceId: "inv2", send: false });
    await recordPayment(deps, B, human, { invoiceId: "inv1", amountMinor: 300_000, receivedAt: "2026-09-28T10:00:00Z", reference: "BACS-1", provider: "bank_transfer" });
    assert.deepEqual(transitions, ["RECORD_DEPOSIT_PAID"]);
    await rejects(recordPayment(deps, B, human, { invoiceId: "inv1", amountMinor: 1, receivedAt: "2026-09-28T10:00:00Z", reference: "BACS-1", provider: "bank_transfer" }), "CONFLICT");
    await recordPayment(deps, B, human, { invoiceId: "inv2", amountMinor: 300_000, receivedAt: "2026-10-28T10:00:00Z", reference: "BACS-2", provider: "bank_transfer" });
    assert.deepEqual(transitions, ["RECORD_DEPOSIT_PAID", "RECORD_PAID"]);
    assert.equal(emitted.filter((e) => e === "invoice.paid").length, 2);
  });

  test("an overpayment is refused", async () => {
    const { deps } = fixture();
    await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: false });
    await issueInvoice(deps, B, human, { invoiceId: "inv1", send: false });
    await rejects(recordPayment(deps, B, human, { invoiceId: "inv1", amountMinor: 300_001, receivedAt: "2026-09-28T10:00:00Z", reference: "X", provider: "manual" }), "CONFLICT");
  });

  test("credit notes never exceed what was paid, and are idempotent per request", async () => {
    const { deps } = fixture();
    await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: false });
    await issueInvoice(deps, B, human, { invoiceId: "inv1", send: false });
    await rejects(issueCreditNote(deps, B, human, { invoiceId: "inv1", amountMinor: 100, reason: "Goodwill", requestId: "c0" }), "CONFLICT");
    await recordPayment(deps, B, human, { invoiceId: "inv1", amountMinor: 100_000, receivedAt: "2026-09-28T10:00:00Z", reference: "P1", provider: "manual" });
    const note = await issueCreditNote(deps, B, human, { invoiceId: "inv1", amountMinor: 60_000, reason: "Goodwill", requestId: "c1" });
    assert.equal(note.creditNote.netMinor + note.creditNote.vatMinor, 60_000);
    assert.equal(note.creditNote.vatMinor, 10_000, "VAT is credited in proportion");
    const repeat = await issueCreditNote(deps, B, human, { invoiceId: "inv1", amountMinor: 60_000, reason: "Goodwill", requestId: "c1" });
    assert.equal(repeat.duplicate, true);
    await rejects(issueCreditNote(deps, B, human, { invoiceId: "inv1", amountMinor: 50_000, reason: "More", requestId: "c2" }), "CONFLICT");
  });

  test("only an unpaid invoice can be voided", async () => {
    const { deps } = fixture();
    await createInvoicesFromQuote(deps, B, human, { quoteId: "q1", autoIssue: false });
    await issueInvoice(deps, B, human, { invoiceId: "inv1", send: false });
    await recordPayment(deps, B, human, { invoiceId: "inv1", amountMinor: 1, receivedAt: "2026-09-28T10:00:00Z", reference: "P", provider: "manual" });
    await rejects(voidInvoice(deps, B, human, { invoiceId: "inv1", reason: "Mistake" }), "CONFLICT");
    assert.equal((await voidInvoice(deps, B, human, { invoiceId: "inv2", reason: "Mistake" })).invoice.status, "VOID");
  });
});
