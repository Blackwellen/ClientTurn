import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scrubBreadcrumb, scrubSentryEvent, scrubUrl, sentryOptions } from "../src/lib/observability/sentry-scrub.ts";

/**
 * Sentry events obey the logger's redaction rule (docs/OBSERVABILITY.md):
 * no transcript text, phone numbers or email addresses leave the process.
 */

const TRANSCRIPT = "Caller: my number is 07700 900123, email jo@example.co.uk";

function flat(value: unknown): string {
  return JSON.stringify(value);
}

describe("scrubSentryEvent", () => {
  test("strips PII from every channel Sentry can carry it in", () => {
    const event = {
      event_id: "e1",
      message: `Failed for jo@example.co.uk`,
      user: { id: "u-1", email: "owner@agency.co.uk", ip_address: "81.2.69.160", username: "Jo" },
      request: {
        method: "POST",
        url: "https://clientturn.com/api/leads?email=jo@example.co.uk&phone=07700900123",
        headers: { cookie: "sb-access-token=secret", authorization: "Bearer x", "user-agent": "Mozilla/5.0" },
        data: { transcript: TRANSCRIPT },
        cookies: { a: "b" },
        env: { SECRET: "x" },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: `Could not text +44 7700 900123 (${"x".repeat(300)})`,
            stacktrace: { frames: [{ filename: "a.ts", vars: { phone: "07700900123", body: TRANSCRIPT } }] },
          },
        ],
      },
      extra: { transcript: TRANSCRIPT, callId: "3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60", to: "+447700900123" },
      contexts: { os: { name: "Linux" }, lead: { email: "jo@example.co.uk", name: "Jo Bloggs" } },
      tags: { lead_email: "jo@example.co.uk", route: "/api/leads" },
      breadcrumbs: [
        { category: "console", message: TRANSCRIPT },
        { category: "fetch", data: { method: "GET", url: "https://api.example.com/x?email=jo@example.co.uk", status_code: 500, body: TRANSCRIPT } },
        { category: "ui.click", message: "button jo@example.co.uk" },
      ],
    };
    const out = scrubSentryEvent(event);
    const text = flat(out);
    for (const needle of ["jo@example.co.uk", "owner@agency.co.uk", "07700", "7700 900123", "81.2.69.160", "sb-access-token", "Bearer x", "SECRET", "Caller:"]) {
      assert.ok(!text.includes(needle), `leaked: ${needle}`);
    }
    assert.deepEqual(out.user, { id: "u-1" });
    assert.equal(out.request?.url, "https://clientturn.com/api/leads");
    assert.deepEqual(out.request?.headers, { "user-agent": "Mozilla/5.0" });
    assert.equal(out.breadcrumbs.length, 2, "console breadcrumb dropped");
    assert.equal((out.extra as Record<string, unknown>).callId, "3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60", "ids survive");
    assert.deepEqual((out.contexts as Record<string, unknown>).os, { name: "Linux" });
    assert.ok(!("vars" in (out.exception.values[0].stacktrace.frames[0] as object)));
    assert.ok((out.exception.values[0].value as string).length <= 201);
  });

  test("never throws, whatever it is given", () => {
    assert.equal(scrubSentryEvent(null), null);
    assert.equal(scrubSentryEvent("x"), "x");
    const cyclic: Record<string, unknown> = { event_id: "c" };
    cyclic.extra = cyclic;
    assert.doesNotThrow(() => scrubSentryEvent(cyclic));
  });
});

describe("URLs and breadcrumbs", () => {
  test("query strings go and capability tokens in the path are masked; UUIDs stay", () => {
    assert.equal(scrubUrl("https://clientturn.com/q/aZ9kLm2Pq7Rt5Xy8Wv3Nb6Cd?x=1"), "https://clientturn.com/q/[token]");
    assert.equal(
      scrubUrl("/app/leads/3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60#notes"),
      "/app/leads/3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60",
    );
    assert.equal(scrubUrl(undefined), undefined);
  });

  test("navigation breadcrumbs keep only scrubbed from/to", () => {
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/unsubscribe/Ab12Cd34Ef56Gh78Ij90Kl", to: "/app?email=jo@example.co.uk" } });
    assert.deepEqual(crumb?.data, { from: "/unsubscribe/[token]", to: "/app" });
  });
});

describe("sentryOptions", () => {
  test("no default PII, tracing off unless a valid rate is set, the scrubber wired in", () => {
    const options = sentryOptions({ dsn: "https://k@o1.ingest.sentry.io/1", runtime: "nodejs" });
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.beforeSend, scrubSentryEvent);
    assert.equal(sentryOptions({ dsn: "x", runtime: "edge", tracesSampleRate: "0.1" }).tracesSampleRate, 0.1);
    assert.equal(sentryOptions({ dsn: "x", runtime: "edge", tracesSampleRate: "7" }).tracesSampleRate, 0);
  });
});
