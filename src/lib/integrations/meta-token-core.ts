/**
 * Meta (Lead Ads, Pages/Messenger/Instagram) and WhatsApp Cloud tokens: what
 * the daily check does about a credential that has no refresh grant.
 *
 * Meta issues no refresh token. A Facebook Login user token is exchanged for a
 * long-lived one (~60 days) at connect (`afterConnect` in meta-lead-ads.ts);
 * the Page tokens derived from it carry no expiry of their own but die with
 * it. An Embedded Signup (WhatsApp) token is a business-integration system
 * user token, which usually never expires. So, once a day per connection:
 *
 *   1. Ask Meta what the token is (`/debug_token`): valid or not, when it
 *      expires (0 = never), when data access expires. Recorded on the row,
 *      so the health card and the warning use Meta's own answer rather than
 *      a lifetime guessed at connect time (the owner's Meta row had none).
 *   2. Within META_EXTEND_WITHIN_MS of expiry, try Meta's own extension
 *      (`grant_type=fb_exchange_token` with the current long-lived token).
 *      The new token is stored only if Meta gave a later expiry, and only if
 *      the stored token is still the one we checked (compare-and-swap), so a
 *      reconnect made meanwhile is never overwritten.
 *   3. Warn the owner (health card + notification) from META_TOKEN_WARN_DAYS
 *      out when the expiry could not be extended (`metaTokenRenewal` in
 *      catalog.ts, the same rule the connection card uses).
 *   4. "Reconnect" only when Meta says the token itself is invalid
 *      (`is_valid: false`) and nobody replaced it meanwhile. A network error
 *      or a 5xx from Meta, or a refused extension of a token Meta still calls
 *      valid, changes nothing.
 *
 * Pure over ports (tests/integration-token-refresh-providers.test.ts).
 */

export type MetaDebugInfo = {
  isValid: boolean;
  /** Epoch seconds; 0 means the token never expires. */
  expiresAt: number | null;
  /** Epoch seconds; 0 or null when Meta states none. */
  dataAccessExpiresAt: number | null;
  /** Meta's error code when invalid (190 = expired or revoked). */
  errorCode: number | null;
};

export type MetaStoredToken = { access_token: string | null; token_expires_at: string | null };

export type MetaTokenFacts = {
  token_expires_at: string | null;
  data_access_expires_at: string | null;
  checked_at: string;
};

export type MetaTokenPorts = {
  now(): number;
  read(integrationId: string): Promise<MetaStoredToken | null>;
  /** `/debug_token`. Throws on a network error or a non-2xx answer (a blip). */
  debug(accessToken: string): Promise<MetaDebugInfo>;
  /** `fb_exchange_token`. Throws on any failure. */
  exchange(accessToken: string): Promise<{ accessToken: string; expiresInSeconds: number | null }>;
  /** Writes the new token only where the stored token is still `expectedAccessToken`. */
  swap(integrationId: string, expectedAccessToken: string, next: { access_token: string; token_expires_at: string | null }): Promise<boolean>;
  /** Records what Meta said, only where the stored token is still `expectedAccessToken`. */
  record(integrationId: string, expectedAccessToken: string, facts: MetaTokenFacts): Promise<void>;
  markReconnect(integrationId: string, reason: string): Promise<void>;
};

/** Try Meta's extension from this far out. */
export const META_EXTEND_WITHIN_MS = 15 * 24 * 60 * 60_000;
/** Meta connections are asked about once a day. */
export const META_CHECK_EVERY_MS = 24 * 60 * 60_000;

export type MetaMaintenanceOutcome =
  | "missing"
  | "blip"
  | "reconnect"
  | "replaced"
  | "never_expires"
  | "ok"
  | "extended"
  | "not_extended";

export type MetaMaintenanceResult = {
  outcome: MetaMaintenanceOutcome;
  /** The expiry now stored (null = never expires or unknown). */
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
};

const isoFromSeconds = (s: number | null): string | null => (s && s > 0 ? new Date(s * 1000).toISOString() : null);

export async function maintainMetaToken(ports: MetaTokenPorts, integrationId: string): Promise<MetaMaintenanceResult> {
  const stored = await ports.read(integrationId);
  const token = stored?.access_token;
  if (!token) return { outcome: "missing", expiresAt: null, dataAccessExpiresAt: null };
  const unchanged = { expiresAt: stored.token_expires_at, dataAccessExpiresAt: null };

  let info: MetaDebugInfo;
  try {
    info = await ports.debug(token);
  } catch {
    return { outcome: "blip", ...unchanged };
  }

  if (!info.isValid) {
    const again = await ports.read(integrationId);
    if (again?.access_token && again.access_token !== token) {
      return { outcome: "replaced", expiresAt: again.token_expires_at, dataAccessExpiresAt: null };
    }
    await ports.markReconnect(integrationId, `meta_${info.errorCode ?? "invalid"}`);
    return { outcome: "reconnect", ...unchanged };
  }

  const now = ports.now();
  const dataAccessExpiresAt = isoFromSeconds(info.dataAccessExpiresAt);
  const checkedAt = new Date(now).toISOString();

  if (info.expiresAt === 0) {
    await ports.record(integrationId, token, { token_expires_at: null, data_access_expires_at: dataAccessExpiresAt, checked_at: checkedAt });
    return { outcome: "never_expires", expiresAt: null, dataAccessExpiresAt };
  }

  const expiresAt = isoFromSeconds(info.expiresAt) ?? stored.token_expires_at;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;

  if (Number.isFinite(expiresMs) && expiresMs - now < META_EXTEND_WITHIN_MS) {
    try {
      const fresh = await ports.exchange(token);
      const nextExpiry = fresh.expiresInSeconds ? new Date(now + fresh.expiresInSeconds * 1000).toISOString() : null;
      const later = nextExpiry === null || Date.parse(nextExpiry) > expiresMs;
      if (fresh.accessToken && later) {
        const won = await ports.swap(integrationId, token, { access_token: fresh.accessToken, token_expires_at: nextExpiry });
        if (won) {
          await ports.record(integrationId, fresh.accessToken, { token_expires_at: nextExpiry, data_access_expires_at: dataAccessExpiresAt, checked_at: checkedAt });
          return { outcome: "extended", expiresAt: nextExpiry, dataAccessExpiresAt };
        }
        const latest = await ports.read(integrationId);
        return { outcome: "replaced", expiresAt: latest?.token_expires_at ?? null, dataAccessExpiresAt };
      }
    } catch {
      // Meta still calls the token valid; a refused extension is not a reason
      // to ask anyone to reconnect yet. The warning below covers it.
    }
    await ports.record(integrationId, token, { token_expires_at: expiresAt, data_access_expires_at: dataAccessExpiresAt, checked_at: checkedAt });
    return { outcome: "not_extended", expiresAt, dataAccessExpiresAt };
  }

  await ports.record(integrationId, token, { token_expires_at: expiresAt, data_access_expires_at: dataAccessExpiresAt, checked_at: checkedAt });
  return { outcome: "ok", expiresAt, dataAccessExpiresAt };
}

/** Whether a Meta-family connection is due its daily check. */
export function metaCheckDue(checkedAt: string | null | undefined, now: number): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  return !Number.isFinite(at) || now - at >= META_CHECK_EVERY_MS;
}

/** The Meta-family providers the daily check covers. */
export const META_TOKEN_PROVIDERS = ["meta", "whatsapp_cloud"] as const;
