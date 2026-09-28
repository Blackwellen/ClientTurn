/**
 * Customer invoicing operations over an injected store (the workspace's
 * invoices to ITS customers; ClientTurn's own billing is lib/billing).
 * Pure: relative imports only, so the service operations, the jobs and
 * tests/invoice-service.test.ts run the same code.
 *
 * Amounts are never recomputed here: an invoice is a schedule row of the
 * signed quote's calculation (from-quote.ts); issuing fixes its number and
 * dates (0154 makes the row immutable after); payments and credit notes are
 * append-only and bounded by database triggers as well as by the pure rules.
 */

import type { Capability } from "../billing/capability-rules.ts";
import { quoteActionKey, creditNoteKey } from "../quotes/idempotency.ts";
import type { DueRule, QuoteCalculation, VatBucket } from "../quotes/types.ts";
import type { QuoteSettings } from "../quotes/settings.ts";
import { createCreditNote } from "./credit-notes.ts";
import { invoicesFromQuote } from "./from-quote.ts";
import { addDays, computeReminderSchedule, invoiceDueDate } from "./reminders.ts";
import type { CreditNote, InvoiceDraft, InvoiceKind, InvoiceStatus } from "./types.ts";

export type InvoiceErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "PLAN_LIMIT" | "CONFLICT" | "POLICY_BLOCKED";

export class InvoiceServiceError extends Error {
  readonly code: InvoiceErrorCode;
  constructor(code: InvoiceErrorCode, message: string) {
    super(message);
    this.name = "InvoiceServiceError";
    this.code = code;
  }
}

export type PartySnapshot = { name: string; address: string[]; email?: string | null; vatNumber?: string | null; companyNumber?: string | null };

export type QuoteForInvoicing = {
  id: string;
  number: string;
  status: string;
  opportunityId: string;
  leadId: string | null;
  revisionId: string;
  calculation: QuoteCalculation;
  acceptedAt: string | null;
};

export type InvoiceRecord = {
  id: string;
  opportunityId: string;
  quoteId: string | null;
  revisionId: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  vatByRate: VatBucket[];
  issueDate: string | null;
  dueDate: string | null;
  scheduleSeq: number | null;
  dueRule: DueRule | null;
  buyer: PartySnapshot;
  createdAt: string;
};

/** "stripe" is written only by automatic settlement (payments/confirm.ts, 0173), never typed by a person. */
export type PaymentProvider = "manual" | "bank_transfer" | "other" | "stripe";

export interface InvoiceStore {
  loadSettings(businessId: string): Promise<QuoteSettings>;
  loadSeller(businessId: string): Promise<PartySnapshot>;
  loadQuoteForInvoicing(businessId: string, quoteId: string): Promise<QuoteForInvoicing | null>;
  loadBuyer(businessId: string, opportunityId: string): Promise<PartySnapshot>;
  /** Insert a DRAFT invoice (+ its lines and schedule row); returns the existing id on an idempotency-key repeat. */
  insertDraft(businessId: string, input: { draft: InvoiceDraft; quote: QuoteForInvoicing; seller: PartySnapshot; buyer: PartySnapshot }): Promise<{ id: string; created: boolean }>;
  loadInvoice(businessId: string, invoiceId: string): Promise<InvoiceRecord | null>;
  listInvoices(businessId: string, filter: { quoteId?: string; opportunityId?: string; status?: InvoiceStatus; limit: number }): Promise<InvoiceRecord[]>;
  allocateNumber(businessId: string, kind: "INVOICE" | "CREDIT_NOTE"): Promise<string>;
  /** DRAFT -> OPEN with number and dates; false when it was no longer a draft. */
  issue(businessId: string, invoiceId: string, fields: { number: string; issueDate: string; dueDate: string; supplyDate: string }): Promise<boolean>;
  /** Append a payment; the 0154 trigger moves paid_minor and the status. */
  insertPayment(businessId: string, input: { invoiceId: string; provider: PaymentProvider; externalId: string; amountMinor: number; receivedAt: string; recordedBy: string | null; checkoutPaymentId?: string | null }): Promise<"RECORDED" | "DUPLICATE" | "REFUSED">;
  voidInvoice(businessId: string, invoiceId: string): Promise<boolean>;
  loadCreditNotes(businessId: string, invoiceId: string): Promise<CreditNote[]>;
  findCreditNoteByKey(businessId: string, idempotencyKey: string): Promise<{ number: string; amountMinor: number; netMinor: number; vatMinor: number } | null>;
  insertCreditNote(businessId: string, note: CreditNote & { idempotencyKey: string; issuedBy: string | null }): Promise<"RECORDED" | "DUPLICATE" | "REFUSED">;
  quoteTransition(businessId: string, quoteId: string, action: "RECORD_DEPOSIT_PAID" | "RECORD_PAID", expectedStatus: string, actionKey: string): Promise<{ ok: boolean; duplicate?: boolean }>;
  loadQuoteStatus(businessId: string, quoteId: string): Promise<string | null>;
}

export interface InvoiceEffects {
  deliverInvoice(input: { businessId: string; invoice: InvoiceRecord; leadId: string | null; sendKey: string; kind: "ISSUED" | "REMINDER" }): Promise<{ queued: boolean; detail: string }>;
  enqueue(type: "invoice.issue" | "invoice.remind", payload: Record<string, unknown>, options: { businessId: string; runAt?: Date; idempotencyKey: string }): Promise<void>;
  emit(businessId: string, type: "invoice.created" | "invoice.issued" |"invoice.paid" | "invoice.voided" | "invoice.credited" | "invoice.overdue", payload: Record<string, unknown>): Promise<void>;
}

export type InvoiceDeps = {
  store: InvoiceStore;
  effects: InvoiceEffects;
  can: (capability: Capability) => Promise<{ allowed: boolean; message: string | null }>;
  now: () => Date;
};

export type InvoiceActor = { kind: "HUMAN" | "AI" | "API" | "SYSTEM"; userId: string | null };

async function requireInvoicing(deps: InvoiceDeps) {
  const decision = await deps.can("invoicing_enabled");
  if (!decision.allowed) throw new InvoiceServiceError("PLAN_LIMIT", decision.message ?? "Invoicing is not on your plan.");
}

export const INVOICEABLE_QUOTE_STATES = ["ACCEPTED", "SIGNED", "DEPOSIT_PAID", "PAID"] as const;

export function presentInvoice(invoice: InvoiceRecord) {
  return {
    id: invoice.id,
    opportunityId: invoice.opportunityId,
    quoteId: invoice.quoteId,
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.number,
    currency: invoice.currency,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    creditedMinor: invoice.creditedMinor,
    dueMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    scheduleSeq: invoice.scheduleSeq,
  };
}

async function loadOrFail(deps: InvoiceDeps, businessId: string, invoiceId: string) {
  const invoice = await deps.store.loadInvoice(businessId, invoiceId);
  if (!invoice) throw new InvoiceServiceError("NOT_FOUND", "That invoice could not be found.");
  return invoice;
}

/* ------------------------------------------------------ create from quote */

export async function createInvoicesFromQuote(deps: InvoiceDeps, businessId: string, actor: InvoiceActor, args: { quoteId: string; autoIssue: boolean }) {
  await requireInvoicing(deps);
  const quote = await deps.store.loadQuoteForInvoicing(businessId, args.quoteId);
  if (!quote) throw new InvoiceServiceError("NOT_FOUND", "That quote could not be found.");
  if (!(INVOICEABLE_QUOTE_STATES as readonly string[]).includes(quote.status)) {
    throw new InvoiceServiceError("CONFLICT", "Only an accepted or signed quote can be invoiced.");
  }
  const drafts = invoicesFromQuote({ businessId, quoteRevisionId: quote.revisionId, quoteNumber: quote.number, calculation: quote.calculation });
  if (drafts.length === 0) throw new InvoiceServiceError("CONFLICT", "This quote has no one-off charges to invoice.");
  const [seller, buyer] = await Promise.all([deps.store.loadSeller(businessId), deps.store.loadBuyer(businessId, quote.opportunityId)]);
  const settings = await deps.store.loadSettings(businessId);
  const acceptedOn = (quote.acceptedAt ?? deps.now().toISOString()).slice(0, 10);

  const created: { id: string; kind: InvoiceKind; created: boolean; issueOn: string | null }[] = [];
  for (const draft of drafts) {
    const result = await deps.store.insertDraft(businessId, { draft, quote, seller, buyer });
    const issueOn = draft.due ? invoiceIssueDate(draft.due, acceptedOn, settings.paymentTermsDays) : acceptedOn;
    created.push({ id: result.id, kind: draft.kind, created: result.created, issueOn });
    // Automation trigger (gap map §45): once per new draft, never on a repeat.
    if (result.created) {
      await deps.effects.emit(businessId, "invoice.created", { invoiceId: result.id, kind: draft.kind, quoteId: args.quoteId, opportunityId: quote.opportunityId, issueOn });
    }
    if (args.autoIssue && result.created && issueOn) {
      const today = deps.now().toISOString().slice(0, 10);
      const runAt = issueOn <= today ? deps.now() : new Date(`${issueOn}T08:00:00.000Z`);
      await deps.effects.enqueue("invoice.issue", { invoiceId: result.id }, { businessId, runAt, idempotencyKey: `invoice.issue:${result.id}` });
    }
  }
  return { invoices: created, duplicate: created.every((row) => !row.created) };
}

/**
 * When an instalment's invoice is issued: the payment-terms days before it
 * falls due, never before acceptance. ON_COMPLETION waits for a person
 * (null: issued by hand when the work is done).
 */
export function invoiceIssueDate(due: DueRule, acceptedOn: string, termsDays: number): string | null {
  if (due.type === "ON_COMPLETION") return null;
  if (due.type === "ON_ACCEPTANCE") return acceptedOn;
  const dueOn = addDays(acceptedOn, due.days);
  const issueOn = addDays(dueOn, -termsDays);
  return issueOn < acceptedOn ? acceptedOn : issueOn;
}

/* ------------------------------------------------------------------ issue */

export async function issueInvoice(deps: InvoiceDeps, businessId: string, actor: InvoiceActor, args: { invoiceId: string; send: boolean }) {
  await requireInvoicing(deps);
  const invoice = await loadOrFail(deps, businessId, args.invoiceId);
  if (invoice.status !== "DRAFT") {
    if (invoice.status === "VOID") throw new InvoiceServiceError("CONFLICT", "A void invoice cannot be issued.");
    return { invoice: presentInvoice(invoice), duplicate: true, delivery: null };
  }
  if (invoice.totalMinor <= 0) throw new InvoiceServiceError("CONFLICT", "An invoice needs an amount to issue.");
  const settings = await deps.store.loadSettings(businessId);
  const today = deps.now().toISOString().slice(0, 10);
  const quote = invoice.quoteId ? await deps.store.loadQuoteForInvoicing(businessId, invoice.quoteId) : null;
  const acceptedOn = (quote?.acceptedAt ?? today).slice(0, 10);
  const computed = invoice.dueRule
    ? invoiceDueDate({ due: invoice.dueRule, acceptedOn, termsDays: settings.paymentTermsDays })
    : null;
  let dueDate = computed ?? addDays(today, settings.paymentTermsDays);
  if (dueDate < today) dueDate = addDays(today, settings.paymentTermsDays);
  if (invoice.dueRule?.type === "ON_ACCEPTANCE") dueDate = addDays(today, settings.paymentTermsDays);

  const number = await deps.store.allocateNumber(businessId, "INVOICE");
  const issued = await deps.store.issue(businessId, invoice.id, { number, issueDate: today, dueDate, supplyDate: today });
  if (!issued) throw new InvoiceServiceError("CONFLICT", "That invoice is no longer a draft.");
  const after = (await deps.store.loadInvoice(businessId, invoice.id)) ?? { ...invoice, status: "OPEN" as const, number, issueDate: today, dueDate };

  for (const step of computeReminderSchedule({ issueDate: today, dueDate, offsetsDays: settings.reminderOffsets })) {
    await deps.effects.enqueue(
      "invoice.remind",
      { invoiceId: invoice.id, step: step.step },
      { businessId, runAt: new Date(`${step.sendOn}T09:00:00.000Z`), idempotencyKey: `invoice.remind:${invoice.id}:${step.step}` },
    );
  }
  let delivery: { queued: boolean; detail: string } | null = null;
  if (args.send) {
    delivery = await deps.effects.deliverInvoice({ businessId, invoice: after, leadId: quote?.leadId ?? null, sendKey: `invoice-issued:${invoice.id}`, kind: "ISSUED" });
  }
  await deps.effects.emit(businessId, "invoice.issued", { invoiceId: invoice.id, number, totalMinor: invoice.totalMinor, currency: invoice.currency, dueDate, quoteId: invoice.quoteId, leadId: quote?.leadId ?? null });
  return { invoice: presentInvoice(after), duplicate: false, delivery };
}

/* --------------------------------------------------------------- payments */

export async function recordPayment(
  deps: InvoiceDeps,
  businessId: string,
  actor: InvoiceActor,
  args: { invoiceId: string; amountMinor: number; receivedAt: string; reference: string; provider: PaymentProvider; checkoutPaymentId?: string | null },
) {
  const invoice = await loadOrFail(deps, businessId, args.invoiceId);
  if (invoice.status !== "OPEN" && invoice.status !== "PARTIALLY_PAID") {
    throw new InvoiceServiceError("CONFLICT", `A ${invoice.status.toLowerCase().replace("_", " ")} invoice cannot take a payment.`);
  }
  if (args.amountMinor > invoice.totalMinor - invoice.paidMinor) {
    throw new InvoiceServiceError("CONFLICT", "That is more than the amount still due. Record the amount due and refund or credit the rest.");
  }
  const outcome = await deps.store.insertPayment(businessId, {
    invoiceId: invoice.id,
    provider: args.provider,
    externalId: args.reference,
    amountMinor: args.amountMinor,
    receivedAt: args.receivedAt,
    recordedBy: actor.userId,
    checkoutPaymentId: args.checkoutPaymentId ?? null,
  });
  if (outcome === "REFUSED") throw new InvoiceServiceError("CONFLICT", "That payment could not be applied to this invoice.");
  const after = (await deps.store.loadInvoice(businessId, invoice.id)) ?? invoice;
  // Only the insert that paid the invoice off emits: a duplicate (a replayed
  // webhook, a retried job) never does, so invoice.paid fires once.
  if (outcome === "RECORDED" && after.status === "PAID") {
    const quote = after.quoteId ? await deps.store.loadQuoteForInvoicing(businessId, after.quoteId) : null;
    await deps.effects.emit(businessId, "invoice.paid", { invoiceId: after.id, number: after.number, totalMinor: after.totalMinor, currency: after.currency, quoteId: after.quoteId, leadId: quote?.leadId ?? null });
    await projectOntoQuote(deps, businessId, after);
  }
  return { invoice: presentInvoice(after), duplicate: outcome === "DUPLICATE" };
}

/** A paid deposit moves the quote to DEPOSIT_PAID; every schedule invoice paid moves it to PAID. */
export async function projectOntoQuote(deps: InvoiceDeps, businessId: string, paid: InvoiceRecord): Promise<void> {
  if (!paid.quoteId || !paid.revisionId) return;
  const status = await deps.store.loadQuoteStatus(businessId, paid.quoteId);
  if (!status || !["SIGNED", "DEPOSIT_PAID"].includes(status)) return;
  const siblings = await deps.store.listInvoices(businessId, { quoteId: paid.quoteId, limit: 100 });
  const live = siblings.filter((inv) => inv.revisionId === paid.revisionId && inv.status !== "VOID" && inv.kind !== "RECURRING");
  if (live.length > 0 && live.every((inv) => inv.status === "PAID")) {
    await deps.store.quoteTransition(businessId, paid.quoteId, "RECORD_PAID", status, quoteActionKey({ revisionId: paid.revisionId, action: "RECORD_PAID" }));
    return;
  }
  if (paid.kind === "DEPOSIT" && status === "SIGNED") {
    await deps.store.quoteTransition(businessId, paid.quoteId, "RECORD_DEPOSIT_PAID", "SIGNED", quoteActionKey({ revisionId: paid.revisionId, action: "RECORD_DEPOSIT_PAID" }));
  }
}

/* ------------------------------------------------------------ void/credit */

export async function voidInvoice(deps: InvoiceDeps, businessId: string, actor: InvoiceActor, args: { invoiceId: string; reason: string }) {
  const invoice = await loadOrFail(deps, businessId, args.invoiceId);
  if (invoice.status !== "DRAFT" && invoice.status !== "OPEN") {
    throw new InvoiceServiceError("CONFLICT", `A ${invoice.status.toLowerCase().replace("_", " ")} invoice cannot be voided; issue a credit note.`);
  }
  if (invoice.paidMinor > 0) throw new InvoiceServiceError("CONFLICT", "An invoice with payments is corrected by a credit note.");
  const ok = await deps.store.voidInvoice(businessId, invoice.id);
  if (!ok) throw new InvoiceServiceError("CONFLICT", "That invoice changed while you were working on it.");
  await deps.effects.emit(businessId, "invoice.voided", { invoiceId: invoice.id, number: invoice.number, reason: args.reason });
  return { invoice: presentInvoice({ ...invoice, status: "VOID" }) };
}

export async function issueCreditNote(
  deps: InvoiceDeps,
  businessId: string,
  actor: InvoiceActor,
  args: { invoiceId: string; amountMinor: number; reason: string; requestId: string },
) {
  await requireInvoicing(deps);
  const invoice = await loadOrFail(deps, businessId, args.invoiceId);
  const notes = await deps.store.loadCreditNotes(businessId, invoice.id);
  const idempotencyKey = creditNoteKey({ businessId, invoiceId: invoice.id, requestId: args.requestId });
  const existing = await deps.store.findCreditNoteByKey(businessId, idempotencyKey);
  if (existing) return { creditNote: existing, duplicate: true };
  const state = {
    id: invoice.id,
    status: invoice.status,
    number: invoice.number,
    currency: invoice.currency,
    totalMinor: invoice.totalMinor,
    vatByRate: invoice.vatByRate,
    // The pure rule needs the paid total; one synthetic entry carries it.
    payments: invoice.paidMinor > 0 ? [{ id: "paid", amountMinor: invoice.paidMinor, receivedAt: invoice.issueDate ?? "" }] : [],
    creditNotes: notes,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
  };
  const check = createCreditNote(state, { id: "pending", number: "pending", amountMinor: args.amountMinor, reason: args.reason, issuedAt: deps.now().toISOString() });
  if (!check.ok) throw new InvoiceServiceError("CONFLICT", check.detail);
  const number = await deps.store.allocateNumber(businessId, "CREDIT_NOTE");
  const outcome = await deps.store.insertCreditNote(businessId, { ...check.creditNote, number, idempotencyKey, issuedBy: actor.userId });
  if (outcome === "REFUSED") throw new InvoiceServiceError("CONFLICT", "That credit note could not be issued.");
  if (outcome === "RECORDED") {
    await deps.effects.emit(businessId, "invoice.credited", { invoiceId: invoice.id, number: invoice.number, creditNote: number, amountMinor: args.amountMinor });
  }
  return { creditNote: { number: outcome === "DUPLICATE" ? null : number, amountMinor: args.amountMinor, netMinor: check.creditNote.netMinor, vatMinor: check.creditNote.vatMinor }, duplicate: outcome === "DUPLICATE" };
}

export async function listInvoices(deps: InvoiceDeps, businessId: string, filter: { quoteId?: string; opportunityId?: string; status?: InvoiceStatus; limit: number }) {
  const rows = await deps.store.listInvoices(businessId, filter);
  return { invoices: rows.map(presentInvoice), count: rows.length };
}
