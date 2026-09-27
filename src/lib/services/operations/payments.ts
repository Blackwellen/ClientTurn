import "server-only";
import { z } from "zod";
import { enqueue } from "@/lib/jobs/queue";
import { db, PAYMENT_FIELDS } from "@/lib/payments/store";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Payment operations (the direct-sale loop, 0143).
 *
 * `payment.link_to_lead`: a person says who paid. The payment is recorded
 * against the lead (LINKED, MANUAL) and the same `payment.confirm` apply a
 * token match gets is queued -- WON with the amount, follow-up stopped, the
 * thank-you on the normal send path. Queued rather than done inline so the
 * one retry-safe path does the work, whoever asked for it.
 */

defineOperation("payment.link_to_lead", {
  schema: z.object({ paymentId: z.uuid(), leadId: z.uuid() }),
  async run({ args, context }: HandlerInput<{ paymentId: string; leadId: string }>) {
    const { data: payment, error } = await db()
      .from("checkout_payments")
      .select(PAYMENT_FIELDS)
      .eq("id", args.paymentId)
      .eq("business_id", context.businessId)
      .maybeSingle();
    if (error) throw new ServiceError("UNAVAILABLE", "Payments could not be read.");
    if (!payment) throw new ServiceError("NOT_FOUND", "That payment could not be found.");
    const before = payment as { status: string; lead_id: string | null; applied_at: string | null };
    if (before.applied_at || (before.status !== "REVIEW" && before.status !== "UNMATCHED")) {
      throw new ServiceError("CONFLICT", "That payment is already linked to a lead.");
    }

    const { data: lead } = await db()
      .from("leads")
      .select("id, archived_at, anonymised_at")
      .eq("id", args.leadId)
      .eq("business_id", context.businessId)
      .maybeSingle();
    const leadRow = lead as { id: string; archived_at: string | null; anonymised_at: string | null } | null;
    if (!leadRow || leadRow.anonymised_at) throw new ServiceError("NOT_FOUND", "That lead could not be found.");

    const { data: updated, error: updateError } = await db()
      .from("checkout_payments")
      .update({ status: "LINKED", match_kind: "MANUAL", lead_id: leadRow.id, linked_by: context.userId })
      .eq("id", args.paymentId)
      .eq("business_id", context.businessId)
      .in("status", ["REVIEW", "UNMATCHED"])
      .is("applied_at", null)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new ServiceError("CONFLICT", "That payment changed while you were linking it. Refresh and try again.");

    await enqueue(
      "payment.confirm",
      { mode: "linked", businessId: context.businessId, paymentId: args.paymentId },
      { businessId: context.businessId, priority: 40, idempotencyKey: `payment.confirm:linked:${args.paymentId}` },
    );

    return {
      data: { paymentId: args.paymentId, leadId: leadRow.id, status: "LINKED" },
      entityId: args.paymentId,
      before: { status: before.status, lead_id: before.lead_id },
      after: { status: "LINKED", lead_id: leadRow.id },
      warnings: leadRow.archived_at
        ? [{ code: "lead_archived", message: "That lead is archived. The payment is still recorded against it and the deal marked won." }]
        : [],
    };
  },
});
