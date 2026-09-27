import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../src/lib/quotes/calculate.ts";
import { buildQuoteRenderModel, renderModelHash } from "../src/lib/quotes/render-model.ts";
import type { QuoteRenderModel } from "../src/lib/quotes/types.ts";
import { sha256Hex } from "../src/lib/quotes/canonical.ts";
import { chainEvents, genesisHash, sealSignature, verifySignature } from "../src/lib/esign/seal.ts";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, SIGNATURE_NOTICE, SIGNATURE_TYPE, SIGNATURE_TYPE_LABEL } from "../src/lib/esign/notice.ts";
import type { SignatureCaptureInput, SignatureRecord } from "../src/lib/esign/types.ts";

function renderModel(terms = "Payment within 14 days."): QuoteRenderModel {
  const result = calculateQuote({
    currency: "GBP",
    vatRegistered: true,
    catalogue: {
      currency: "GBP",
      items: [{ id: "build", name: "Build", currency: "GBP", unit: "project", chargeType: "ONE_OFF", unitPriceMinor: 500000, vatRate: "STANDARD" }],
    },
    lines: [{ lineId: "a", kind: "ITEM", itemId: "build", quantity: 1 }],
  });
  if (!result.ok) throw new Error("calc");
  return buildQuoteRenderModel({
    quote: { number: "Q-1", revision: 1, title: "Build", issuedOn: "2026-10-01", validUntil: "2026-10-31" },
    seller: { name: "Studio" },
    buyer: { name: "Sam" },
    calculation: result.quote,
    terms,
    poweredBy: true,
  });
}

const SIGNED_AT = "2026-10-02T10:00:00.000Z";

const capture = (overrides: Partial<SignatureCaptureInput> = {}): SignatureCaptureInput => ({
  typedName: "Sam Buyer",
  consent: true,
  consentText: CONSENT_TEXT,
  consentVersion: CONSENT_TEXT_VERSION,
  signerName: "Sam Buyer",
  signerEmail: "Sam@Buyer.test",
  signerTitle: "Director",
  emailVerifiedAt: "2026-10-02T09:59:00.000Z",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
  signedAt: SIGNED_AT,
  ...overrides,
});

function seal(overrides: Partial<SignatureCaptureInput> = {}, model = renderModel()): SignatureRecord {
  const result = sealSignature({
    businessId: "biz-1",
    quoteId: "q-1",
    revisionId: "rev-1",
    renderModel: model,
    capture: capture(overrides),
    priorEvents: [
      { type: "DOCUMENT_VIEWED", at: "2026-10-02T09:50:00.000Z" },
      { type: "EMAIL_CODE_SENT", at: "2026-10-02T09:58:00.000Z" },
      { type: "EMAIL_VERIFIED", at: "2026-10-02T09:59:00.000Z" },
    ],
  });
  if (!result.ok) assert.fail(JSON.stringify(result.issues));
  return result.record;
}

describe("capture", () => {
  const refused: [string, Partial<SignatureCaptureInput> | Record<string, unknown>][] = [
    ["no typed or drawn signature", { typedName: undefined, drawn: undefined }],
    ["consent unticked", { consent: false as unknown as true }],
    ["missing email", { signerEmail: "not-an-email" }],
    ["bad IP", { ip: "<script>" }],
    ["missing timestamp", { signedAt: "yesterday" }],
    ["consent text too short", { consentText: "ok" }],
    ["a drawn PNG that is not a PNG", { typedName: undefined, drawn: { format: "PNG_DATA_URL", data: "data:image/jpeg;base64,AAAA" } }],
    ["an SVG path with markup", { typedName: undefined, drawn: { format: "SVG_PATH", data: "M0 0 L10 10 <script>" } }],
  ];
  for (const [label, overrides] of refused) {
    test(`refuses ${label}`, () => {
      const result = sealSignature({ businessId: "b", quoteId: "q", revisionId: "r", renderModel: renderModel(), capture: capture(overrides as Partial<SignatureCaptureInput>) });
      assert.equal(result.ok, false);
    });
  }

  test("refuses an audit event dated after the signature", () => {
    const result = sealSignature({
      businessId: "b",
      quoteId: "q",
      revisionId: "r",
      renderModel: renderModel(),
      capture: capture(),
      priorEvents: [{ type: "DOCUMENT_VIEWED", at: "2026-10-03T00:00:00.000Z" }],
    });
    assert.equal(result.ok, false);
  });

  test("typed, drawn, or both", () => {
    assert.equal(seal().method, "TYPED");
    const drawn = { format: "SVG_PATH" as const, data: "M10 10 L20 20 C30 30 40 40 50 50" };
    assert.equal(seal({ typedName: undefined, drawn }).method, "DRAWN");
    const both = seal({ drawn });
    assert.equal(both.method, "TYPED_AND_DRAWN");
    assert.equal(both.drawnSignature?.sha256, sha256Hex(drawn.data));
    const png = seal({ typedName: undefined, drawn: { format: "PNG_DATA_URL", data: "data:image/png;base64,iVBORw0KGgo=" } });
    assert.equal(png.method, "DRAWN");
  });
});

describe("sealed evidence", () => {
  const record = seal();

  test("records who, what, how, where and when", () => {
    assert.equal(record.signatureType, SIGNATURE_TYPE);
    assert.equal(record.documentHash, renderModelHash(renderModel()));
    assert.equal(record.documentHashAlgorithm, "SHA-256");
    assert.equal(record.calculationHash, renderModel().calculationHash);
    assert.deepEqual(record.signer, { name: "Sam Buyer", email: "sam@buyer.test", title: "Director", emailVerifiedAt: "2026-10-02T09:59:00.000Z" });
    assert.deepEqual(record.context, { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (test)" });
    assert.equal(record.consent.given, true);
    assert.equal(record.consent.textSha256, sha256Hex(CONSENT_TEXT));
    assert.equal(record.signedAt, SIGNED_AT);
  });

  test("the audit trail is ordered and hash-chained from the revision's genesis", () => {
    assert.deepEqual(
      record.auditTrail.map((e) => e.type),
      ["DOCUMENT_VIEWED", "EMAIL_CODE_SENT", "EMAIL_VERIFIED", "CONSENT_GIVEN", "SIGNATURE_CAPTURED", "SEALED"],
    );
    assert.equal(record.auditTrail[0].prevHash, genesisHash("rev-1"));
    for (let i = 1; i < record.auditTrail.length; i += 1) assert.equal(record.auditTrail[i].prevHash, record.auditTrail[i - 1].hash);
    assert.equal(record.auditTrail.at(-1)?.detail.documentHash, record.documentHash);
  });

  test("sealing is deterministic", () => {
    assert.equal(seal().recordHash, record.recordHash);
  });

  test("an untouched record verifies against the same revision", () => {
    assert.deepEqual(verifySignature(record, { renderModel: renderModel(), revisionId: "rev-1" }), { valid: true, problems: [] });
  });
});

describe("tamper detection", () => {
  const record = seal({ drawn: { format: "SVG_PATH", data: "M10 10 L20 20 L30 5" } });
  const clone = (): SignatureRecord => structuredClone(record);

  const tampers: [string, (r: SignatureRecord) => SignatureRecord | void, string][] = [
    ["signer name edited", (r) => void (r.signer.name = "Someone Else"), "RECORD_HASH_MISMATCH"],
    ["signing time moved", (r) => void (r.signedAt = "2026-10-01T00:00:00.000Z"), "RECORD_HASH_MISMATCH"],
    ["IP changed", (r) => void (r.context.ip = "198.51.100.1"), "RECORD_HASH_MISMATCH"],
    ["document hash swapped", (r) => void (r.documentHash = "0".repeat(64)), "AUDIT_CHAIN_BROKEN"],
    ["an audit event removed", (r) => void r.auditTrail.splice(1, 1), "AUDIT_CHAIN_BROKEN"],
    ["an audit event re-dated", (r) => void (r.auditTrail[0].at = "2026-01-01T00:00:00.000Z"), "AUDIT_CHAIN_BROKEN"],
    ["drawn signature replaced", (r) => void (r.drawnSignature!.data = "M0 0 L1 1 L2 2"), "DRAWN_SIGNATURE_ALTERED"],
    ["consent text rewritten", (r) => void (r.consent.text = "I agree to anything at all whatsoever."), "CONSENT_TEXT_ALTERED"],
  ];
  for (const [label, mutate, problem] of tampers) {
    test(`detects ${label}`, () => {
      const tampered = clone();
      mutate(tampered);
      const result = verifySignature(tampered, { renderModel: renderModel() });
      assert.equal(result.valid, false);
      assert.ok(result.problems.includes(problem as never), JSON.stringify(result.problems));
    });
  }

  test("detects tampering even when the attacker recomputes the record hash", () => {
    const tampered = clone();
    tampered.documentHash = renderModelHash(renderModel("Payment within 90 days."));
    const body: Partial<SignatureRecord> = { ...tampered };
    delete body.recordHash;
    tampered.recordHash = sha256Hex(JSON.stringify(body)); // wrong canonicalisation, still caught
    assert.equal(verifySignature(tampered).valid, false);
  });

  test("a change to the quote itself is detected against the sealed hash", () => {
    const result = verifySignature(record, { renderModel: renderModel("Payment within 90 days.") });
    assert.deepEqual(result, { valid: false, problems: ["DOCUMENT_HASH_MISMATCH"] });
  });

  test("a signature presented for another revision is refused", () => {
    assert.deepEqual(verifySignature(record, { revisionId: "rev-2" }).problems, ["REVISION_MISMATCH"]);
  });

  test("chainEvents is reproducible", () => {
    const events = [{ type: "DOCUMENT_VIEWED" as const, at: SIGNED_AT }];
    assert.deepEqual(chainEvents("r", events), chainEvents("r", events));
    assert.notEqual(chainEvents("r", events)[0].hash, chainEvents("s", events)[0].hash);
  });
});

describe("legal wording", () => {
  test("describes a simple electronic signature and never claims a higher tier", () => {
    assert.match(SIGNATURE_NOTICE, /simple electronic signature/i);
    assert.match(SIGNATURE_NOTICE, /Electronic Communications Act 2000/);
    assert.match(SIGNATURE_NOTICE, /UK eIDAS/);
    assert.match(SIGNATURE_TYPE_LABEL, /^Simple electronic signature/);
    for (const text of [SIGNATURE_NOTICE, SIGNATURE_TYPE_LABEL, CONSENT_TEXT]) {
      assert.doesNotMatch(text, /\badvanced\b|\bqualified\b|legally binding in all/i);
    }
    assert.equal(SIGNATURE_TYPE, "SIMPLE_ELECTRONIC_SIGNATURE");
  });

  test("notes that some documents need another form of signature", () => {
    assert.match(SIGNATURE_NOTICE, /deeds/);
  });
});
