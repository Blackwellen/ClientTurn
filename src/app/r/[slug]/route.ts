import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import {
  clampCookieDays,
  looksAutomated,
  REFERRAL_PARAM,
  signReferralCookie,
  visitorHash,
} from "@/lib/affiliates/attribution";
import { isAllowedDestination } from "@/lib/affiliates/types";
import { hashesFor } from "@/lib/affiliates/fraud";
import { isPrefetch, proxySuspected } from "@/lib/affiliates/fraud-rules";
import { isSchemaMissing } from "@/lib/billing/stripe-events";

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
 * - **Never stores a raw IP.** The visitor is a salted hash, the network a
 *   keyed HMAC, and both are purged after 120 days (migration 0166).
 *
 * Attribution is **last click**: every counted click carries a fresh signed
 * referral, so the most recent affiliate link before signup earns the credit,
 * inside the crediting partner's own plan window (clamped to 90 days). This is
 * the rule the public terms, the FAQ and `describeAttribution` state.
 *
 * **No cookie is set here** (owner decision 2026-09-28). The `ct_ref` cookie
 * is an affiliate-tracking cookie and needs consent, which only the site's
 * banner can give. The signed referral travels in the landing URL as
 * `?ct_ref=`; `ReferralCapture` turns it into the cookie once the visitor
 * accepts, and otherwise carries it in the URL to signup in the same visit.
 *
 * Not counted (and not cookied): automation, link-preview fetches and browser
 * prefetches, and anything over 20 clicks per network per 10 minutes. The
 * visitor still reaches the page either way.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const origin = request.nextUrl.origin;
  const home = NextResponse.redirect(new URL("/", origin), 302);

  const db = createAdminClient();

  const { data: link } = await db
    .from("affiliate_links")
    .select(
      `id, affiliate_id, campaign_id, destination_path, archived,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       affiliates ( id, status, code, commission_plan_id )`,
    )
    .eq("slug", slug)
    .maybeSingle();

  const affiliate = link?.affiliates as unknown as {
    id: string;
    status: string;
    code: string;
    commission_plan_id: string | null;
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

  // Returned when the click is not counted (rate limit, automation): the
  // visitor still lands, with no referral attached.
  const response = NextResponse.redirect(destination, 302);

  const ip = clientIdentifier(request.headers);
  const userAgent = request.headers.get("user-agent") ?? "";
  const hashes = ip !== "unknown" ? hashesFor(ip, userAgent) : null;

  // Keyed by the network hash, so the limiter's own table holds no address.
  const limit = await checkRateLimit("affiliate:click", hashes?.ipHash ?? "unknown");
  // Over the limit: still send the visitor where they were going, just do not
  // record the click or set the cookie. A rate limit is our problem, not theirs.
  if (!limit.allowed) return response;

  const prefetch = isPrefetch(request.headers);
  const isBot = looksAutomated(userAgent) || prefetch;
  const suspect: string[] = [];
  if (proxySuspected(request.headers)) suspect.push("PROXY");
  if (prefetch) suspect.push("PREFETCH");

  // The crediting partner's own plan decides the window, not the default.
  const planQuery = db.from("affiliate_commission_plans").select("cookie_window_days");
  const { data: plan } = affiliate.commission_plan_id
    ? await planQuery.eq("id", affiliate.commission_plan_id).maybeSingle()
    : await planQuery.eq("is_default", true).eq("active", true).maybeSingle();

  const windowDays = clampCookieDays(plan?.cookie_window_days ?? 60);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  // Recorded even when it looks automated, flagged rather than dropped: an
  // affiliate's click count and our attribution record are allowed to disagree,
  // but only visibly.
  const click = {
    affiliate_id: affiliate.id,
    link_id: link.id,
    campaign_id: link.campaign_id,
    visitor_hash: visitorHash(ip, userAgent),
    landing_path: destinationPath,
    referrer_host: hostOf(request.headers.get("referer")),
    country: request.headers.get("x-vercel-ip-country"),
    device_type: /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop",
    is_bot: isBot,
  };
  const withHashes = await (db as unknown as import("@supabase/supabase-js").SupabaseClient)
    .from("affiliate_clicks")
    .insert({ ...click, ip_hash: hashes?.ipHash ?? null, suspect_reasons: suspect });
  // Before migration 0166 the two new columns do not exist: record the click without them.
  if (withHashes.error && isSchemaMissing(withHashes.error)) {
    await db.from("affiliate_clicks").insert(click);
  }

  if (!isBot) {
    await db.rpc("increment_affiliate_link_click", { p_link_id: link.id });

    // The signed referral rides in the URL; nothing is stored on the device.
    const referred = new URL(destination);
    referred.searchParams.set(
      REFERRAL_PARAM,
      signReferralCookie({
        affiliateId: affiliate.id,
        linkId: link.id,
        clickedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
    );
    return NextResponse.redirect(referred, 302);
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
