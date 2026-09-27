import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CLIENT_HEADER,
  handleQuoteSignRequest,
  handleQuoteViewRequest,
  isSameOrigin,
  issueFormNonce,
  signatureRpcPayload,
  verifyFormNonce,
  type PublicDeps,
  type PublicQuoteContext,
} from "../src/lib/quotes/public-sign.ts";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from "../src/lib/esign/notice.ts";
import { verifySignature } from "../src/lib/esign/seal.ts";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { buildQuoteRenderModel, renderModelHash } from "../src/lib/quotes/render-model.ts";
import { TOKEN_UNAVAILABLE_MESSAGE } from "../src/lib/quotes/tokens.ts";
import type { SignatureRecord } from "../src/lib/esign/types.ts";
import { CATALOGUE } from "./fixtures/quote-fakes.ts";

/**
 * The public quote page's POSTs: rate limit, same-origin + form nonce
 * (CSRF), token handling (one generic 404 for every failure), and replay
 * (one acceptance and one signature per revision, whatever is re-sent).
 */

const SECRET = "test-secret-with-enough-length-0123456789";
const ORIGIN = "https://app.clientturn.test";
const TOKEN = "A".repeat(43);
const NOW = new Date("2026-09-27T12:00:00Z");

function renderModel() {
  const calc = calculateQuote({ currency: "GBP", vatRegistered: true, catalogue: CATALOGUE, lines: [{ lineId: "l1", kind: "ITEM", itemId: "website", quantity: 1 }] });
  assert.ok(calc.ok);
  return buildQuoteRenderModel({
    quote: { number: "Q-00001", revision: 1, title: "Website", issuedOn: "2026-09-27", validUntil: "2026-10-27" },
    seller: { name: "Studio North" },
    buyer: { name: "Priya Shah" },
    calculation: calc.quote,
    terms: "Terms.",
    poweredBy: true,
  });
}

function headers(extra: Record<string, string> = {}) {
  const map = new Map(Object.entries({ origin: ORIGIN, [CLIENT_HEADER]: "1", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9", "user-agent": "Test/1.0", ...extra }));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

function harness(overrides: Partial<PublicQuoteContext> = {}, depOverrides: Partial<PublicDeps> = {}) {
  const model = renderModel();
  const context: PublicQuoteContext = {
    businessId: "b1",
    quoteId: "q1",
    revisionId: "r1",
    quoteStatus: "SENT",
    renderModel: model,
    renderHash: renderModelHash(model),
    calculationHash: model.calculationHash,
    validUntil: "2026-10-27T23:59:59.999Z",
    firstViewedAt: "2026-09-27T11:00:00Z",
    purpose: "VIEW_AND_SIGN",
    leadId: "lead-1",
    esignEnabled: true,
    requireDrawnSignature: false,
    ...overrides,
  };
  const log = { accepts: [] as string[], signatures: [] as SignatureRecord[], emitted: [] as string[], views: 0 };
  const acceptedKeys = new Set<string>();
  const signedKeys = new Set<string>();
  const deps: PublicDeps = {
    now: () => NOW,
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    rateLimited: async () => false,
    resolve: async (token) => (token === TOKEN ? context : null),
    async accept({ actionKey }) {
      log.accepts.push(actionKey);
      if (acceptedKeys.has(actionKey)) return { ok: true, duplicate: true };
      acceptedKeys.add(actionKey);
      context.quoteStatus = "ACCEPTED";
      return { ok: true };
    },
    async recordSignature({ actionKey, record }) {
      if (signedKeys.has(actionKey)) return { ok: true, duplicate: true };
      signedKeys.add(actionKey);
      log.signatures.push(record);
      context.quoteStatus = "SIGNED";
      return { ok: true };
    },
    async markViewed() {
      log.views += 1;
      const first = context.quoteStatus === "SENT";
      context.quoteStatus = "VIEWED";
      return { firstView: first };
    },
    nextStep: async () => ({ kind: "PAY", label: "Pay the £3,000.00 deposit", url: "https://buy.stripe.com/test" }),
    emit: async (_ctx, type) => {
      log.emitted.push(type);
    },
    ...depOverrides,
  };
  return { deps, context, log };
}

function body(extra: Record<string, unknown> = {}) {
  return {
    nonce: issueFormNonce(SECRET, TOKEN, NOW),
    idempotencyKey: randomUUID(),
    signerName: "Priya Shah",
    signerEmail: "priya@acme.test",
    typedName: "Priya Shah",
    consent: true,
    consentVersion: CONSENT_TEXT_VERSION,
    ...extra,
  };
}

describe("same-origin and the form nonce (CSRF)", () => {
  test("a cross-site or header-less request is refused", () => {
    assert.equal(isSameOrigin(headers(), [ORIGIN]), true);
    assert.equal(isSameOrigin(headers({ origin: "https://evil.test" }), [ORIGIN]), false);
    assert.equal(isSameOrigin(headers({ [CLIENT_HEADER]: "" }), [ORIGIN]), false, "a plain form post cannot set the custom header");
    assert.equal(isSameOrigin(headers({ "sec-fetch-site": "cross-site" }), [ORIGIN]), false);
  });

  test("a nonce is bound to the link and expires", () => {
    const nonce = issueFormNonce(SECRET, TOKEN, NOW);
    assert.equal(verifyFormNonce(SECRET, TOKEN, nonce, NOW), true);
    assert.equal(verifyFormNonce(SECRET, "B".repeat(43), nonce, NOW), false, "another link's page");
    assert.equal(verifyFormNonce("other-secret", TOKEN, nonce, NOW), false);
    assert.equal(verifyFormNonce(SECRET, TOKEN, nonce, new Date(NOW.getTime() + 3 * 3_600_000)), false, "expired");
    assert.equal(verifyFormNonce(SECRET, TOKEN, "garbage", NOW), false);
  });

  test("the sign handler refuses a cross-site POST before touching the token", async () => {
    let resolved = false;
    const { deps } = harness({}, { resolve: async () => ((resolved = true), null) });
    const res = await handleQuoteSignRequest(deps, TOKEN, headers({ origin: "https://evil.test" }), body());
    assert.equal(res.status, 403);
    assert.equal(resolved, false);
  });

  test("a stale or forged nonce is refused", async () => {
    const { deps } = harness();
    const res = await handleQuoteSignRequest(deps, TOKEN, headers(), body({ nonce: issueFormNonce("other", TOKEN, NOW) }));
    assert.equal(res.status, 403);
  });
});

describe("rate limiting", () => {
  test("a limited address gets 429 and nothing else happens", async () => {
    const { deps, log } = harness({}, { rateLimited: async () => true });
    const res = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    assert.equal(res.status, 429);
    assert.equal(log.accepts.length, 0);
  });
});

describe("token handling", () => {
  test("malformed, unknown, expired or revoked all return the same generic 404", async () => {
    const { deps } = harness();
    const malformed = await handleQuoteSignRequest(deps, "short", headers(), body());
    const unknown = await handleQuoteSignRequest(deps, "Z".repeat(43), headers(), body({ nonce: issueFormNonce(SECRET, "Z".repeat(43), NOW) }));
    assert.equal(malformed.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(malformed.body, unknown.body);
    assert.equal(malformed.body.error, TOKEN_UNAVAILABLE_MESSAGE);
  });

  test("a view-only link cannot sign", async () => {
    const { deps } = harness({ purpose: "VIEW_ONLY" });
    assert.equal((await handleQuoteSignRequest(deps, TOKEN, headers(), body())).status, 404);
  });

  test("an expired quote cannot be accepted", async () => {
    const { deps } = harness({ validUntil: "2026-09-01T00:00:00Z" });
    assert.equal((await handleQuoteSignRequest(deps, TOKEN, headers(), body())).status, 409);
  });

  test("a document whose stored model no longer matches its hash is never signed", async () => {
    const { deps, log } = harness({ renderHash: "0".repeat(64) });
    assert.equal((await handleQuoteSignRequest(deps, TOKEN, headers(), body())).status, 409);
    assert.equal(log.accepts.length, 0);
  });
});

describe("accept and sign", () => {
  test("accepts, seals and records a verifiable signature, and offers the payment step", async () => {
    const { deps, context, log } = harness();
    const res = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "SIGNED");
    assert.deepEqual(res.body.nextStep, { kind: "PAY", label: "Pay the £3,000.00 deposit", url: "https://buy.stripe.com/test" });
    assert.equal(log.signatures.length, 1);
    const record = log.signatures[0];
    assert.equal(record.consent.text, CONSENT_TEXT);
    assert.equal(record.context.ip, "203.0.113.9");
    assert.equal(record.auditTrail[0].type, "DOCUMENT_VIEWED");
    assert.deepEqual(verifySignature(record, { renderModel: context.renderModel, revisionId: "r1" }), { valid: true, problems: [] });
    assert.deepEqual(log.emitted, ["quote.accepted", "quote.signed"]);
    const payload = signatureRpcPayload(record);
    assert.equal(payload.document_hash, context.renderHash, "the RPC is given exactly the frozen revision's hash");
  });

  test("a replay (double click, retry) records one acceptance and one signature", async () => {
    const { deps, log } = harness();
    const first = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    const again = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(log.signatures.length, 1);
    assert.equal(log.emitted.filter((e) => e === "quote.signed").length, 1);
  });

  test("the consent box and a mark are required", async () => {
    const { deps } = harness();
    assert.equal((await handleQuoteSignRequest(deps, TOKEN, headers(), body({ consent: false }))).status, 400);
    assert.equal((await handleQuoteSignRequest(deps, TOKEN, headers(), body({ typedName: undefined }))).status, 400);
  });

  test("a workspace that requires a drawn signature gets one", async () => {
    const { deps } = harness({ requireDrawnSignature: true });
    const res = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    assert.equal(res.status, 400);
    assert.equal(res.body.field, "drawn");
    const ok = await handleQuoteSignRequest(deps, TOKEN, headers(), body({ drawn: { format: "SVG_PATH", data: "M 10 10 L 40 40 L 80 20" } }));
    assert.equal(ok.status, 200);
  });

  test("without e-signature the customer accepts with their name; nothing is sealed", async () => {
    const { deps, log } = harness({ esignEnabled: false });
    const res = await handleQuoteSignRequest(deps, TOKEN, headers(), body({ typedName: undefined }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ACCEPTED");
    assert.equal(log.signatures.length, 0);
    const again = await handleQuoteSignRequest(deps, TOKEN, headers(), body());
    assert.equal(again.body.duplicate, true);
  });
});

describe("the viewed event", () => {
  test("records the first view once, with a valid nonce only", async () => {
    const { deps, log } = harness();
    const nonce = issueFormNonce(SECRET, TOKEN, NOW);
    assert.equal((await handleQuoteViewRequest(deps, TOKEN, headers(), { nonce: "bad" })).status, 403);
    const first = await handleQuoteViewRequest(deps, TOKEN, headers(), { nonce });
    const second = await handleQuoteViewRequest(deps, TOKEN, headers(), { nonce });
    assert.equal(first.body.recorded, true);
    assert.equal(second.body.recorded, false);
    assert.equal(log.views, 1);
    assert.deepEqual(log.emitted, ["quote.viewed"]);
  });
});
