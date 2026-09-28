/**
 * Safe `ilike` patterns for PostgREST.
 *
 * Pure: no imports, no `server-only`, so client components and `node --test`
 * can use it. This is the one place user text becomes an `ilike` pattern —
 * search boxes, the command palette, dedupe lookups and the help search all
 * route through here rather than keeping their own regex.
 */

/**
 * Escapes `%`, `_` and `\` before a value is used as a PostgREST `ilike`
 * pattern.
 *
 * Both wildcards are legal characters in an email local-part, a company name
 * or free text a customer types, so a value that was never meant as a
 * pattern can otherwise widen the match to other records in the same
 * workspace — an inbound reply from `al%ice@gmail.com` would match any email
 * starting "al" and ending "ice@gmail.com", not just that one address.
 */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * PostgREST rewrites every `*` in a like/ilike value to `%`, so a literal
 * asterisk cannot be expressed. It becomes `_` instead: a single-character
 * wildcard still matches the asterisk the person typed, and widens the match
 * by exactly one character rather than to "anything".
 */
function neutraliseStar(value: string): string {
  return value.replace(/\*/g, "_");
}

/**
 * A "contains" pattern for the builder's own `.ilike(column, pattern)`
 * method, where the value is a plain query parameter (no logic-tree syntax).
 * Returns null when nothing searchable is left.
 */
export function ilikeContains(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `%${neutraliseStar(escapeIlike(trimmed))}%`;
}

/**
 * A "contains" value that is safe inside a PostgREST `.or()` filter string.
 *
 * `.or()` takes raw logic-tree syntax, where `,` separates predicates, `(`/`)`
 * group them and `.`/`:` delimit operators — so a term like `Smith, (Ltd)`
 * would otherwise be parsed as extra filters. The value is therefore
 * double-quoted, which PostgREST treats as a literal, with `"` and `\`
 * backslash-escaped inside the quotes as its grammar requires. The LIKE
 * escaping (`\%`, `\_`, `\\`) happens first, so its backslashes survive the
 * quoting as real backslashes for Postgres.
 *
 * Returns null when nothing searchable is left, so callers skip the filter
 * instead of matching everything.
 */
export function ilikeOrTerm(value: string): string | null {
  const pattern = ilikeContains(value);
  if (!pattern) return null;
  return `"${pattern.replace(/["\\]/g, (char) => `\\${char}`)}"`;
}

/**
 * `col1.ilike."%term%",col2.ilike."%term%"` for `.or()`, or null when the term
 * is empty. Column names come from code, never from the request.
 */
export function orIlike(columns: readonly string[], value: string): string | null {
  const term = ilikeOrTerm(value);
  if (!term || columns.length === 0) return null;
  return columns.map((column) => `${column}.ilike.${term}`).join(",");
}

/**
 * `and(first_name.ilike."%A%",last_name.ilike."%B%")` for a term with a space
 * in it, to append to an `orIlike` list; null for a single word.
 *
 * Searching each column on its own meant "Chloe Winters" matched nothing: no
 * single column holds both names (QA 2026-09-28). The first word is matched
 * against the first name and the rest against the last name.
 */
export function fullNameIlike(value: string): string | null {
  const [first, ...rest] = value.trim().split(/\s+/);
  if (!first || rest.length === 0) return null;
  const a = ilikeOrTerm(first);
  const b = ilikeOrTerm(rest.join(" "));
  if (!a || !b) return null;
  return `and(first_name.ilike.${a},last_name.ilike.${b})`;
}
