/**
 * Wave 5 (admin + affiliate surface QA, 2026-09-30) regressions.
 *
 * 1. Storage readiness: Admin → System → Readiness had no signal for the R2
 *    bucket, so a wrong bucket name or a key without access surfaced only as a
 *    failed customer upload. The probe is one read-only HeadBucket and its
 *    result must never carry the bucket name, endpoint or provider message.
 * 2. WhatsApp template sync: `GET content.twilio.com/v1/ContentAndApprovals`
 *    answered 401 because it authenticated `SK…` (API key SID) with the
 *    account auth token. It shares `twilioCredentials()` with SMS, so it must
 *    pair the key SID with the key secret.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";
process.env.STRIPE_SECRET_KEY_TEST ??= "sk_test_placeholder";
// Twilio as production has it: AC account SID, SK API key, both secrets.
process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000001";
process.env.TWILIO_API_KEY_SID = "SK00000000000000000000000000000002";
process.env.TWILIO_AUTH_TOKEN = "account-auth-token";
process.env.TWILIO_API_KEY_SECRET = "api-key-secret";
process.env.TWILIO_SMS_FROM = "+447000000000";
delete process.env.TWILIO_SID;

import {
  classifyStorageError,
  probeStorageBucket,
  storageReadiness,
} from "../src/lib/storage/r2-health.ts";

const root = path.resolve(import.meta.dirname, "..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("storage readiness probe", () => {
  test("not configured never calls the provider", async () => {
    let called = false;
    const result = await probeStorageBucket({
      configured: false,
      head: async () => {
        called = true;
      },
    });
    assert.equal(result.state, "NOT_CONFIGURED");
    assert.equal(called, false);
  });

  test("a bucket that answers is OK", async () => {
    const result = await probeStorageBucket({ configured: true, head: async () => ({}) });
    assert.deepEqual(result, { state: "OK", httpStatus: 200 });
  });

  test("404 is bucket not found, 403/401 access denied, anything else unreachable", () => {
    assert.equal(
      classifyStorageError({ name: "NotFound", $metadata: { httpStatusCode: 404 } }).state,
      "BUCKET_NOT_FOUND",
    );
    assert.equal(
      classifyStorageError({ name: "Forbidden", $metadata: { httpStatusCode: 403 } }).state,
      "ACCESS_DENIED",
    );
    assert.equal(classifyStorageError({ $metadata: { httpStatusCode: 401 } }).state, "ACCESS_DENIED");
    assert.equal(classifyStorageError(new Error("ECONNRESET")).state, "UNREACHABLE");
    assert.equal(classifyStorageError(undefined).state, "UNREACHABLE");
  });

  test("a hanging endpoint times out instead of hanging the page", async () => {
    const result = await probeStorageBucket({
      configured: true,
      head: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    assert.equal(result.state, "UNREACHABLE");
  });

  test("the readiness row never carries the provider's error text, bucket or endpoint", async () => {
    const secretish = "https://acc123.r2.cloudflarestorage.com/leadrecover AKIASECRET";
    const result = await probeStorageBucket({
      configured: true,
      head: async () => {
        throw Object.assign(new Error(secretish), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      },
    });
    const row = storageReadiness(result, { credentialsSet: true, bucketNamed: true });
    assert.equal(row.state, "BLOCKED");
    assert.match(row.detail, /Bucket not found/);
    const text = JSON.stringify({ result, row });
    for (const needle of ["r2.cloudflarestorage", "leadrecover", "AKIA", "acc123"]) {
      assert.ok(!text.includes(needle), `leaked ${needle}`);
    }
  });

  test("each state reads as an operator would need it", () => {
    const cfg = { credentialsSet: true, bucketNamed: false };
    assert.equal(storageReadiness({ state: "OK", httpStatus: 200 }, cfg).state, "READY");
    assert.match(
      storageReadiness({ state: "ACCESS_DENIED", httpStatus: 403 }, cfg).detail,
      /Access denied/,
    );
    assert.match(
      storageReadiness({ state: "NOT_CONFIGURED", httpStatus: null }, cfg).detail,
      /not configured/,
    );
    assert.equal(storageReadiness({ state: "UNREACHABLE", httpStatus: null }, cfg).state, "ATTENTION");
  });

  test("readiness wires the probe in, server-side only", () => {
    const readiness = src("src/lib/admin/readiness.ts");
    assert.match(readiness, /probeStorage\(\)/);
    assert.match(readiness, /key: "storage"/);
    const r2 = src("src/lib/storage/r2.ts");
    assert.match(r2, /^import "server-only";/);
    assert.match(r2, /new HeadBucketCommand\(\{ Bucket: serverEnv\.r2\.bucket \}\)/);
  });
});

describe("WhatsApp template sync authenticates like SMS", () => {
  test("Content API is called with the API key SID and the API key secret", async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push(String(url));
      const header = new Headers(init?.headers).get("authorization") ?? "";
      const decoded = Buffer.from(header.replace(/^Basic /, ""), "base64").toString("utf8");
      seen.push(decoded);
      return new Response(JSON.stringify({ contents: [], meta: { next_page_url: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const { fetchTwilioContentTemplates } = await import("../src/lib/messaging/twilio.ts");
      const out = await fetchTwilioContentTemplates();
      assert.deepEqual(out, []);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(seen[0].startsWith("https://content.twilio.com/v1/ContentAndApprovals"));
    assert.equal(seen[1], "SK00000000000000000000000000000002:api-key-secret");
  });
});

describe("Overview copy", () => {
  test("greets the operator by first name, in UK time", async () => {
    const { adminGreeting } = await import("../src/lib/admin/greeting.ts");
    // 13:00 UTC on 30 Sept is 14:00 in London (BST).
    assert.equal(adminGreeting(new Date("2026-09-30T13:00:00Z"), "Jamahl"), "Good afternoon, Jamahl");
    assert.equal(adminGreeting(new Date("2026-09-30T06:00:00Z"), null), "Good morning, Admin");
    assert.equal(adminGreeting(new Date("2026-09-30T19:00:00Z"), "  "), "Good evening, Admin");
  });

  test("an Action-required integration row names every broken connection", async () => {
    const { integrationActionDetail } = await import("../src/lib/admin/format.ts");
    assert.equal(
      integrationActionDetail([
        { provider_type: "google_ads", status: "ACTION_REQUIRED", last_error_message: "Token has been expired or revoked." },
        { provider_type: "google_calendar", status: "ACTION_REQUIRED", last_error_message: null },
        { provider_type: "salesforce", status: "ACTION_REQUIRED", last_error_message: null },
      ]),
      "Google Ads, Google Calendar and Salesforce need reconnecting: Token has been expired or revoked.",
    );
    assert.equal(
      integrationActionDetail([{ provider_type: "slack", status: "DISCONNECTED", last_error_message: null }]),
      "Slack is disconnected",
    );
  });
});

describe("System page", () => {
  test("the System page reads its views from a plain module, not the client switch", () => {
    const page = src("src/app/admin/(ops)/system/page.tsx");
    assert.match(page, /from "@\/lib\/admin\/system-views"/);
    assert.doesNotMatch(page, /SYSTEM_VIEWS,?[^;]*from "@\/components\/admin\/system\/system-view-switch"/);
    assert.doesNotMatch(src("src/lib/admin/system-views.ts"), /^\s*["']use client["']/m);
  });

  test("readiness counts integrations by the real status vocabulary", () => {
    const readiness = src("src/lib/admin/readiness.ts");
    assert.doesNotMatch(readiness, /\.eq\("status", "CONNECTED"\)/);
    assert.match(readiness, /\.eq\("status", "HEALTHY"\)/);
  });
});

describe("Errors view areas", () => {
  test("a revoked connection token is an Integrations error, not a LOW Webhook one", async () => {
    const shared = await import("../src/lib/admin/errors-shared.ts");
    assert.equal(shared.areaForIntegration("google_ads"), "Integrations");
    assert.equal(shared.areaForIntegration("google_calendar"), "Google Calendar");
    assert.equal(shared.areaForProvider("unknown_webhook"), "Webhook");
    assert.equal(shared.severityForArea("Integrations", "Token has been expired or revoked."), "HIGH");
    assert.match(shared.referenceFor("Integrations", "abcdef0123"), /^INT-\d{5}$/);
  });
});

describe("Admin labels", () => {
  test("enum values read as words, acronyms stay", async () => {
    const { titleise, jobLabel } = await import("../src/lib/admin/format.ts");
    assert.equal(titleise("WAITING_CUSTOMER"), "Waiting customer");
    assert.equal(titleise("TRIALING"), "Trialing");
    assert.equal(titleise("SMS"), "SMS");
    assert.equal(titleise("crm.pull"), "Crm pull");
    assert.equal(jobLabel("crm.pull"), "CRM import");
    assert.equal(jobLabel("whatsapp.template_sync"), "WhatsApp template sync");
  });
});

describe("Affiliate portal shell", () => {
  test("provides the toast host its children rely on", () => {
    const shell = src("src/components/affiliates/shell/affiliate-portal-shell.tsx");
    assert.match(shell, /<ToastProvider>/);
    assert.match(src("src/components/affiliates/shell/affiliate-profile-popover.tsx"), /useToast\(\)/);
  });
});

describe("Partner portal kit", () => {
  test("portal-ui stays a server module; only the interactive pieces are client", () => {
    const kit = src("src/components/affiliates/portal-ui.tsx");
    assert.doesNotMatch(kit, /^\s*["']use client["']/);
    assert.doesNotMatch(kit, /\buse(State|Effect|Router|Toast)\(/);
    assert.match(kit, /export \{ RangeTabs, CopyButton \} from "\.\/portal-ui-client"/);
    assert.match(src("src/components/affiliates/portal-ui-client.tsx"), /^"use client";/);
  });
});

describe("Maintenance and banner times", () => {
  test("a time in another year carries the year; winter reads GMT", async () => {
    const { formatLondon } = await import("../src/lib/maintenance/schedule.ts");
    const text = formatLondon("2030-01-01T10:00:00Z");
    assert.match(text, /2030/);
    assert.match(text, /GMT$/);
    assert.doesNotMatch(formatLondon(new Date().toISOString()), /\d{4},/);
  });
});
