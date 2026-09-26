/** Pure: parses a ?limit= query value for the public API. */
export function parseLimit(value: string | null, fallback = 25, max = 100) {
  // An absent or empty ?limit= means "use the default". Number(null) and
  // Number("") are both 0, which the clamp below turned into 1 -- so every
  // list call without an explicit limit returned a single row.
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}
