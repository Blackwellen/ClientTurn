import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Maintenance enforcement in the real server code (run with
 * scripts/e2e-resolver.mjs so `@/` imports resolve):
 *
 *   * READ_ONLY is refused inside `runOperation`, for every caller a person
 *     drives, before the handler or the audit log is touched;
 *   * the proxy gate returns 503 + Retry-After + noindex for an offline page,
 *     and never touches a provider webhook, the cron worker or /status.
 *
 * No database and no network: the maintenance state is primed in the
 * module cache, and every assertion stops before any I/O would happen.
 */

// env.ts refuses to load without its required variables. None is used here:
// every path under test returns before a client is created.
function primeEnv() {
  const source = readFileSync(path.join(process.cwd(), "src/lib/env.ts"), "utf8");
  for (const [, name] of source.matchAll(/required\("([A-Z0-9_]+)"\)/g)) {
    if (!process.env[name]) process.env[name] = name.includes("STRIPE_SECRET") ? "sk_test_placeholder" : "placeholder";
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:9";
  delete process.env.MAINTENANCE_OVERRIDE_LEVEL;
}

type State = typeof import("../src/lib/maintenance/state.ts");
type Runtime = typeof import("../src/lib/services/runtime.ts");
type Gate = typeof import("../src/lib/maintenance/proxy-gate.ts");

let state: State;
let runtime: Runtime;
let gate: Gate;
let NextRequest: typeof import("next/server").NextRequest;
let NextResponse: typeof import("next/server").NextResponse;

const WINDOW = {
  id: "33333333-3333-4333-8333-333333333333",
  startsAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  expectedBackAt: null,
  message: null,
  keepQuotePagesOnline: true,
  keepAutomationRunning: false,
  announceBanner: true,
};

function setLevel(level: "OFF" | "READ_ONLY" | "APP_OFFLINE" | "SITE_OFFLINE") {
  state.primeMaintenanceCache(level === "OFF" ? [] : [{ ...WINDOW, level }]);
}

const context = (caller: "UI" | "COPILOT" | "MCP" | "API" | "AGENT" | "SYSTEM") => ({
  businessId: "44444444-4444-4444-8444-444444444444",
  userId: caller === "SYSTEM" ? null : "55555555-5555-4555-8555-555555555555",
  role: "owner" as const,
  caller,
  correlationId: "test",
});

before(async () => {
  primeEnv();
  state = await import("../src/lib/maintenance/state.ts");
  runtime = await import("../src/lib/services/runtime.ts");
  gate = await import("../src/lib/maintenance/proxy-gate.ts");
  ({ NextRequest, NextResponse } = await import("next/server"));
});

describe("READ_ONLY blocks mutations at runOperation", () => {
  beforeEach(() => setLevel("READ_ONLY"));

  for (const caller of ["UI", "COPILOT", "MCP", "API"] as const) {
    test(`a ${caller} write is refused with the friendly message`, async () => {
      const result = await runtime.runOperation("lead.update", { leadId: "x" }, context(caller));
      assert.equal(result.success, false);
      assert.equal(!result.success && result.code, "UNAVAILABLE");
      assert.match(!result.success ? result.message : "", /in maintenance, so changes are paused/);
    });
  }

  test("every offline level blocks writes too (levels are cumulative)", async () => {
    for (const level of ["APP_OFFLINE", "SITE_OFFLINE"] as const) {
      setLevel(level);
      const result = await runtime.runOperation("lead.update", {}, context("MCP"));
      assert.match(!result.success ? result.message : "", /changes are paused/);
    }
  });

  test("the worker's own work passes the maintenance check (SYSTEM and AGENT)", async () => {
    for (const caller of ["SYSTEM", "AGENT"] as const) {
      const result = await runtime.runOperation("lead.update", {}, context(caller));
      // No handlers are registered in this test, so it reaches the lookup
      // after the maintenance check: proof it was not refused by maintenance.
      assert.doesNotMatch(!result.success ? result.message : "", /changes are paused/);
    }
  });

  test("reads are never refused", async () => {
    const result = await runtime.runOperation("lead.get", {}, context("UI"));
    assert.doesNotMatch(!result.success ? result.message : "", /changes are paused/);
  });

  test("with maintenance OFF a write is not refused by maintenance", async () => {
    setLevel("OFF");
    const result = await runtime.runOperation("lead.update", {}, context("UI"));
    assert.doesNotMatch(!result.success ? result.message : "", /changes are paused/);
  });
});

describe("the proxy gate", () => {
  const noSession = async () => {
    throw new Error("the session must not be read for a visitor without a session cookie");
  };

  test("SITE_OFFLINE: a page is a 503 with Retry-After, no-store and noindex", async () => {
    setLevel("SITE_OFFLINE");
    const response = await gate.maintenanceGate(
      new NextRequest("https://clientturn.com/pricing", { headers: { accept: "text/html" } }),
      noSession,
    );
    assert.ok(response);
    assert.equal(response.status, 503);
    const retry = Number(response.headers.get("retry-after"));
    assert.ok(retry >= 60 && retry <= 3600, `Retry-After ${retry}`);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(await response.text(), /planned maintenance/i);
  });

  for (const [url, method] of [
    ["https://clientturn.com/api/webhooks/stripe", "POST"],
    ["https://clientturn.com/api/webhooks/twilio", "POST"],
    ["https://clientturn.com/api/webhooks/meta", "POST"],
    ["https://clientturn.com/api/cron/worker", "POST"],
    ["https://clientturn.com/status", "GET"],
    ["https://clientturn.com/admin/login", "POST"],
  ] as const) {
    test(`webhooks, cron, status and admin are still accepted at SITE_OFFLINE: ${method} ${new URL(url).pathname}`, async () => {
      setLevel("SITE_OFFLINE");
      const response = await gate.maintenanceGate(new NextRequest(url, { method, body: method === "POST" ? "{}" : undefined }), noSession);
      assert.equal(response, null);
    });
  }

  test("READ_ONLY: a Server Action gets text/plain 503; the page itself loads", async () => {
    setLevel("READ_ONLY");
    const action = await gate.maintenanceGate(
      new NextRequest("https://clientturn.com/app/leads", { method: "POST", headers: { "next-action": "abc" }, body: "[]" }),
      noSession,
    );
    assert.equal(action?.status, 503);
    assert.equal(action?.headers.get("content-type"), "text/plain");
    assert.match((await action?.text()) ?? "", /changes are paused/);

    const page = await gate.maintenanceGate(new NextRequest("https://clientturn.com/app/leads"), noSession);
    assert.equal(page, null);
  });

  test("the admin bypass lets a verified platform admin preview an offline page", async () => {
    setLevel("APP_OFFLINE");
    let refreshed = 0;
    const refresh = async () => {
      refreshed += 1;
      return {
        response: NextResponse.next(),
        userId: "66666666-6666-4666-8666-666666666666",
        supabase: {
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { platform_role: "platform_admin" } }) }) }),
          }),
        } as never,
      };
    };
    const request = new NextRequest("https://clientturn.com/app", {
      headers: { accept: "text/html", cookie: "sb-project-auth-token=abc" },
    });
    const response = await gate.maintenanceGate(request, refresh);
    assert.equal(refreshed, 1);
    assert.ok(response);
    assert.notEqual(response.status, 503);
    assert.equal(response.cookies.get("ct-maintenance-bypass")?.value, "APP_OFFLINE");
  });

  test("a signed-in customer is not bypassed", async () => {
    setLevel("APP_OFFLINE");
    const refresh = async () => ({
      response: NextResponse.next(),
      userId: "77777777-7777-4777-8777-777777777777",
      supabase: {
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { platform_role: "user" } }) }) }) }),
      } as never,
    });
    const response = await gate.maintenanceGate(
      new NextRequest("https://clientturn.com/app", { headers: { accept: "text/html", cookie: "sb-project-auth-token=abc" } }),
      refresh,
    );
    assert.equal(response?.status, 503);
  });

  test("OFF costs nothing: no session read, no response", async () => {
    setLevel("OFF");
    assert.equal(await gate.maintenanceGate(new NextRequest("https://clientturn.com/app"), noSession), null);
  });
});

describe("webhook handlers themselves know nothing about maintenance", () => {
  // The guarantee "webhooks are still accepted" must not depend on each
  // handler remembering an exemption: none of them reads maintenance at all.
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }
  for (const file of walk(path.join(process.cwd(), "src/app/api/webhooks")).filter((f) => f.endsWith(".ts"))) {
    test(path.relative(process.cwd(), file).replace(/\\/g, "/"), () => {
      assert.doesNotMatch(readFileSync(file, "utf8"), /maintenance\/(state|routes|proxy-gate)/);
    });
  }
});
