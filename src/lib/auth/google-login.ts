import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { destinationForUser, sanitizeRedirectPath } from "@/lib/auth/destination";
import { CALLBACK_PATH, googleCallbackUri } from "@/lib/auth/google-callback-uri";

/**
 * Google sign-in, built as a fully native/redirect flow through this app's own
 * domain -- never through Supabase's `signInWithOAuth`/`signInWithIdToken` and
 * never via a browser-visible `supabase.co` hop. Google only ever talks to
 * `${siteUrl}/api/auth/google/connect` and `.../callback`; Supabase is touched
 * exactly once, server-to-server, to mint a session for the Google-verified
 * email (see `mintGoogleSession` below). A new email becomes a new account there,
 * exactly as a completed signup form would.
 *
 * Docs consulted while building this (fetched live, not from training data):
 * - Authorization endpoint + params: https://developers.google.com/identity/protocols/oauth2/web-server
 *   (`https://accounts.google.com/o/oauth2/v2/auth`, `response_type=code`,
 *   `scope`, `state`) -- the same endpoint `google-calendar.ts` already uses
 *   for the Calendar OAuth adapter in this codebase.
 * - Token endpoint: `POST https://oauth2.googleapis.com/token` with
 *   `grant_type=authorization_code` -- same shape `exchangeCodeForToken` in
 *   `src/lib/integrations/oauth.ts` already implements for every other
 *   workspace-connect provider; this file does not import that helper because
 *   it computes its own fixed `redirect_uri`, but the request shape mirrors it.
 * - OIDC userinfo endpoint: `GET https://openidconnect.googleapis.com/v1/userinfo`
 *   returns `{ sub, email, email_verified, name, picture }` for a token minted
 *   with the `openid email profile` scope requested below. Verified against
 *   https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo
 *   as of this build.
 *
 * This is a LOGIN flow, not a workspace-integration-connect flow, so it does
 * NOT reuse `integration_oauth_states`/`createOAuthState` from
 * `src/lib/integrations/oauth.ts` -- that table is keyed by an already
 * authenticated `businessId`/`userId`, neither of which exists yet for someone
 * who has not signed in. CSRF state instead lives in a short-lived, HMAC-signed,
 * httpOnly cookie the browser carries from `/connect` to `/callback` -- the
 * same signed-cookie technique `src/lib/admin/step-up.ts` uses for the admin
 * re-auth window, applied here to a one-shot value instead of a session flag.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE = "openid email profile";

export const GOOGLE_LOGIN_COOKIE = "ct_g_login";
/** Generous enough for a slow consent screen, tight enough to bound replay. */
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleLoginAudience = "customer" | "affiliate";

export function googleLoginConfig(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = serverEnv.google;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}


/**
 * Signs the CSRF/context cookie. No dedicated secret is provisioned for this
 * one narrow purpose, so this falls back to the service-role key the same way
 * `admin/step-up.ts` falls back for its own cookie -- both are HMAC keys never
 * exposed to a client, and both would need a real secret compromise (not just
 * cookie forgery) to be broken.
 */
function signingKey(): string {
  return process.env.GOOGLE_LOGIN_STATE_SECRET || serverEnv.supabase.serviceRoleKey;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

type LoginState = {
  csrf: string;
  aud: GoogleLoginAudience;
  next: string | null;
  issuedAt: number;
  /** The exact redirect_uri sent to Google; the token exchange must repeat it. */
  redirectUri: string;
};

/**
 * Builds the Google authorize URL and the signed cookie value to set alongside
 * the redirect. The `state` query param sent to Google is the bare CSRF token;
 * the cookie carries that same token plus the context (`aud`, `next`) needed
 * to route the callback, since Google echoes back only `code` and `state`.
 */
export function startGoogleLogin(params: {
  audience: GoogleLoginAudience;
  next: string | null;
  /** The origin of the incoming request, e.g. `request.nextUrl.origin`. */
  origin: string | null;
}): { url: string; cookieValue: string; maxAgeSeconds: number } | null {
  const config = googleLoginConfig();
  if (!config) return null;

  const csrf = randomBytes(24).toString("base64url");
  const redirectUri = googleCallbackUri(params.origin, serverEnv.siteUrl);
  const state: LoginState = {
    csrf,
    aud: params.audience,
    next: params.next,
    issuedAt: Date.now(),
    redirectUri,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const cookieValue = `${payload}.${sign(payload)}`;

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", csrf);
  // Google re-shows the consent screen only when scopes change or this is
  // forced; omitted here since `openid email profile` asks for nothing a
  // returning user has not already granted once.

  return { url: url.toString(), cookieValue, maxAgeSeconds: Math.floor(STATE_TTL_MS / 1000) };
}

/**
 * Verifies the cookie against the `state` query param and returns the context
 * it carried, or null for anything forged, expired, or mismatched. One-shot by
 * convention: the caller clears the cookie immediately after calling this,
 * whatever the outcome.
 */
export function consumeGoogleLoginState(
  cookieValue: string | undefined,
  stateParam: string | null,
): { audience: GoogleLoginAudience; next: string | null; redirectUri: string } | null {
  if (!cookieValue || !stateParam) return null;

  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot < 0) return null;

  const payload = cookieValue.slice(0, lastDot);
  const signature = cookieValue.slice(lastDot + 1);
  if (!verifySignature(payload, signature)) return null;

  let state: LoginState;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LoginState;
  } catch {
    return null;
  }

  if (state.csrf !== stateParam) return null;
  if (Date.now() - state.issuedAt > STATE_TTL_MS) return null;
  if (state.aud !== "customer" && state.aud !== "affiliate") return null;

  // A cookie issued before redirectUri was carried falls back to the site
  // URL, which is what it was sent to Google with.
  const redirectUri =
    typeof state.redirectUri === "string" && state.redirectUri.endsWith(CALLBACK_PATH)
      ? state.redirectUri
      : googleCallbackUri(null, serverEnv.siteUrl);
  return { audience: state.aud, next: state.next, redirectUri };
}

export type GoogleTokenResponse = {
  accessToken: string;
};

/** Exchanges the authorization code for an access token. Never a refresh token: this flow never returns to Google after login, so nothing here is stored. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const config = googleLoginConfig();
  if (!config) throw new Error("Google sign-in is not configured on this environment.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // Must be byte-identical to the redirect_uri sent in the authorize step.
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || typeof json.access_token !== "string") {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : `Google token exchange failed with status ${response.status}`,
    );
  }

  return { accessToken: json.access_token };
}

type GoogleUserinfo = {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
};

export type VerifiedGoogleProfile = {
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * The signed-in Google account's verified email and name, or null if Google
 * would not vouch for the address. `email_verified` is what lets a Google
 * sign-in stand in for an emailed confirmation link.
 */
export async function fetchVerifiedGoogleProfile(
  accessToken: string,
): Promise<VerifiedGoogleProfile | null> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);

  if (!response?.ok) return null;

  const json = (await response.json().catch(() => ({}))) as GoogleUserinfo;
  if (!json.email || json.email_verified !== true) return null;

  const [nameFirst = "", ...nameRest] = (json.name ?? "").trim().split(/\s+/);
  return {
    email: json.email.trim().toLowerCase(),
    firstName: (json.given_name ?? nameFirst).trim().slice(0, 80),
    lastName: (json.family_name ?? nameRest.join(" ")).trim().slice(0, 80),
  };
}

/**
 * Mints a real Supabase session for a Google-verified email, without ever
 * sending an email and without a browser-visible `supabase.co` hop.
 * `generateLink` produces the same token a magic-link email would carry and,
 * for an address it has never seen, creates the `auth.users` row -- which is
 * how "Continue with Google" registers a new person. `verifyOtp` redeems the
 * token in the same request against the request-scoped, cookie-aware server
 * client, which sets the session cookies on this route handler's response.
 *
 * Returns the user id, or null if Supabase refused either step.
 */
export async function mintGoogleSession(email: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = linkData?.properties?.hashed_token;
  const userId = linkData?.user?.id;
  if (linkError || !hashedToken || !userId) return null;

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });

  return verifyError ? null : userId;
}

/** Where a signed-in customer lands: an explicit `next` wins, otherwise the same rule `signIn` uses. */
export async function customerDestination(userId: string, next: string | null): Promise<string> {
  return sanitizeRedirectPath(next) ?? (await destinationForUser(userId));
}

/**
 * Where a signed-in partner lands. Mirrors `partnerPath` in
 * `src/app/affiliates/login/page.tsx`: only the partner surfaces, and never
 * back onto a login page (a sign-in loop).
 */
export function affiliateDestination(next: string | null): string {
  const fallback = "/affiliates/app";
  if (!next) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/affiliates/login")) return fallback;
  if (next !== "/affiliates" && !next.startsWith("/affiliates/")) return fallback;
  return next;
}
