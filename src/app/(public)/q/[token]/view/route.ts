import { handleQuoteViewRequest } from "@/lib/quotes/public-sign";
import { livePublicDeps } from "@/lib/quotes/public-server";

export const dynamic = "force-dynamic";

/**
 * POST /q/[token]/view: "the customer opened the quote", sent once per
 * browser session by the page's script. Same guards as signing (rate limit,
 * same-origin, form nonce, verified token); the server records only the
 * first view (SENT -> VIEWED through quote_transition), so repeats change
 * nothing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleQuoteViewRequest(livePublicDeps(), token, request.headers, body);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
