import { z } from "zod";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { openSecret } from "@/lib/security/secret-box";
import { verifyOrderPaidSignature } from "@/lib/payments/signatures";
import { orderPaidFact, orderPaidSchema } from "@/lib/payments/facts";
import { endpointForDelivery, noteEndpointDelivery } from "@/lib/payments/store";
import { acceptPaymentDelivery } from "@/lib/payments/inbound";

export const dynamic = "force-dynamic";

/**
 * The generic signed "order paid" webhook (the direct-sale loop), for
 * Shopify, WooCommerce, GoCardless, Paddle, Zapier or anything that can sign a
 * request. Contract: docs/DEVELOPER_PLATFORM.md, "Order paid".
 *
 *   POST /api/webhooks/payments/order-paid/<endpoint id>
 *   Content-Type: application/json
 *   X-ClientTurn-Timestamp: <unix seconds>
 *   X-ClientTurn-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
 *   { order_id, amount, currency, reference?, email?, recurring?, interval?,
 *     subscription_id?, event_id?, source?, paid_at? }
 *
 * The same signing scheme as the inbound contact endpoint. Verify -> write
 * `webhook_events` (unique per endpoint + event_id, or order_id) -> queue
 * `payment.confirm` -> 202. Idempotent twice over: the event id here, and
 * (workspace, order id) in `checkout_payments`.
 */

const MAX_BODY_BYTES = 16_384;

export async function POST(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const { endpointId } = await params;
  if (!z.uuid().safeParse(endpointId).success) return Response.json({ error: "Unknown endpoint" }, { status: 404 });

  const endpoint = await endpointForDelivery(endpointId, "ORDER_PAID");
  if (!endpoint) return Response.json({ error: "Unknown endpoint" }, { status: 404 });

  const secret = openSecret(endpoint.secret_ciphertext);
  if (!secret) return Response.json({ error: "Endpoint unavailable" }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });

  const verdict = verifyOrderPaidSignature({
    rawBody,
    timestamp: request.headers.get("x-clientturn-timestamp"),
    signature: request.headers.get("x-clientturn-signature"),
    secret,
  });
  if (!verdict.ok) {
    await noteEndpointDelivery(endpoint.id, `Signature ${verdict.reason}`);
    return Response.json({ error: verdict.reason === "stale" ? "Expired timestamp" : "Invalid signature" }, { status: 401 });
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = orderPaidSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    await noteEndpointDelivery(endpoint.id, "Invalid order body");
    return Response.json(
      { error: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  const fact = orderPaidFact(parsed.data);
  const response = await acceptPaymentDelivery({
    endpointId: endpoint.id,
    businessId: endpoint.business_id,
    provider: "order_paid",
    eventId: fact.eventId,
    eventType: "order.paid",
    fact,
  });
  if (response.status !== 200) return response;
  const body = (await response.json()) as { duplicate?: boolean };
  return Response.json(
    { accepted: true, order_id: fact.orderId, status: body.duplicate ? "duplicate" : "queued" },
    { status: 202 },
  );
}
