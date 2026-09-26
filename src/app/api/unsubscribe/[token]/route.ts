import { performUnsubscribe } from "@/lib/email/unsubscribe";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe.
 *
 * The `List-Unsubscribe` header on marketing mail points here, and Gmail /
 * Yahoo's unsubscribe button POSTs `List-Unsubscribe=One-Click` to it with no
 * cookies and no user interaction. It must answer 200 and must be idempotent:
 * a second POST for the same token succeeds and changes nothing.
 *
 * The body is not required to contain `List-Unsubscribe=One-Click` — the token
 * alone authorises the action, and refusing a client that omits the body would
 * only leave someone subscribed who asked not to be.
 *
 * GET is deliberately not handled: scanners prefetch GETs. The visible page at
 * `/unsubscribe/[token]` is where a person clicking the footer link lands.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const { token } = await params;
  const result = await performUnsubscribe(token);

  if (result.ok) {
    return Response.json({ ok: true }, { status: 200 });
  }
  if (result.reason === "invalid") {
    return Response.json({ ok: false, error: "unknown_token" }, { status: 404 });
  }
  // A transient failure is a 5xx so the client may retry.
  return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
}
