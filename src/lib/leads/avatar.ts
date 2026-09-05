import "server-only";
import { createHash } from "crypto";

/**
 * Computes a Gravatar URL from a lead's email, server-side only, so no PII
 * hashing logic ships to the client bundle. Gravatar returns a real 404 for
 * `d=404` when no image is registered for the address — the browser <img>
 * onError handler in `components/ui/avatar.tsx` catches that and falls back
 * to initials, so callers never need to pre-check whether an image exists.
 *
 * Returns null when there is no email to hash, so the caller (and Avatar)
 * goes straight to the initials fallback without a network round trip.
 */
export function gravatarUrl(
  email: string | null | undefined,
  size = 64,
): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const hash = createHash("md5").update(normalized).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=${size}`;
}
