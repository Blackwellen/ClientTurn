import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_LOGIN_COOKIE,
  affiliateDestination,
  consumeGoogleLoginState,
  customerDestination,
  exchangeGoogleCode,
  fetchVerifiedGoogleProfile,
  mintGoogleSession,
} from "@/lib/auth/google-login";
import { activatePendingInvites } from "@/lib/auth/invites";
import { ensureProfile, hasAnyMembership, provisionCustomerWorkspace } from "@/lib/auth/provision";
import { UNNAMED_WORKSPACE } from "@/lib/auth/workspace-name";
import { attributeSignup } from "@/lib/affiliates/attribution";

/**
 * Step 2 of native Google sign-in. Google redirects back here with `code` +
 * `state` -- the browser has still never touched `supabase.co`. From here:
 *
 * 1. verify `state` against the signed cookie from `/connect` (CSRF)
 * 2. exchange `code` for an access token directly with Google
 * 3. ask Google's own userinfo endpoint for a verified email
 * 4. mint a session for that email (server-to-server, via `mintGoogleSession`);
 *    a new email becomes a new account, as a completed signup form would
 * 5. a new customer with no workspace (and no invitation) gets one, built by
 *    the same `provisionCustomerWorkspace` the signup form uses, and goes to
 *    card-first trial checkout; everyone else goes where they were going.
 */

function doorFor(audience: "customer" | "affiliate"): string {
  return audience === "affiliate" ? "/affiliates/login" : "/login";
}

function fail(origin: string, audience: "customer" | "affiliate", code: string) {
  const response = NextResponse.redirect(
    `${origin}${doorFor(audience)}?error=${encodeURIComponent(code)}`,
  );
  response.cookies.delete({ name: GOOGLE_LOGIN_COOKIE, path: "/api/auth/google" });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const cookieValue = request.cookies.get(GOOGLE_LOGIN_COOKIE)?.value;

  // The audience is only known once the cookie is verified, so a failure
  // before that point (no cookie, forged state) has nowhere trustworthy to
  // report an error against and falls back to the customer door.
  const state = consumeGoogleLoginState(cookieValue, stateParam);
  if (!state) return fail(origin, "customer", "link_invalid");

  const { audience, next } = state;

  if (oauthError || !code) return fail(origin, audience, "link_invalid");

  let accessToken: string;
  try {
    accessToken = (await exchangeGoogleCode(code, state.redirectUri)).accessToken;
  } catch {
    return fail(origin, audience, "link_invalid");
  }

  const profile = await fetchVerifiedGoogleProfile(accessToken);
  if (!profile) return fail(origin, audience, "link_invalid");
  const { email } = profile;

  const userId = await mintGoogleSession(email);
  if (!userId) return fail(origin, audience, "link_invalid");

  if (audience === "customer") {
    // The Google userinfo endpoint already required `email_verified: true`
    // (see `fetchVerifiedGoogleProfile`), so this address is confirmed the same
    // way an emailed confirmation link would confirm it.
    await activatePendingInvites(userId, email, true);

    // Someone who was invited now has that workspace; anyone else with no
    // workspace is registering, so they get their own.
    if (!(await hasAnyMembership(userId))) {
      let businessId: string;
      try {
        ({ businessId } = await provisionCustomerWorkspace({
          userId,
          email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          // Named by the owner in onboarding's first step (8.29).
          businessName: UNNAMED_WORKSPACE,
        }));
      } catch {
        return fail(origin, audience, "signup_failed");
      }
      // Referral credit must never block account creation.
      await attributeSignup({ userId, businessId }).catch(() => undefined);

      // Card and terms first (8.10); onboarding follows once Stripe confirms.
      const response = NextResponse.redirect(`${origin}/start-trial`);
      response.cookies.delete({ name: GOOGLE_LOGIN_COOKIE, path: "/api/auth/google" });
      return response;
    }

    const destination = await customerDestination(userId, next);
    const response = NextResponse.redirect(`${origin}${destination}`);
    response.cookies.delete({ name: GOOGLE_LOGIN_COOKIE, path: "/api/auth/google" });
    return response;
  }

  try {
    await ensureProfile({ userId, email, firstName: profile.firstName, lastName: profile.lastName });
  } catch {
    return fail(origin, audience, "signup_failed");
  }

  const destination = affiliateDestination(next);
  const response = NextResponse.redirect(`${origin}${destination}`);
  response.cookies.delete({ name: GOOGLE_LOGIN_COOKIE, path: "/api/auth/google" });
  return response;
}
