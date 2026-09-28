import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { applyLinked, confirmPayment, flagReversal } from "@/lib/payments/confirm";
import { confirmDeps } from "@/lib/payments/store";
import { BILLING_INTERVALS, STRIPE_REVERSAL_EVENTS } from "@/lib/payments/facts";
import { parsePayload } from "./parse";

/**
 * `payment.confirm` -- a verified payment, off the request path.
 *
 * Queued by the two payment webhooks (api/webhooks/payments/*) after the
 * signature is verified and the `webhook_events` row is written, and by the
 * `payment.link_to_lead` operation when a person links a payment. All the
 * work is in lib/payments/confirm.ts, which re-reads every row it acts on and
 * is idempotent step by step, so a retry at any point repeats nothing.
 */

const factSchema = z.object({
  provider: z.enum(["stripe", "order_paid"]),
  source: z.string().max(40).nullable(),
  eventId: z.string().min(1).max(200),
  eventType: z.string().max(80),
  orderId: z.string().min(1).max(200),
  reference: z.string().max(200).nullable(),
  email: z.string().max(254).nullable(),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  recurring: z.boolean(),
  interval: z.enum(BILLING_INTERVALS).nullable(),
  intervalCount: z.number().int().min(1).max(365),
  subscriptionId: z.string().max(200).nullable(),
  paidAt: z.string().max(40),
  paymentIntentId: z.string().max(200).nullable().optional(),
});

const reversalSchema = z.object({
  provider: z.literal("stripe"),
  eventId: z.string().min(1).max(200),
  eventType: z.enum(STRIPE_REVERSAL_EVENTS),
  paymentIntentId: z.string().min(1).max(200),
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const paymentConfirmPayload = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("delivery"), businessId: z.uuid(), fact: factSchema }),
  z.object({ mode: z.literal("linked"), businessId: z.uuid(), paymentId: z.uuid() }),
  // 0173: a refund or dispute. Flagged for a person, never applied to money.
  z.object({ mode: z.literal("reversal"), businessId: z.uuid(), reversal: reversalSchema }),
]);

export async function handlePaymentConfirm(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(paymentConfirmPayload, job.payload);
  if (job.business_id && job.business_id !== payload.businessId) {
    throw new PermanentJobError("payment.confirm: job business does not match its payload");
  }
  const result =
    payload.mode === "delivery"
      ? await confirmPayment(confirmDeps, { businessId: payload.businessId, fact: payload.fact })
      : payload.mode === "reversal"
        ? await flagReversal(confirmDeps, { businessId: payload.businessId, reversal: payload.reversal })
        : await applyLinked(confirmDeps, payload.businessId, payload.paymentId);
  console.info("[payment.confirm]", { businessId: payload.businessId, ...result });
}
