import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { reverseRefundedCreditPurchase } from "@/lib/billing/message-credits";
import { reverseRefundedTokenPurchase } from "@/lib/billing/token-service";
import { parsePayload } from "./parse";

const payloadSchema = z.object({
  kind: z.enum(["message_credits", "ai_tokens"]),
  purchaseId: z.string().uuid(),
  amountRefundedMinor: z.number().int().min(0),
});

/**
 * `billing.refund_reverse`: queued by the Stripe `charge.refunded` webhook for
 * a top-up purchase the owner refunded in Stripe.
 *
 * Owner policy 2026-09-27: top-up credit is non-refundable once any of it is
 * used, so a refund reverses ONLY the purchase's credit that is still unused
 * (FIFO attribution, src/lib/billing/refundability.ts), never taking a balance
 * below zero.
 *
 * Retry-safe: each reversal re-reads the purchase (only a REFUNDED one is
 * touched) and runs in one RPC under the balance row lock, keyed on
 * `refund:<purchase>:<cumulative amount refunded>` in the ledger, so a retried
 * job or a replayed webhook never reverses twice. No provider I/O.
 */
export async function handleBillingRefundReverse(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(payloadSchema, job.payload);
  const reversed =
    payload.kind === "message_credits"
      ? await reverseRefundedCreditPurchase(payload)
      : await reverseRefundedTokenPurchase(payload);
  console.info(
    `[billing.refund_reverse] kind=${payload.kind} purchase=${payload.purchaseId} ` +
      `refunded_minor=${payload.amountRefundedMinor} reversed=${reversed}`,
  );
}
