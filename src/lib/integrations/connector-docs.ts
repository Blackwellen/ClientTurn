/**
 * Copyable documentation for an inbound connector (Programme §5).
 *
 * Pure — no `server-only`, no Supabase — so the examples can be rendered in
 * Settings, asserted in tests, and kept in step with the ingest route's schema
 * without a database.
 *
 * These exist because the endpoint is the product for a connector, and the
 * commonest way a connection fails is that somebody guessed the signing scheme.
 */

import type { AuthMethod } from "./apps";

/** A payload matching what the ingest route accepts, for documentation. */
export function examplePayload(): Record<string, unknown> {
  return {
    eventId: "your-system-id-12345",
    eventType: "contact.created",
    firstName: "Priya",
    lastName: "Shah",
    email: "priya@example.co.uk",
    phone: "+447700900123",
    company: "Example Roofing Ltd",
  };
}

/**
 * A copyable cURL for this exact installation.
 *
 * Generated per auth method rather than shown as a generic example, because the
 * signing method is where these go wrong: an HMAC sender needs the timestamp in
 * the signed string and almost nobody guesses that from prose. For HMAC the
 * command computes the signature inline, so it can be pasted and run.
 */
export function exampleCurl(input: {
  endpoint: string;
  authMethod: AuthMethod;
  headerName?: string | null;
}): string {
  const body = JSON.stringify(examplePayload());

  if (input.authMethod === "hmac_sha256") {
    return [
      `SECRET='your-signing-secret'`,
      `TS=$(date +%s)`,
      `BODY='${body}'`,
      `SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')`,
      `curl -X POST '${input.endpoint}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -H "X-ClientTurn-Timestamp: $TS" \\`,
      `  -H "X-ClientTurn-Signature: $SIG" \\`,
      `  -d "$BODY"`,
    ].join("\n");
  }

  const authHeader =
    input.authMethod === "bearer"
      ? `  -H 'Authorization: Bearer your-token' \\`
      : input.authMethod === "api_key_header"
        ? `  -H '${input.headerName || "X-Api-Key"}: your-api-key' \\`
        : `  -u 'your-username:your-password' \\`;

  return [
    `curl -X POST '${input.endpoint}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    authHeader,
    `  -d '${body}'`,
  ].join("\n");
}

