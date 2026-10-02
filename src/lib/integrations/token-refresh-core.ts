/**
 * The one rule for turning a stored OAuth credential into a live access token
 * (Calendly, Google Calendar, Google Ads, Salesforce, Zoho, Slack, LinkedIn
 * Ads). Pure over injected ports so the refresh race, refresh-token rotation
 * and the reconnect verdict are tested without a database or a provider
 * (tests/oauth-token-refresh.test.ts, tests/integration-token-refresh-providers.test.ts).
 *
 * Why it exists (QA 2026-09-30, owner: "Calendly login must stay constant"):
 *   - Calendly access tokens live two hours. A path that read `access_token`
 *     straight from the row (availability) failed silently once the
 *     connection was two hours old.
 *   - Calendly ROTATES the refresh token on every refresh. Two workers
 *     refreshing at once both sent the same refresh token; the second got
 *     `invalid_grant` and the connection was flipped to "Reconnect" although
 *     the first had just renewed it. Now: the new pair is written only if the
 *     stored refresh token is still the one we used (compare-and-swap), and an
 *     `invalid_grant` is only believed when the stored refresh token has not
 *     changed under us.
 *   - A quiet workspace's token is renewed ahead of time by the scheduled
 *     `integration.token_refresh` sweep (PROACTIVE_REFRESH_WINDOW_MS), so a
 *     call or message never waits on, or fails on, a refresh.
 *
 * Extended 2026-10-02 (owner: "check that the other integrations refresh"):
 * every refreshable provider is swept, Salesforce (no stated lifetime) is
 * refreshed on a 401 through the same compare-and-swap (`rejectedAccessToken`)
 * and records an assumed session lifetime, and connections flagged
 * "Reconnect" are retried every six hours so a false flag heals itself.
 */

export type StoredSecret = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

export type RefreshedToken = {
  accessToken: string;
  /** The provider's new refresh token, or the old one when it sent none (Google). */
  refreshToken: string | null;
  expiresInSeconds: number | null;
};

export type RefreshFailure = { needsReconnect: boolean; oauthError: string | null; status: number };

export type TokenRefreshPorts = {
  now(): number;
  read(integrationId: string): Promise<StoredSecret | null>;
  /** Calls the provider's token endpoint. Throws on failure; `classify` reads the error. */
  refresh(refreshToken: string): Promise<RefreshedToken>;
  classify(error: unknown): RefreshFailure | null;
  /**
   * Writes the new pair only where `refresh_token` still equals `expectedRefreshToken`.
   * Returns false when another refresh won the race.
   */
  swap(integrationId: string, expectedRefreshToken: string, next: { access_token: string; refresh_token: string | null; token_expires_at: string | null }): Promise<boolean>;
  markReconnect(integrationId: string, reason: string): Promise<void>;
};

/** Refresh on use when the token has less than this left. */
export const ON_USE_REFRESH_WINDOW_MS = 5 * 60_000;
/** The scheduled sweep renews anything expiring within this. */
export const PROACTIVE_REFRESH_WINDOW_MS = 30 * 60_000;

export class MissingCredentialError extends Error {
  constructor() {
    super("No stored credential for this integration.");
    this.name = "MissingCredentialError";
  }
}

function expiresSoon(secret: StoredSecret, now: number, windowMs: number, unknownIsDue: boolean): boolean {
  if (!secret.token_expires_at) return unknownIsDue;
  const at = Date.parse(secret.token_expires_at);
  return Number.isFinite(at) && at - now < windowMs;
}

export type LiveTokenResult = { accessToken: string; refreshed: boolean; lostRace: boolean };

export type LiveTokenOptions = {
  /** Refresh when less than this is left (default: the on-use window). */
  windowMs?: number;
  /**
   * The access token the provider has just refused (a 401 on a real call).
   * Forces a refresh whatever the stored expiry says, unless the stored token
   * is already a different one: then another worker refreshed in the
   * meantime and its token is returned instead of refreshing again.
   * Salesforce needs this: its sessions end on the org's idle timeout, not on
   * a lifetime the token response states.
   */
  rejectedAccessToken?: string;
  /**
   * For a provider whose token response carries no `expires_in` (Salesforce):
   * the lifetime to record, and an unknown stored expiry counts as due so an
   * old row learns one on its next use.
   */
  fallbackLifetimeSeconds?: number;
};

export async function liveAccessToken(
  ports: TokenRefreshPorts,
  integrationId: string,
  windowOrOptions: number | LiveTokenOptions = {},
): Promise<LiveTokenResult> {
  const options: LiveTokenOptions = typeof windowOrOptions === "number" ? { windowMs: windowOrOptions } : windowOrOptions;
  const windowMs = options.windowMs ?? ON_USE_REFRESH_WINDOW_MS;
  const secret = await ports.read(integrationId);
  if (!secret?.access_token) throw new MissingCredentialError();

  const forced = options.rejectedAccessToken !== undefined;
  if (forced && secret.access_token !== options.rejectedAccessToken) {
    // Someone already replaced the token the provider refused.
    return { accessToken: secret.access_token, refreshed: false, lostRace: true };
  }
  const due = forced || expiresSoon(secret, ports.now(), windowMs, options.fallbackLifetimeSeconds !== undefined);
  if (!due || !secret.refresh_token) {
    return { accessToken: secret.access_token, refreshed: false, lostRace: false };
  }
  const used = secret.refresh_token;

  let fresh: RefreshedToken;
  try {
    fresh = await ports.refresh(used);
  } catch (error) {
    const failure = ports.classify(error);
    if (failure?.needsReconnect) {
      // Rotation race: another worker refreshed with the same token a moment
      // ago, so ours is spent. Their pair is stored; use it.
      const again = await ports.read(integrationId);
      if (again?.access_token && again.refresh_token && again.refresh_token !== used) {
        return { accessToken: again.access_token, refreshed: false, lostRace: true };
      }
      // The grant itself is dead: only now does a person need to reconnect.
      await ports.markReconnect(integrationId, failure.oauthError ?? String(failure.status));
    }
    throw error;
  }

  const lifetime = fresh.expiresInSeconds ?? options.fallbackLifetimeSeconds ?? null;
  const next = {
    access_token: fresh.accessToken,
    refresh_token: fresh.refreshToken ?? used,
    token_expires_at: lifetime ? new Date(ports.now() + lifetime * 1000).toISOString() : null,
  };
  const won = await ports.swap(integrationId, used, next);
  if (won) return { accessToken: fresh.accessToken, refreshed: true, lostRace: false };
  // Someone else stored a newer pair first. Ours is still a valid access
  // token, but theirs is the one the row carries; prefer the stored one.
  const stored = await ports.read(integrationId);
  return { accessToken: stored?.access_token ?? fresh.accessToken, refreshed: true, lostRace: true };
}

/**
 * Salesforce states no token lifetime: a session ends on the org's idle
 * timeout (two hours by default, the setting most orgs keep). Recorded as the
 * expiry so the sweep renews it ahead of time; a shorter org timeout is caught
 * by the 401-then-refresh path on the call itself.
 */
export const SALESFORCE_ASSUMED_SESSION_SECONDS = 2 * 60 * 60;

/** Per-provider refresh facts the accessor and the sweep share. */
const REFRESH_POLICY: Readonly<Record<string, LiveTokenOptions>> = {
  salesforce: { fallbackLifetimeSeconds: SALESFORCE_ASSUMED_SESSION_SECONDS },
};

export function refreshPolicy(providerType: string): LiveTokenOptions {
  return REFRESH_POLICY[providerType] ?? {};
}

/**
 * Providers whose tokens the scheduled sweep keeps fresh: every connection
 * that holds an expiring access token AND a standard OAuth refresh grant.
 *
 *   calendly         2 h access token, refresh token rotates on every use
 *   google_calendar  1 h access token, refresh token kept
 *   google_ads       1 h access token, refresh token kept
 *   salesforce       session (org idle timeout), refresh token kept
 *   zoho_crm         1 h access token, per data centre token endpoint
 *   slack            12 h, only when token rotation is on (no refresh token otherwise)
 *   linkedin_ads     60 d access token, 365 d refresh token
 *
 * Not here, and why: Meta and WhatsApp Cloud have no refresh grant (the daily
 * `maintainMetaToken` check extends and warns instead); HubSpot is a pasted
 * private-app token and TikTok's Marketing API token does not expire.
 */
export const PROACTIVE_REFRESH_PROVIDERS = [
  "calendly",
  "google_calendar",
  "google_ads",
  "salesforce",
  "zoho_crm",
  "slack",
  "linkedin_ads",
] as const;

export type RefreshCandidate = {
  integrationId: string;
  providerType: string;
  status: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
};

/**
 * The connections the sweep renews now: a refreshable provider, still
 * connected (a connection already waiting for a person to reconnect is left
 * to `dueForRecovery`), with a refresh token, expiring within the window
 * (already-expired included). An unknown expiry is due only for a provider
 * that never states one (Salesforce), so the first sweep records one.
 */
export function dueForProactiveRefresh(rows: readonly RefreshCandidate[], now: number, windowMs: number = PROACTIVE_REFRESH_WINDOW_MS): string[] {
  return rows
    .filter((r) => (PROACTIVE_REFRESH_PROVIDERS as readonly string[]).includes(r.providerType))
    .filter((r) => r.status !== "DISCONNECTED" && r.status !== "ACTION_REQUIRED")
    .filter((r) => Boolean(r.refreshToken))
    .filter((r) => {
      if (!r.tokenExpiresAt) return refreshPolicy(r.providerType).fallbackLifetimeSeconds !== undefined;
      const at = Date.parse(r.tokenExpiresAt);
      return Number.isFinite(at) && at - now < windowMs;
    })
    .map((r) => r.integrationId);
}

/**
 * A connection flagged "Reconnect" by a refusal is retried this often by the
 * sweep. A real `invalid_grant` simply fails again (no new notification: the
 * flag is idempotent); a connection flagged by mistake (a health ping that met
 * an idle Salesforce session, an old poll that met a blip) is restored.
 */
export const RECOVERY_INTERVAL_MS = 6 * 60 * 60_000;

/** Whether this ten-minute sweep is the one that also retries flagged connections. */
export function isRecoverySweep(now: number, sweepEveryMs = 10 * 60_000): boolean {
  return Math.floor(now / sweepEveryMs) % Math.round(RECOVERY_INTERVAL_MS / sweepEveryMs) === 0;
}

export const RECONNECT_ERROR_CODE = "reconnect_required";

/** Flagged connections worth one recovery refresh: refreshable, flagged by a refusal, holding a refresh token. */
export function dueForRecovery(rows: readonly (RefreshCandidate & { errorCode: string | null })[]): string[] {
  return rows
    .filter((r) => (PROACTIVE_REFRESH_PROVIDERS as readonly string[]).includes(r.providerType))
    .filter((r) => r.status === "ACTION_REQUIRED" && r.errorCode === RECONNECT_ERROR_CODE)
    .filter((r) => Boolean(r.refreshToken))
    .map((r) => r.integrationId);
}
