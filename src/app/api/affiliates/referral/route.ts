import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clampCookieDays,
  parseReferralToken,
  REFERRAL_COOKIE_NAME,
} from "@/lib/affiliates/attribution";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { serverEnv } from "@/lib/env";

/**
 * POST /api/affiliates/referral: stores the referral cookie, AFTER consent.
 *
 * `ct_ref` is an affiliate-tracking cookie. The ICO treats those as not
 * strictly necessary, so it is set only once the visitor has accepted
 * non-essential cookies in the site banner (owner decision 2026-09-28). The
 * banner's choice lives in the browser, so the page's `ReferralCapture`
 * calls this only when that choice is "accepted"; nothing server-side sets
 * the cookie on any other path.
 *
 * The body is the signed referral `/r` put in the landing URL. It is verified
 * here (signature and expiry) and the cookie's lifetime is the referral's own
 * remaining window, so consenting later never extends it.
 */

export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().min(10).max(400) });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers, [new URL(request.url).origin, serverEnv.siteUrl])) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const referral = parseReferralToken(parsed.data.token);
  if (!referral) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const remainingSeconds = Math.floor((new Date(referral.expiresAt).getTime() - Date.now()) / 1000);
  const maxAge = Math.min(remainingSeconds, clampCookieDays(90) * 24 * 60 * 60);
  if (maxAge <= 0) return NextResponse.json({ error: "expired" }, { status: 400 });

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(REFERRAL_COOKIE_NAME, parsed.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}

/**
 * DELETE: withdrawal. Called when the visitor rejects or resets their cookie
 * choice, so withdrawing consent removes the referral cookie as well (it is
 * httpOnly, so the page cannot delete it itself).
 */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request.headers, [new URL(request.url).origin, serverEnv.siteUrl])) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(REFERRAL_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
