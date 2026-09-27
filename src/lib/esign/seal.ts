/**
 * Sealing and verifying a simple electronic signature (see notice.ts).
 *
 * Evidence captured in every record:
 *   - WHAT was signed: documentHash = sha256(canonicalJson(render model))
 *     of the exact revision shown (quotes/render-model.ts), plus the
 *     calculationHash of its prices.
 *   - WHO: signer name, email (and when it was verified by a one-time
 *     code, when it was), optional title.
 *   - HOW: typed name, drawn signature (stored with its own SHA-256), or
 *     both; the explicit consent checkbox with the exact consent text, its
 *     version and hash.
 *   - WHERE / WHEN: IP address and user-agent as passed in by the route
 *     handler; the signing timestamp.
 *   - An audit trail of events, each hash-chained to the previous one
 *     (viewed -> code sent -> verified -> consent -> captured -> sealed).
 *   - recordHash over all of the above.
 *
 * verifySignature recomputes every hash; a change to any stored field, to
 * the audit trail, or to the document itself is reported.
 */

import { canonicalJson, hashCanonical, sha256Hex } from "../quotes/canonical.ts";
import { renderModelHash } from "../quotes/render-model.ts";
import type { QuoteRenderModel } from "../quotes/types.ts";
import { SIGNATURE_TYPE } from "./notice.ts";
import {
  signatureCaptureSchema,
  type AuditEvent,
  type AuditEventInput,
  type SignatureRecord,
  type VerificationProblem,
  type VerificationResult,
} from "./types.ts";

export function genesisHash(revisionId: string): string {
  return sha256Hex(`clientturn.signature/1:${revisionId}`);
}

function eventHash(event: Omit<AuditEvent, "hash">): string {
  return sha256Hex(canonicalJson(event));
}

export function chainEvents(revisionId: string, events: readonly AuditEventInput[]): AuditEvent[] {
  const chained: AuditEvent[] = [];
  let prevHash = genesisHash(revisionId);
  events.forEach((event, index) => {
    const body = { seq: index + 1, type: event.type, at: event.at, detail: { ...(event.detail ?? {}) }, prevHash };
    const hash = eventHash(body);
    chained.push({ ...body, hash });
    prevHash = hash;
  });
  return chained;
}

export function computeRecordHash(record: Omit<SignatureRecord, "recordHash">): string {
  return hashCanonical(record);
}

export type SealInput = {
  businessId: string;
  quoteId: string;
  revisionId: string;
  renderModel: QuoteRenderModel;
  capture: unknown;
  /** Earlier events from the signing session (viewed, code sent, verified). */
  priorEvents?: AuditEventInput[];
};

export type SealResult =
  | { ok: true; record: SignatureRecord }
  | { ok: false; issues: { path: (string | number)[]; message: string }[] };

export function sealSignature(input: SealInput): SealResult {
  const parsed = signatureCaptureSchema.safeParse(input.capture);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      })),
    };
  }
  const capture = parsed.data;
  const prior = [...(input.priorEvents ?? [])];
  const late = prior.find((event) => Date.parse(event.at) > Date.parse(capture.signedAt));
  if (late) {
    return { ok: false, issues: [{ path: ["priorEvents"], message: "An audit event is dated after the signature." }] };
  }

  const documentHash = renderModelHash(input.renderModel);
  const method = capture.typedName && capture.drawn ? "TYPED_AND_DRAWN" : capture.typedName ? "TYPED" : "DRAWN";
  const drawnSignature = capture.drawn
    ? { format: capture.drawn.format, data: capture.drawn.data, sha256: sha256Hex(capture.drawn.data) }
    : null;

  const auditTrail = chainEvents(input.revisionId, [
    ...prior,
    { type: "CONSENT_GIVEN", at: capture.signedAt, detail: { version: capture.consentVersion } },
    { type: "SIGNATURE_CAPTURED", at: capture.signedAt, detail: { method } },
    { type: "SEALED", at: capture.signedAt, detail: { documentHash } },
  ]);

  const body: Omit<SignatureRecord, "recordHash"> = {
    schema: "clientturn.signature/1",
    signatureType: SIGNATURE_TYPE,
    businessId: input.businessId,
    quoteId: input.quoteId,
    revisionId: input.revisionId,
    documentHashAlgorithm: "SHA-256",
    documentHash,
    calculationHash: input.renderModel.calculationHash,
    signer: {
      name: capture.signerName,
      email: capture.signerEmail,
      title: capture.signerTitle ?? null,
      emailVerifiedAt: capture.emailVerifiedAt ?? null,
    },
    method,
    typedName: capture.typedName ?? null,
    drawnSignature,
    consent: { given: true, text: capture.consentText, textSha256: sha256Hex(capture.consentText), version: capture.consentVersion },
    context: { ip: capture.ip, userAgent: capture.userAgent },
    signedAt: capture.signedAt,
    auditTrail,
  };
  return { ok: true, record: { ...body, recordHash: computeRecordHash(body) } };
}

/**
 * Verify a stored record. Pass the render model rebuilt from the stored
 * revision to prove the document itself is unchanged; pass the expected
 * revision id to prove the signature belongs to it.
 */
export function verifySignature(
  record: SignatureRecord,
  options: { renderModel?: QuoteRenderModel; revisionId?: string } = {},
): VerificationResult {
  const problems: VerificationProblem[] = [];
  const { recordHash, ...body } = record;
  if (computeRecordHash(body) !== recordHash) problems.push("RECORD_HASH_MISMATCH");

  let prevHash = genesisHash(record.revisionId);
  const chainOk = record.auditTrail.every((event, index) => {
    const { hash, ...rest } = event;
    const ok = rest.seq === index + 1 && rest.prevHash === prevHash && eventHash(rest) === hash;
    prevHash = hash;
    return ok;
  });
  const sealed = record.auditTrail.at(-1);
  if (!chainOk || !sealed || sealed.type !== "SEALED" || sealed.detail.documentHash !== record.documentHash) {
    problems.push("AUDIT_CHAIN_BROKEN");
  }

  if (options.renderModel && renderModelHash(options.renderModel) !== record.documentHash) {
    problems.push("DOCUMENT_HASH_MISMATCH");
  }
  if (options.revisionId !== undefined && options.revisionId !== record.revisionId) problems.push("REVISION_MISMATCH");
  if (record.drawnSignature && sha256Hex(record.drawnSignature.data) !== record.drawnSignature.sha256) {
    problems.push("DRAWN_SIGNATURE_ALTERED");
  }
  if (record.consent?.given !== true) problems.push("CONSENT_MISSING");
  else if (sha256Hex(record.consent.text) !== record.consent.textSha256) problems.push("CONSENT_TEXT_ALTERED");
  if (!record.typedName && !record.drawnSignature) problems.push("NO_SIGNATURE");
  if (record.signatureType !== SIGNATURE_TYPE) problems.push("WRONG_SIGNATURE_TYPE");

  return { valid: problems.length === 0, problems };
}
