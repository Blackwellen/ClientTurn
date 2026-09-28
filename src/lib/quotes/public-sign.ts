/**
 * The public quote page's POST handlers (/q/[token]/sign and /q/[token]/view),
 * as pure functions over injected dependencies so every guard is tested
 * without a server (tests/quote-public-sign.test.ts):
 *
 *   1. rate limit per client address
 *   2. same-origin: the Origin (or Referer) must be this site, and a browser's
 *      Sec-Fetch-Site must not be cross-site. The body is JSON with a custom
 *      header, which a cross-site form cannot send without a CORS preflight.
 *   3. a form nonce: HMAC-SHA256 over the token hash and the time it was
 *      issued, rendered into the page and valid for two hours. A request that
 *      did not come from a page the server rendered for THIS link is refused.
 *   4. the token: pattern, then looked up by its SHA-256 and verified in
 *      constant time (tokens.ts); every failure is the same generic 404.
 *   5. the body (zod), then accept + seal + record through the 0153 RPCs.
 *      Accept and sign carry deterministic action keys per revision, so a
 *      replayed or double-clicked POST records ONE acceptance and ONE
 *      signature and answers exactly as the first did.
 *
 * Pure: `node:crypto` and relative imports only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from "../esign/notice.ts";
import { sealSignature } from "../esign/seal.ts";
import { drawnSignatureSchema, type AuditEventInput, type SignatureRecord } from "../esign/types.ts";
import { quoteActionKey } from "./idempotency.ts";
import { renderModelHash } from "./render-model.ts";
import { TOKEN_PATTERN, TOKEN_UNAVAILABLE_MESSAGE, hashToken } from "./tokens.ts";
import type { QuoteState } from "./lifecycle.ts";
import type { QuoteRenderModel } from "./types.ts";

/* ------------------------------------------------------------ form nonce */

export const NONCE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const CLIENT_HEADER = "x-clientturn-quote";

export function issueFormNonce(secret: string, token: string, now: Date): string {
  const issued = now.getTime().toString(36);
  const mac = createHmac("sha256", secret).update(`quote-form:v1:${hashToken(token)}:${issued}`).digest("base64url");
  return `${issued}.${mac}`;
}

export function verifyFormNonce(secret: string, token: string, nonce: unknown, now: Date): boolean {
  if (typeof nonce !== "string" || !/^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{43}$/.test(nonce)) return false;
  const [issued, mac] = nonce.split(".");
  const issuedAt = parseInt(issued, 36);
  if (!Number.isFinite(issuedAt) || issuedAt > now.getTime() + 60_000 || now.getTime() - issuedAt > NONCE_MAX_AGE_MS) return false;
  const expected = createHmac("sha256", secret).update(`quote-form:v1:${hashToken(token)}:${issued}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ----------------------------------------------------------- same origin */

export type RequestHeaders = { get(name: string): string | null };

export function isSameOrigin(headers: RequestHeaders, allowedOrigins: readonly string[]): boolean {
  if (headers.get(CLIENT_HEADER) !== "1") return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const allowed = allowedOrigins.map((origin) => origin.replace(/\/$/, "").toLowerCase());
  const origin = headers.get("origin");
  if (origin) return allowed.includes(origin.replace(/\/$/, "").toLowerCase());
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return allowed.includes(new URL(referer).origin.toLowerCase());
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ the context */

export type PublicQuoteContext = {
  businessId: string;
  quoteId: string;
  revisionId: string;
  quoteStatus: QuoteState;
  renderModel: QuoteRenderModel;
  renderHash: string;
  calculationHash: string;
  validUntil: string | null;
  firstViewedAt: string | null;
  purpose: "VIEW_AND_SIGN" | "VIEW_ONLY";
  leadId: string | null;
  /** esign_enabled for the workspace (can()). Off: accept with a typed name only. */
  esignEnabled: boolean;
  requireDrawnSignature: boolean;
};

export type NextStep = { kind: "PAY"; label: string; url: string } | { kind: "NONE"; message: string };

export type PublicDeps = {
  now: () => Date;
  secret: string;
  allowedOrigins: readonly string[];
  rateLimited: (clientId: string) => Promise<boolean>;
  /** Resolves a VERIFIED token (hash lookup + constant-time check + current revision + not revoked/expired). */
  resolve: (token: string) => Promise<PublicQuoteContext | null>;
  accept: (input: { context: PublicQuoteContext; actionKey: string; evidence: AcceptanceEvidence }) => Promise<{ ok: boolean; duplicate?: boolean; reason?: string }>;
  recordSignature: (input: { context: PublicQuoteContext; actionKey: string; record: SignatureRecord }) => Promise<{ ok: boolean; duplicate?: boolean; reason?: string }>;
  markViewed: (context: PublicQuoteContext) => Promise<{ firstView: boolean }>;
  nextStep: (context: PublicQuoteContext) => Promise<NextStep>;
  emit: (context: PublicQuoteContext, type: "quote.accepted" | "quote.signed" | "quote.viewed") => Promise<void>;
  /**
   * Every view of a live quote (brief §72): a lead who opens it again and
   * again is weighing it up, which the live implementation records as a HIGH
   * buying-intent signal once the views reach the threshold
   * (quotes/follow-up.ts). Never throws. Optional: absent in older wiring.
   */
  onView?: (context: PublicQuoteContext) => Promise<void>;
};

export type AcceptanceEvidence = { email: string; ip: string; userAgent: string; documentHash: string };

export type PublicResponse = { status: number; body: Record<string, unknown> };

const GENERIC_404: PublicResponse = { status: 404, body: { ok: false, error: TOKEN_UNAVAILABLE_MESSAGE } };

export const signBodySchema = z.object({
  nonce: z.string().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  signerName: z.string().trim().min(2).max(120),
  signerEmail: z.string().trim().toLowerCase().email().max(254),
  signerTitle: z.string().trim().max(120).optional(),
  typedName: z.string().trim().min(2).max(120).optional(),
  drawn: drawnSignatureSchema.optional(),
  consent: z.literal(true),
  consentVersion: z.literal(CONSENT_TEXT_VERSION),
});
export type SignBody = z.infer<typeof signBodySchema>;

export function clientAddress(headers: RequestHeaders): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9A-Fa-f:.]{2,64}$/.test(candidate) ? candidate : "0.0.0.0";
}

async function guard(deps: PublicDeps, token: string, headers: RequestHeaders): Promise<PublicResponse | null> {
  if (await deps.rateLimited(clientAddress(headers))) {
    return { status: 429, body: { ok: false, error: "Too many requests. Please wait a moment and try again." } };
  }
  if (!isSameOrigin(headers, deps.allowedOrigins)) {
    return { status: 403, body: { ok: false, error: "This request did not come from the quote page." } };
  }
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return GENERIC_404;
  return null;
}

/** POST /q/[token]/view: records the first view (once per browser session, idempotent server-side). */
export async function handleQuoteViewRequest(deps: PublicDeps, token: string, headers: RequestHeaders, rawBody: unknown): Promise<PublicResponse> {
  const refused = await guard(deps, token, headers);
  if (refused) return refused;
  const nonce = (rawBody as { nonce?: unknown } | null)?.nonce;
  if (!verifyFormNonce(deps.secret, token, nonce, deps.now())) return { status: 403, body: { ok: false, error: "This page has expired. Reload it." } };
  const context = await deps.resolve(token);
  if (!context) return GENERIC_404;
  if (context.quoteStatus === "VIEWED") {
    if (deps.onView) await deps.onView(context);
    return { status: 200, body: { ok: true, recorded: false } };
  }
  if (context.quoteStatus !== "SENT") return { status: 200, body: { ok: true, recorded: false } };
  const { firstView } = await deps.markViewed(context);
  if (firstView) await deps.emit(context, "quote.viewed");
  if (deps.onView) await deps.onView(context);
  return { status: 200, body: { ok: true, recorded: firstView } };
}

/** POST /q/[token]/sign: accept (and sign, where e-signature is on). */
export async function handleQuoteSignRequest(deps: PublicDeps, token: string, headers: RequestHeaders, rawBody: unknown): Promise<PublicResponse> {
  const refused = await guard(deps, token, headers);
  if (refused) return refused;

  const parsed = signBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: 400, body: { ok: false, error: issue ? issue.message : "Some details were missing.", field: issue?.path.join(".") ?? null } };
  }
  const body = parsed.data;
  const now = deps.now();
  if (!verifyFormNonce(deps.secret, token, body.nonce, now)) {
    return { status: 403, body: { ok: false, error: "This page has expired. Reload it and sign again." } };
  }

  const context = await deps.resolve(token);
  if (!context) return GENERIC_404;
  if (context.purpose !== "VIEW_AND_SIGN") return GENERIC_404;

  const signed = context.quoteStatus === "SIGNED" || context.quoteStatus === "DEPOSIT_PAID" || context.quoteStatus === "PAID" || context.quoteStatus === "WON";
  const acceptedOnly = context.quoteStatus === "ACCEPTED" && !context.esignEnabled;
  if (signed || acceptedOnly) {
    // A replay (double click, retry after a dropped response): same answer, nothing new recorded.
    return { status: 200, body: { ok: true, duplicate: true, status: context.quoteStatus, nextStep: await deps.nextStep(context) } };
  }
  if (!["SENT", "VIEWED", "ACCEPTED"].includes(context.quoteStatus)) {
    return { status: 409, body: { ok: false, error: "This quote can no longer be accepted. Ask the sender for a new one." } };
  }
  if (context.validUntil && Date.parse(context.validUntil) < now.getTime()) {
    return { status: 409, body: { ok: false, error: "This quote has expired. Ask the sender for a new one." } };
  }

  const typedName = body.typedName ?? (context.esignEnabled ? undefined : body.signerName);
  if (context.esignEnabled) {
    if (!typedName && !body.drawn) return { status: 400, body: { ok: false, error: "Type your name, draw your signature, or both.", field: "typedName" } };
    if (context.requireDrawnSignature && !body.drawn) {
      return { status: 400, body: { ok: false, error: "Draw your signature in the box.", field: "drawn" } };
    }
  }

  const ip = clientAddress(headers);
  const userAgent = (headers.get("user-agent") ?? "unknown").slice(0, 512) || "unknown";
  const documentHash = renderModelHash(context.renderModel);
  if (documentHash !== context.renderHash) {
    // The stored model no longer hashes to what was frozen: never sign it.
    return { status: 409, body: { ok: false, error: "This quote cannot be signed right now. Ask the sender for a new link." } };
  }

  if (context.quoteStatus !== "ACCEPTED") {
    const accepted = await deps.accept({
      context,
      actionKey: quoteActionKey({ revisionId: context.revisionId, action: "ACCEPT" }),
      evidence: { email: body.signerEmail, ip, userAgent, documentHash },
    });
    if (!accepted.ok) {
      return { status: 409, body: { ok: false, error: "This quote can no longer be accepted. Ask the sender for a new one." } };
    }
    if (!accepted.duplicate) await deps.emit(context, "quote.accepted");
  }

  if (!context.esignEnabled) {
    return { status: 200, body: { ok: true, status: "ACCEPTED", nextStep: await deps.nextStep(context) } };
  }

  const priorEvents: AuditEventInput[] = context.firstViewedAt && Date.parse(context.firstViewedAt) <= now.getTime()
    ? [{ type: "DOCUMENT_VIEWED", at: new Date(context.firstViewedAt).toISOString() }]
    : [];
  const sealed = sealSignature({
    businessId: context.businessId,
    quoteId: context.quoteId,
    revisionId: context.revisionId,
    renderModel: context.renderModel,
    priorEvents,
    capture: {
      typedName,
      drawn: body.drawn,
      consent: true,
      consentText: CONSENT_TEXT,
      consentVersion: CONSENT_TEXT_VERSION,
      signerName: body.signerName,
      signerEmail: body.signerEmail,
      signerTitle: body.signerTitle || undefined,
      ip,
      userAgent,
      signedAt: now.toISOString(),
    },
  });
  if (!sealed.ok) {
    const issue = sealed.issues[0];
    return { status: 400, body: { ok: false, error: issue?.message ?? "The signature could not be recorded.", field: issue?.path.join(".") ?? null } };
  }
  const recorded = await deps.recordSignature({
    context: { ...context, quoteStatus: "ACCEPTED" },
    actionKey: quoteActionKey({ revisionId: context.revisionId, action: "SIGN" }),
    record: sealed.record,
  });
  if (!recorded.ok) {
    return { status: 409, body: { ok: false, error: "The signature could not be recorded. Reload the page and try again." } };
  }
  if (!recorded.duplicate) await deps.emit(context, "quote.signed");
  return { status: 200, body: { ok: true, status: "SIGNED", duplicate: Boolean(recorded.duplicate), nextStep: await deps.nextStep(context) } };
}

/** The sealed record as the `quote_record_signature` RPC's snake_case JSON. */
export function signatureRpcPayload(record: SignatureRecord): Record<string, unknown> {
  return {
    document_hash: record.documentHash,
    calculation_hash: record.calculationHash,
    signer_name: record.signer.name,
    signer_email: record.signer.email,
    signer_title: record.signer.title,
    email_verified_at: record.signer.emailVerifiedAt,
    method: record.method,
    typed_name: record.typedName,
    drawn_format: record.drawnSignature?.format ?? null,
    drawn_data: record.drawnSignature?.data ?? null,
    drawn_sha256: record.drawnSignature?.sha256 ?? null,
    consent_given: true,
    consent_text: record.consent.text,
    consent_sha256: record.consent.textSha256,
    consent_version: record.consent.version,
    ip: record.context.ip,
    user_agent: record.context.userAgent,
    signed_at: record.signedAt,
    audit_trail: record.auditTrail,
    record_hash: record.recordHash,
  };
}
