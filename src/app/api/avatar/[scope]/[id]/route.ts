import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { resolveAvatar } from "@/lib/prospects/avatar";

export const dynamic = "force-dynamic";

/**
 * Serves a person's profile picture through our own origin.
 *
 * `lib/prospects/avatar.ts` decides *whether* an image may be shown. This route
 * is how it is shown, and it exists because rendering the platform's URL
 * directly would be wrong in three ways:
 *
 *   1. **Disclosure.** An `<img src="https://scontent.xx.fbcdn.net/…">` makes
 *      the customer's browser call Meta on every render, with a referer naming
 *      this application. Meta then knows which of its users this business is
 *      looking at, and when. Nobody agreed to that. Proxying moves the request
 *      to the server, so the platform sees a deployment rather than a customer.
 *   2. **Authorisation.** The URL is addressed by record id and read through
 *      the caller's own session, so RLS decides. An avatar is personal data
 *      about a third party and must not be readable by anyone who guesses a URL.
 *   3. **Expiry.** Platform CDN URLs are signed and short-lived. A lapsed one
 *      returns an error page, and an `<img>` pointed at it renders a broken
 *      icon. Here it becomes a clean 404, which is what makes the client fall
 *      back to initials.
 *
 * The bytes are never written to disk. This is a pass-through: streamed to the
 * caller and forgotten, because a cache is a copy and a copy of a photograph of
 * an identifiable person is exactly what an erasure request is about.
 */

const paramsSchema = z.object({
  scope: z.enum(["conversation", "prospect"]),
  id: z.uuid(),
});

/** Only real images. A platform returning HTML is an expired or errored URL. */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Generous for a profile picture, and a hard stop on a hostile response. */
const MAX_BYTES = 2_000_000;

/**
 * The CDNs a stored avatar URL may point at.
 *
 * Without this the column is an SSRF primitive: anything that could write a
 * conversation or prospect row could make the server fetch an arbitrary
 * internal address and return the response. The allowlist is on the *host*
 * rather than the URL, because a signed CDN URL's path is unpredictable by
 * design.
 */
function isAllowedHost(host: string): boolean {
  return (
    host.endsWith(".fbcdn.net") ||
    host.endsWith(".cdninstagram.com") ||
    host.endsWith(".tiktokcdn.com") ||
    host === "www.gravatar.com" ||
    host === "gravatar.com"
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ scope: string; id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return new Response(null, { status: 404 });

  // Workspace-scoped, through the caller's own session. The service-role client
  // is deliberately not used: this route must never read a record the signed-in
  // user could not read for themselves.
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  let source: string | null = null;

  if (parsed.data.scope === "prospect") {
    const { data } = await supabase
      .from("prospects")
      .select("avatar_url, avatar_source, avatar_expires_at")
      .eq("business_id", workspace.businessId)
      .eq("id", parsed.data.id)
      .maybeSingle();

    // The same policy the list applies, re-applied here rather than trusted
    // from the caller. A URL whose source is not displayable, or whose signed
    // lifetime has lapsed, must not be fetchable just because somebody kept an
    // old link.
    source = resolveAvatar(data).url;
  } else {
    const { data } = await supabase
      .from("conversations")
      .select("counterparty_avatar_url")
      .eq("business_id", workspace.businessId)
      .eq("id", parsed.data.id)
      .maybeSingle();

    source = data?.counterparty_avatar_url ?? null;
  }

  if (!source) return new Response(null, { status: 404 });

  let host: string;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") return new Response(null, { status: 404 });
    host = url.hostname.toLowerCase();
  } catch {
    return new Response(null, { status: 404 });
  }

  if (!isAllowedHost(host)) return new Response(null, { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(source, {
      // No credentials, no cookies, and explicitly no referer — the point of
      // the proxy is that the platform learns nothing about who is looking.
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return new Response(null, { status: 404 });
  }

  if (!upstream.ok) return new Response(null, { status: 404 });

  const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim();
  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    return new Response(null, { status: 404 });
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return new Response(null, { status: 404 });

  const bytes = await upstream.arrayBuffer();
  // Checked again after reading: `content-length` is the server's claim, not a
  // guarantee, and a chunked response carries none at all.
  if (bytes.byteLength > MAX_BYTES) return new Response(null, { status: 404 });

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      // Private, because the image is personal data about a third party and
      // must not sit in a shared cache. Short, because the upstream URL expires
      // and a long cache would outlive it.
      "cache-control": "private, max-age=900",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
