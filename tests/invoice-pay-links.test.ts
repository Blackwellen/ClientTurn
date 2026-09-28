import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  invoicePayUrl,
  invoicePaySettingsSchema,
  payLinkProblem,
  setInvoicePayLinkSchema,
} from "../src/lib/invoicing/pay-link.ts";
import { decideInvoiceSettlement, invoicePaymentExternalId, invoicePaymentProvider } from "../src/lib/invoicing/settlement.ts";
import { projectOntoQuote, recordPayment, InvoiceServiceError, type InvoiceDeps, type InvoiceRecord, type InvoiceStore } from "../src/lib/invoicing/service-core.ts";
import { confirmPayment, flagReversal, type ConfirmDeps, type InvoiceSettlementDeps, type PaymentRow } from "../src/lib/payments/confirm.ts";
import { stripePaymentFact, stripeReversalFact, type PaymentFact } from "../src/lib/payments/facts.ts";
import { untagCheckoutUrl } from "../src/lib/payments/tracking.ts";
import { DEFAULT_QUOTE_SETTINGS, quoteSettingsInputSchema, settingsFromRow } from "../src/lib/quotes/settings.ts";

/**
 * Invoice pay links and automatic settlement (0173), with in-memory fakes
 * only: no database, no Stripe, no email. The invoice store mirrors the 0154
 * trigger (a payment never exceeds what is due, and only an open invoice
 * takes one; (provider, external id) is unique).
 */

const BIZ = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const DEPOSIT_TOKEN = "DepositTokenAAAAAAAAAAAA";
const BALANCE_TOKEN = "BalanceTokenBBBBBBBBBBBB";
const LINK = "https://buy.stripe.com/test_abc123";

/* ------------------------------------------------------------ pay links */

describe("the pay link", () => {
  const open = { status: "OPEN", payToken: DEPOSIT_TOKEN, payLinkUrl: null };

  test("a Stripe link carries the invoice token in client_reference_id, and nothing about the lead", () => {
    const url = invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: LINK }, open);
    assert.ok(url);
    const parsed = new URL(url!);
    assert.equal(parsed.origin + parsed.pathname, LINK);
    assert.equal(parsed.searchParams.get("client_reference_id"), DEPOSIT_TOKEN);
    assert.equal([...parsed.searchParams.keys()].length, 1, "exactly one added parameter");
    assert.equal(untagCheckoutUrl(url!, "client_reference_id")?.token, DEPOSIT_TOKEN);
    assert.ok(!/lead/i.test(url!));
  });

  test("a non-Stripe link carries it in ct_ref (the tracked checkout mechanism)", () => {
    const url = invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: "https://pay.example.com/checkout?p=1" }, open);
    assert.equal(new URL(url!).searchParams.get("ct_ref"), DEPOSIT_TOKEN);
    assert.equal(new URL(url!).searchParams.get("p"), "1");
  });

  test("no button: bank transfer only, no link, not payable, or no token", () => {
    assert.equal(invoicePayUrl({ mode: "NONE", workspaceLinkUrl: LINK }, open), null);
    assert.equal(invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: null }, open), null);
    assert.equal(invoicePayUrl({ mode: "PER_INVOICE", workspaceLinkUrl: LINK }, open), null, "per-invoice mode ignores the workspace link");
    for (const status of ["DRAFT", "PAID", "VOID", "UNCOLLECTIBLE"]) {
      assert.equal(invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: LINK }, { ...open, status }), null, status);
    }
    assert.equal(invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: LINK }, { ...open, payToken: null }), null);
    assert.equal(invoicePayUrl({ mode: "WORKSPACE_LINK", workspaceLinkUrl: LINK }, { ...open, payToken: "short" }), null);
  });

  test("per-invoice mode uses the link pasted on that invoice", () => {
    const url = invoicePayUrl({ mode: "PER_INVOICE", workspaceLinkUrl: null }, { status: "PARTIALLY_PAID", payToken: BALANCE_TOKEN, payLinkUrl: "https://buy.stripe.com/test_balance" });
    assert.equal(new URL(url!).searchParams.get("client_reference_id"), BALANCE_TOKEN);
  });

  test("links are validated: https, no credentials, no tracking parameter of their own", () => {
    assert.equal(payLinkProblem(LINK), null);
    assert.ok(payLinkProblem("http://buy.stripe.com/x"));
    assert.ok(payLinkProblem("not a url"));
    assert.ok(payLinkProblem("https://user:pw@buy.stripe.com/x"));
    assert.ok(payLinkProblem(`${LINK}?client_reference_id=abc`));
    assert.ok(payLinkProblem("https://shop.example.com/pay?ct_ref=abc"));
    assert.equal(setInvoicePayLinkSchema.safeParse({ invoiceId: "3f1c9a52-7b1e-4c2d-9a8e-5d6f7a8b9c0d", url: null }).success, true);
    assert.equal(setInvoicePayLinkSchema.safeParse({ invoiceId: "3f1c9a52-7b1e-4c2d-9a8e-5d6f7a8b9c0d", url: "javascript:alert(1)" }).success, false);
  });

  test("settings: a workspace link is required for WORKSPACE_LINK; the default is bank transfer only", () => {
    assert.equal(invoicePaySettingsSchema.safeParse({ invoicePayMode: "WORKSPACE_LINK" }).success, false);
    assert.equal(invoicePaySettingsSchema.safeParse({ invoicePayMode: "WORKSPACE_LINK", invoicePayLinkUrl: LINK }).success, true);
    assert.equal(DEFAULT_QUOTE_SETTINGS.invoicePayMode, "NONE");
    assert.equal(settingsFromRow(null).invoicePayMode, "NONE");
    assert.equal(settingsFromRow({ invoice_pay_mode: "nonsense" }).invoicePayMode, "NONE");
    const base = { vatRegistered: false, validityDays: 30, paymentTermsDays: 14, defaultDepositBps: null };
    assert.equal(quoteSettingsInputSchema.safeParse({ ...base, invoicePayMode: "WORKSPACE_LINK" }).success, false);
    assert.equal(quoteSettingsInputSchema.safeParse({ ...base, invoicePayMode: "WORKSPACE_LINK", invoicePayLinkUrl: "http://x.test" }).success, false);
    const parsed = quoteSettingsInputSchema.parse({ ...base, invoicePayMode: "WORKSPACE_LINK", invoicePayLinkUrl: LINK });
    assert.equal(parsed.invoicePayLinkUrl, LINK);
  });
});

/* ------------------------------------------------------ settlement rules */

describe("settlement rules", () => {
  const invoice = { business_id: BIZ, status: "OPEN", currency: "GBP", total_minor: 50_000, paid_minor: 0 };
  const decide = (overrides: Partial<typeof invoice> = {}, payment = { amountMinor: 50_000, currency: "GBP" }, alreadyRecorded = false) =>
    decideInvoiceSettlement({ businessId: BIZ, invoice: { ...invoice, ...overrides }, payment, alreadyRecorded });

  test("the exact amount settles it", () => {
    assert.deepEqual(decide(), { kind: "SETTLE", amountMinor: 50_000, excessMinor: 0 });
  });
  test("an under-payment settles what was paid (part-paid)", () => {
    assert.deepEqual(decide({}, { amountMinor: 20_000, currency: "GBP" }), { kind: "SETTLE", amountMinor: 20_000, excessMinor: 0 });
  });
  test("an over-payment records the amount due and flags the excess", () => {
    assert.deepEqual(decide({ paid_minor: 30_000 }, { amountMinor: 25_000, currency: "GBP" }), { kind: "SETTLE", amountMinor: 20_000, excessMinor: 5_000 });
  });
  test("a currency mismatch is review, never settlement (case-insensitive compare)", () => {
    assert.deepEqual(decide({}, { amountMinor: 50_000, currency: "EUR" }), { kind: "REVIEW", reason: "CURRENCY_MISMATCH" });
    assert.equal(decide({ currency: "gbp" }).kind, "SETTLE");
  });
  test("a retry or duplicate webhook is ALREADY_RECORDED, whatever the invoice now says", () => {
    assert.deepEqual(decide({ status: "PAID", paid_minor: 50_000 }, undefined, true), { kind: "ALREADY_RECORDED" });
  });
  test("paid, draft, void, written off and zero amounts are review", () => {
    assert.deepEqual(decide({ status: "PAID", paid_minor: 50_000 }), { kind: "REVIEW", reason: "INVOICE_ALREADY_PAID" });
    for (const status of ["DRAFT", "VOID", "UNCOLLECTIBLE"]) assert.deepEqual(decide({ status }), { kind: "REVIEW", reason: "INVOICE_NOT_PAYABLE" }, status);
    assert.deepEqual(decide({}, { amountMinor: 0, currency: "GBP" }), { kind: "REVIEW", reason: "ZERO_AMOUNT" });
  });
  test("another workspace's invoice is never settled", () => {
    assert.deepEqual(decide({ business_id: OTHER }), { kind: "NOT_THIS_WORKSPACE" });
  });
  test("the invoice payment key is the provider order id", () => {
    assert.equal(invoicePaymentExternalId({ provider_order_id: "cs_test_1" }), "cs_test_1");
    assert.equal(invoicePaymentProvider("stripe"), "stripe");
    assert.equal(invoicePaymentProvider("order_paid"), "other");
  });
});

/* ------------------------------------------- the whole loop, with fakes */

type Inv = InvoiceRecord & { payToken: string };

function world(options: { currency?: string } = {}) {
  const currency = options.currency ?? "GBP";
  const invoices = new Map<string, Inv>();
  const base = {
    opportunityId: "opp-1",
    quoteId: "quote-1",
    revisionId: "rev-1",
    currency,
    creditedMinor: 0,
    vatByRate: [],
    dueRule: null,
    buyer: { name: "Acme Ltd", address: [] },
    createdAt: "2026-09-27T10:00:00Z",
    issueDate: "2026-09-27",
    dueDate: "2026-10-11",
  };
  invoices.set("inv-dep", { ...base, id: "inv-dep", kind: "DEPOSIT", status: "OPEN", number: "INV-00001", totalMinor: 50_000, paidMinor: 0, scheduleSeq: 1, payToken: DEPOSIT_TOKEN });
  invoices.set("inv-bal", { ...base, id: "inv-bal", kind: "BALANCE", status: "OPEN", number: "INV-00002", totalMinor: 70_000, paidMinor: 0, scheduleSeq: 2, payToken: BALANCE_TOKEN });
  const invoicePayments: { provider: string; externalId: string; invoiceId: string; amountMinor: number; checkoutPaymentId: string | null }[] = [];
  const emitted: string[] = [];
  const transitions: string[] = [];
  let quoteStatus = "SIGNED";

  const store = {
    loadInvoice: async (_b: string, id: string) => (invoices.has(id) ? structuredClone(invoices.get(id)!) : null),
    listInvoices: async () => [...invoices.values()].map((inv) => structuredClone(inv)),
    loadQuoteForInvoicing: async () => null,
    async insertPayment(_b: string, input: Parameters<InvoiceStore["insertPayment"]>[1]) {
      if (invoicePayments.some((p) => p.provider === input.provider && p.externalId === input.externalId)) return "DUPLICATE" as const;
      const inv = invoices.get(input.invoiceId)!;
      if (!["OPEN", "PARTIALLY_PAID"].includes(inv.status) || inv.paidMinor + input.amountMinor > inv.totalMinor) return "REFUSED" as const;
      invoicePayments.push({ provider: input.provider, externalId: input.externalId, invoiceId: input.invoiceId, amountMinor: input.amountMinor, checkoutPaymentId: input.checkoutPaymentId ?? null });
      inv.paidMinor += input.amountMinor;
      inv.status = inv.paidMinor === inv.totalMinor ? "PAID" : "PARTIALLY_PAID";
      return "RECORDED" as const;
    },
    async quoteTransition(_b: string, _q: string, action: string, expected: string) {
      if (expected !== quoteStatus) return { ok: false };
      transitions.push(action);
      quoteStatus = action === "RECORD_DEPOSIT_PAID" ? "DEPOSIT_PAID" : "PAID";
      return { ok: true };
    },
    loadQuoteStatus: async () => quoteStatus,
  } as unknown as InvoiceStore;

  const invoiceDeps: InvoiceDeps = {
    store,
    effects: {
      deliverInvoice: async () => ({ queued: false, detail: "" }),
      enqueue: async () => undefined,
      emit: async (_b, type, payload) => {
        emitted.push(`${type}:${String(payload.invoiceId)}`);
      },
    },
    can: async () => ({ allowed: true, message: null }),
    now: () => new Date("2026-09-28T12:00:00Z"),
  };

  const payments: (PaymentRow & { payment_intent: string | null })[] = [];
  const notices: string[] = [];
  const audits: string[] = [];
  let seq = 0;
  let crashAfterRecord = false;

  const invoicesDeps: InvoiceSettlementDeps = {
    async invoiceByPayToken(businessId, token) {
      const inv = [...invoices.values()].find((i) => i.payToken === token);
      if (!inv || businessId !== BIZ) return null;
      return { id: inv.id, business_id: BIZ, number: inv.number, status: inv.status, currency: inv.currency, total_minor: inv.totalMinor, paid_minor: inv.paidMinor, lead_id: "lead-1" };
    },
    async invoicePaymentRecorded(_b, provider, externalId) {
      return invoicePayments.find((p) => p.provider === provider && p.externalId === externalId)?.amountMinor ?? null;
    },
    async recordInvoicePayment(input) {
      try {
        const result = await recordPayment(invoiceDeps, input.businessId, { kind: "SYSTEM", userId: null }, {
          invoiceId: input.invoiceId,
          amountMinor: input.amountMinor,
          receivedAt: input.receivedAt,
          reference: input.externalId,
          provider: input.provider,
          checkoutPaymentId: input.checkoutPaymentId,
        });
        if (crashAfterRecord) {
          crashAfterRecord = false;
          throw new Error("simulated crash after the invoice payment");
        }
        return result.duplicate ? "DUPLICATE" : "RECORDED";
      } catch (error) {
        if (error instanceof InvoiceServiceError) return "CONFLICT";
        throw error;
      }
    },
    async reprojectQuote(businessId, invoiceId) {
      const inv = await invoiceDeps.store.loadInvoice(businessId, invoiceId);
      if (inv?.status === "PAID") await projectOntoQuote(invoiceDeps, businessId, inv);
    },
    async paymentByIntent(_b, intent) {
      const row = payments.find((p) => p.payment_intent === intent);
      return row ? { ...row } : null;
    },
    async notify(input) {
      const key = `${input.reason}:${input.paymentId}`;
      if (!notices.includes(key)) notices.push(key);
    },
  };

  const fail = async (): Promise<never> => {
    throw new Error("not an invoice path");
  };
  const deps: ConfirmDeps = {
    async recordPayment(businessId, fact: PaymentFact) {
      const existing = payments.find((p) => p.business_id === businessId && p.provider === fact.provider && p.provider_order_id === fact.orderId);
      if (existing) return { row: { ...existing }, inserted: false };
      const row = {
        id: `pay-${++seq}`,
        business_id: businessId,
        provider: fact.provider,
        source: fact.source,
        provider_order_id: fact.orderId,
        reference: fact.reference,
        email: fact.email,
        amount_minor: fact.amountMinor,
        currency: fact.currency,
        recurring: fact.recurring,
        recurring_interval: fact.interval,
        mrr_minor: null,
        subscription_id: fact.subscriptionId,
        status: "UNMATCHED",
        match_kind: null,
        lead_id: null,
        checkout_attempt_id: null,
        opportunity_id: null,
        applied_at: null,
        invoice_id: null,
        review_reason: null,
        payment_intent: fact.paymentIntentId ?? null,
      };
      payments.push(row);
      return { row: { ...row }, inserted: true };
    },
    async updatePayment(_b, id, patch) {
      Object.assign(payments.find((p) => p.id === id)!, patch);
    },
    async loadPayment(_b, id) {
      const row = payments.find((p) => p.id === id);
      return row ? { ...row } : null;
    },
    attemptByToken: async () => null,
    attemptById: async () => null,
    subscriptionLeadId: async () => null,
    leadIdsByEmail: async (_b, email) => (email === "buyer@acme.test" ? ["lead-1"] : []),
    loadLead: fail,
    priorAppliedPayments: fail,
    markAttemptPaid: fail,
    openOpportunity: fail,
    hasWonOpportunity: fail,
    createOpportunity: fail,
    setOpportunityValue: fail,
    closeWon: fail,
    stopAutomation: fail,
    checkoutLink: fail,
    businessName: fail,
    queueThankYou: fail,
    async notifyOwner(input) {
      notices.push(`${input.status}:${input.paymentId}`);
    },
    async audit(input) {
      audits.push(input.action);
    },
    now: () => new Date("2026-09-28T12:00:00Z"),
    invoices: invoicesDeps,
  };

  return {
    deps,
    invoices,
    invoicePayments,
    payments,
    emitted,
    transitions,
    notices,
    audits,
    quoteStatus: () => quoteStatus,
    crashNextRecord: () => {
      crashAfterRecord = true;
    },
  };
}

/** A checkout.session.completed from the customer's own Stripe, through the real normaliser. */
function sessionFact(input: { id: string; session: string; amount: number; token?: string | null; currency?: string; email?: string; intent?: string }): PaymentFact {
  const result = stripePaymentFact({
    id: input.id,
    type: "checkout.session.completed",
    created: 1_790_000_000,
    data: {
      object: {
        id: input.session,
        mode: "payment",
        payment_status: "paid",
        amount_total: input.amount,
        currency: (input.currency ?? "gbp").toLowerCase(),
        client_reference_id: input.token ?? null,
        payment_intent: input.intent ?? `pi_${input.session}`,
        customer_details: { email: input.email ?? "buyer@acme.test" },
      },
    },
  });
  assert.equal(result.kind, "fact");
  return (result as { kind: "fact"; fact: PaymentFact }).fact;
}

describe("payment.confirm settles an invoice from its pay token", () => {
  test("a deposit paid through its link: invoice PAID, quote DEPOSIT_PAID, invoice.paid once", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_test_dep", amount: 50_000, token: DEPOSIT_TOKEN }) });
    assert.equal(result.outcome, "INVOICE_SETTLED");
    assert.equal(w.invoices.get("inv-dep")!.status, "PAID");
    assert.equal(w.quoteStatus(), "DEPOSIT_PAID");
    assert.deepEqual(w.emitted, ["invoice.paid:inv-dep"]);
    assert.deepEqual(w.invoicePayments.map((p) => [p.provider, p.externalId, p.amountMinor, p.checkoutPaymentId]), [["stripe", "cs_test_dep", 50_000, result.paymentId]]);
    const payment = w.payments[0];
    assert.equal(payment.status, "MATCHED");
    assert.equal(payment.match_kind, "INVOICE");
    assert.equal(payment.invoice_id, "inv-dep");
    assert.equal(payment.lead_id, "lead-1");
    assert.ok(payment.applied_at);
    assert.equal(payment.review_reason, null);
  });

  test("then the balance: every schedule invoice paid moves the quote to PAID", async () => {
    const w = world();
    await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_dep", amount: 50_000, token: DEPOSIT_TOKEN }) });
    await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_2", session: "cs_bal", amount: 70_000, token: BALANCE_TOKEN }) });
    assert.equal(w.quoteStatus(), "PAID");
    assert.deepEqual(w.transitions, ["RECORD_DEPOSIT_PAID", "RECORD_PAID"]);
    assert.deepEqual(w.emitted, ["invoice.paid:inv-dep", "invoice.paid:inv-bal"]);
  });

  test("duplicate webhooks and a retried job never record twice or emit twice", async () => {
    const w = world();
    const fact = sessionFact({ id: "evt_1", session: "cs_dep", amount: 50_000, token: DEPOSIT_TOKEN });
    await confirmPayment(w.deps, { businessId: BIZ, fact });
    const again = await confirmPayment(w.deps, { businessId: BIZ, fact });
    const otherEvent = await confirmPayment(w.deps, { businessId: BIZ, fact: { ...fact, eventId: "evt_1b", eventType: "checkout.session.async_payment_succeeded" } });
    assert.equal(again.outcome, "ALREADY_APPLIED");
    assert.equal(otherEvent.outcome, "ALREADY_APPLIED");
    assert.equal(w.invoicePayments.length, 1);
    assert.equal(w.invoices.get("inv-dep")!.paidMinor, 50_000);
    assert.deepEqual(w.emitted, ["invoice.paid:inv-dep"]);
    assert.deepEqual(w.transitions, ["RECORD_DEPOSIT_PAID"]);
  });

  test("a crash after the invoice payment: the retry finishes without recording or emitting again", async () => {
    const w = world();
    const fact = sessionFact({ id: "evt_1", session: "cs_dep", amount: 50_000, token: DEPOSIT_TOKEN });
    w.crashNextRecord();
    await assert.rejects(confirmPayment(w.deps, { businessId: BIZ, fact }));
    assert.equal(w.payments[0].applied_at, null, "the checkout payment was not stamped");
    const retry = await confirmPayment(w.deps, { businessId: BIZ, fact });
    assert.equal(retry.outcome, "INVOICE_SETTLED");
    assert.equal(w.invoicePayments.length, 1);
    assert.equal(w.invoices.get("inv-dep")!.status, "PAID");
    assert.deepEqual(w.emitted, ["invoice.paid:inv-dep"]);
    assert.equal(w.quoteStatus(), "DEPOSIT_PAID");
    assert.ok(w.payments[0].applied_at);
  });

  test("an under-payment leaves the invoice part-paid and the quote SIGNED", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_part", amount: 20_000, token: DEPOSIT_TOKEN }) });
    assert.equal(result.outcome, "INVOICE_SETTLED");
    assert.equal(w.invoices.get("inv-dep")!.status, "PARTIALLY_PAID");
    assert.equal(w.quoteStatus(), "SIGNED");
    assert.deepEqual(w.emitted, []);
  });

  test("an over-payment records the amount due, pays the invoice off and flags the rest", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_over", amount: 60_000, token: DEPOSIT_TOKEN }) });
    assert.equal(result.outcome, "INVOICE_SETTLED");
    assert.equal(w.invoicePayments[0].amountMinor, 50_000);
    assert.equal(w.invoices.get("inv-dep")!.status, "PAID");
    assert.equal(w.payments[0].review_reason, "OVERPAID");
    assert.deepEqual(w.notices, [`OVERPAID:${result.paymentId}`]);
  });

  test("a currency mismatch is review: nothing recorded, the owner told once", async () => {
    const w = world();
    const fact = sessionFact({ id: "evt_1", session: "cs_eur", amount: 50_000, token: DEPOSIT_TOKEN, currency: "EUR" });
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact });
    assert.equal(result.outcome, "REVIEW");
    assert.equal(w.invoicePayments.length, 0);
    assert.equal(w.invoices.get("inv-dep")!.status, "OPEN");
    assert.equal(w.payments[0].status, "REVIEW");
    assert.equal(w.payments[0].review_reason, "CURRENCY_MISMATCH");
    assert.equal(w.payments[0].applied_at, null);
    await confirmPayment(w.deps, { businessId: BIZ, fact: { ...fact, eventId: "evt_1b" } });
    assert.deepEqual(w.notices, [`CURRENCY_MISMATCH:${result.paymentId}`]);
  });

  test("a second payment on an already-paid invoice is review, not an overpayment of a paid invoice", async () => {
    const w = world();
    await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_a", amount: 50_000, token: DEPOSIT_TOKEN }) });
    const second = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_2", session: "cs_b", amount: 50_000, token: DEPOSIT_TOKEN }) });
    assert.equal(second.outcome, "REVIEW");
    assert.equal(w.payments[1].review_reason, "INVOICE_ALREADY_PAID");
    assert.equal(w.invoicePayments.length, 1);
  });

  test("no token: an email-only match is REVIEW and never settles an invoice", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_none", amount: 50_000, token: null }) });
    assert.equal(result.outcome, "REVIEW");
    assert.equal(w.payments[0].match_kind, "EMAIL");
    assert.equal(w.invoicePayments.length, 0);
    assert.equal(w.invoices.get("inv-dep")!.status, "OPEN");
    assert.deepEqual(w.emitted, []);
  });

  test("a token that names no invoice falls through to the checkout-attempt path (UNMATCHED here)", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_x", amount: 50_000, token: "UnknownTokenCCCCCCCCCCCC", email: "someone@else.test" }) });
    assert.equal(result.outcome, "UNMATCHED");
    assert.equal(w.invoicePayments.length, 0);
  });

  test("another workspace's delivery cannot settle this workspace's invoice", async () => {
    const w = world();
    const result = await confirmPayment(w.deps, { businessId: OTHER, fact: sessionFact({ id: "evt_1", session: "cs_y", amount: 50_000, token: DEPOSIT_TOKEN, email: "nobody@x.test" }) });
    assert.notEqual(result.outcome, "INVOICE_SETTLED");
    assert.equal(w.invoicePayments.length, 0);
  });
});

describe("refunds and disputes are flagged, never reversed", () => {
  test("a refund on a settled invoice payment flags it and leaves the invoice PAID", async () => {
    const w = world();
    const paid = await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_dep", amount: 50_000, token: DEPOSIT_TOKEN, intent: "pi_123" }) });
    const reversal = stripeReversalFact({ id: "evt_r", type: "charge.refunded", data: { object: { payment_intent: "pi_123", amount_refunded: 50_000, currency: "gbp" } } });
    assert.ok(reversal);
    const flagged = await flagReversal(w.deps, { businessId: BIZ, reversal: reversal! });
    assert.equal(flagged.outcome, "FLAGGED");
    assert.equal(w.payments[0].review_reason, "REFUNDED");
    assert.equal(w.invoices.get("inv-dep")!.status, "PAID");
    assert.equal(w.invoices.get("inv-dep")!.paidMinor, 50_000);
    assert.equal(w.invoicePayments.length, 1);
    assert.ok(w.notices.includes(`REFUNDED:${paid.paymentId}`));
    await flagReversal(w.deps, { businessId: BIZ, reversal: reversal! });
    assert.equal(w.notices.filter((n) => n.startsWith("REFUNDED")).length, 1);
  });

  test("a dispute is parsed and flagged; an unknown payment intent is left alone", async () => {
    const w = world();
    await confirmPayment(w.deps, { businessId: BIZ, fact: sessionFact({ id: "evt_1", session: "cs_dep", amount: 50_000, token: DEPOSIT_TOKEN, intent: "pi_9" }) });
    const dispute = stripeReversalFact({ id: "evt_d", type: "charge.dispute.created", data: { object: { payment_intent: "pi_9", amount: 50_000, currency: "gbp" } } });
    assert.equal(dispute?.eventType, "charge.dispute.created");
    assert.equal((await flagReversal(w.deps, { businessId: BIZ, reversal: dispute! })).outcome, "FLAGGED");
    assert.equal(w.payments[0].review_reason, "DISPUTED");
    const unknown = stripeReversalFact({ id: "evt_u", type: "charge.refunded", data: { object: { payment_intent: "pi_nope", amount_refunded: 1, currency: "gbp" } } });
    assert.equal((await flagReversal(w.deps, { businessId: BIZ, reversal: unknown! })).outcome, "UNKNOWN_PAYMENT");
    assert.equal(stripeReversalFact({ id: "evt_z", type: "invoice.paid", data: { object: {} } }), null);
  });
});
