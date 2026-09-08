/**
 * Which transport a deployment gets, and the one it must never get by accident.
 *
 * An unconfigured deployment used to fall through to the development stub,
 * which returns `{ ok: true }` for every send. On production that meant every
 * SMS and WhatsApp was discarded and recorded as delivered — the UI showed
 * SENT, the customer watched follow-ups "go out", and nothing anywhere
 * disagreed. A missing `TWILIO_SMS_FROM` was enough to cause it.
 *
 * These tests exist so that cannot come back.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

const ENV_KEYS = [
  "MESSAGING_PROVIDER",
  "VERCEL_ENV",
  "NODE_ENV",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_SMS_FROM",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

// `env.ts` refuses to load without these. They are irrelevant to transport
// selection but are read at import time, so they are supplied once rather than
// wiped by `setEnv` along with the keys this test actually manipulates.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";
process.env.STRIPE_SECRET_KEY_TEST ??= "sk_test_placeholder";

const original = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/**
 * `NODE_ENV` is typed read-only, so the whole bag is written through an index
 * signature. These are process-wide mutations restored after every case.
 */
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete env[key];
    else env[key] = original[key];
  }
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) delete env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) env[key] = value;
  }
}

/** Re-imported per case: the registry caches its choice, by design. */
async function provider() {
  const mod = await import("../src/lib/messaging/registry.ts");
  mod.resetMessagingProvider();
  return mod.getMessagingProvider();
}

const SEND = {
  businessId: "00000000-0000-0000-0000-000000000000",
  to: "+447700900123",
  body: "hello",
  sendKey: "k1",
  channel: "sms" as const,
};

describe("an unconfigured production deployment", () => {
  test("refuses to send rather than pretending", async () => {
    // The bug this replaces: `ok: true` from a sink, on production, for ever.
    setEnv({ VERCEL_ENV: "production" });

    const result = await (await provider()).send(SEND);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.errorCode, "provider_not_configured");
  });

  test("the refusal is permanent, not a retry loop", async () => {
    // Retrying cannot conjure credentials, and a loop would bury the one error
    // that explains the outage.
    setEnv({ VERCEL_ENV: "production" });

    const result = await (await provider()).send(SEND);
    assert.equal(result.ok === false && result.permanent, true);
  });

  test("the error names what is missing", async () => {
    setEnv({ VERCEL_ENV: "production" });

    const result = await (await provider()).send(SEND);
    assert.match(
      result.ok === false ? result.errorMessage : "",
      /not configured/i,
    );
  });

  test("an unknown environment is treated as production, not development", async () => {
    // An allow-list, not "anything but production". A new deployment target
    // with an unset NODE_ENV must not inherit silent discarding.
    setEnv({ NODE_ENV: "staging-ish" });

    const result = await (await provider()).send(SEND);
    assert.equal(result.ok, false);
  });

  test("an entirely unset environment still refuses", async () => {
    setEnv({});

    const result = await (await provider()).send(SEND);
    assert.equal(result.ok, false);
  });
});

describe("the stub remains available where it belongs", () => {
  test("development gets it", async () => {
    setEnv({ NODE_ENV: "development" });

    const result = await (await provider()).send(SEND);
    assert.equal(result.ok, true);
  });

  test("tests and previews get it", async () => {
    for (const env of ["test", "preview"]) {
      setEnv({ VERCEL_ENV: env });
      const result = await (await provider()).send(SEND);
      assert.equal(result.ok, true, `${env} should get the stub`);
    }
  });

  test("only these three environments are development-like", async () => {
    // An allow-list, asserted directly. `MESSAGING_PROVIDER=stub` still selects
    // the sink on any environment — a development sink is a legitimate thing to
    // want, and it stays reachable by name. What is refused is *defaulting* to
    // one, which is what this list governs.
    const { isDevelopmentLike } = await import("../src/lib/messaging/registry.ts");

    for (const env of ["development", "test", "preview"]) {
      assert.equal(isDevelopmentLike(env), true, `${env} should be development-like`);
    }
    for (const env of ["production", "staging", "", "prod", "live"]) {
      assert.equal(isDevelopmentLike(env), false, `${env} must not be development-like`);
    }
  });
});

describe("which Twilio SID goes where", () => {
  // Shaped like the real thing and deliberately not it. A fixture carrying a
  // live account identifier is a credential sitting in a test file, and the
  // bug under test is about which prefix goes where — the digits are noise.
  const AC = "AC00000000000000000000000000000001";
  const SK = "SK00000000000000000000000000000002";

  test("an API key SID alone yields no account SID", async () => {
    // The live bug: `SK…` was stored as the account SID. It authenticates
    // perfectly well, so nothing looked wrong — but Twilio builds every REST
    // path from the account SID, and `SK…` there returns `20404 not found` on
    // every single send.
    const { resolveTwilioSids } = await import("../src/lib/messaging/twilio.ts");

    const { accountSid, authSid } = resolveTwilioSids({
      configuredSid: SK,
      apiKeySid: null,
    });

    assert.equal(accountSid, null, "an SK… must never become a path segment");
    assert.equal(authSid, SK, "but it is still what authenticates");
  });

  test("an account SID plus an API key uses each in its place", async () => {
    const { resolveTwilioSids } = await import("../src/lib/messaging/twilio.ts");

    const { accountSid, authSid } = resolveTwilioSids({
      configuredSid: AC,
      apiKeySid: SK,
    });

    assert.equal(accountSid, AC);
    assert.equal(authSid, SK);
  });

  test("an account SID alone plays both roles", async () => {
    const { resolveTwilioSids } = await import("../src/lib/messaging/twilio.ts");

    const { accountSid, authSid } = resolveTwilioSids({
      configuredSid: AC,
      apiKeySid: null,
    });

    assert.equal(accountSid, AC);
    assert.equal(authSid, AC);
  });

  test("an API key configured alongside a non-account SID still refuses", async () => {
    // Both slots holding `SK…` is a misconfiguration, not a fallback.
    const { resolveTwilioSids } = await import("../src/lib/messaging/twilio.ts");

    const { accountSid } = resolveTwilioSids({ configuredSid: SK, apiKeySid: SK });
    assert.equal(accountSid, null);
  });

  test("nothing configured yields nothing", async () => {
    const { resolveTwilioSids } = await import("../src/lib/messaging/twilio.ts");

    assert.deepEqual(
      resolveTwilioSids({ configuredSid: null, apiKeySid: null }),
      { accountSid: null, authSid: null },
    );
  });
});
