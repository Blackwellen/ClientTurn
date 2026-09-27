/**
 * Signature verification for the two payment-confirmation endpoints.
 *
 * Pure (`node:crypto` only) so both are asserted with fixtures in
 * tests/direct-sale.test.ts, including a fixture produced by the Stripe SDK
 * itself.
 *
 *   * Stripe (the customer's own account): `Stripe-Signature:
 *     t=<unix>,v1=<hex>[,v1=<hex>...]`, where v1 is HMAC-SHA256 over
 *     `${t}.${rawBody}` keyed with the endpoint's whole signing secret
 *     (`whsec_...`). Any v1 may match (Stripe sends several while a secret
 *     is being rolled). Five minutes of tolerance, Stripe's own default.
 *   * The generic "order paid" webhook: the same scheme as the inbound
 *     contact endpoint (api/apps/[id]/events): `X-ClientTurn-Timestamp:
 *     <unix>` and `X-ClientTurn-Signature: <hex>` = HMAC-SHA256 over
 *     `${timestamp}.${rawBody}` with the workspace's secret; five minutes
 *     each way.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** Parses `t=...,v1=...,v1=...`. */
export function parseStripeSignatureHeader(header: string | null | undefined): { t: string; v1: string[] } | null {
  if (!header) return null;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") t = value;
    if (key === "v1") v1.push(value.toLowerCase());
  }
  if (!/^\d{1,12}$/.test(t) || v1.length === 0) return null;
  return { t, v1 };
}

export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | null | undefined;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureVerdict {
  if (!input.header || !input.secret) return { ok: false, reason: "missing" };
  const parsed = parseStripeSignatureHeader(input.header);
  if (!parsed) return { ok: false, reason: "malformed" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(parsed.t)) > tolerance) return { ok: false, reason: "stale" };
  const expected = hmacHex(input.secret, `${parsed.t}.${input.rawBody}`);
  return parsed.v1.some((candidate) => safeEqualHex(candidate, expected))
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

/** Builds a Stripe-Signature header. Tests and the local simulator only. */
export function signStripePayload(rawBody: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}

export function verifyOrderPaidSignature(input: {
  rawBody: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  secret: string;
  nowSeconds?: number;
}): SignatureVerdict {
  if (!input.timestamp || !input.signature || !input.secret) return { ok: false, reason: "missing" };
  // Bounded digits rather than an exact width (the contact endpoint's rule).
  if (!/^\d{9,12}$/.test(input.timestamp)) return { ok: false, reason: "malformed" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(input.timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = hmacHex(input.secret, `${input.timestamp}.${input.rawBody}`);
  return safeEqualHex(input.signature.trim().toLowerCase(), expected)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

/** Signs an order-paid body the way a sender must. Documented; used by tests. */
export function signOrderPaid(rawBody: string, secret: string, timestamp: number): string {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}
