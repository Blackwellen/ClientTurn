import { test, describe, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeDb, installFakeFetch, table, type FakeDb } from "./fixtures/fake-postgrest.ts";
import {
  OAuthRefreshError,
  classifyPing,
  pingSpec,
  refreshNeedsReconnect,
  zohoScopeOutdated,
} from "../src/lib/integrations/oauth-health.ts";

/**
 * Gap audit 15 #9: a revoked grant must flip the connection to Reconnect
 * (ACTION_REQUIRED, notification, banner), and the health check must make a
 * real authenticated call where one is cheap. The token endpoint is faked;
 * no provider is called.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_never_used";

const db: FakeDb = createFakeDb();
const restore = installFakeFetch(db);
const postgrest = globalThis.fetch;
let tokenReply: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://oauth.example.test/")) {
    return new Response(JSON.stringify(tokenReply.body), {
      status: tokenReply.status,
      headers: { "content-type": "application/json" },
    });
  }
  return postgrest(input, init);
}) as typeof fetch;
after(() => restore());

const oauth = await import("../src/lib/integrations/oauth.ts");

const CONFIG = {
  clientId: "id",
  clientSecret: "secret",
  authorizeUrl: "https://oauth.example.test/authorize",
  tokenUrl: "https://oauth.example.test/token",
  scopes: [],
  redirectUri: "https://app.example.test/cb",
} as never;

const INTEGRATION = "11111111-0000-4000-8000-000000000001";
const BIZ = "11111111-0000-4000-8000-000000000002";

beforeEach(() => {
  db.tables.clear();
  table(db, "integrations").push({
    id: INTEGRATION,
    business_id: BIZ,
    provider_type: "google_calendar",
    status: "HEALTHY",
    last_error_code: null,
  });
  table(db, "integration_secrets").push({
    integration_id: INTEGRATION,
    business_id: BIZ,
    access_token: "old",
    refresh_token: "refresh-1",
    token_expires_at: new Date(Date.now() - 1000).toISOString(),
  });
});

describe("refresh failures", () => {
  test("invalid_grant flips the connection to Reconnect and queues one notification", async () => {
    tokenReply = { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
    await assert.rejects(oauth.getLiveAccessToken(INTEGRATION, CONFIG), (error: unknown) => {
      assert.ok(error instanceof OAuthRefreshError);
      assert.equal((error as OAuthRefreshError).needsReconnect, true);
      return true;
    });
    const row = table(db, "integrations")[0];
    assert.equal(row.status, "ACTION_REQUIRED");
    assert.equal(row.last_error_code, "reconnect_required");
    const jobs = table(db, "jobs").filter((j) => j.type === "notification.send" || j.job_type === "notification.send" || JSON.stringify(j).includes("integration_failure"));
    assert.equal(jobs.length, 1, "one reconnect notification");

    // A second failure is idempotent: no second notification.
    await assert.rejects(oauth.getLiveAccessToken(INTEGRATION, CONFIG));
    const again = table(db, "jobs").filter((j) => JSON.stringify(j).includes("integration_failure"));
    assert.equal(again.length, 1);
  });

  test("Zoho's HTTP 200 with an error body is a failure, not an empty token", async () => {
    tokenReply = { status: 200, body: { error: "invalid_code" } };
    await assert.rejects(oauth.getLiveAccessToken(INTEGRATION, CONFIG));
    assert.equal(table(db, "integrations")[0].status, "ACTION_REQUIRED");
  });

  test("a 503 from the token endpoint is a blip: the status is unchanged", async () => {
    tokenReply = { status: 503, body: {} };
    await assert.rejects(oauth.getLiveAccessToken(INTEGRATION, CONFIG), (error: unknown) => {
      assert.equal((error as OAuthRefreshError).needsReconnect, false);
      return true;
    });
    assert.equal(table(db, "integrations")[0].status, "HEALTHY");
  });

  test("a good refresh stores the new token", async () => {
    tokenReply = { status: 200, body: { access_token: "new", expires_in: 3600 } };
    assert.equal(await oauth.getLiveAccessToken(INTEGRATION, CONFIG), "new");
    assert.equal(table(db, "integration_secrets")[0].access_token, "new");
  });
});

describe("pure rules", () => {
  test("which refresh errors need a person", () => {
    assert.equal(refreshNeedsReconnect(400, "invalid_grant"), true);
    assert.equal(refreshNeedsReconnect(401, "invalid_client"), true);
    assert.equal(refreshNeedsReconnect(500, null), false);
    assert.equal(refreshNeedsReconnect(429, null), false);
  });

  test("pings are authenticated GETs to cheap endpoints", () => {
    const g = pingSpec("google_calendar", "tok");
    assert.ok(g && g.url.includes("maxResults=1"));
    assert.equal(g!.headers.authorization, "Bearer tok");
    assert.ok(pingSpec("calendly", "t")?.url.endsWith("/users/me"));
    assert.ok(pingSpec("hubspot", "t")?.url.includes("limit=1"));
    assert.equal(pingSpec("zoho_crm", "t", { apiDomain: "https://www.zohoapis.eu" })!.headers.authorization, "Zoho-oauthtoken t");
    assert.equal(pingSpec("zoho_crm", "t", { apiDomain: "javascript:alert(1)" }), null);
    assert.ok(pingSpec("salesforce", "t", { instanceUrl: "https://acme.my.salesforce.com" })?.url.endsWith("/limits"));
    assert.equal(pingSpec("google_ads", "t"), null, "no cheap call without a developer token");
  });

  test("ping verdicts", () => {
    assert.equal(classifyPing(200), "ok");
    assert.equal(classifyPing(401), "reconnect");
    assert.equal(classifyPing(403), "reconnect");
    assert.equal(classifyPing(503), "degraded");
    assert.equal(classifyPing(429), "degraded");
  });

  test("Zoho connections made before the UPDATE-scope fix are flagged", () => {
    assert.equal(zohoScopeOutdated(["ZohoCRM.modules.leads.CREATE", "ZohoCRM.modules.leads.READ"]), true);
    assert.equal(zohoScopeOutdated([]), true);
    assert.equal(
      zohoScopeOutdated(["ZohoCRM.modules.leads.CREATE", "ZohoCRM.modules.leads.READ", "ZohoCRM.modules.leads.UPDATE"]),
      false,
    );
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("the health job pings and prompts Zoho reconnects", () => {
    const health = read("src/lib/jobs/handlers/integration-health.ts");
    assert.match(health, /pingSpec\(/);
    assert.match(health, /zohoScopeOutdated\(/);
  });

  test("direct refresh callers pass the integration id", () => {
    assert.match(read("src/lib/integrations/providers/zoho-crm.ts"), /refreshAccessToken\([^)]*\{ integrationId \}\)/);
    assert.match(read("src/lib/integrations/providers/salesforce.ts"), /refreshAccessToken\([^)]*\{ integrationId \}\)/);
  });

  test("the app shell renders a Reconnect banner", () => {
    assert.match(read("src/app/(app)/layout.tsx"), /reconnect=\{health\.reconnect\}/);
    assert.match(read("src/components/site/app-notices.tsx"), /Reconnect /);
  });
});
