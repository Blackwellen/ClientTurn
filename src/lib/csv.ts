/**
 * One quoted CSV field, safe to open in a spreadsheet.
 *
 * Quotes every field (doubling embedded quotes) and defuses formula injection:
 * a value starting with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * prefixed with `'` so Excel/Sheets treat it as text rather than executing it.
 * Null and undefined become an empty field.
 *
 * Pure — no `server-only` — so any export route or client download can use it.
 * This is the single implementation; do not re-declare a local `escape`.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
