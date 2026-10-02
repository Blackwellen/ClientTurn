/**
 * Calendly scoped permissions (2026-09-30): the owner workspace's token was
 * migrated to the app's narrow scopes on refresh, and availability then got
 * 403 "Insufficient scope" while the connection card still said Healthy.
 *
 * - We ask for exactly the scopes the endpoints we call need.
 * - A 403 "Insufficient scope" reads as "Reconnect Calendly to grant access".
 * - The health ping proves event_types:read, not only that the token works.
 * - Availability goes through the refresh-aware accessor (source check).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALENDLY_SCOPES, CALENDLY_SCOPE_MISSING, isInsufficientScope, pingSpec, classifyPing } from "../src/lib/integrations/oauth-health.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Calendly scopes", () => {
  test("exactly one scope per endpoint family the product calls", () => {
    assert.deepEqual([...CALENDLY_SCOPES].sort(), ["event_types:read", "scheduled_events:read", "users:read", "webhooks:write"]);
  });

  test("every Calendly endpoint in the code maps to a requested scope", () => {
    const needs: Record<string, string> = {
      "/users/me": "users:read",
      "/event_type_available_times": "event_types:read",
      "/event_types": "event_types:read",
      "/webhook_subscriptions": "webhooks:write",
    };
    const code = [
      src("src/lib/integrations/providers/calendly.ts"),
      src("src/lib/agent/availability/index.ts"),
      src("src/lib/integrations/oauth-health.ts"),
    ].join("\n");
    for (const [path, scope] of Object.entries(needs)) {
      if (code.includes(path)) assert.ok((CALENDLY_SCOPES as readonly string[]).includes(scope), `${path} needs ${scope}`);
    }
    // invitee.created / invitee.canceled payloads need scheduled_events:read.
    assert.match(src("src/lib/integrations/providers/calendly.ts"), /invitee\.created/);
    assert.ok((CALENDLY_SCOPES as readonly string[]).includes("scheduled_events:read"));
  });

  test("the OAuth config requests them, space separated, instead of an empty scope", () => {
    const calendly = src("src/lib/integrations/providers/calendly.ts");
    assert.match(calendly, /scope: CALENDLY_SCOPES\.join\(" "\)/);
    assert.doesNotMatch(calendly, /scope: "",/);
  });
});

describe("Insufficient scope reads as Reconnect", () => {
  const body = { title: "Insufficient scope", message: "This operation requires the scopes listed in the 'required_scopes' array.", required_scopes: ["event_types:read"] };
  test("Calendly's 403 shape is recognised", () => {
    assert.equal(isInsufficientScope(403, body), true);
    assert.equal(isInsufficientScope(403, { required_scopes: ["x"] }), true);
  });
  test("other failures are not mistaken for it", () => {
    assert.equal(isInsufficientScope(403, { title: "Permission Denied" }), false);
    assert.equal(isInsufficientScope(401, body), false);
    assert.equal(isInsufficientScope(403, null), false);
  });
  test("the copy tells the owner what to do", () => {
    assert.equal(CALENDLY_SCOPE_MISSING.status, "ACTION_REQUIRED");
    assert.match(CALENDLY_SCOPE_MISSING.message, /^Reconnect Calendly to grant access/);
    assert.equal(classifyPing(403), "reconnect");
  });
  test("the health check and availability both use it", () => {
    assert.match(src("src/lib/jobs/handlers/integration-health.ts"), /isInsufficientScope\(response\.status, body\)/);
    assert.match(src("src/lib/agent/availability/index.ts"), /isInsufficientScope\(response\.status, body\)/);
  });
});

describe("Calendly health ping proves the scope availability needs", () => {
  test("with the organisation known, the ping reads one event type", () => {
    const spec = pingSpec("calendly", "t", { calendlyOrganizationUri: "https://api.calendly.com/organizations/7f3b39fc-7048-4061-86b9-c97e107dd501" });
    assert.ok(spec?.url.startsWith("https://api.calendly.com/event_types?organization="));
    assert.ok(spec?.url.endsWith("&count=1"));
  });
  test("an organisation URI that is not Calendly's is never fetched", () => {
    assert.ok(pingSpec("calendly", "t", { calendlyOrganizationUri: "https://evil.example/organizations/x" })?.url.endsWith("/users/me"));
  });
});

describe("availability uses the refresh-aware token", () => {
  test("calendlyAvailableSlots no longer reads access_token from the row", () => {
    const a = src("src/lib/agent/availability/index.ts");
    const fn = a.slice(a.indexOf("async function calendlyAvailableSlots"), a.indexOf("// ---------------------------------------------------------------- resolver"));
    assert.match(fn, /getLiveAccessToken\(integrationId, config\)/);
    assert.doesNotMatch(fn, /select\("access_token"\)/);
  });
  test("the worker tick queues the proactive token refresh", () => {
    assert.match(src("src/app/api/cron/worker/route.ts"), /scheduleIntegrationTokenRefresh\(\)/);
    assert.match(src("src/lib/jobs/register.ts"), /registerHandler\("integration\.token_refresh"/);
  });
});
