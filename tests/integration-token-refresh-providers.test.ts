/**
 * Every connection that holds an expiring credential (owner, 2026-10-02:
 * "check that the other integrations refresh"). The shared rule is
 * token-refresh-core.ts (OAuth refresh grants) and meta-token-core.ts (Meta
 * and WhatsApp Cloud, which have none). Each provider is simulated with its
 * own token-endpoint behaviour; no provider is called.
 *
 * Per provider: refresh on use, proactive (sweep) refresh, rotation, the
 * refresh race, and a refused grant (Reconnect) versus a blip (no Reconnect).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PROACTIVE_REFRESH_PROVIDERS,
  PROACTIVE_REFRESH_WINDOW_MS,
  RECOVERY_INTERVAL_MS,
  SALESFORCE_ASSUMED_SESSION_SECONDS,
  dueForProactiveRefresh,
  dueForRecovery,
  isRecoverySweep,
  liveAccessToken,
  refreshPolicy,
  type RefreshedToken,
  type StoredSecret,
  type TokenRefreshPorts,
} from "../src/lib/integrations/token-refresh-core.ts";
import { OAuthRefreshError } from "../src/lib/integrations/oauth-health.ts";
import { MissingCredentialError } from "../src/lib/integrations/token-refresh-core.ts";
import { pollFailureVerdict } from "../src/lib/integrations/poll-failure.ts";
import {
  META_EXTEND_WITHIN_MS,
  maintainMetaToken,
  metaCheckDue,
  type MetaDebugInfo,
  type MetaTokenPorts,
} from "../src/lib/integrations/meta-token-core.ts";

const NOW = Date.parse("2026-10-02T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/* --------------------------------------------------- provider simulations --- */

type ProviderSim = {
  provider: string;
  /** Access-token lifetime the provider states (null: none, Salesforce). */
  expiresIn: number | null;
  /** Whether each refresh issues a new refresh token and spends the old one. */
  rotates: boolean;
  /**
   * How the provider refuses a dead refresh token, as `refreshAccessToken`
   * turns it into an OAuthRefreshError (Zoho: HTTP 200 + `error`, mapped to 400).
   */
  refusal: () => OAuthRefreshError;
};

const PROVIDERS: ProviderSim[] = [
  { provider: "calendly", expiresIn: 7200, rotates: true, refusal: () => new OAuthRefreshError("invalid_grant", 400, "invalid_grant") },
  { provider: "google_calendar", expiresIn: 3599, rotates: false, refusal: () => new OAuthRefreshError("Token has been expired or revoked.", 400, "invalid_grant") },
  { provider: "google_ads", expiresIn: 3599, rotates: false, refusal: () => new OAuthRefreshError("Bad Request", 400, "invalid_grant") },
  { provider: "salesforce", expiresIn: null, rotates: false, refusal: () => new OAuthRefreshError("expired access/refresh token", 400, "invalid_grant") },
  { provider: "zoho_crm", expiresIn: 3600, rotates: false, refusal: () => new OAuthRefreshError("Token refresh failed (invalid_code).", 400, "invalid_code") },
  { provider: "slack", expiresIn: 43200, rotates: true, refusal: () => new OAuthRefreshError("Token refresh failed (invalid_refresh_token).", 400, "invalid_refresh_token") },
  { provider: "linkedin_ads", expiresIn: 5_184_000, rotates: false, refusal: () => new OAuthRefreshError("The token used in the request has been revoked by the user", 400, "invalid_grant") },
];

function world(sim: ProviderSim, initial: StoredSecret) {
  const row: StoredSecret = { ...initial };
  let issued = 0;
  const valid = new Set<string>(initial.refresh_token ? [initial.refresh_token] : []);
  const log = { refreshCalls: 0, reconnects: [] as string[], swaps: 0 };
  const ports: TokenRefreshPorts = {
    now: () => NOW,
    read: async () => ({ ...row }),
    async refresh(refreshToken: string): Promise<RefreshedToken> {
      log.refreshCalls++;
      if (!valid.has(refreshToken)) throw sim.refusal();
      issued++;
      if (!sim.rotates) return { accessToken: `${sim.provider}-at-${issued}`, refreshToken: null, expiresInSeconds: sim.expiresIn };
      valid.delete(refreshToken);
      const next = `${sim.provider}-rt-${issued}`;
      valid.add(next);
      return { accessToken: `${sim.provider}-at-${issued}`, refreshToken: next, expiresInSeconds: sim.expiresIn };
    },
    // The real port's classification (oauth.ts tokenRefreshPorts).
    classify: (error) =>
      error instanceof OAuthRefreshError ? { needsReconnect: error.needsReconnect, oauthError: error.oauthError, status: error.status } : null,
    async swap(_id, expected, next) {
      if (row.refresh_token !== expected) return false;
      log.swaps++;
      Object.assign(row, next);
      return true;
    },
    markReconnect: async (_id, reason) => {
      log.reconnects.push(reason);
    },
  };
  return { ports, row, log, valid };
}

for (const sim of PROVIDERS) {
  const policy = refreshPolicy(sim.provider);
  const lifetimeMs = (sim.expiresIn ?? SALESFORCE_ASSUMED_SESSION_SECONDS) * 1000;

  describe(`${sim.provider}`, () => {
    test("is covered by the proactive sweep", () => {
      assert.ok((PROACTIVE_REFRESH_PROVIDERS as readonly string[]).includes(sim.provider));
    });

    test("refresh on use: an expired token is renewed and stored with its expiry", async () => {
      const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - HOUR) });
      const r = await liveAccessToken(w.ports, "i1", policy);
      assert.equal(r.refreshed, true);
      assert.equal(w.row.access_token, `${sim.provider}-at-1`);
      assert.equal(w.row.token_expires_at, iso(NOW + lifetimeMs), "a stated or assumed lifetime is recorded, so the sweep can see it");
    });

    test("proactive: the sweep renews a token inside 30 minutes; the on-use window leaves it", async () => {
      const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW + 20 * 60_000) });
      assert.equal((await liveAccessToken(w.ports, "i1", policy)).refreshed, false);
      assert.equal((await liveAccessToken(w.ports, "i1", { ...policy, windowMs: PROACTIVE_REFRESH_WINDOW_MS })).refreshed, true);
      const due = dueForProactiveRefresh(
        [{ integrationId: "i1", providerType: sim.provider, status: "HEALTHY", refreshToken: "rt", tokenExpiresAt: iso(NOW + 20 * 60_000) }],
        NOW,
      );
      assert.deepEqual(due, ["i1"]);
    });

    test(sim.rotates ? "rotation: the new refresh token is stored and the next refresh uses it" : "no rotation: the original refresh token is kept", async () => {
      const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
      await liveAccessToken(w.ports, "i1", policy);
      assert.equal(w.row.refresh_token, sim.rotates ? `${sim.provider}-rt-1` : "rt-0");
      w.row.token_expires_at = iso(NOW - 1000);
      await liveAccessToken(w.ports, "i1", policy);
      assert.equal(w.row.access_token, `${sim.provider}-at-2`);
      assert.deepEqual(w.log.reconnects, []);
    });

    test("the race: two refreshes at once write one pair and nobody is told to reconnect", async () => {
      const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
      const results = await Promise.all([liveAccessToken(w.ports, "i1", policy), liveAccessToken(w.ports, "i1", policy)]);
      assert.deepEqual(w.log.reconnects, []);
      if (sim.rotates) {
        // The loser's refresh token was spent by the winner: one pair written,
        // both callers use it.
        assert.equal(w.log.swaps, 1);
        assert.ok(results.every((r) => r.accessToken === w.row.access_token));
      } else {
        // Without rotation both refreshes succeed and both access tokens are
        // valid; the refresh token is never lost whichever write lands last.
        assert.equal(w.row.refresh_token, "rt-0");
        assert.ok(results.every((r) => r.accessToken.startsWith(`${sim.provider}-at-`)));
      }
    });

    test("a refused grant nobody replaced marks Reconnect", async () => {
      const w = world(sim, { access_token: "at-0", refresh_token: "rt-dead", token_expires_at: iso(NOW - 1000) });
      w.valid.clear();
      await assert.rejects(() => liveAccessToken(w.ports, "i1", policy));
      assert.equal(w.log.reconnects.length, 1);
    });

    test("a blip (network error or 5xx) never marks Reconnect and leaves the stored pair", async () => {
      for (const blip of [new Error("ECONNRESET"), new OAuthRefreshError("Service Unavailable", 503, null), new OAuthRefreshError("rate limited", 429, null)]) {
        const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
        w.ports.refresh = async () => {
          throw blip;
        };
        await assert.rejects(() => liveAccessToken(w.ports, "i1", policy));
        assert.deepEqual(w.log.reconnects, [], `${blip.message} is a blip`);
        assert.equal(w.row.refresh_token, "rt-0");
      }
    });
  });
}

describe("Salesforce: no stated lifetime", () => {
  const sim = PROVIDERS.find((p) => p.provider === "salesforce")!;
  const policy = refreshPolicy("salesforce");

  test("an old row with no expiry is refreshed on first use and learns the assumed session", async () => {
    const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: null });
    const r = await liveAccessToken(w.ports, "i1", policy);
    assert.equal(r.refreshed, true);
    assert.equal(w.row.token_expires_at, iso(NOW + SALESFORCE_ASSUMED_SESSION_SECONDS * 1000));
  });

  test("the sweep picks up a Salesforce row with no expiry, but not a Google row with none", () => {
    const rows = [
      { integrationId: "sf", providerType: "salesforce", status: "HEALTHY", refreshToken: "rt", tokenExpiresAt: null },
      { integrationId: "g", providerType: "google_ads", status: "HEALTHY", refreshToken: "rt", tokenExpiresAt: null },
    ];
    assert.deepEqual(dueForProactiveRefresh(rows, NOW), ["sf"]);
  });

  test("a 401 forces a refresh even though the stored expiry says the session is live", async () => {
    const w = world(sim, { access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW + HOUR) });
    const r = await liveAccessToken(w.ports, "i1", { ...policy, rejectedAccessToken: "at-0" });
    assert.equal(r.refreshed, true);
    assert.equal(r.accessToken, "salesforce-at-1");
  });

  test("a 401 on a token another worker already replaced reuses theirs, with no second refresh", async () => {
    const w = world(sim, { access_token: "at-new", refresh_token: "rt-0", token_expires_at: iso(NOW + HOUR) });
    const r = await liveAccessToken(w.ports, "i1", { ...policy, rejectedAccessToken: "at-old" });
    assert.equal(r.accessToken, "at-new");
    assert.equal(w.log.refreshCalls, 0);
  });

  test("a 401 with no refresh token returns the same token (the caller reports it)", async () => {
    const w = world(sim, { access_token: "at-0", refresh_token: null, token_expires_at: null });
    const r = await liveAccessToken(w.ports, "i1", { ...policy, rejectedAccessToken: "at-0" });
    assert.equal(r.accessToken, "at-0");
    assert.equal(r.refreshed, false);
  });
});

describe("recovery of connections flagged Reconnect", () => {
  test("every six hours, refreshable connections flagged by a refusal are retried", () => {
    const rows = [
      { integrationId: "sf", providerType: "salesforce", status: "ACTION_REQUIRED", errorCode: "reconnect_required", refreshToken: "rt", tokenExpiresAt: null },
      { integrationId: "zoho-scope", providerType: "zoho_crm", status: "ACTION_REQUIRED", errorCode: "scope_outdated", refreshToken: "rt", tokenExpiresAt: null },
      { integrationId: "meta", providerType: "meta", status: "ACTION_REQUIRED", errorCode: "reconnect_required", refreshToken: null, tokenExpiresAt: null },
      { integrationId: "ok", providerType: "google_ads", status: "HEALTHY", errorCode: null, refreshToken: "rt", tokenExpiresAt: null },
    ];
    assert.deepEqual(dueForRecovery(rows), ["sf"]);
    const sweeps = Array.from({ length: 36 }, (_, i) => NOW + i * 10 * 60_000).filter((t) => isRecoverySweep(t));
    assert.equal(sweeps.length, 1, "one recovery pass per six hours of ten-minute sweeps");
    assert.equal(RECOVERY_INTERVAL_MS, 6 * HOUR);
  });
});

describe("lead-source poll failures", () => {
  test("only a refused grant (or no credential) is Reconnect; a blip is Degraded", () => {
    assert.equal(pollFailureVerdict(new OAuthRefreshError("Bad Request", 400, "invalid_grant")), "reconnect");
    assert.equal(pollFailureVerdict(new OAuthRefreshError("down", 503, null)), "degraded");
    assert.equal(pollFailureVerdict(new MissingCredentialError()), "action_required");
    assert.equal(pollFailureVerdict(new Error("fetch failed")), "degraded");
    assert.equal(pollFailureVerdict(new Error("Google Ads search failed (status 500)")), "degraded");
  });
});

/* ------------------------------------------------------------------ meta --- */

function metaWorld(initial: { access_token: string | null; token_expires_at: string | null }, info: Partial<MetaDebugInfo> = {}) {
  const row = { ...initial, extra: {} as Record<string, unknown> };
  const log = { reconnects: [] as string[], exchanges: 0, debugs: 0 };
  const ports: MetaTokenPorts = {
    now: () => NOW,
    read: async () => ({ access_token: row.access_token, token_expires_at: row.token_expires_at }),
    async debug() {
      log.debugs++;
      return { isValid: true, expiresAt: null, dataAccessExpiresAt: null, errorCode: null, ...info };
    },
    async exchange() {
      log.exchanges++;
      return { accessToken: "meta-extended", expiresInSeconds: 60 * 24 * 3600 };
    },
    async swap(_id, expected, next) {
      if (row.access_token !== expected) return false;
      row.access_token = next.access_token;
      row.token_expires_at = next.token_expires_at;
      return true;
    },
    async record(_id, expected, facts) {
      if (row.access_token !== expected) return;
      row.token_expires_at = facts.token_expires_at;
      row.extra = { ...row.extra, meta_token_checked_at: facts.checked_at, meta_data_access_expires_at: facts.data_access_expires_at };
    },
    markReconnect: async (_id, reason) => {
      log.reconnects.push(reason);
    },
  };
  return { ports, row, log };
}

const secs = (ms: number) => Math.floor(ms / 1000);

describe("Meta / WhatsApp Cloud (no refresh grant)", () => {
  test("a token Meta says never expires is recorded as such (no expiry, no warning)", async () => {
    const w = metaWorld({ access_token: "page-token", token_expires_at: null }, { expiresAt: 0, dataAccessExpiresAt: secs(NOW + 80 * DAY) });
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "never_expires");
    assert.equal(w.row.token_expires_at, null);
    assert.equal(w.row.extra.meta_data_access_expires_at, iso(secs(NOW + 80 * DAY) * 1000));
    assert.equal(w.log.exchanges, 0);
  });

  test("an unknown stored expiry learns Meta's own", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: null }, { expiresAt: secs(NOW + 50 * DAY) });
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "ok");
    assert.equal(w.row.token_expires_at, iso(secs(NOW + 50 * DAY) * 1000));
    assert.equal(w.log.exchanges, 0, "nowhere near expiry: no extension attempted");
  });

  test("within 15 days of expiry it is extended with fb_exchange_token, compare-and-swap on the token", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: iso(NOW + 5 * DAY) }, { expiresAt: secs(NOW + 5 * DAY) });
    assert.ok(5 * DAY < META_EXTEND_WITHIN_MS);
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "extended");
    assert.equal(w.row.access_token, "meta-extended");
    assert.equal(w.row.token_expires_at, iso(NOW + 60 * DAY));
  });

  test("an extension that does not move the expiry is not stored, and the result says so (the warning follows)", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: iso(NOW + 5 * DAY) }, { expiresAt: secs(NOW + 5 * DAY) });
    w.ports.exchange = async () => ({ accessToken: "same-lifetime", expiresInSeconds: 4 * 24 * 3600 });
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "not_extended");
    assert.equal(w.row.access_token, "user-token");
  });

  test("a refused extension of a token Meta still calls valid is not a Reconnect", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: iso(NOW + 3 * DAY) }, { expiresAt: secs(NOW + 3 * DAY) });
    w.ports.exchange = async () => {
      throw new Error("Meta token extension answered 400.");
    };
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "not_extended");
    assert.deepEqual(w.log.reconnects, []);
  });

  test("the race: a reconnect stored a new token while we extended; ours is not written over it", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: iso(NOW + 3 * DAY) }, { expiresAt: secs(NOW + 3 * DAY) });
    w.ports.exchange = async () => {
      w.row.access_token = "reconnected-token";
      w.row.token_expires_at = iso(NOW + 60 * DAY);
      return { accessToken: "meta-extended", expiresInSeconds: 60 * 24 * 3600 };
    };
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "replaced");
    assert.equal(w.row.access_token, "reconnected-token");
  });

  test("Meta says the token is invalid (190) and nobody replaced it: Reconnect", async () => {
    const w = metaWorld({ access_token: "dead", token_expires_at: iso(NOW - DAY) }, { isValid: false, errorCode: 190 });
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "reconnect");
    assert.deepEqual(w.log.reconnects, ["meta_190"]);
  });

  test("invalid, but a reconnect replaced it meanwhile: no Reconnect", async () => {
    const w = metaWorld({ access_token: "dead", token_expires_at: null }, { isValid: false, errorCode: 190 });
    const debug = w.ports.debug;
    w.ports.debug = async (t) => {
      const out = await debug(t);
      w.row.access_token = "fresh-from-reconnect";
      return out;
    };
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "replaced");
    assert.deepEqual(w.log.reconnects, []);
  });

  test("debug_token unreachable or 5xx is a blip: nothing changes", async () => {
    const w = metaWorld({ access_token: "user-token", token_expires_at: iso(NOW + 3 * DAY) });
    w.ports.debug = async () => {
      throw new Error("Meta debug_token answered 503.");
    };
    const r = await maintainMetaToken(w.ports, "m1");
    assert.equal(r.outcome, "blip");
    assert.deepEqual(w.log.reconnects, []);
    assert.equal(w.row.access_token, "user-token");
  });

  test("checked once a day", () => {
    assert.equal(metaCheckDue(null, NOW), true);
    assert.equal(metaCheckDue(iso(NOW - 2 * HOUR), NOW), false);
    assert.equal(metaCheckDue(iso(NOW - 25 * HOUR), NOW), true);
  });
});
