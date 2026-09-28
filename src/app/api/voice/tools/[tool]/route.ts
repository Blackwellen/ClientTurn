import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { verifyRetellSignature } from "@/lib/voice/providers/retell-protocol";
import { handleVoiceToolRequest } from "@/lib/voice/tools/server";
import { isVoiceToolName } from "@/lib/voice/tools/definitions";

export const dynamic = "force-dynamic";

/**
 * Retell custom functions (voice phase P3, docs/VOICE.md §16). The voice
 * agent's tools: one POST per invocation, `{ name, call, args }`, signed with
 * `X-Retell-Signature` (verified exactly as the call webhook, keyed by
 * RETELL_SECRET_KEY; no key = 503, never waved through).
 *
 * Not a webhook: Retell waits for the answer, which the model then speaks.
 * Every action goes through the service registry as caller AGENT
 * (`voice_agent.*`), is idempotent per (call, tool call id), and is gated by
 * the workspace's own permissions. Messages it sends (a checkout link, a
 * quote) are queued through the ordinary send path, never sent inline.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const { tool } = await params;
  if (!isVoiceToolName(tool)) return NextResponse.json({ ok: false, error: "Unknown tool." }, { status: 404 });

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

  const result = await handleVoiceToolRequest(tool, rawBody);
  return NextResponse.json(result.body, { status: result.status });
}
