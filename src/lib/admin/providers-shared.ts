/**
 * Pure credential-shape checks for the platform provider probes.
 *
 * Free of `server-only` and of any network call so the rules can be unit
 * tested: a misconfiguration that no probe could ever succeed against should
 * be reported as a configuration problem, not as a provider outage.
 */

/**
 * Twilio's REST path is `/2010-04-01/Accounts/{AccountSid}.json`, and only an
 * Account SID (`AC…`) is valid there. An API Key SID (`SK…`) authenticates
 * fine as the Basic-auth username but is not an account identifier, so the
 * request 404s — which reads as "Twilio is down" unless it is named properly.
 */
export function twilioAccountSidProblem(sid: string | undefined): string | null {
  if (!sid) return null;
  if (sid.startsWith("AC")) return null;
  if (sid.startsWith("SK")) {
    return "The configured Twilio SID is an API Key SID (SK…), not an Account SID (AC…). Set TWILIO_ACCOUNT_SID to the AC… value from the Twilio console.";
  }
  return "The configured Twilio SID is not a recognised Account SID (expected an AC… value).";
}

/**
 * TikTok's OAuth parameters are `client_key` / `client_secret`. The catalogue
 * originally asked for `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET`, which is not
 * what the provider calls them, so provisioned credentials read as absent.
 * Both spellings resolve here, with TikTok's own naming preferred.
 */
// Takes the four keys it reads rather than a full `NodeJS.ProcessEnv`, which
// requires `NODE_ENV` and would force every caller — tests included — to
// supply a variable this function has no interest in.
export function resolveTikTokCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  clientKey: string | undefined;
  clientSecret: string | undefined;
} {
  return {
    clientKey: env.TIKTOK_CLIENT_KEY || env.TIKTOK_APP_ID || undefined,
    clientSecret: env.TIKTOK_CLIENT_SECRET || env.TIKTOK_APP_SECRET || undefined,
  };
}
