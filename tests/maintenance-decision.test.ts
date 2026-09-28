import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyRoute, decideMaintenance, type RouteClass } from "../src/lib/maintenance/routes.ts";
import { maintenancePageHtml, maintenanceResponse, writesPausedText } from "../src/lib/maintenance/response.ts";
import { resolveMaintenance } from "../src/lib/maintenance/schedule.ts";
import type { EffectiveLevel, PublicMaintenanceWindow } from "../src/lib/maintenance/types.ts";

/**
 * The proxy's maintenance decision (docs/MAINTENANCE.md), asserted as a full
 * matrix: every level x every route class x bypass, for reads and writes.
 * The one outcome this file exists to prevent is a provider webhook, the
 * worker, the status page or the admin console being taken down by the
 * switch that was supposed to protect them.
 */

/* ------------------------------------------------------------ classification */

const SAMPLES: Record<RouteClass, string[]> = {
  ADMIN: ["/admin", "/admin/login", "/admin/site", "/admin/customers/abc"],
  STATUS: ["/status"],
  WEBHOOK: ["/api/webhooks/stripe", "/api/webhooks/meta", "/api/webhooks/twilio", "/api/webhooks/payments/stripe/x"],
  CRON: ["/api/cron/worker", "/api/cron/daily"],
  HEALTH: ["/api/health", "/healthz"],
  LEGAL: ["/privacy", "/terms", "/cookies", "/sub-processors", "/data-deletion", "/privacy-request", "/unsubscribe/tok", "/api/unsubscribe/tok"],
  ASSET: ["/robots.txt", "/sitemap.xml", "/favicon.ico", "/_next/static/chunk.js", "/opengraph-image", "/dark_background_logo.png"],
  PLATFORM_UI: ["/api/platform/banners/dismiss"],
  QUOTE: ["/q/abc123", "/q/abc123/sign", "/q/abc123/pdf"],
  AUTH: ["/login", "/forgot-password", "/reset-password", "/verify-email", "/auth/callback", "/api/auth/google/connect"],
  APP: ["/app", "/app/leads", "/app/settings", "/onboarding", "/start-trial", "/signup", "/affiliates/app"],
  APP_API: ["/api/v1/leads", "/api/search", "/api/exports/leads", "/api/integrations/hubspot/connect"],
  MCP: ["/api/mcp"],
  MARKETING: ["/", "/pricing", "/product/follow-up", "/contact-sales", "/help", "/affiliates", "/r/partner", "/api/marketing/track"],
};

describe("route classification", () => {
  for (const [expected, paths] of Object.entries(SAMPLES)) {
    for (const pathname of paths) {
      test(`${pathname} is ${expected}`, () => {
        assert.equal(classifyRoute(pathname), expected);
      });
    }
  }

  test("prefix matching is on path segments, not substrings", () => {
    assert.equal(classifyRoute("/administrator"), "MARKETING");
    assert.equal(classifyRoute("/statuses"), "MARKETING");
    assert.equal(classifyRoute("/apps"), "MARKETING");
    assert.equal(classifyRoute("/application"), "MARKETING");
  });

  test("trailing slashes and case do not change the class", () => {
    assert.equal(classifyRoute("/Admin/"), "ADMIN");
    assert.equal(classifyRoute("/api/webhooks/stripe/"), "WEBHOOK");
  });
});

/* ------------------------------------------------------------------ matrix */

type Expect = "allow" | "offline" | "writes_paused";
const LEVELS: EffectiveLevel[] = ["OFF", "READ_ONLY", "APP_OFFLINE", "SITE_OFFLINE"];

/** Expected [GET, POST] outcome per class per level, without bypass. */
const MATRIX: Record<RouteClass, Record<EffectiveLevel, [Expect, Expect]>> = {
  ADMIN: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  STATUS: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  WEBHOOK: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  CRON: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  HEALTH: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  LEGAL: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  ASSET: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  PLATFORM_UI: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["allow", "allow"], SITE_OFFLINE: ["allow", "allow"] },
  // With the window's default "keep quote pages online" = false here; the
  // configurable exemption is asserted separately below.
  QUOTE: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "writes_paused"], APP_OFFLINE: ["offline", "offline"], SITE_OFFLINE: ["offline", "offline"] },
  AUTH: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["offline", "offline"], SITE_OFFLINE: ["offline", "offline"] },
  APP: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "writes_paused"], APP_OFFLINE: ["offline", "offline"], SITE_OFFLINE: ["offline", "offline"] },
  APP_API: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "writes_paused"], APP_OFFLINE: ["offline", "offline"], SITE_OFFLINE: ["offline", "offline"] },
  MCP: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "allow"], APP_OFFLINE: ["offline", "offline"], SITE_OFFLINE: ["offline", "offline"] },
  MARKETING: { OFF: ["allow", "allow"], READ_ONLY: ["allow", "writes_paused"], APP_OFFLINE: ["allow", "writes_paused"], SITE_OFFLINE: ["offline", "offline"] },
};

/** With a verified platform-admin session: view anything, write through nothing paused. */
function withBypass(cls: RouteClass, level: EffectiveLevel, method: "GET" | "POST", expected: Expect): Expect {
  if (expected !== "offline") return expected;
  if (method === "GET" || cls === "AUTH") return "allow";
  return "writes_paused";
}

describe("every level x route class x method x bypass", () => {
  for (const [cls, byLevel] of Object.entries(MATRIX) as [RouteClass, Record<EffectiveLevel, [Expect, Expect]>][]) {
    const pathname = SAMPLES[cls][0];
    for (const level of LEVELS) {
      (["GET", "POST"] as const).forEach((method, index) => {
        const expected = byLevel[level][index];
        for (const bypass of [false, true]) {
          const want = bypass ? withBypass(cls, level, method, expected) : expected;
          test(`${level} ${method} ${cls}${bypass ? " (admin bypass)" : ""} -> ${want}`, () => {
            const decision = decideMaintenance({ level, pathname, method, keepQuotePagesOnline: false, bypass });
            assert.equal(decision.action, want);
            assert.equal(decision.routeClass, cls);
          });
        }
      });
    }
  }
});

describe("the always-exempt routes, by name", () => {
  const offline = { level: "SITE_OFFLINE" as const, keepQuotePagesOnline: false, bypass: false };
  for (const [pathname, method] of [
    ["/admin/login", "POST"],
    ["/admin/site", "POST"],
    ["/status", "GET"],
    ["/api/webhooks/stripe", "POST"],
    ["/api/webhooks/twilio", "POST"],
    ["/api/webhooks/meta", "POST"],
    ["/api/cron/worker", "POST"],
    ["/api/health", "GET"],
    ["/robots.txt", "GET"],
    ["/privacy", "GET"],
    ["/api/unsubscribe/abc", "POST"],
  ] as const) {
    test(`${method} ${pathname} is untouched even at SITE_OFFLINE`, () => {
      assert.deepEqual(decideMaintenance({ ...offline, pathname, method }).action, "allow");
    });
  }
});

describe("configurable and special cases", () => {
  test("the quote page stays up through an offline level when the window keeps it", () => {
    for (const level of ["APP_OFFLINE", "SITE_OFFLINE"] as const) {
      assert.equal(decideMaintenance({ level, pathname: "/q/tok", method: "GET", keepQuotePagesOnline: true, bypass: false }).action, "allow");
      // Including signing, which is a POST.
      assert.equal(decideMaintenance({ level, pathname: "/q/tok/sign", method: "POST", keepQuotePagesOnline: true, bypass: false }).action, "allow");
    }
  });

  test("the OAuth connect flow writes on GET, so read-only pauses it", () => {
    assert.equal(
      decideMaintenance({ level: "READ_ONLY", pathname: "/api/integrations/hubspot/callback", method: "GET", keepQuotePagesOnline: true, bypass: false }).action,
      "writes_paused",
    );
  });

  test("HEAD and OPTIONS are reads", () => {
    for (const method of ["HEAD", "OPTIONS"]) {
      assert.equal(decideMaintenance({ level: "READ_ONLY", pathname: "/app/leads", method, keepQuotePagesOnline: true, bypass: false }).action, "allow");
    }
  });

  test("PUT, PATCH and DELETE are writes", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      assert.equal(decideMaintenance({ level: "READ_ONLY", pathname: "/api/v1/leads/1", method, keepQuotePagesOnline: true, bypass: false }).action, "writes_paused");
    }
  });
});

/* ---------------------------------------------------------------- response */

const WINDOW: PublicMaintenanceWindow = {
  id: "11111111-1111-4111-8111-111111111111",
  level: "SITE_OFFLINE",
  startsAt: "2026-10-01T09:00:00.000Z",
  endsAt: "2026-10-01T11:00:00.000Z",
  expectedBackAt: null,
  message: "Database upgrade <script>alert(1)</script>",
  keepQuotePagesOnline: true,
  keepAutomationRunning: false,
  announceBanner: true,
};
const NOW = new Date("2026-10-01T10:00:00.000Z");
const STATUS = resolveMaintenance([WINDOW], NOW);

describe("the 503 response", () => {
  const offline = { action: "offline" as const, routeClass: "MARKETING" as const };

  test("a browser gets the maintenance page as a 503 with Retry-After, no-store and noindex", () => {
    const spec = maintenanceResponse({ decision: offline, status: STATUS, now: NOW, method: "GET", isServerAction: false, acceptsHtml: true });
    assert.equal(spec.status, 503);
    assert.equal(spec.headers["Retry-After"], "3600");
    assert.match(spec.headers["Cache-Control"], /no-store/);
    assert.match(spec.headers["X-Robots-Tag"], /noindex/);
    assert.match(spec.headers["Content-Type"], /^text\/html/);
    assert.match(spec.body ?? "", /<meta name="robots" content="noindex, nofollow">/);
    assert.match(spec.body ?? "", /planned maintenance/i);
    assert.match(spec.body ?? "", /href="\/status"/);
  });

  test("the operator's message is escaped, never rendered as HTML", () => {
    const html = maintenancePageHtml({ status: STATUS, kind: "offline" });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test("a Server Action gets text/plain exactly, so Next shows the sentence", () => {
    const spec = maintenanceResponse({
      decision: { action: "writes_paused", routeClass: "APP" },
      status: STATUS,
      now: NOW,
      method: "POST",
      isServerAction: true,
      acceptsHtml: true,
    });
    assert.equal(spec.status, 503);
    assert.equal(spec.headers["Content-Type"], "text/plain");
    assert.equal(spec.body, writesPausedText(STATUS));
    assert.match(spec.body ?? "", /changes are paused/);
  });

  test("an API client gets JSON it can branch on", () => {
    const spec = maintenanceResponse({
      decision: { action: "writes_paused", routeClass: "APP_API" },
      status: STATUS,
      now: NOW,
      method: "POST",
      isServerAction: false,
      acceptsHtml: false,
    });
    const body = JSON.parse(spec.body ?? "{}");
    assert.equal(body.error.code, "maintenance_read_only");
    assert.equal(body.error.retry_after_seconds, 3600);
    assert.equal(body.error.expected_back_at, WINDOW.endsAt);
  });

  test("HEAD gets the headers and no body", () => {
    const spec = maintenanceResponse({ decision: offline, status: STATUS, now: NOW, method: "HEAD", isServerAction: false, acceptsHtml: true });
    assert.equal(spec.status, 503);
    assert.equal(spec.body, null);
    assert.ok(spec.headers["Retry-After"]);
  });
});
