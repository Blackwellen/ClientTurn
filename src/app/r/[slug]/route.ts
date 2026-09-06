import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import {
  clampCookieDays,
  looksAutomated,
  REFERRAL_COOKIE_NAME,
  signReferralCookie,
  visitorHash,
} from "@/lib/affiliates/attribution";
import { isAllowedDestination } from "@/lib/affiliates/types";

/**
 * Referral link entry point (V4 §31).
 *
 * A stranger's first contact with the product, so it does the least possible
 * work: resolve the slug, record the click, set a signed cookie, redirect.
 *
 * Three things it deliberately never does:
 *
 * - **Never 404s to a dead end.** An archived, unknown or suspended link sends
 *   the visitor to the home page rather than an error. They did nothing wrong,
 *   and a broken link is the affiliate's problem to see in their dashboard, not
 *   the visitor's problem to read about.
 * - **Never redirects anywhere the affiliate chose freely.** The destination is
 *   re-checked against the allow-list here as well as at creation, so a row
 *   edited by any other path still cannot produce an open redirect.
 * - **Never stores a raw IP.** The visitor is a salted hash.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const origin = request.nextUrl.origin;
  const home = NextResponse.redirect(new URL("/", origin), 302);

  const limit = await checkRateLimit(
    "affiliate:click",
    clientIdentifier(request.headers),
  );
  // Over the limit: still send the visitor where they were going, just do not
  // record the click. A rate limit is our problem, not theirs.
  if (!limit.allowed) return home;

  const db = createAdminClient();

  const { data: link } = await db
    .from("affiliate_links")
    .select(
      `id, affiliate_id, campaign_id, destination_path, archived,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       affiliates ( id, status, code )`,
    )
    .eq("slug", slug)
    .maybeSingle();

  const affiliate = link?.affiliates as unknown as {
    id: string;
    status: string;
    code: string;
  } | null;

  if (!link || link.archived || !affiliate || affiliate.status !== "ACTIVE") {
    return home;
  }

  const destinationPath = isAllowedDestination(link.destination_path)
    ? link.destination_path
    : "/";

  const destination = new URL(destinationPath, origin);
  for (const [key, value] of [
    ["utm_source", link.utm_source ?? "affiliate"],
    ["utm_medium", link.utm_medium ?? "referral"],
    ["utm_campaign", link.utm_campaign],
    ["utm_content", link.utm_content],
    ["utm_term", link.utm_term],
  ] as const) {
    if (value) destination.searchParams.set(key, value);
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const isBot = looksAutomated(userAgent);

  const { data: plan } = await db
    .from("affiliate_commission_plans")
    .select("cookie_window_days")
    .eq("is_default", true)
    .eq("active", true)
    .maybeSingle();

  const windowDays = clampCookieDays(plan?.cookie_window_days ?? 60);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  // Recorded even when it looks automated, flagged rather than dropped: an
  // affiliate's click count and our attribution record are allowed to disagree,
  // but only visibly.
  await db.from("affiliate_clicks").insert({
    affiliate_id: affiliate.id,
    link_id: link.id,
    campaign_id: link.campaign_id,
    visitor_hash: visitorHash(clientIdentifier(request.headers), userAgent),
    landing_path: destinationPath,
    referrer_host: hostOf(request.headers.get("referer")),
    country: request.headers.get("x-vercel-ip-country"),
    device_type: /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop",
    is_bot: isBot,
  });

  const response = NextResponse.redirect(destination, 302);

  if (!isBot) {
    await db.rpc("increment_affiliate_link_click", { p_link_id: link.id });

    response.cookies.set(
      REFERRAL_COOKIE_NAME,
      signReferralCookie({
        affiliateId: affiliate.id,
        linkId: link.id,
        clickedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: windowDays * 24 * 60 * 60,
      },
    );
  }

  return response;
}

/** The referring host only — never the full URL, which can carry a query. */
function hostOf(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host;
  } catch {
    return null;
  }
}
