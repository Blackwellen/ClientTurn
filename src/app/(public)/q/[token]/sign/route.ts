import { handleQuoteSignRequest } from "@/lib/quotes/public-sign";
import { livePublicDeps } from "@/lib/quotes/public-server";

export const dynamic = "force-dynamic";

/**
 * POST /q/[token]/sign: the customer accepts (and signs) a quote.
 *
 * Every guard is in `handleQuoteSignRequest` (lib/quotes/public-sign.ts,
 * tested in tests/quote-public-sign.test.ts): rate limit per address,
 * same-origin + custom header + a form nonce bound to this link (CSRF),
 * the token verified by hash in constant time (one generic 404 for every
 * failure), then accept + seal + record through the row-locked 0153 RPCs
 * with per-revision action keys (a replay records nothing new).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleQuoteSignRequest(livePublicDeps(), token, request.headers, body);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
