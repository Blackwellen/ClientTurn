import { createHash } from "node:crypto";

/**
 * The normalisation behind suppression hashes (decision Q5).
 *
 * Pure. The hash itself is computed in the database by `suppression_hash()`
 * (migration 0124), because the salt lives in `platform_secrets` and never
 * leaves it. This module mirrors the normalisation so it can be pinned by
 * tests: if the two ever disagreed, an erased address would be hashed one way
 * and looked up another, and the person would silently become contactable.
 *
 *   email  -> lower(trim)
 *   phone  -> trim, then only digits and "+"
 *   social -> trim
 */

export type HashKind = "email" | "phone" | "social";

export function normaliseForHash(kind: HashKind, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let normalised: string;
  switch (kind) {
    case "email":
      normalised = value.trim().toLowerCase();
      break;
    case "phone":
      normalised = value.trim().replace(/[^0-9+]/g, "");
      break;
    case "social":
      normalised = value.trim();
      break;
  }
  return normalised === "" ? null : normalised;
}

/**
 * sha256 hex of `salt || normalised`, exactly as the SQL computes it. Exposed
 * for tests and for any offline verification an operator needs to do with the
 * salt in hand; application code never holds the salt.
 */
export function suppressionHash(
  salt: string,
  kind: HashKind,
  value: string | null | undefined,
): string | null {
  const normalised = normaliseForHash(kind, value);
  if (!normalised) return null;
  return createHash("sha256").update(salt + normalised).digest("hex");
}

/** A privacy-request verification token's stored form. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
