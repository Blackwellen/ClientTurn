import "server-only";
import { enqueue } from "@/lib/jobs/queue";
import { db, noteEndpointDelivery } from "./store";
import type { PaymentFact, PaymentReversal } from "./facts";

/**
 * The shared tail of both payment webhooks, after the signature is verified:
 * write the `webhook_events` row (unique on provider + external event id),
 * queue `payment.confirm`, acknowledge. No provider I/O and no business logic
 * in the request (CLAUDE.md webhook rule).
 *
 * The external event id is scoped to the endpoint: two workspaces pointing
 * at one Stripe account both receive `evt_123`, and each must record it.
 */
export async function acceptPaymentDelivery(input: {
  endpointId: string;
  businessId: string;
  provider: "stripe_payments" | "order_paid";
  eventId: string;
  eventType: string;
  /** Null when the event is verified but not a payment we act on. */
  fact: PaymentFact | null;
  /** 0173: a refund or dispute to flag (Stripe only). Queued like a fact. */
  reversal?: PaymentReversal | null;
  ignoredReason?: string;
}): Promise<Response> {
  const reversal = input.fact ? null : (input.reversal ?? null);
  const actionable = Boolean(input.fact || reversal);
  const externalEventId = `${input.endpointId}:${input.eventId}`.slice(0, 400);

  const { error: inboxError } = await db()
    .from("webhook_events")
    .insert({
      provider: input.provider,
      external_event_id: externalEventId,
      business_id: input.businessId,
      event_type: input.eventType.slice(0, 80),
      status: actionable ? "received" : "ignored",
      // The normalised fact only, never the provider's raw body: the raw
      // event carries billing details this product has no use for.
      payload: (input.fact ?? reversal ?? { ignored: input.ignoredReason ?? "not a payment" }) as never,
    });

  if (inboxError?.code === "23505") {
    return Response.json({ received: true, duplicate: true });
  }
  if (inboxError) {
    // No inbox row means no idempotency guard: refuse and let the sender retry.
    console.error("[payments webhook] inbox insert failed", { code: inboxError.code, message: inboxError.message });
    return Response.json({ error: "inbox unavailable" }, { status: 500 });
  }

  await noteEndpointDelivery(input.endpointId, null);

  if (!actionable) return Response.json({ received: true, ignored: input.ignoredReason ?? true });

  try {
    await enqueue(
      "payment.confirm",
      input.fact
        ? { mode: "delivery", businessId: input.businessId, fact: input.fact }
        : { mode: "reversal", businessId: input.businessId, reversal },
      {
        businessId: input.businessId,
        priority: 40,
        idempotencyKey: `payment.confirm:${input.provider}:${externalEventId}`,
      },
    );
  } catch (error) {
    // The inbox row exists, so a retry would be acknowledged as a duplicate
    // and the payment lost. Remove it, then refuse, so the retry is real.
    await db()
      .from("webhook_events")
      .delete()
      .eq("provider", input.provider)
      .eq("external_event_id", externalEventId)
      .then(
        () => undefined,
        () => undefined,
      );
    console.error("[payments webhook] enqueue failed", { error });
    return Response.json({ error: "queue unavailable" }, { status: 500 });
  }

  return Response.json({ received: true, queued: true });
}
