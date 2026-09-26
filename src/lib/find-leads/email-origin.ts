/**
 * Email origin and verification class (brief §26). Pure: no Supabase, no
 * `server-only`; tests import it with its `.ts` extension.
 *
 * Where an address came from is a different fact from whether it works:
 *
 *   origin        FOUND_PUBLICLY        read verbatim from the company's own site
 *                 PROVIDED_BY_PROVIDER  a licensed provider returned it as held
 *                 CRM_IMPORTED          the customer's own CRM or import file
 *                 CUSTOMER_PROVIDED     the person gave it (form, DM, manual entry, API)
 *                 PATTERN_INFERRED      a provider guessed it from a name pattern
 *   verification  VERIFIED | UNVERIFIED | INVALID, derived from
 *                 prospects.verification_status (VALID / INVALID / anything else).
 *
 * The rule the brief sets: never send solely because an address was guessed.
 * Cold dispatch refuses PATTERN_INFERRED unless the address has since been
 * verified.
 */

export const EMAIL_ORIGINS = [
  "FOUND_PUBLICLY",
  "PROVIDED_BY_PROVIDER",
  "CRM_IMPORTED",
  "CUSTOMER_PROVIDED",
  "PATTERN_INFERRED",
] as const;
export type EmailOrigin = (typeof EMAIL_ORIGINS)[number];

export type EmailVerificationClass = "VERIFIED" | "UNVERIFIED" | "INVALID";

export function isEmailOrigin(value: unknown): value is EmailOrigin {
  return typeof value === "string" && (EMAIL_ORIGINS as readonly string[]).includes(value);
}

/**
 * Apollo's `email_status`: "verified", "unverified", "likely to engage",
 * "guessed", "extrapolated", "unavailable". Guessed and extrapolated addresses
 * are built from a name pattern, not held.
 */
export function apolloEmailOrigin(emailStatus: string | null | undefined): EmailOrigin {
  const status = (emailStatus ?? "").trim().toLowerCase();
  return status === "guessed" || status === "extrapolated" ? "PATTERN_INFERRED" : "PROVIDED_BY_PROVIDER";
}

/** The origin a sourcing provider's contact carries when it did not say. */
export function originForProvider(provider: string | null | undefined): EmailOrigin {
  return provider === "website_contacts" ? "FOUND_PUBLICLY" : "PROVIDED_BY_PROVIDER";
}

/** The origin of a lead's address, from how the lead arrived (ingest source type). */
export function originForIngestSource(sourceType: string): EmailOrigin {
  switch (sourceType) {
    case "CRM":
    case "CSV":
      return "CRM_IMPORTED";
    default:
      // Forms, DMs, manual entry, API, MCP and connectors: the person gave it.
      return "CUSTOMER_PROVIDED";
  }
}

export function emailVerificationClass(verificationStatus: string | null | undefined): EmailVerificationClass {
  if (verificationStatus === "VALID") return "VERIFIED";
  if (verificationStatus === "INVALID") return "INVALID";
  return "UNVERIFIED";
}

/**
 * Cold outreach refuses a guessed address that nobody has verified. Unknown
 * origin (pre-0131 rows, a lagging schema) is not treated as guessed: the
 * provider flag was never stored, and inventing it would block real contacts.
 */
export function coldSendRefusedForOrigin(input: {
  origin: string | null | undefined;
  verificationStatus: string | null | undefined;
}): boolean {
  return input.origin === "PATTERN_INFERRED" && emailVerificationClass(input.verificationStatus) !== "VERIFIED";
}
