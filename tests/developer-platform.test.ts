import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PLATFORM_SCOPES,
  SCOPE_DESCRIPTIONS,
  isPlatformScope,
  isWriteScope,
  roleMeets,
} from "../src/lib/platform/scopes.ts";
import { MCP_SCOPES, MCP_TOOLS } from "../src/lib/mcp/tools.ts";
import {
  apiKeyStatus,
  expiryToDate,
  ipAllowed,
  isAllowedIpEntry,
  maskedKey,
  type ApiKeyView,
} from "../src/lib/api-keys/types.ts";
import {
  generateSigningSecret,
  secretHint,
  signPayload,
  verifySignature,
} from "../src/lib/webhooks/signature.ts";
import {
  ENDPOINT_FAILURE_LIMIT,
  WEBHOOK_EVENTS,
  WEBHOOK_RETRY_BACKOFF_SECONDS,
  WEBHOOK_TEST_EVENT,
  isWebhookEventType,
  nextAttemptDelaySeconds,
} from "../src/lib/webhooks/events.ts";

/**
 * The developer platform is a permission boundary and a promise to a customer's
 * own systems, so these tests are written from the two directions that matter:
 * proving a credential cannot quietly widen, and proving we do not advertise an
 * event nothing sends.
 *
 * Everything asserted here is pure. The database paths are covered by
 * `tests/rls-new-tables.test.ts` and by the live end-to-end script, because a
 * mocked Supabase client would only prove the mock agrees with itself.
 */

const root = join(import.meta.dirname, "..");

/**
 * Source with comments removed.
 *
 * The "this column never leaves the server" assertions below look for a column
 * name in the code. Without this they also match the comment explaining why the
 * column is withheld — which would make documenting the rule the thing that
 * breaks the test enforcing it.
 */
function code(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ------------------------------------------------------------------ scopes */

describe("platform scopes", () => {
  test("MCP and the public API read one list, not two copies", () => {
    // The regression this catches: someone adds a scope to MCP_SCOPES and the
    // API silently does not grant it, or vice versa. They are the same array
    // identity precisely so that cannot happen.
    assert.equal(MCP_SCOPES, PLATFORM_SCOPES);
  });

  test("every scope has a description a customer could act on", () => {
    for (const scope of PLATFORM_SCOPES) {
      const description = SCOPE_DESCRIPTIONS[scope];
      assert.ok(description, `${scope} has no description`);
      assert.ok(
        description.length > 10 && !description.includes("_"),
        `${scope} reads like an identifier, not a sentence`,
      );
    }
  });

  test("scope names are unique and lower case", () => {
    const seen = new Set<string>();
    for (const scope of PLATFORM_SCOPES) {
      assert.ok(!seen.has(scope), `${scope} is declared twice`);
      seen.add(scope);
      assert.equal(scope, scope.toLowerCase());
      assert.match(scope, /^[a-z_]+:(read|write)$/);
    }
  });

  test("an unknown scope is refused rather than passed through", () => {
    assert.equal(isPlatformScope("leads:read"), true);
    assert.equal(isPlatformScope("leads:delete"), false);
    assert.equal(isPlatformScope("*"), false);
    assert.equal(isPlatformScope(""), false);
  });

  test("write scopes are recognised as writes", () => {
    assert.equal(isWriteScope("leads:write"), true);
    assert.equal(isWriteScope("leads:read"), false);
  });

  test("role ranking never lets a lower role clear a higher bar", () => {
    assert.equal(roleMeets("viewer", "member"), false);
    assert.equal(roleMeets("member", "admin"), false);
    assert.equal(roleMeets("admin", "owner"), false);
    assert.equal(roleMeets("owner", "viewer"), true);
    assert.equal(roleMeets("admin", "admin"), true);
    // An unrecognised role must fail closed, not rank as anything.
    assert.equal(roleMeets("superuser", "viewer"), false);
  });

  test("every MCP tool's scope exists in the shared list", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(
        isPlatformScope(tool.scope),
        `${tool.name} uses a scope the platform does not grant`,
      );
    }
  });
});

/* ---------------------------------------------------------------- API keys */

describe("API key display rules", () => {
  const base: ApiKeyView = {
    id: "k1",
    name: "Zapier",
    keyPrefix: "ct_live_a1b2c3d4",
    keyLastFour: "f9c4",
    environment: "live",
    scopes: ["leads:read"],
    ownerName: "Sam",
    ownerIsCaller: false,
    allowedIps: [],
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    requestCount: 0,
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    recentDenials: 0,
    recentRequests: 0,
  };

  test("a key that has never been used is not called active", () => {
    // Showing "Active" for a key nothing has ever presented is a claim the
    // customer can disprove, and the first thing they would disprove.
    assert.equal(apiKeyStatus(base), "unused");
  });

  test("a used key is active, a revoked key is revoked whatever else is true", () => {
    assert.equal(apiKeyStatus({ ...base, lastUsedAt: "2026-01-02T00:00:00Z" }), "active");
    assert.equal(
      apiKeyStatus({
        ...base,
        lastUsedAt: "2026-01-02T00:00:00Z",
        revokedAt: "2026-01-03T00:00:00Z",
      }),
      "revoked",
    );
  });

  test("expiry is judged against the clock, not a stored flag", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    assert.equal(
      apiKeyStatus({ ...base, expiresAt: "2026-05-31T23:59:59Z" }, now),
      "expired",
    );
    assert.equal(
      apiKeyStatus({ ...base, expiresAt: "2026-06-02T00:00:00Z" }, now),
      "unused",
    );
  });

  test("the masked form never contains the whole key", () => {
    const masked = maskedKey(base);
    assert.ok(masked.includes("ct_live_"));
    assert.ok(masked.includes("…"));
    assert.ok(masked.length < 30);
  });

  test("expiry options resolve to real dates, and 'never' to null", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    assert.equal(expiryToDate("never", from), null);
    assert.equal(
      expiryToDate("90", from)?.toISOString(),
      new Date("2026-04-01T00:00:00Z").toISOString(),
    );
    // Anything unrecognised must not silently become a long-lived key.
    assert.equal(expiryToDate("banana", from), null);
    assert.equal(expiryToDate("-5", from), null);
  });
});

describe("API key IP allowlist", () => {
  test("an empty allowlist permits any address", () => {
    assert.equal(ipAllowed("203.0.113.4", []), true);
  });

  test("an unknown address is refused when a list exists", () => {
    // The interesting case: we could not determine the caller's address, and a
    // customer asked us to restrict by address. Allowing it would defeat the
    // restriction exactly when it matters.
    assert.equal(ipAllowed("unknown", ["203.0.113.4"]), false);
    assert.equal(ipAllowed("", ["203.0.113.4"]), false);
  });

  test("exact addresses match and neighbours do not", () => {
    assert.equal(ipAllowed("203.0.113.4", ["203.0.113.4"]), true);
    assert.equal(ipAllowed("203.0.113.5", ["203.0.113.4"]), false);
  });

  test("CIDR blocks include their range and exclude the next one", () => {
    assert.equal(ipAllowed("198.51.100.7", ["198.51.100.0/24"]), true);
    assert.equal(ipAllowed("198.51.101.7", ["198.51.100.0/24"]), false);
    assert.equal(ipAllowed("10.1.2.3", ["10.0.0.0/8"]), true);
    assert.equal(ipAllowed("11.1.2.3", ["10.0.0.0/8"]), false);
  });

  test("a /32 is a single address and a /0 is everything", () => {
    assert.equal(ipAllowed("203.0.113.4", ["203.0.113.4/32"]), true);
    assert.equal(ipAllowed("203.0.113.5", ["203.0.113.4/32"]), false);
    // The shift-by-32 case, which in JavaScript is a no-op and would otherwise
    // produce a mask of all ones — matching nothing instead of everything.
    assert.equal(ipAllowed("8.8.8.8", ["0.0.0.0/0"]), true);
  });

  test("IPv6 is exact-match only, never approximated", () => {
    assert.equal(ipAllowed("2001:db8::1", ["2001:db8::1"]), true);
    // A prefix comparison we cannot do correctly must refuse, not guess.
    assert.equal(ipAllowed("2001:db8::2", ["2001:db8::/32"]), false);
  });

  test("a malformed entry never matches anything", () => {
    assert.equal(ipAllowed("203.0.113.4", ["nonsense"]), false);
    assert.equal(ipAllowed("203.0.113.4", ["203.0.113.0/99"]), false);
  });

  test("the form validator agrees with what the matcher can use", () => {
    assert.equal(isAllowedIpEntry("203.0.113.4"), true);
    assert.equal(isAllowedIpEntry("198.51.100.0/24"), true);
    assert.equal(isAllowedIpEntry("2001:db8::1"), true);
    assert.equal(isAllowedIpEntry("999.0.0.1"), false);
    assert.equal(isAllowedIpEntry("203.0.113.0/33"), false);
    assert.equal(isAllowedIpEntry(""), false);
  });
});

/* -------------------------------------------------------- webhook signing */

describe("webhook signatures", () => {
  const secret = "whsec_test_value";
  const body = JSON.stringify({ id: "evt_1", type: "lead.created" });

  test("a signature we produce is one we accept", () => {
    const header = signPayload(body, secret, 1_700_000_000);
    const result = verifySignature(body, header, secret, {
      nowSeconds: 1_700_000_000,
    });
    assert.equal(result.ok, true);
  });

  test("the header is the versioned scheme a receiver can parse", () => {
    const header = signPayload(body, secret, 1_700_000_000);
    assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  test("a changed body fails, even by one character", () => {
    const header = signPayload(body, secret, 1_700_000_000);
    const result = verifySignature(`${body} `, header, secret, {
      nowSeconds: 1_700_000_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "MISMATCH");
  });

  test("a different secret fails", () => {
    const header = signPayload(body, secret, 1_700_000_000);
    const result = verifySignature(body, header, "whsec_other", {
      nowSeconds: 1_700_000_000,
    });
    assert.equal(result.ok === false && result.reason, "MISMATCH");
  });

  test("an old signature is refused, which is what stops a replay", () => {
    // This is the property that makes signing the timestamp worthwhile: without
    // it, anyone who ever saw one valid request could resend it forever.
    const header = signPayload(body, secret, 1_700_000_000);
    const result = verifySignature(body, header, secret, {
      nowSeconds: 1_700_000_000 + 3600,
    });
    assert.equal(result.ok === false && result.reason, "STALE");
  });

  test("a signature from the future is refused too", () => {
    const header = signPayload(body, secret, 1_700_000_000 + 3600);
    const result = verifySignature(body, header, secret, {
      nowSeconds: 1_700_000_000,
    });
    assert.equal(result.ok === false && result.reason, "STALE");
  });

  test("a missing or malformed header is refused, not treated as unsigned", () => {
    assert.equal(verifySignature(body, null, secret).ok, false);
    assert.equal(verifySignature(body, "", secret).ok, false);

    for (const header of ["v1=abc", "t=1700000000", "garbage", "t=x,v1=y"]) {
      const result = verifySignature(body, header, secret);
      assert.equal(result.ok, false, `${header} was accepted`);
      if (!result.ok) assert.equal(result.reason, "MALFORMED", header);
    }
  });

  test("multiple v1 candidates are all tried, so rotation can be handled", () => {
    const good = signPayload(body, secret, 1_700_000_000).split("v1=")[1];
    const header = `t=1700000000,v1=deadbeef,v1=${good}`;
    assert.equal(
      verifySignature(body, header, secret, { nowSeconds: 1_700_000_000 }).ok,
      true,
    );
  });

  test("generated secrets are prefixed, long, and never repeat", () => {
    const a = generateSigningSecret();
    const b = generateSigningSecret();
    assert.match(a, /^whsec_[A-Za-z0-9_-]{40,}$/);
    assert.notEqual(a, b);
    assert.equal(secretHint(a), a.slice(-6));
    assert.equal(secretHint(a).length, 6);
  });
});

/* ------------------------------------------------------- webhook catalogue */

describe("webhook event catalogue", () => {
  test("every advertised event is actually emitted somewhere", () => {
    // The failure this prevents is the worst kind for an integration: a
    // subscription checkbox for an event nothing sends. The customer builds
    // against it, waits, and concludes the product is broken.
    for (const event of WEBHOOK_EVENTS) {
      const source = readFileSync(join(root, "src", event.emittedBy), "utf8");
      assert.ok(
        source.includes("emitWebhookEvent"),
        `${event.type} claims to be emitted by ${event.emittedBy}, which does not emit anything`,
      );
      assert.ok(
        source.includes(`"${event.type}"`),
        `${event.emittedBy} does not emit ${event.type}`,
      );
    }
  });

  test("event types are unique, namespaced and described", () => {
    const seen = new Set<string>();
    for (const event of WEBHOOK_EVENTS) {
      assert.ok(!seen.has(event.type), `${event.type} is declared twice`);
      seen.add(event.type);
      assert.match(event.type, /^[a-z_]+\.[a-z_]+$/);
      assert.ok(event.label.length > 3, `${event.type} needs a readable label`);
      assert.ok(
        event.description.length > 20,
        `${event.type} needs a description a customer can act on`,
      );
    }
  });

  test("the test event is not one of the real ones", () => {
    // A receiver must be able to tell a drill from the real thing, or testing
    // an endpoint means creating a phantom lead in their CRM.
    assert.equal(isWebhookEventType(WEBHOOK_TEST_EVENT), false);
  });

  test("an unknown event type is refused", () => {
    assert.equal(isWebhookEventType("lead.created"), true);
    assert.equal(isWebhookEventType("lead.deleted"), false);
    assert.equal(isWebhookEventType("*"), false);
  });
});

describe("webhook retry schedule", () => {
  test("backoff grows, so a struggling endpoint is not hammered", () => {
    for (let i = 1; i < WEBHOOK_RETRY_BACKOFF_SECONDS.length; i += 1) {
      assert.ok(
        WEBHOOK_RETRY_BACKOFF_SECONDS[i] > WEBHOOK_RETRY_BACKOFF_SECONDS[i - 1],
        "each retry must wait longer than the last",
      );
    }
  });

  test("retries stop rather than continuing forever", () => {
    const attempts = WEBHOOK_RETRY_BACKOFF_SECONDS.length;
    assert.equal(typeof nextAttemptDelaySeconds(attempts), "number");
    // One past the end returns null, which is what marks a delivery EXHAUSTED.
    assert.equal(nextAttemptDelaySeconds(attempts + 1), null);
  });

  test("the whole schedule spans hours, not days", () => {
    const total = WEBHOOK_RETRY_BACKOFF_SECONDS.reduce((sum, s) => sum + s, 0);
    assert.ok(total > 3600, "an endpoint down for an hour should still receive its events");
    assert.ok(
      total < 48 * 3600,
      "a two-day-old event arriving as if it were new is worse than not arriving",
    );
  });

  test("an endpoint failing forever is eventually switched off", () => {
    assert.ok(ENDPOINT_FAILURE_LIMIT > 0);
    assert.ok(
      ENDPOINT_FAILURE_LIMIT < 100,
      "we must stop connecting to a stranger's server long before this",
    );
  });
});

/* -------------------------------------------------------- wiring guarantees */

describe("developer platform wiring", () => {
  test("the webhook dispatch job is registered", () => {
    // A queued delivery with no registered handler fails permanently on the
    // first attempt, which looks exactly like a customer's endpoint being down.
    const queue = readFileSync(join(root, "src/lib/jobs/queue.ts"), "utf8");
    const register = readFileSync(join(root, "src/lib/jobs/register.ts"), "utf8");
    assert.ok(queue.includes('"webhook.dispatch"'));
    assert.ok(register.includes('registerHandler("webhook.dispatch"'));
  });

  test("the public API never emits CORS headers", () => {
    // An API key usable from a browser page is a key in the hands of every
    // visitor to that page.
    const source = code("src/lib/api/public.ts").toLowerCase();
    assert.ok(!source.includes("access-control-allow-origin"));
  });

  test("no query selects the stored key digest", () => {
    // The digest is not a credential, but returning it invites offline attack
    // on a value the customer believes is private, and no screen needs it.
    for (const file of ["src/lib/api-keys/queries.ts"]) {
      const source = code(file);
      assert.ok(
        !source.includes("key_hash"),
        `${file} selects key_hash, which must never leave the server`,
      );
    }
  });

  test("no query selects the sealed webhook secret", () => {
    const source = code("src/lib/webhooks/queries.ts");
    assert.ok(!source.includes("secret_sealed"));
  });

  test("every public API route goes through the one auth wrapper", () => {
    // A route that authenticated itself would be the one that eventually
    // forgets the scope check.
    const routes = [
      "src/app/api/v1/me/route.ts",
      "src/app/api/v1/leads/route.ts",
      "src/app/api/v1/leads/[id]/route.ts",
      "src/app/api/v1/events/route.ts",
    ];
    for (const file of routes) {
      const source = readFileSync(join(root, file), "utf8");
      assert.ok(
        source.includes("withApiKey"),
        `${file} does not use withApiKey`,
      );
      assert.ok(
        !source.includes("authenticateApiKey"),
        `${file} authenticates by hand instead of using the wrapper`,
      );
    }
  });
});
