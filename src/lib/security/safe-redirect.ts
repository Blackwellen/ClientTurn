/**
 * Same-origin relative paths for `?redirect=` / `?next=` parameters.
 *
 * The old checks were `startsWith("/") && !startsWith("//")`, which a browser
 * defeats: `/\evil.example` and `/<TAB>/evil.example` both resolve to
 * `https://evil.example/` (the URL parser treats `\` as `/` and strips tabs and
 * newlines). A path handed to `router.replace` after sign-in then became an
 * open redirect (internal security review 2026-09-28, finding IR-01).
 *
 * Pure: no server-only import, so it is tested directly.
 */
const PROBE_ORIGIN = "https://clientturn.invalid";

export function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith("/")) return null;
  // Backslashes and any control or whitespace character are never needed in
  // one of our own paths, and each is a known way to smuggle a second slash.
  if (/[\\\u0000- \u007f]/.test(value)) return null;
  if (value.startsWith("//")) return null;
  try {
    const resolved = new URL(value, PROBE_ORIGIN);
    if (resolved.origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return value;
}
