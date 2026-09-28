import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createFakeDb, installFakeFetch, type FakeDb } from "./fixtures/fake-postgrest.ts";
import { isSameOriginRequest } from "../src/lib/security/same-origin.ts";

/**
 * Gap audit 15 §3, batch 3: the rate limiter fails closed for credentials,
 * SVG logos are refused, the banner-dismiss endpoint requires an origin,
 * search and exports are rate limited, and the dead bookings helpers are gone.
 * Supabase is the in-memory fake; nothing leaves the process.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_never_used";

const db: FakeDb = createFakeDb();
const restore = installFakeFetch(db);
after(() => restore());

const rateLimit = await import("../src/lib/security/rate-limit.ts");
const r2 = await import("../src/lib/storage/r2.ts");

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("rate limiter: fail closed for credentials only", () => {
  test("credential buckets refuse when the limiter cannot answer", async () => {
    // The fake has no `consume_rate_limit` RPC, so every call errors.
    for (const key of ["auth:signin", "auth:signup", "auth:reset", "admin:signin", "admin:stepup"] as const) {
      const result = await rateLimit.checkRateLimit(key, "203.0.113.9");
      assert.equal(result.allowed, false, key);
      assert.ok(result.retryAfterSeconds > 0);
    }
  });

  test("other buckets still fail open", async () => {
    for (const key of ["marketing:track", "webhook:inbound", "app:search"] as const) {
      assert.equal((await rateLimit.checkRateLimit(key, "x")).allowed, true, key);
    }
  });

  test("a working limiter is obeyed either way", async () => {
    db.rpcs.set("consume_rate_limit", () => [{ allowed: true, remaining: 3, retry_after: 0 }]);
    assert.equal((await rateLimit.checkRateLimit("auth:signin", "x")).allowed, true);
    db.rpcs.set("consume_rate_limit", () => [{ allowed: false, remaining: 0, retry_after: 60 }]);
    assert.equal((await rateLimit.checkRateLimit("marketing:track", "x")).allowed, false);
    db.rpcs.delete("consume_rate_limit");
  });

  test("tooManyRequests carries Retry-After", () => {
    const response = rateLimit.tooManyRequests({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "42");
  });
});

describe("logo uploads", () => {
  test("SVG is refused; raster formats are accepted", () => {
    assert.throws(() => r2.assertUploadAllowed("logo", "image/svg+xml", 1000), /not allowed/);
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      assert.doesNotThrow(() => r2.assertUploadAllowed("logo", type, 1000));
    }
  });

  test("an old SVG key downloads as an attachment", () => {
    assert.equal(r2.isSvgKey("logo/biz/uuid-brand.svg"), true);
    assert.equal(r2.isSvgKey("logo/biz/uuid-brand.png"), false);
    assert.match(read("src/lib/storage/r2.ts"), /ResponseContentDisposition: "attachment"/);
  });

  test("the uploader no longer offers SVG", () => {
    assert.ok(!read("src/components/settings/workspace/logo-uploader.tsx").includes("svg+xml"));
  });
});

describe("same-origin check (banner dismiss)", () => {
  const h = (values: Record<string, string>) => new Headers(values);
  const allowed = ["https://app.clientturn.com"];

  test("a missing Origin and Referer is refused", () => {
    assert.equal(isSameOriginRequest(h({}), allowed), false);
  });

  test("the right Origin is accepted", () => {
    assert.equal(isSameOriginRequest(h({ origin: "https://app.clientturn.com", "sec-fetch-site": "same-origin" }), allowed), true);
  });

  test("a cross-site Origin or Sec-Fetch-Site is refused", () => {
    assert.equal(isSameOriginRequest(h({ origin: "https://evil.example" }), allowed), false);
    assert.equal(isSameOriginRequest(h({ origin: "https://app.clientturn.com", "sec-fetch-site": "cross-site" }), allowed), false);
    assert.equal(isSameOriginRequest(h({ origin: "null" }), allowed), false);
  });

  test("Referer is the fallback when Origin is stripped", () => {
    assert.equal(isSameOriginRequest(h({ referer: "https://app.clientturn.com/app" }), allowed), true);
    assert.equal(isSameOriginRequest(h({ referer: "https://evil.example/x" }), allowed), false);
  });

  test("the route uses it", () => {
    assert.match(read("src/app/api/platform/banners/dismiss/route.ts"), /isSameOriginRequest\(/);
  });
});

describe("search and export limits", () => {
  test("search is rate limited per user", () => {
    assert.match(read("src/app/api/search/route.ts"), /checkRateLimit\("app:search", workspace\.userId\)/);
  });

  test("every export is rate limited per user and row-capped", () => {
    for (const name of ["attribution", "leads", "prospects"]) {
      assert.match(read(`src/app/api/exports/${name}/route.ts`), /checkRateLimit\("app:export", workspace\.userId\)/, name);
    }
    assert.match(read("src/app/api/exports/attribution/route.ts"), /\.slice\(0, MAX_ROWS\)/);
  });
});

describe("dead bookings code", () => {
  test("the /app/bookings helpers are gone and the route does not exist", () => {
    assert.ok(!read("src/lib/bookings/types.ts").includes("bookingsHref"));
    assert.ok(!read("src/lib/bookings/actions.ts").includes('"/app/bookings"'));
    assert.equal(existsSync(new URL("../src/app/(app)/app/bookings", import.meta.url)), false);
  });
});
