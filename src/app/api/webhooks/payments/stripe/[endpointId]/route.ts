import { z } from "zod";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { openSecret } from "@/lib/security/secret-box";
import { verifyStripeSignature } from "@/lib/payments/signatures";
import { stripePaymentFact } from "@/lib/payments/facts";
import { endpointForDelivery, noteEndpointDelivery } from "@/lib/payments/store";
import { acceptPaymentDelivery } from "@/lib/payments/inbound";

export const dynamic = "force-dynamic";

/**
 * Payment confirmation from the CUSTOMER'S OWN Stripe account (the
 * direct-sale loop). No Stripe Connect: the customer adds this URL as a
 * webhook endpoint in their Stripe dashboard (events
 * `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
 * `invoice.paid`) and pastes its signing secret into Settings -> Connections.
 *
 * Verify the signature with that workspace's secret -> write `webhook_events`
 * -> queue `payment.confirm` -> acknowledge. This route never calls Stripe
 * and never touches a lead. It is separate from /api/webhooks/stripe, which
 * is ClientTurn's own billing account and keeps its own secrets.
 */

const MAX_BODY_BYTES = 262_144;

export async function POST(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const { endpointId } = await params;
  if (!z.uuid().safeParse(endpointId).success) return Response.json({ error: "unknown endpoint" }, { status: 404 });

  const endpoint = await endpointForDelivery(endpointId, "STRIPE");
  if (!endpoint) return Response.json({ error: "unknown endpoint" }, { status: 404 });

  const secret = openSecret(endpoint.secret_ciphertext);
  if (!secret) {
    // Nothing safe to verify against: refused, never trusted unauthenticated.
    await noteEndpointDelivery(endpoint.id, "No signing secret saved");
    return Response.json({ error: "not configured" }, { status: 400 });
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return Response.json({ error: "payload too large" }, { status: 413 });

  const verdict = verifyStripeSignature({ rawBody, header: request.headers.get("stripe-signature"), secret });
  if (!verdict.ok) {
    await noteEndpointDelivery(endpoint.id, `Signature ${verdict.reason}`);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const envelope = event as { id?: unknown; type?: unknown };
  if (typeof envelope.id !== "string" || typeof envelope.type !== "string") {
    return Response.json({ error: "not a stripe event" }, { status: 400 });
  }

  const normalised = stripePaymentFact(event);
  return acceptPaymentDelivery({
    endpointId: endpoint.id,
    businessId: endpoint.business_id,
    provider: "stripe_payments",
    eventId: envelope.id,
    eventType: envelope.type,
    fact: normalised.kind === "fact" ? normalised.fact : null,
    ignoredReason: normalised.kind === "ignore" ? normalised.reason : undefined,
  });
}
