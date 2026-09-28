import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { reverseRefundedCreditPurchase } from "@/lib/billing/message-credits";
import { reverseRefundedTokenPurchase } from "@/lib/billing/token-service";
import { parsePayload } from "./parse";

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message_credits"),
    purchaseId: z.string().uuid(),
    amountRefundedMinor: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("ai_tokens"),
    purchaseId: z.string().uuid(),
    amountRefundedMinor: z.number().int().min(0),
  }),
  // A voice minute pack (voice P2): no purchases table; the ledger row is keyed by its PaymentIntent.
  z.object({
    kind: z.literal("voice_pack"),
    businessId: z.string().uuid(),
    paymentIntentId: z.string().min(1).max(200),
    amountMinor: z.number().int().min(0),
    amountRefundedMinor: z.number().int().min(0),
  }),
  // A chargeback (billing/disputes.ts): claw back the disputed purchase's
  // unused units when it opens, give them back if it is won.
  z.object({
    kind: z.literal("dispute"),
    disputeId: z.string().min(1).max(200),
    action: z.enum(["reverse", "restore"]),
  }),
]);

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
  if (payload.kind === "dispute") {
    const { runDisputeJob } = await import("@/lib/billing/disputes");
    const units = await runDisputeJob({ disputeId: payload.disputeId, action: payload.action });
    console.info(`[billing.refund_reverse] kind=dispute dispute=${payload.disputeId} action=${payload.action} units=${units}`);
    return;
  }
  if (payload.kind === "voice_pack") {
    const { reverseVoicePackRefund } = await import("@/lib/voice/minutes");
    const seconds = await reverseVoicePackRefund(payload);
    console.info(`[billing.refund_reverse] kind=voice_pack pi=${payload.paymentIntentId} refunded_minor=${payload.amountRefundedMinor} reversed_sec=${seconds}`);
    return;
  }
  const reversed =
    payload.kind === "message_credits"
      ? await reverseRefundedCreditPurchase(payload)
      : await reverseRefundedTokenPurchase(payload);
  console.info(
    `[billing.refund_reverse] kind=${payload.kind} purchase=${payload.purchaseId} ` +
      `refunded_minor=${payload.amountRefundedMinor} reversed=${reversed}`,
  );
}
