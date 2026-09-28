import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { applyAffiliateBillingEvent } from "@/lib/affiliates/billing-events";
import { parsePayload } from "./parse";

const id = z.string().min(1).max(200);

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("refund"),
    eventId: id,
    chargeId: id,
    paymentIntentId: id.nullable(),
    invoiceId: id.nullable(),
    amountRefundedMinor: z.number().int().min(0),
    chargeAmountMinor: z.number().int().min(0).nullable(),
  }),
  z.object({
    kind: z.enum(["dispute_opened", "dispute_closed"]),
    eventId: id,
    disputeId: id,
    chargeId: id.nullable(),
    paymentIntentId: id.nullable(),
    invoiceId: id.nullable(),
    disputedMinor: z.number().int().min(0),
    status: z.string().max(60).nullable(),
  }),
]);

/**
 * `affiliate.billing_event`: queued by the Stripe webhook for `charge.refunded`
 * and `charge.dispute.created` / `.closed` (affiliate audit 17 §2).
 *
 * Reverses commission on a refund or dispute and re-accrues it when a dispute
 * is won. Resolving the invoice may call Stripe, which is why this runs as a
 * job and not inside the webhook. Every ledger write is keyed, so a retry or a
 * replayed event moves no money twice.
 */
export async function handleAffiliateBillingEvent(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(payloadSchema, job.payload);
  const outcome = await applyAffiliateBillingEvent(payload);
  console.info(`[affiliate.billing_event] kind=${payload.kind} event=${payload.eventId} outcome=${outcome.status}`);
}
