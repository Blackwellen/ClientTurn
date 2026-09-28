import { rateLimitResponse } from "@/lib/security/rate-limit";
import { formToRecord } from "@/lib/twilio/signature";
import { parseTwilioWebhook } from "@/lib/voice/providers/twilio-protocol";
import { storeVoiceEvents, verifyTwilioVoiceRequest } from "@/lib/voice/webhook-inbox";

export const dynamic = "force-dynamic";

/**
 * Twilio regulatory bundle status callback (voice P2 number provisioning):
 * POST with AccountSid, BundleSid, Status, FailureReason. Verified with
 * `X-Twilio-Signature` (verifyTwilioSignature), stored keyed
 * `BundleSid:Status`, and `voice.webhook_ingest` applies it to the number's
 * provisioning record and queues the next `voice.number_provision` step.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const rawBody = await request.text();
  const params = formToRecord(rawBody);
  if (!(await verifyTwilioVoiceRequest({ request, params }))) return new Response(null, { status: 403 });

  const events = parseTwilioWebhook(rawBody).filter((e) => e.type === "BUNDLE_STATUS_CHANGED");
  if (events.length === 0) return new Response(null, { status: 400 });
  const result = await storeVoiceEvents("twilio_voice", events);
  if (result.failed > 0) return new Response(null, { status: 500 });
  return new Response(null, { status: 204 });
}
