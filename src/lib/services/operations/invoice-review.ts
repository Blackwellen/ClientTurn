import "server-only";
import { z } from "zod";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { liveInvoiceDeps } from "@/lib/invoicing/store";
import { InvoiceServiceError, recordPayment } from "@/lib/invoicing/service-core";
import { invoicePaymentExternalId, invoicePaymentProvider } from "@/lib/invoicing/settlement";
import {
  applyPatch,
  canDismiss,
  decideApply,
  DISMISS_RESOLUTIONS,
  isOpenReview,
  reviewKind,
  type DismissResolution,
} from "@/lib/invoicing/payment-review";
import { loadReviewPayment, reviewDb } from "@/lib/invoicing/payment-review-store";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * The invoice-payment review queue (Settings -> Quotes & invoices; rules in
 * lib/invoicing/payment-review.ts). A person resolves a payment the
 * settlement flagged (0173 review_reason) or that matched nothing.
 *
 *   invoice.review_apply_payment    record it on an open invoice, by the
 *                                   automatic settlement's own rules;
 *   invoice.review_dismiss_payment  record what was done outside ClientTurn.
 *
 * Both re-read the payment at the moment of acting and write conditionally,
 * so a double click or two people at once resolve it once. Neither moves
 * money: the workspace's own Stripe is the merchant of record. Audited by the
 * runtime like every operation (before / after on the audit row).
 */

const NOT_INSTALLED = "The payment review queue needs database update 0175.";

const applySchema = z.object({ paymentId: z.string().uuid(), invoiceId: z.string().uuid() });

defineOperation("invoice.review_apply_payment", {
  schema: applySchema,
  async run({ args, context }: HandlerInput<z.infer<typeof applySchema>>) {
    const businessId = context.businessId;
    let payment;
    try {
      payment = await loadReviewPayment(businessId, args.paymentId);
    } catch (error) {
      if (isSchemaLag(error as { code?: string })) throw new ServiceError("CONFLICT", NOT_INSTALLED);
      throw new ServiceError("UNAVAILABLE", "Payments could not be read.");
    }
    if (!payment) throw new ServiceError("NOT_FOUND", "That payment could not be found.");

    const deps = liveInvoiceDeps(businessId);
    const invoice = await deps.store.loadInvoice(businessId, args.invoiceId);
    if (!invoice) throw new ServiceError("NOT_FOUND", "That invoice could not be found.");

    const provider = invoicePaymentProvider(payment.provider);
    const externalId = invoicePaymentExternalId(payment);
    // Re-read at the moment of acting: is this provider payment already on an invoice?
    const { data: existing, error: existingError } = await reviewDb()
      .from("invoice_payments")
      .select("amount_minor, invoice_id")
      .eq("business_id", businessId)
      .eq("provider", provider)
      .eq("external_payment_id", externalId)
      .maybeSingle();
    if (existingError) throw new ServiceError("UNAVAILABLE", "Invoice payments could not be read.");
    const recorded = existing as { amount_minor: number; invoice_id: string } | null;

    const decision = decideApply({
      businessId,
      row: payment,
      invoice: {
        business_id: businessId,
        status: invoice.status,
        currency: invoice.currency,
        total_minor: invoice.totalMinor,
        paid_minor: invoice.paidMinor,
      },
      alreadyRecordedMinor: recorded ? Number(recorded.amount_minor) : null,
    });
    if (decision.kind === "REFUSE") throw new ServiceError("CONFLICT", decision.message);

    const invoiceId = recorded?.invoice_id ?? invoice.id;
    if (decision.kind === "RECORD") {
      try {
        await recordPayment(deps, businessId, { kind: "HUMAN", userId: context.userId }, {
          invoiceId,
          amountMinor: decision.amountMinor,
          receivedAt: payment.paid_at,
          reference: externalId,
          provider,
          checkoutPaymentId: payment.id,
        });
      } catch (error) {
        if (error instanceof InvoiceServiceError) throw new ServiceError(error.code, error.message);
        throw error;
      }
    }

    const { data: opp } = await reviewDb()
      .from("opportunities")
      .select("lead_id")
      .eq("business_id", businessId)
      .eq("id", invoice.opportunityId)
      .maybeSingle();
    const leadId = (opp as { lead_id: string | null } | null)?.lead_id ?? payment.lead_id;

    const { data: updated, error: updateError } = await reviewDb()
      .from("checkout_payments")
      .update(applyPatch({ invoiceId, leadId, excessMinor: decision.excessMinor, userId: context.userId, now: new Date().toISOString() }))
      .eq("business_id", businessId)
      .eq("id", payment.id)
      .is("applied_at", null)
      .is("review_resolved_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) throw new ServiceError("UNAVAILABLE", "The payment could not be updated.");

    const warnings = [];
    if (!updated) warnings.push({ code: "already_resolved", message: "This payment had already been resolved. Nothing was recorded twice." });
    if (decision.excessMinor > 0) {
      warnings.push({ code: "overpaid", message: "The amount due was recorded. The rest stays in the queue: refund it or keep it as credit." });
    }
    return {
      data: { paymentId: payment.id, invoiceId, recordedMinor: decision.amountMinor, excessMinor: decision.excessMinor },
      entityId: payment.id,
      before: { status: payment.status, review_reason: payment.review_reason, invoice_id: payment.invoice_id },
      after: { status: "MATCHED", invoice_id: invoiceId, recorded_minor: decision.amountMinor, excess_minor: decision.excessMinor },
      warnings,
    };
  },
});

const dismissSchema = z.object({
  paymentId: z.string().uuid(),
  resolution: z.enum(DISMISS_RESOLUTIONS as [DismissResolution, ...DismissResolution[]]),
  note: z.string().trim().max(500).optional(),
});

defineOperation("invoice.review_dismiss_payment", {
  schema: dismissSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof dismissSchema>>) {
    const businessId = context.businessId;
    let payment;
    try {
      payment = await loadReviewPayment(businessId, args.paymentId);
    } catch (error) {
      if (isSchemaLag(error as { code?: string })) throw new ServiceError("CONFLICT", NOT_INSTALLED);
      throw new ServiceError("UNAVAILABLE", "Payments could not be read.");
    }
    if (!payment) throw new ServiceError("NOT_FOUND", "That payment could not be found.");
    if (!isOpenReview(payment)) {
      return {
        data: { paymentId: payment.id, resolution: args.resolution },
        entityId: payment.id,
        warnings: [{ code: "already_resolved", message: "This payment had already been resolved." }],
      };
    }
    if (!canDismiss(payment, args.resolution)) {
      throw new ServiceError("INVALID_INPUT", "That outcome does not fit this payment. Choose one of the options shown.");
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await reviewDb()
      .from("checkout_payments")
      .update({
        review_resolved_at: now,
        review_resolved_by: context.userId,
        review_resolution: args.resolution,
        review_note: args.note ? args.note : null,
      })
      .eq("business_id", businessId)
      .eq("id", payment.id)
      .is("review_resolved_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isSchemaLag(error)) throw new ServiceError("CONFLICT", NOT_INSTALLED);
      throw new ServiceError("UNAVAILABLE", "The payment could not be updated.");
    }
    return {
      data: { paymentId: payment.id, resolution: args.resolution },
      entityId: payment.id,
      before: { kind: reviewKind(payment), resolved: false },
      after: { resolution: args.resolution, resolved: true },
      warnings: updated ? [] : [{ code: "already_resolved", message: "This payment had already been resolved." }],
    };
  },
});
