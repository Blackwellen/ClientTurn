/**
 * Whether a Supabase/PostgREST error means "the database is behind the code":
 * a column, table or function this release added does not exist yet because
 * its migration has not been applied.
 *
 * Used only on the send path's hot reads and writes, where a release that
 * reaches production before its migration must degrade to the previous
 * behaviour rather than stop every message. Pure.
 */
const SCHEMA_LAG_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42883", // undefined_function
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found in the schema cache
  "PGRST205", // table not found in the schema cache
]);

export function isSchemaLag(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && SCHEMA_LAG_CODES.has(error.code));
}
