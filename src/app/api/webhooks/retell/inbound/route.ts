import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { verifyRetellSignature } from "@/lib/voice/providers/retell-protocol";
import { answerRetellInbound } from "@/lib/voice/inbound-core";
import { inboundLookups, serverVoiceDeps } from "@/lib/voice/server-deps";

export const dynamic = "force-dynamic";

/**
 * Retell's inbound-call webhook (§25, return calls). Retell asks which agent
 * answers an inbound call to the workspace's number and with what context.
 * Verified with `X-Retell-Signature` (the secret key). The answer is data only:
 * the agent, the locked inbound greeting and the lead's context for a known
 * lead on an entitled workspace, or NO agent for anyone else. The INBOUND call
 * row and its minute hold are written first; no provider I/O on the request.
 *
 * UNVERIFIED: the payload (`{ event: "call_inbound", call_inbound: { from_number,
 * to_number, agent_id } }`) and the response shape follow Retell's inbound
 * webhook docs; confirm them, and that an empty answer leaves the call
 * unanswered, before the number is imported into Retell.
 */

const payloadSchema = z.object({
  event: z.literal("call_inbound"),
  call_inbound: z.object({
    from_number: z.string().min(3).max(32).nullable().optional(),
    to_number: z.string().min(3).max(32),
  }),
});

export async function POST(request: Request) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const apiKey = serverEnv.retell.apiKey;
  if (!apiKey) return new Response(null, { status: 503 });

  const rawBody = await request.text();
  const verified = verifyRetellSignature({
    rawBody,
    headers: { "x-retell-signature": request.headers.get("x-retell-signature") ?? undefined },
    now: new Date(),
    apiKey,
  });
  if (!verified) return new Response(null, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  try {
    const answer = await answerRetellInbound(serverVoiceDeps(), inboundLookups, {
      to: parsed.data.call_inbound.to_number,
      from: parsed.data.call_inbound.from_number ?? null,
    });
    return Response.json(answer.response);
  } catch (error) {
    console.error("[voice] retell inbound failed", { message: error instanceof Error ? error.message : String(error) });
    // No agent: the AI never answers on an error.
    return Response.json({ call_inbound: {} });
  }
}
