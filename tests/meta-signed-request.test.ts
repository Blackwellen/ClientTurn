/**
 * Meta's `signed_request`, as used by the deauthorize and data-deletion
 * callbacks.
 *
 * These two endpoints are unauthenticated and one of them **deletes data**, so
 * the verifier is the only thing between the public internet and destroying a
 * customer's Meta connection. It is tested harder than anything else here.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  deletionConfirmationCode,
  parseSignedRequest,
} from "../src/lib/messaging/meta-signed-request.ts";

const SECRET = "test-app-secret";

/** Builds a signed_request the way Meta does: base64url, signature over the
 *  encoded payload string. */
function sign(payload: unknown, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  return `${signature}.${encoded}`;
}

const VALID = { algorithm: "HMAC-SHA256", user_id: "1782641009599925", issued_at: 1789000000 };

describe("verifying a signed request", () => {
  test("a genuine request is accepted and names the user", () => {
    const result = parseSignedRequest(sign(VALID), SECRET);

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.userId, "1782641009599925");
  });

  test("a request signed with a different secret is refused", () => {
    const result = parseSignedRequest(sign(VALID, "not-the-secret"), SECRET);
    assert.equal(result.ok, false);
  });

  test("a tampered payload is refused", () => {
    // The attack the whole verifier exists to stop: swap the user id for
    // somebody else's and delete their integration.
    const genuine = sign(VALID);
    const [signature] = genuine.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...VALID, user_id: "999999999999999" }),
      "utf8",
    ).toString("base64url");

    const result = parseSignedRequest(`${signature}.${forgedPayload}`, SECRET);
    assert.equal(result.ok, false);
  });

  test("base64url is decoded as base64url, not base64", () => {
    // A payload whose encoding contains '-' or '_' — the characters that differ
    // between the alphabets. Decoding with a plain base64 reader appears to work
    // for most inputs and silently corrupts the rest, which is the worst
    // possible failure mode for a signature check.
    let payload = { ...VALID, user_id: "1782641009599925", note: "" };
    let encoded = "";

    // Find a payload that actually exercises the differing characters.
    for (let i = 0; i < 500; i += 1) {
      payload = { ...payload, note: `padding-${i}~${i}` };
      encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      if (encoded.includes("-") || encoded.includes("_")) break;
    }

    assert.ok(
      encoded.includes("-") || encoded.includes("_"),
      "could not construct a payload exercising the base64url alphabet",
    );

    const result = parseSignedRequest(sign(payload), SECRET);
    assert.equal(result.ok, true, "a valid base64url payload must verify");
  });

  test("an algorithm the payload asks for is checked, never trusted", () => {
    // The oldest trick there is: a token that nominates its own, weaker
    // verification. Correctly signed with our real secret, and still refused.
    const result = parseSignedRequest(
      sign({ ...VALID, algorithm: "none" }),
      SECRET,
    );

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /algorithm/i);
  });

  test("a payload naming no user is refused", () => {
    const result = parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), SECRET);
    assert.equal(result.ok, false);
  });

  test("malformed input is refused rather than throwing", () => {
    for (const input of [
      null,
      "",
      "no-dot",
      "too.many.dots",
      "!!!.!!!",
      ".",
      "abc.",
      ".abc",
    ]) {
      const result = parseSignedRequest(input, SECRET);
      assert.equal(result.ok, false, `${JSON.stringify(input)} should be refused`);
    }
  });

  test("a valid signature over payload that is not JSON is refused", () => {
    const encoded = Buffer.from("not json at all", "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(encoded, "utf8").digest("base64url");

    const result = parseSignedRequest(`${signature}.${encoded}`, SECRET);
    assert.equal(result.ok, false);
  });

  test("with no configured secret, nothing verifies", () => {
    // An unconfigured deployment must refuse every request, not accept them.
    for (const secret of [null, undefined, ""]) {
      const result = parseSignedRequest(sign(VALID), secret);
      assert.equal(result.ok, false);
    }
  });
});

describe("the deletion confirmation code", () => {
  test("is 24 hex characters", () => {
    const code = deletionConfirmationCode(Buffer.alloc(16, 0xab));
    assert.match(code, /^[0-9a-f]{24}$/);
  });

  test("differs for different input", () => {
    // Random per request, never derived from the Meta user id — a derived code
    // would let anybody who knows somebody's id look up their deletion request.
    const a = deletionConfirmationCode(Buffer.from("0123456789abcdef", "utf8"));
    const b = deletionConfirmationCode(Buffer.from("fedcba9876543210", "utf8"));
    assert.notEqual(a, b);
  });

  test("matches the shape the status page will accept", () => {
    // The page rejects anything that is not exactly this shape before it
    // reaches the database, so a code it generates must satisfy it.
    const code = deletionConfirmationCode(Buffer.from("aaaabbbbccccdddd", "utf8"));
    assert.equal(/^[0-9a-f]{24}$/.test(code), true);
  });
});
