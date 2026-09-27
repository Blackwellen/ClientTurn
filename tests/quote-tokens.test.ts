import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  TOKEN_UNAVAILABLE_MESSAGE,
  constantTimeEqualHex,
  generatePublicToken,
  hashToken,
  revokeForRevision,
  tokenExpiry,
  verifyPublicToken,
  type StoredToken,
} from "../src/lib/quotes/tokens.ts";

const NOW = "2026-10-01T12:00:00.000Z";
const EXPIRES = "2026-11-30T23:59:59.999Z";

function issue(revisionId = "rev-1") {
  const issued = generatePublicToken({ revisionId, expiresAt: EXPIRES });
  const stored: StoredToken = { tokenHash: issued.tokenHash, revisionId, expiresAt: EXPIRES, revokedAt: null };
  return { issued, stored };
}

describe("token generation", () => {
  test("32 random bytes, base64url, 43 characters, >= 256 bits", () => {
    const { issued } = issue();
    assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(issued.token, "base64url").length, 32);
  });

  test("only the SHA-256 hash is meant for storage", () => {
    const { issued } = issue();
    assert.match(issued.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(issued.tokenHash, hashToken(issued.token));
    assert.ok(!issued.tokenHash.includes(issued.token));
  });

  test("golden hash", () => {
    assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("uses the injected CSPRNG and refuses short randomness", () => {
    const fixed = generatePublicToken({ revisionId: "r", expiresAt: EXPIRES }, () => Buffer.alloc(32, 1));
    assert.equal(fixed.token, Buffer.alloc(32, 1).toString("base64url"));
    assert.throws(() => generatePublicToken({ revisionId: "r", expiresAt: EXPIRES }, () => Buffer.alloc(16)));
  });

  test("1,000 tokens are all distinct", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generatePublicToken({ revisionId: "r", expiresAt: EXPIRES }).token));
    assert.equal(seen.size, 1000);
  });
});

describe("verification", () => {
  test("the right token for the current revision is accepted", () => {
    const { issued, stored } = issue();
    assert.deepEqual(verifyPublicToken(issued.token, stored, NOW, "rev-1"), { ok: true, revisionId: "rev-1" });
  });

  const failures: [string, (t: ReturnType<typeof issue>) => [string, StoredToken | null, string, string?], string][] = [
    ["a malformed token", ({ stored }) => ["short", stored, NOW], "MALFORMED"],
    ["a token with bad characters", ({ issued, stored }) => [`${issued.token.slice(0, 42)}!`, stored, NOW], "MALFORMED"],
    ["a token with no row", ({ issued }) => [issued.token, null, NOW], "UNKNOWN"],
    ["a different token against a row", ({ stored }) => [randomBytes(32).toString("base64url"), stored, NOW], "MISMATCH"],
    ["a revoked token", ({ issued, stored }) => [issued.token, { ...stored, revokedAt: NOW }, NOW], "REVOKED"],
    ["an expired token", ({ issued, stored }) => [issued.token, stored, "2026-12-01T00:00:00.000Z"], "EXPIRED"],
    ["exactly at expiry", ({ issued, stored }) => [issued.token, stored, EXPIRES], "EXPIRED"],
    ["a superseded revision", ({ issued, stored }) => [issued.token, stored, NOW, "rev-2"], "SUPERSEDED"],
  ];
  for (const [label, build, reason] of failures) {
    test(`refuses ${label} with the same public message`, () => {
      const [token, stored, now, current] = build(issue());
      const result = verifyPublicToken(token, stored, now, current);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, reason);
        assert.equal(result.publicMessage, TOKEN_UNAVAILABLE_MESSAGE);
      }
    });
  }

  test("constant-time comparison only accepts well-formed hashes", () => {
    const hash = hashToken("x");
    assert.equal(constantTimeEqualHex(hash, hash), true);
    assert.equal(constantTimeEqualHex(hash, hashToken("y")), false);
    assert.equal(constantTimeEqualHex(hash, hash.slice(0, 63)), false);
    assert.equal(constantTimeEqualHex(hash.toUpperCase(), hash), false);
  });

  test("non-string input is refused, never thrown", () => {
    const { stored } = issue();
    assert.equal(verifyPublicToken(undefined as unknown as string, stored, NOW).ok, false);
  });
});

describe("revocation on revision", () => {
  test("revises revoke every live token of the old revision only", () => {
    const a = issue("rev-1").stored;
    const b = issue("rev-1").stored;
    const c = issue("rev-2").stored;
    const alreadyRevoked = { ...issue("rev-1").stored, revokedAt: "2026-09-01T00:00:00.000Z" };
    const after = revokeForRevision([a, b, c, alreadyRevoked], "rev-1", NOW);
    assert.deepEqual(after.map((t) => t.revokedAt), [NOW, NOW, null, "2026-09-01T00:00:00.000Z"]);
  });

  test("expiry adds a grace period to view (never sign) after validity", () => {
    assert.equal(tokenExpiry("2026-10-31T23:59:59.999Z"), "2026-11-30T23:59:59.999Z");
    assert.equal(tokenExpiry("2026-10-31T23:59:59.999Z", 0), "2026-10-31T23:59:59.999Z");
  });
});
