/**
 * The refresh-aware token accessor (src/lib/integrations/token-refresh-core.ts),
 * after the owner workspace's Calendly connection went silently dead two hours
 * after connecting (2026-09-30): availability read the stored access token
 * directly, and nothing renewed it ahead of time.
 *
 * Covers: refresh on use, refresh-token rotation stored, the refresh race
 * (compare-and-swap; a rotation race is not a dead grant), reconnect only on a
 * refused grant nobody replaced, and the proactive 30-minute sweep window.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ON_USE_REFRESH_WINDOW_MS,
  PROACTIVE_REFRESH_WINDOW_MS,
  MissingCredentialError,
  dueForProactiveRefresh,
  liveAccessToken,
  type RefreshedToken,
  type StoredSecret,
  type TokenRefreshPorts,
} from "../src/lib/integrations/token-refresh-core.ts";

const NOW = Date.parse("2026-09-30T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

class GrantError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** An in-memory secret store plus a Calendly-like token endpoint that rotates refresh tokens. */
function world(initial: StoredSecret) {
  const row: StoredSecret = { ...initial };
  let issued = 0;
  const valid = new Set<string>(initial.refresh_token ? [initial.refresh_token] : []);
  const log = { refreshCalls: 0, reconnects: [] as string[], swaps: 0 };
  const ports: TokenRefreshPorts = {
    now: () => NOW,
    read: async () => ({ ...row }),
    async refresh(refreshToken: string): Promise<RefreshedToken> {
      log.refreshCalls++;
      // Calendly: a refresh token is single use; the response carries a new one.
      if (!valid.has(refreshToken)) throw new GrantError("invalid_grant");
      valid.delete(refreshToken);
      issued++;
      const next = `rt-${issued}`;
      valid.add(next);
      return { accessToken: `at-${issued}`, refreshToken: next, expiresInSeconds: 7200 };
    },
    classify: (e) => (e instanceof GrantError ? { needsReconnect: e.code === "invalid_grant", oauthError: e.code, status: e.status } : null),
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

describe("liveAccessToken", () => {
  test("a token with time left is returned as stored, no refresh", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW + 60 * 60_000) });
    const r = await liveAccessToken(w.ports, "i1");
    assert.equal(r.accessToken, "at-0");
    assert.equal(w.log.refreshCalls, 0);
  });

  test("an expired Calendly token is refreshed on use (the 2026-09-30 failure)", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 3 * 60 * 60_000) });
    const r = await liveAccessToken(w.ports, "i1");
    assert.equal(r.accessToken, "at-1");
    assert.equal(r.refreshed, true);
    assert.equal(w.row.access_token, "at-1");
    assert.equal(w.row.token_expires_at, iso(NOW + 7200 * 1000));
  });

  test("refresh-token rotation: the NEW refresh token is stored, so the next refresh works", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
    await liveAccessToken(w.ports, "i1");
    assert.equal(w.row.refresh_token, "rt-1");
    // Two hours later it expires again; the stored (rotated) token must be accepted.
    w.row.token_expires_at = iso(NOW - 1000);
    const again = await liveAccessToken(w.ports, "i1");
    assert.equal(again.accessToken, "at-2");
    assert.equal(w.row.refresh_token, "rt-2");
    assert.deepEqual(w.log.reconnects, []);
  });

  test("a provider that sends no new refresh token (Google) keeps the old one", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-g", token_expires_at: iso(NOW - 1000) });
    w.ports.refresh = async () => ({ accessToken: "at-g2", refreshToken: null, expiresInSeconds: 3600 });
    await liveAccessToken(w.ports, "i1");
    assert.equal(w.row.refresh_token, "rt-g");
    assert.equal(w.row.access_token, "at-g2");
  });

  test("the race: two workers refresh at once; one wins, the other uses the winner's token and nobody is told to reconnect", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
    const [a, b] = await Promise.all([liveAccessToken(w.ports, "i1"), liveAccessToken(w.ports, "i1")]);
    assert.deepEqual(w.log.reconnects, [], "a rotation race is not a dead grant");
    assert.equal(w.log.swaps, 1, "only one pair is written");
    assert.equal(w.row.refresh_token, "rt-1");
    assert.ok([a, b].every((r) => r.accessToken === "at-1"));
    assert.ok([a, b].some((r) => r.lostRace));
  });

  test("compare-and-swap: a refresh that finishes after another stored a newer pair does not overwrite it", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
    const realRefresh = w.ports.refresh;
    w.ports.refresh = async (rt) => {
      const out = await realRefresh(rt);
      // Meanwhile another worker stored its own newer pair.
      Object.assign(w.row, { access_token: "at-other", refresh_token: "rt-other", token_expires_at: iso(NOW + 7200_000) });
      return out;
    };
    const r = await liveAccessToken(w.ports, "i1");
    assert.equal(w.row.refresh_token, "rt-other", "the newer stored pair is kept");
    assert.equal(r.accessToken, "at-other");
    assert.equal(r.lostRace, true);
  });

  test("a refused grant nobody replaced marks the connection Reconnect, once, and throws", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-revoked", token_expires_at: iso(NOW - 1000) });
    w.valid.clear();
    await assert.rejects(() => liveAccessToken(w.ports, "i1"));
    assert.deepEqual(w.log.reconnects, ["invalid_grant"]);
  });

  test("a network blip (not a grant refusal) never marks Reconnect", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
    w.ports.refresh = async () => {
      throw new Error("ECONNRESET");
    };
    await assert.rejects(() => liveAccessToken(w.ports, "i1"));
    assert.deepEqual(w.log.reconnects, []);
    assert.equal(w.row.refresh_token, "rt-0", "the stored pair is untouched");
  });

  test("a 5xx from the token endpoint is a blip", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW - 1000) });
    w.ports.refresh = async () => {
      throw new GrantError("server_error", 503);
    };
    await assert.rejects(() => liveAccessToken(w.ports, "i1"));
    assert.deepEqual(w.log.reconnects, []);
  });

  test("no stored credential throws MissingCredentialError", async () => {
    const w = world({ access_token: null, refresh_token: null, token_expires_at: null });
    await assert.rejects(() => liveAccessToken(w.ports, "i1"), MissingCredentialError);
  });

  test("the on-use window renews a token with four minutes left", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW + 4 * 60_000) });
    assert.ok(4 * 60_000 < ON_USE_REFRESH_WINDOW_MS);
    const r = await liveAccessToken(w.ports, "i1");
    assert.equal(r.refreshed, true);
  });

  test("the proactive window renews a token with 25 minutes left; the on-use window would not", async () => {
    const w = world({ access_token: "at-0", refresh_token: "rt-0", token_expires_at: iso(NOW + 25 * 60_000) });
    const onUse = await liveAccessToken(w.ports, "i1");
    assert.equal(onUse.refreshed, false);
    const sweep = await liveAccessToken(w.ports, "i1", PROACTIVE_REFRESH_WINDOW_MS);
    assert.equal(sweep.refreshed, true);
  });
});

describe("dueForProactiveRefresh (the ten-minute sweep)", () => {
  const base = { status: "HEALTHY", refreshToken: "rt" };
  test("refreshable connections expiring within 30 minutes (or already expired) are due; others are not", () => {
    const due = dueForProactiveRefresh(
      [
        { ...base, integrationId: "cal-soon", providerType: "calendly", tokenExpiresAt: iso(NOW + 20 * 60_000) },
        { ...base, integrationId: "cal-expired", providerType: "calendly", tokenExpiresAt: iso(NOW - 60 * 60_000) },
        { ...base, integrationId: "cal-later", providerType: "calendly", tokenExpiresAt: iso(NOW + 90 * 60_000) },
        { ...base, integrationId: "gcal-soon", providerType: "google_calendar", tokenExpiresAt: iso(NOW + 5 * 60_000) },
        { ...base, integrationId: "slack-soon", providerType: "slack", tokenExpiresAt: iso(NOW + 5 * 60_000) },
        { ...base, integrationId: "no-refresh", providerType: "calendly", refreshToken: null, tokenExpiresAt: iso(NOW + 5 * 60_000) },
        { ...base, integrationId: "gone", providerType: "calendly", status: "DISCONNECTED", tokenExpiresAt: iso(NOW + 5 * 60_000) },
        { ...base, integrationId: "needs-person", providerType: "google_calendar", status: "ACTION_REQUIRED", tokenExpiresAt: iso(NOW - 5 * 60_000) },
      ],
      NOW,
    );
    // Slack joined the sweep on 2026-10-02 (a rotating Slack token carries a
    // refresh token and a 12-hour expiry); see the provider suite.
    assert.deepEqual(due, ["cal-soon", "cal-expired", "gcal-soon", "slack-soon"]);
  });

  test("the sweep runs every ten minutes and renews 30 minutes ahead, so a two-hour token never lapses between sweeps", () => {
    assert.ok(PROACTIVE_REFRESH_WINDOW_MS >= 2 * 10 * 60_000);
  });
});
