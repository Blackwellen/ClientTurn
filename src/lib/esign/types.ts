/**
 * First-party e-signature: the capture the signing page posts and the
 * sealed record stored in `quote_signatures` (append-only). Pure: zod only.
 */

import { z } from "zod";
import { SIGNATURE_TYPE } from "./notice.ts";

const SVG_PATH = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export const drawnSignatureSchema = z
  .object({
    format: z.enum(["SVG_PATH", "PNG_DATA_URL"]),
    data: z.string().min(10).max(200_000),
  })
  .refine((drawn) => (drawn.format === "SVG_PATH" ? SVG_PATH.test(drawn.data) : PNG_DATA_URL.test(drawn.data)), {
    message: "The drawn signature is not a valid path or PNG.",
    path: ["data"],
  });
export type DrawnSignature = z.infer<typeof drawnSignatureSchema>;

export const signatureCaptureSchema = z
  .object({
    /** Signing by typing the name. */
    typedName: z.string().trim().min(2).max(120).optional(),
    drawn: drawnSignatureSchema.optional(),
    /** The explicit consent checkbox. Must be ticked (true), never defaulted. */
    consent: z.literal(true),
    /** The exact consent wording shown next to the checkbox, and its version. */
    consentText: z.string().trim().min(20).max(1000),
    consentVersion: z.string().trim().min(1).max(40),
    signerName: z.string().trim().min(2).max(120),
    signerEmail: z.string().trim().toLowerCase().email().max(254),
    signerTitle: z.string().trim().max(120).optional(),
    /** Set when the signer proved the email with a one-time code. */
    emailVerifiedAt: z.string().datetime().optional(),
    /** As passed in by the route handler (x-forwarded-for first hop). */
    ip: z.string().trim().min(2).max(64).regex(/^[0-9A-Fa-f:.]+$/, "Not an IP address"),
    userAgent: z.string().trim().min(1).max(512),
    signedAt: z.string().datetime(),
  })
  .refine((capture) => capture.typedName !== undefined || capture.drawn !== undefined, {
    message: "Type your name, draw your signature, or both.",
    path: ["typedName"],
  });
export type SignatureCapture = z.infer<typeof signatureCaptureSchema>;
export type SignatureCaptureInput = z.input<typeof signatureCaptureSchema>;

export const AUDIT_EVENT_TYPES = [
  "DOCUMENT_VIEWED",
  "EMAIL_CODE_SENT",
  "EMAIL_VERIFIED",
  "CONSENT_GIVEN",
  "SIGNATURE_CAPTURED",
  "SEALED",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditEventInput = { type: AuditEventType; at: string; detail?: Record<string, string> };

export type AuditEvent = {
  seq: number;
  type: AuditEventType;
  at: string;
  detail: Record<string, string>;
  prevHash: string;
  hash: string;
};

export type SignatureMethod = "TYPED" | "DRAWN" | "TYPED_AND_DRAWN";

export type SignatureRecord = {
  schema: "clientturn.signature/1";
  signatureType: typeof SIGNATURE_TYPE;
  businessId: string;
  quoteId: string;
  revisionId: string;
  documentHashAlgorithm: "SHA-256";
  /** sha256(canonicalJson(render model)) of the revision the signer saw. */
  documentHash: string;
  calculationHash: string;
  signer: { name: string; email: string; title: string | null; emailVerifiedAt: string | null };
  method: SignatureMethod;
  typedName: string | null;
  drawnSignature: { format: DrawnSignature["format"]; data: string; sha256: string } | null;
  consent: { given: true; text: string; textSha256: string; version: string };
  context: { ip: string; userAgent: string };
  signedAt: string;
  auditTrail: AuditEvent[];
  /** sha256 over every field above: any edit to the stored record is detectable. */
  recordHash: string;
};

export type VerificationProblem =
  | "RECORD_HASH_MISMATCH"
  | "DOCUMENT_HASH_MISMATCH"
  | "AUDIT_CHAIN_BROKEN"
  | "DRAWN_SIGNATURE_ALTERED"
  | "CONSENT_TEXT_ALTERED"
  | "CONSENT_MISSING"
  | "NO_SIGNATURE"
  | "WRONG_SIGNATURE_TYPE"
  | "REVISION_MISMATCH";

export type VerificationResult = { valid: boolean; problems: VerificationProblem[] };
