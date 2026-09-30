import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Regressions from the Settings / Analytics / Support surface QA (2026-09-30).
 * Runs under the g3 resolver (server code, `server-only`, `@/` aliases).
 */
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("R2 signed URLs", () => {
  let r2: typeof import("../src/lib/storage/r2.ts");
  before(async () => {
    // serverEnv reads these at import; fake values, nothing is contacted.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
    process.env.STRIPE_SECRET_KEY_TEST ??= "sk_test_dummy";
    process.env.R2_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID = "test-access";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET = "test-bucket";
    r2 = await import("../src/lib/storage/r2.ts");
  });

  test("a presigned PUT carries no checksum of an empty body", async () => {
    // SDK >= 3.729 signed x-amz-checksum-crc32=AAAAAA== (CRC32 of nothing)
    // into every presigned PutObject, so the browser's real upload failed.
    const url = await r2.createUploadUrl("logo/00000000-0000-4000-8000-000000000000/a.png", "image/png", 60, 1234);
    assert.doesNotMatch(url, /x-amz-checksum|x-amz-sdk-checksum-algorithm/i);
    assert.match(url, /X-Amz-SignedHeaders=content-length/);
  });

  test("support downloads that are not raster images are forced to download", async () => {
    const pdf = await r2.createDownloadUrl("support/b/x-report.pdf", 60, { forceDownload: true });
    assert.match(pdf, /response-content-disposition=attachment/);
    const png = await r2.createDownloadUrl("support/b/x-shot.png", 60);
    assert.doesNotMatch(png, /response-content-disposition/);
  });

  test("inline-safe keys are raster images only", () => {
    assert.equal(r2.isInlineSafeImageKey("support/b/a.PNG"), true);
    assert.equal(r2.isInlineSafeImageKey("support/b/a.jpeg"), true);
    for (const key of ["a.pdf", "a.txt", "a.csv", "a.log", "a.svg", "a.png.html"]) {
      assert.equal(r2.isInlineSafeImageKey(key), false, key);
    }
  });
});

describe("server-side guards added in the QA pass", () => {
  const settings = read("src/lib/settings/actions.ts");

  function body(name: string) {
    const start = settings.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    return settings.slice(start, settings.indexOf("\nexport ", start + 10));
  }

  test("connection changes use the integrations capability, not the admin role", () => {
    for (const name of ["connectProviderToken", "disconnectIntegration", "refreshConnectionHealth"]) {
      const fn = body(name);
      assert.match(fn, /requireIntegrationManager\(\)/, name);
      assert.doesNotMatch(fn, /requireSettingsAdmin\(\)/, name);
    }
  });

  test("a pasted provider token is bounded", () => {
    assert.match(body("connectProviderToken"), /trimmedToken\.length > 512/);
  });

  test("changing password is rate limited before the current password is checked", () => {
    const fn = body("changePassword");
    assert.ok(fn.indexOf('checkRateLimit("auth:password_change"') < fn.indexOf("signInWithPassword"));
  });

  test("support upload URLs are rate limited per user", () => {
    assert.match(read("src/lib/support/actions.ts"), /checkRateLimit\("support:upload", workspace\.userId\)/);
  });

  test("support downloads force a download for anything but a raster image", () => {
    assert.match(read("src/lib/support/actions.ts"), /forceDownload: !isInlineSafeImageKey\(data\.storage_key\)/);
  });

  test("an API key's expiry is one of the offered choices", () => {
    const actions = read("src/lib/api-keys/actions.ts");
    assert.match(actions, /expiry: z\s*\.enum\(API_KEY_EXPIRY_OPTIONS/);
    assert.doesNotMatch(actions, /expiry: z\.string\(\)/);
  });

  test("a rejected logo file says what is allowed, not that uploads are down", () => {
    const fn = body("createLogoUploadUrl");
    assert.match(fn, /Choose a PNG, JPG or WebP image up to 10MB/);
  });
});

describe("rendering fixes", () => {
  test("funnel bars use colour tokens that exist", () => {
    const css = read("src/app/globals.css");
    const cards = read("src/components/analytics/cards.tsx");
    const tones = cards.slice(cards.indexOf("const FUNNEL_TONES"), cards.indexOf("];", cards.indexOf("const FUNNEL_TONES")));
    const classes = [...tones.matchAll(/"bg-([a-z]+-\d+)"/g)].map((m) => m[1]);
    assert.ok(classes.length >= 5);
    for (const token of classes) {
      assert.ok(css.includes(`--color-${token}:`), `--color-${token} is not defined`);
    }
  });

  test("timezone labels are computed on the server for the workspace select", () => {
    assert.match(read("src/app/(app)/app/settings/_sections/workspace-section.tsx"), /timezoneLabels=\{Object\.fromEntries\(TIMEZONES\.map/);
    assert.match(read("src/components/settings/workspace/business-identity-card.tsx"), /timezoneLabels\?\.\[zone\] \?\? timezoneLabel\(zone\)/);
  });
});
