import { rateLimitResponse } from "@/lib/security/rate-limit";
import { TOKEN_PATTERN, TOKEN_UNAVAILABLE_MESSAGE } from "@/lib/quotes/tokens";
import { publicPdfUrl, resolvePublicQuote } from "@/lib/quotes/public-server";

export const dynamic = "force-dynamic";

/**
 * GET /q/[token]/pdf: the quote's PDF. The token is verified exactly as for
 * the page (resolvePublicQuote: hash lookup, constant-time compare, not
 * revoked, not expired, current revision), then the browser is sent to a
 * 5-minute signed R2 URL. The bucket is never public and the object key is
 * never shown. Every failure is the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimitResponse("quote:public", request.headers);
  if (limited) return limited;
  const { token } = await params;
  const notAvailable = () => new Response(TOKEN_UNAVAILABLE_MESSAGE, { status: 404, headers: { "cache-control": "no-store" } });
  if (!TOKEN_PATTERN.test(token)) return notAvailable();
  const context = await resolvePublicQuote(token);
  if (!context) return notAvailable();
  const url = await publicPdfUrl(context);
  if (!url) {
    return new Response("The PDF is still being prepared. Please try again in a minute.", {
      status: 503,
      headers: { "retry-after": "60", "cache-control": "no-store" },
    });
  }
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
