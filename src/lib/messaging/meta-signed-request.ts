import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's `signed_request`, as used by the deauthorize and data-deletion
 * callbacks.
 *
 * Pure — no `server-only`, no Supabase, no `serverEnv` — for the same reason as
 * `meta-protocol.ts`: this stands between the public internet and the deletion
 * of a customer's data, so it is the code that most needs to be testable
 * directly, and a module that cannot be imported without a service-role client
 * cannot be tested without one.
 *
 * ## The format, and the two traps in it
 *
 * A signed request is `<signature>.<payload>`, both base64**url**-encoded, with
 * the signature an HMAC-SHA256 of the *encoded payload string* under the app
 * secret.
 *
 *   1. **base64url, not base64.** `-` and `_` stand in for `+` and `/`, and the
 *      `=` padding is stripped. Decoding it with a plain base64 reader appears
 *      to work for most inputs and silently corrupts the rest, which is the
 *      worst possible failure mode for a signature check.
 *   2. **The signature covers the encoded payload, not the decoded JSON.**
 *      Decoding first and re-encoding to verify would reorder nothing and still
 *      break, because the padding was stripped.
 *
 * Meta also sends `algorithm: "HMAC-SHA256"` inside the payload. It is checked
 * rather than trusted: a payload that asks to be verified with a weaker
 * algorithm is the oldest trick there is, and the answer is to refuse anything
 * that is not the algorithm we expect.
 */

export type SignedRequestPayload = {
  /** The app-scoped id of the person who authorised the app. */
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  expires?: number;
  /** Present on some products; unused here but preserved for the audit row. */
  profile_id?: string;
};

export type SignedRequestResult =
  | { ok: true; payload: SignedRequestPayload; userId: string }
  | { ok: false; reason: string };

function base64UrlDecode(value: string): Buffer | null {
  // Restore the standard alphabet and the padding Meta strips.
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    "=",
  );

  // A round-trip check: `Buffer.from` never throws on bad base64, it silently
  // discards what it cannot read. Comparing the re-encoded form is the only way
  // to know the input was actually valid.
  const decoded = Buffer.from(padded, "base64");
  if (decoded.toString("base64") !== padded) return null;

  return decoded;
}

/**
 * Verifies and decodes a `signed_request`.
 *
 * Returns a reason rather than throwing on every failure path. This is called
 * from a route handler answering attacker-controlled input, and an exception
 * thrown from a verifier is a 500 where a 400 belongs.
 */
export function parseSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string | null | undefined,
): SignedRequestResult {
  if (!appSecret) return { ok: false, reason: "The app secret is not configured." };
  if (!signedRequest) return { ok: false, reason: "No signed_request was supplied." };

  const parts = signedRequest.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "A signed_request must be two dot-separated parts." };
  }

  const [encodedSignature, encodedPayload] = parts;

  const signature = base64UrlDecode(encodedSignature);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!signature || !payloadBytes) {
    return { ok: false, reason: "The signed_request is not valid base64url." };
  }

  // Over the *encoded* payload, exactly as received. See the note above.
  const expected = createHmac("sha256", appSecret).update(encodedPayload, "utf8").digest();

  // Length first: `timingSafeEqual` throws on a mismatch, and a digest's length
  // is not a secret.
  if (signature.length !== expected.length) {
    return { ok: false, reason: "The signature does not match." };
  }
  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, reason: "The signature does not match." };
  }

  let payload: SignedRequestPayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as SignedRequestPayload;
  } catch {
    return { ok: false, reason: "The payload is not JSON." };
  }

  // Checked, never trusted. A payload naming a weaker algorithm is refused
  // rather than honoured.
  if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, reason: `Unsupported algorithm: ${payload.algorithm}.` };
  }

  if (!payload.user_id) {
    return { ok: false, reason: "The payload names no user." };
  }

  return { ok: true, payload, userId: payload.user_id };
}

/**
 * A short, unguessable code the customer can quote back to us.
 *
 * Meta requires the data-deletion callback to return a confirmation code and a
 * URL where the person can check the status of their request. The code is
 * random rather than derived from the user id: a derived code would let anyone
 * who knows somebody's Meta id look up their deletion request.
 */
export function deletionConfirmationCode(bytes: Buffer): string {
  return bytes.toString("hex").slice(0, 24);
}
