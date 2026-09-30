/**
 * Whether a session came from a password-reset link, read from the access
 * token's `amr` (authentication methods reference) claim.
 *
 * /reset-password used to accept ANY signed-in session: someone holding a
 * stolen session cookie could set a new password there without knowing the
 * old one, while Settings -> Security asks for the current password first.
 * A reset now needs a session whose most recent sign-in method was the
 * emailed link itself ("recovery", or "otp" for the token-hash form of the
 * same link), and only for a short while after it was used
 * (surface QA 2026-09-30).
 *
 * Pure and isomorphic (no Node-only API): the reset form runs it in the
 * browser to decide what to show, and `updatePassword` runs it on the server,
 * which is the check that matters.
 */

/** How long a reset link's session may set a password after the link is opened. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

const RECOVERY_METHODS = new Set(["recovery", "otp"]);

type AmrEntry = { method?: unknown; timestamp?: unknown };

function decodeSegment(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function isRecoverySession(
  accessToken: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!accessToken) return false;
  const payload = accessToken.split(".")[1];
  if (!payload) return false;
  const json = decodeSegment(payload);
  if (!json) return false;

  let amr: unknown;
  try {
    amr = (JSON.parse(json) as { amr?: unknown }).amr;
  } catch {
    return false;
  }
  if (!Array.isArray(amr) || amr.length === 0) return false;

  // The most recent authentication decides: a recovery entry followed by a
  // later password sign-in is a password session.
  const entries = (amr as AmrEntry[])
    .filter((entry) => typeof entry?.method === "string" && typeof entry?.timestamp === "number")
    .sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
  const latest = entries[0];
  if (!latest || !RECOVERY_METHODS.has(latest.method as string)) return false;

  const ageSeconds = nowMs / 1000 - (latest.timestamp as number);
  return ageSeconds >= -60 && ageSeconds <= RECOVERY_WINDOW_SECONDS;
}
