import { rateLimitResponse } from "@/lib/security/rate-limit";
import { serverEnv } from "@/lib/env";
import { formToRecord } from "@/lib/twilio/signature";
import { parseTwilioWebhook } from "@/lib/voice/providers/twilio-protocol";
import { storeVoiceEvents, verifyTwilioVoiceRequest } from "@/lib/voice/webhook-inbox";
import { answerTwilioInbound } from "@/lib/voice/inbound-core";
import { NOT_IN_SERVICE } from "@/lib/voice/inbound";
import { inboundLookups, serverVoiceDeps } from "@/lib/voice/server-deps";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
const twiml = (status: number) => xml(EMPTY_TWIML, status);

/**
 * Twilio voice callbacks for a workspace's dedicated number (voice P2).
 *
 * Status, answering-machine detection and recording callbacks are verified
 * with `X-Twilio-Signature` (verifyTwilioVoiceRequest -> verifyTwilioSignature,
 * the account auth token, gap map F7), stored as `webhook_events` rows keyed
 * `CallSid:CallStatus`, and applied by `voice.webhook_ingest`.
 *
 * An INBOUND call to the number (§25, return calls) must be answered with
 * TwiML now, so it is decided from the database only (inbound-core.ts): a
 * known lead on an entitled workspace is handed to the AI over SIP; anyone
 * else hears a short message and gets a text back (queued as a job), or is
 * put through to a person when the transfer setting allows. No provider I/O
 * happens on this request.
 */
export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const rawBody = await request.text();
  const params = formToRecord(rawBody);
  if (!(await verifyTwilioVoiceRequest({ request, params }))) return twiml(403);

  const events = parseTwilioWebhook(rawBody);
  const result = await storeVoiceEvents("twilio_voice", events);

  const inbound = (params.Direction ?? "").toLowerCase() === "inbound" && ["ringing", "in-progress", ""].includes((params.CallStatus ?? "").toLowerCase());
  if (inbound && params.CallSid && params.To) {
    try {
      const answer = await answerTwilioInbound(serverVoiceDeps(), inboundLookups, {
        to: params.To,
        from: params.From ?? null,
        callSid: params.CallSid,
        retellSipDomain: serverEnv.voice.retellSipDomain ?? null,
      });
      return xml(answer.twiml);
    } catch (error) {
      console.error("[voice] inbound answer failed", { message: error instanceof Error ? error.message : String(error) });
      return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-GB">${NOT_IN_SERVICE}</Say><Hangup/></Response>`);
    }
  }

  if (result.failed > 0) return twiml(500);
  return twiml(200);
}
