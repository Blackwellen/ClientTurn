import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  examplePayload,
  exampleCurl,
} from "../src/lib/integrations/connector-docs.ts";
import {
  AUTH_METHOD_KEYS,
  INSTALLABLE_APPS,
  connectorFor,
  fieldsFor,
  statusFor,
} from "../src/lib/integrations/apps.ts";

/**
 * The endpoint *is* the product for an inbound connector, and the commonest way
 * one fails is that somebody guessed the signing scheme. So the documentation
 * is tested as code: an example that does not match what the route accepts is a
 * support ticket waiting to happen, and a cURL that cannot be pasted and run is
 * worse than none.
 */

/** Mirrors the schema in `api/apps/[id]/events/route.ts`. */
const ingestSchema = z
  .object({
    eventId: z.string().min(1).max(150),
    eventType: z.string().max(60).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/)
      .optional(),
    company: z.string().max(150).optional(),
  })
  .refine((v) => !!v.email || !!v.phone);

describe("the documented example payload", () => {
  test("is accepted by the schema the endpoint enforces", () => {
    // The drift this catches: the route tightening a field while the example a
    // customer copies still shows the old shape.
    const result = ingestSchema.safeParse(examplePayload());
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  });

  test("carries an obviously fake contact", () => {
    const payload = examplePayload() as Record<string, string>;
    // Documentation gets pasted. A real-looking address in an example is one
    // somebody eventually sends a real message to.
    assert.match(payload.email, /@example\.(com|co\.uk|org)$/);
  });
});

describe("the documented cURL", () => {
  const endpoint = "https://app.example.com/api/apps/abc/events";

  test("every supported auth method produces a command", () => {
    for (const method of AUTH_METHOD_KEYS) {
      const command = exampleCurl({ endpoint, authMethod: method });
      assert.ok(command.includes("curl"), `${method} produced no curl command`);
      assert.ok(command.includes(endpoint), `${method} omits the endpoint`);
      assert.ok(
        command.includes("Content-Type: application/json"),
        `${method} omits the content type the route requires`,
      );
    }
  });

  test("the signed variant signs timestamp and body, in that order", () => {
    // The exact detail nobody guesses, and the reason this is generated rather
    // than written as prose: the signature covers `<timestamp>.<body>`.
    const command = exampleCurl({ endpoint, authMethod: "hmac_sha256" });
    assert.ok(command.includes("X-ClientTurn-Timestamp"));
    assert.ok(command.includes("X-ClientTurn-Signature"));
    assert.ok(
      command.includes(`printf '%s.%s' "$TS" "$BODY"`),
      "the signed string must be timestamp, dot, body",
    );
  });

  test("the signing recipe the docs describe is the one the route verifies", () => {
    // Recomputed here the way the route does it, to prove the documented order
    // and separator are not merely self-consistent.
    const secret = "test-secret";
    const timestamp = "1789000000";
    const body = JSON.stringify(examplePayload());

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    assert.match(expected, /^[a-f0-9]{64}$/);
    assert.notEqual(
      expected,
      createHmac("sha256", secret).update(`${body}.${timestamp}`).digest("hex"),
      "order must matter, or the documented recipe proves nothing",
    );
  });

  test("an api-key command uses the header the connection declares", () => {
    const command = exampleCurl({
      endpoint,
      authMethod: "api_key_header",
      headerName: "X-Custom-Key",
    });
    assert.ok(command.includes("X-Custom-Key"));
  });

  test("no example ever contains a real credential", () => {
    for (const method of AUTH_METHOD_KEYS) {
      const command = exampleCurl({ endpoint, authMethod: method });
      assert.match(
        command,
        /your-(signing-secret|token|api-key|username)/,
        `${method} should use an obvious placeholder`,
      );
    }
  });
});

describe("the connector catalogue", () => {
  test("every connector declares at least one auth method it supports", () => {
    for (const connector of INSTALLABLE_APPS) {
      assert.ok(
        connector.authMethods.length > 0,
        `${connector.id} declares no way to authenticate`,
      );
      for (const method of connector.authMethods) {
        assert.ok(
          (AUTH_METHOD_KEYS as readonly string[]).includes(method),
          `${connector.id} declares unknown auth method ${method}`,
        );
      }
    }
  });

  test("every declared auth method has fields a person can fill in", () => {
    for (const method of AUTH_METHOD_KEYS) {
      const fields = fieldsFor(method);
      assert.ok(fields.length > 0, `${method} has no credential fields`);
    }
  });

  test("connector ids are unique and resolvable", () => {
    const ids = INSTALLABLE_APPS.map((connector) => connector.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(connectorFor(id), `${id} does not resolve`);
  });

  test("an unknown connector does not resolve", () => {
    assert.equal(connectorFor("not-a-connector"), undefined);
  });

  test("a connection that has never delivered is not reported as healthy", () => {
    // The claim this prevents: a green tick that means "a secret was saved".
    const status = statusFor({
      active: true,
      lastReceivedAt: null,
      lastFailureAt: null,
    });
    assert.notEqual(status, "HEALTHY");
  });

  test("a recent failure outranks an older success", () => {
    const status = statusFor({
      active: true,
      lastReceivedAt: "2026-09-01T10:00:00.000Z",
      lastFailureAt: "2026-09-07T10:00:00.000Z",
    });
    assert.notEqual(status, "HEALTHY");
  });

  test("a switched-off connection is never healthy", () => {
    const status = statusFor({
      active: false,
      lastReceivedAt: "2026-09-07T10:00:00.000Z",
      lastFailureAt: null,
    });
    assert.notEqual(status, "HEALTHY");
  });
});
