import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { ensureInvoicePayToken, liveInvoiceDeps } from "@/lib/invoicing/store";
import { setInvoicePayLinkSchema } from "@/lib/invoicing/pay-link";
import { loadQuoteSettings } from "@/lib/quotes/store";
import { INVOICE_STATUSES } from "@/lib/invoicing/types";
import {
  createInvoicesFromQuote,
  InvoiceServiceError,
  issueCreditNote,
  issueInvoice,
  listInvoices,
  recordPayment,
  voidInvoice,
  type InvoiceActor,
} from "@/lib/invoicing/service-core";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import type { ServiceContext } from "../types";

/**
 * Customer invoicing operations (P2). Thin wrappers over
 * lib/invoicing/service-core.ts; the plan gate (`invoicing_enabled`) is in
 * the core, the role gate in each declaration.
 */

function actorFor(context: ServiceContext): InvoiceActor {
  const kind = context.caller === "AGENT" ? "AI" : context.caller === "UI" || context.caller === "COPILOT" ? "HUMAN" : context.caller === "SYSTEM" ? "SYSTEM" : "API";
  return { kind, userId: context.userId };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvoiceServiceError) throw new ServiceError(error.code, error.message);
    throw error;
  }
}

const fromQuoteSchema = z.object({ quoteId: z.string().uuid(), autoIssue: z.boolean().default(true) });

defineOperation("invoice.create_from_quote", {
  schema: fromQuoteSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof fromQuoteSchema>>) {
    const result = await guarded(() => createInvoicesFromQuote(liveInvoiceDeps(context.businessId), context.businessId, actorFor(context), args));
    return {
      data: result,
      entityId: args.quoteId,
      after: { invoices: result.invoices.length },
      warnings: result.duplicate ? [{ code: "already_invoiced", message: "This quote's invoices already exist; nothing new was created." }] : [],
    };
  },
});

const issueSchema = z.object({ invoiceId: z.string().uuid(), send: z.boolean().default(true) });

defineOperation("invoice.issue", {
  schema: issueSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof issueSchema>>) {
    const result = await guarded(() => issueInvoice(liveInvoiceDeps(context.businessId), context.businessId, actorFor(context), args));
    return {
      data: result,
      entityId: args.invoiceId,
      before: { status: "DRAFT" },
      after: { status: result.invoice.status, number: result.invoice.number, dueDate: result.invoice.dueDate },
    };
  },
});

const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  receivedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => `${d}T12:00:00.000Z`)),
  /** The bank reference or receipt id: a repeat with the same reference is recorded once. */
  reference: z.string().trim().min(1).max(200),
  provider: z.enum(["manual", "bank_transfer", "other"]).default("bank_transfer"),
});

defineOperation("invoice.record_payment", {
  schema: paymentSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof paymentSchema>>) {
    const result = await guarded(() => recordPayment(liveInvoiceDeps(context.businessId), context.businessId, actorFor(context), args));
    return {
      data: result,
      entityId: args.invoiceId,
      after: { status: result.invoice.status, paidMinor: result.invoice.paidMinor },
      warnings: result.duplicate ? [{ code: "already_recorded", message: "A payment with that reference was already recorded." }] : [],
    };
  },
});

const voidSchema = z.object({ invoiceId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

defineOperation("invoice.void", {
  schema: voidSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof voidSchema>>) {
    const result = await guarded(() => voidInvoice(liveInvoiceDeps(context.businessId), context.businessId, actorFor(context), args));
    return { data: result, entityId: args.invoiceId, after: { status: "VOID" } };
  },
});

const creditSchema = z.object({
  invoiceId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  reason: z.string().trim().min(3).max(2000),
  requestId: z.string().trim().min(1).max(200).optional(),
});

defineOperation("invoice.credit_note", {
  schema: creditSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof creditSchema>>) {
    const requestId = args.requestId ?? context.idempotencyKey ?? context.correlationId;
    const result = await guarded(() =>
      issueCreditNote(liveInvoiceDeps(context.businessId), context.businessId, actorFor(context), { ...args, requestId }),
    );
    return { data: result, entityId: args.invoiceId, after: { credited: args.amountMinor } };
  },
});

const listSchema = z.object({
  quoteId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

defineOperation("invoice.list", {
  schema: listSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof listSchema>>) {
    const result = await guarded(() => listInvoices(liveInvoiceDeps(context.businessId), context.businessId, { ...args, limit: args.limit ?? 50 }));
    return { data: result, entityId: null };
  },
});

/**
 * 0173: the Stripe Payment Link for ONE invoice (Settings -> Quotes &
 * invoices, "A link pasted on each invoice"). The link is the workspace's
 * own, made in its own Stripe account; ClientTurn only adds the invoice's
 * opaque token when it sends it. Null removes it (the invoice then shows no
 * pay button). A paid, void or written-off invoice keeps what it had.
 */
defineOperation("invoice.set_pay_link", {
  schema: setInvoicePayLinkSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof setInvoicePayLinkSchema>>) {
    const client = createAdminClient() as unknown as SupabaseClient;
    const { data, error } = await client
      .from("invoices")
      .select("id, status, pay_link_url")
      .eq("business_id", context.businessId)
      .eq("id", args.invoiceId)
      .maybeSingle();
    if (error) {
      if (isSchemaLag(error)) throw new ServiceError("CONFLICT", "Invoice payment links need database update 0173.");
      throw new ServiceError("UNAVAILABLE", "Invoices could not be read.");
    }
    if (!data) throw new ServiceError("NOT_FOUND", "That invoice could not be found.");
    const before = data as { id: string; status: string; pay_link_url: string | null };
    if (!["DRAFT", "OPEN", "PARTIALLY_PAID"].includes(before.status)) {
      throw new ServiceError("CONFLICT", `A ${before.status.toLowerCase().replace("_", " ")} invoice cannot take a new payment link.`);
    }
    const { data: updated, error: updateError } = await client
      .from("invoices")
      .update({ pay_link_url: args.url })
      .eq("business_id", context.businessId)
      .eq("id", args.invoiceId)
      .in("status", ["DRAFT", "OPEN", "PARTIALLY_PAID"])
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new ServiceError("CONFLICT", "That invoice changed while you were editing it. Refresh and try again.");
    // An issued invoice needs its token for the link to be tracked.
    if (args.url && before.status !== "DRAFT") await ensureInvoicePayToken(context.businessId, args.invoiceId);
    const settings = await loadQuoteSettings(context.businessId);
    return {
      data: { invoiceId: args.invoiceId, hasPayLink: Boolean(args.url) },
      entityId: args.invoiceId,
      before: { pay_link: Boolean(before.pay_link_url) },
      after: { pay_link: Boolean(args.url) },
      warnings:
        settings.invoicePayMode === "PER_INVOICE"
          ? []
          : [{ code: "mode_not_per_invoice", message: "Saved. It is used only while Settings > Quotes & invoices is set to a link pasted on each invoice." }],
    };
  },
});
