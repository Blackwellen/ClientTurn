/**
 * Pure: which redirect_uri to send Google for native sign-in. Kept out of the
 * server-only `google-login.ts` so it can be unit-tested.
 */

export const CALLBACK_PATH = "/api/auth/google/callback";

/** Production hosts this app is served from, besides NEXT_PUBLIC_SITE_URL. */
const KNOWN_ORIGINS = new Set([
  "https://clientturn.com",
  "https://www.clientturn.com",
  "https://clientturn.vercel.app",
]);

/**
 * The redirect_uri Google is sent, built from the origin the person is
 * actually on -- not from NEXT_PUBLIC_SITE_URL alone.
 *
 * A fixed env-derived URI broke sign-in whenever the two disagreed: a dev
 * server on :3001 while the env said :3000, `www.` versus the apex, or a
 * production deploy with the variable unset (falling back to localhost). Google
 * then refused with redirect_uri_mismatch. Only known origins are honoured,
 * so a spoofed Host header cannot turn this into an open redirect; anything
 * else falls back to the configured site URL. Every origin used must still be
 * registered as an Authorized redirect URI on the Google OAuth client.
 */
export function googleCallbackUri(requestOrigin: string | null | undefined, siteUrl: string): string {
  const fallback = `${siteUrl.replace(/\/+$/, "")}${CALLBACK_PATH}`;
  if (!requestOrigin) return fallback;
  let origin: URL;
  try {
    origin = new URL(requestOrigin);
  } catch {
    return fallback;
  }
  const normalised = `${origin.protocol}//${origin.host}`;
  const isLocal =
    origin.protocol === "http:" && (origin.hostname === "localhost" || origin.hostname === "127.0.0.1");
  let siteOrigin: string | null = null;
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    siteOrigin = null;
  }
  if (isLocal || KNOWN_ORIGINS.has(normalised) || normalised === siteOrigin) {
    return `${normalised}${CALLBACK_PATH}`;
  }
  return fallback;
}
