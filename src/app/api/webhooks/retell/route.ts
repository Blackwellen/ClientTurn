import { serverEnv } from "@/lib/env";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { parseRetellWebhook, verifyRetellSignature } from "@/lib/voice/providers/retell-protocol";
import { storeVoiceEvents } from "@/lib/voice/webhook-inbox";

export const dynamic = "force-dynamic";

/**
 * Retell call events (voice P2). Verify the `X-Retell-Signature` HMAC over the
 * raw body with the API key (5-minute timestamp tolerance), write one
 * `webhook_events` row per event (unique on provider + `call_id:event`), queue
 * `voice.webhook_ingest`, acknowledge. No provider I/O on the request path.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const apiKey = serverEnv.retell.apiKey;
  // No key: verification is impossible, so the request is refused, never waved through.
  if (!apiKey) return new Response(null, { status: 503 });

  const rawBody = await request.text();
  const verified = verifyRetellSignature({
    rawBody,
    headers: { "x-retell-signature": request.headers.get("x-retell-signature") ?? undefined },
    now: new Date(),
    apiKey,
  });
  if (!verified) return new Response(null, { status: 401 });

  const events = parseRetellWebhook(rawBody);
  if (events.length === 0) return new Response(null, { status: 400 });

  const result = await storeVoiceEvents("retell", events);
  // A failed insert gets a 5xx so Retell retries it; a duplicate is acknowledged.
  if (result.failed > 0) return new Response(null, { status: 500 });
  return new Response(null, { status: 204 });
}
