/**
 * Turning an error into something a customer can read.
 *
 * The rule (docs/revenue-engine/16-ui-sweep-audit.md): a customer sees a short
 * plain-English sentence, what to do next and, when there is one, a reference
 * for support. They never see a Postgres code, a Zod issue path, a stack frame,
 * an HTTP status line or an "Error:" prefix. The real error is logged; the
 * fact that something failed is never hidden, only its technical text.
 *
 * Most server actions already return hand-written sentences ("Only owners and
 * admins can change connections."), and those pass through untouched. This
 * module is the net under them: a message that looks technical is replaced by
 * the caller's fallback.
 *
 * Pure: no `server-only`, no React, so client components, server actions and
 * the unit tests (tests/ui-sweep.test.ts) all import the same rules.
 */

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong on our side. Please try again in a moment.";

/** Shapes that only ever come from infrastructure, never from our copy. */
const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /\bPGRST\d+/i,
  /\bSQLSTATE\b/i,
  /\b(?:2[23]|4[02])\d{3}\b.*(?:constraint|violat|syntax)/i,
  /duplicate key value/i,
  /violates (?:foreign key|unique|check|not-null|row-level)/i,
  /(?:relation|column|function) "[^"]+" does not exist/i,
  /permission denied for (?:table|relation|schema|function)/i,
  /row-level security/i,
  /\bJWT\b|jwt expired|invalid (?:jwt|token signature)/i,
  /fetch failed|\bECONN(?:RESET|REFUSED|ABORTED)\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b|socket hang up/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /Cannot read propert(?:y|ies) of/i,
  /is not a function|is not defined|undefined is not/i,
  /\bat [\w$.<>]+ \(?[^\s)]*:\d+:\d+\)?/,
  /status code \d{3}|\bHTTP\/\d/i,
  /Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i,
  /Unexpected token|Unexpected end of JSON|JSON\.parse/i,
  /\bZodError\b|\binvalid_type\b|Expected [a-z]+, received [a-z]+/,
  /\[object Object\]/,
  /<!doctype html|<html/i,
];

/** True when a message would leak infrastructure detail to a customer. */
export function isTechnicalMessage(message: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(message));
}

/** "Error: The file is too large" reads as a crash; the sentence alone does not. */
function stripErrorPrefix(message: string): string {
  return message.replace(/^\s*(?:uncaught\s+)?(?:[A-Z][A-Za-z]*)?Error:\s*/i, "").trim();
}

/**
 * The message to show for `error` (a string, an Error, or anything thrown).
 * Friendly messages pass through with any "Error:" prefix removed; technical
 * ones, empty ones and runaway ones become `fallback`.
 */
export function friendlyErrorMessage(
  error: unknown,
  fallback: string = GENERIC_ERROR_MESSAGE,
): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";
  // assertWrite's WriteError carries the database message verbatim
  // (src/lib/supabase/write-result.ts); its name is the reliable signal.
  if (error instanceof Error && error.name === "WriteError") return fallback;
  const message = stripErrorPrefix(raw);
  if (!message) return fallback;
  if (isTechnicalMessage(raw) || isTechnicalMessage(message)) return fallback;
  // A paragraph-length message is a dump, not a sentence someone wrote.
  if (message.length > 400) return fallback;
  return message;
}

/**
 * A short reference a customer can quote to support. It is the Next.js error
 * digest when there is one (the server log carries the same digest), otherwise
 * a random id that the caller logs alongside the real error.
 */
export function errorReference(digest?: string | null): string {
  if (digest) return digest.slice(0, 12);
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return random.replace(/-/g, "").slice(0, 10).toUpperCase();
}
