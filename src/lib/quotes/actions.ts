"use server";

import { revalidatePath } from "next/cache";
import type { QuoteActionResult } from "./action-result";
import { runForUser } from "./run-action";

/**
 * Lead page -> Quotes card actions. Each is one service operation run for
 * the signed-in person; `confirmed` is passed only by the actions the card
 * calls from a confirmation dialog (send, withdraw, invoicing, payments).
 */

function refresh(leadId?: string) {
  if (leadId) revalidatePath(`/app/leads/${leadId}`);
}

export async function calculateQuoteAction(input: unknown): Promise<QuoteActionResult> {
  return runForUser("quote.calculate", input);
}

export async function createQuoteAction(input: Record<string, unknown> & { leadId: string; requestId: string }): Promise<QuoteActionResult> {
  const { leadId, ...args } = input;
  const result = await runForUser("quote.create", args);
  if (result.ok) refresh(leadId);
  return result;
}

export async function updateQuoteDraftAction(input: Record<string, unknown> & { leadId: string }): Promise<QuoteActionResult> {
  const { leadId, ...args } = input;
  const result = await runForUser("quote.update_draft", args);
  if (result.ok) refresh(leadId);
  return result;
}

export async function getQuoteAction(input: { quoteId: string }): Promise<QuoteActionResult> {
  return runForUser("quote.get", input);
}

type Step = "submit_for_approval" | "approve" | "reject" | "revise";

const STEPS: readonly Step[] = ["submit_for_approval", "approve", "reject", "revise"];

export async function quoteStepAction(input: { leadId: string; quoteId: string; step: Step; note?: string }): Promise<QuoteActionResult> {
  // A server action's argument is untrusted: only these four steps are reachable here.
  if (!STEPS.includes(input.step)) return { ok: false, error: "That step is not available.", code: "INVALID_INPUT" };
  const args = input.step === "revise" ? { quoteId: input.quoteId } : { quoteId: input.quoteId, note: input.note ?? null };
  const result = await runForUser(`quote.${input.step}`, args);
  if (result.ok) refresh(input.leadId);
  return result;
}

/** Called from the send confirmation dialog. */
export async function sendQuoteAction(input: { leadId: string; quoteId: string; channel: "email" | "link" }): Promise<QuoteActionResult> {
  const result = await runForUser("quote.send", { quoteId: input.quoteId, channel: input.channel }, { confirmed: true });
  if (result.ok) refresh(input.leadId);
  return result;
}

/** Called from the withdraw confirmation dialog. */
export async function withdrawQuoteAction(input: { leadId: string; quoteId: string; reason: string }): Promise<QuoteActionResult> {
  const result = await runForUser("quote.withdraw", { quoteId: input.quoteId, reason: input.reason }, { confirmed: true });
  if (result.ok) refresh(input.leadId);
  return result;
}

/** Called from the invoicing confirmation dialog. */
export async function invoiceQuoteAction(input: { leadId: string; quoteId: string; autoIssue: boolean }): Promise<QuoteActionResult> {
  const result = await runForUser("invoice.create_from_quote", { quoteId: input.quoteId, autoIssue: input.autoIssue }, { confirmed: true });
  if (result.ok) refresh(input.leadId);
  return result;
}

/** Called from the issue confirmation dialog. */
export async function issueInvoiceAction(input: { leadId: string; invoiceId: string }): Promise<QuoteActionResult> {
  const result = await runForUser("invoice.issue", { invoiceId: input.invoiceId, send: true }, { confirmed: true });
  if (result.ok) refresh(input.leadId);
  return result;
}

/** Called from the record-payment dialog. */
export async function recordPaymentAction(input: { leadId: string; invoiceId: string; amountMinor: number; receivedOn: string; reference: string }): Promise<QuoteActionResult> {
  const result = await runForUser(
    "invoice.record_payment",
    { invoiceId: input.invoiceId, amountMinor: input.amountMinor, receivedAt: input.receivedOn, reference: input.reference, provider: "bank_transfer" },
    { confirmed: true },
  );
  if (result.ok) refresh(input.leadId);
  return result;
}
