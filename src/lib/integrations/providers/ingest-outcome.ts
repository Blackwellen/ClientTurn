/**
 * Shared ingest decisions for the ad-platform lead pollers (B12, B13).
 *
 * The Supabase client returns `{ data, error }` rather than throwing, so every
 * ingest path has to decide what an error means. Exactly one error is benign —
 * `23505` on `(business_id, external_id)`, which is a webhook and a poll
 * delivering the same lead — and every other one must stop the poll so the job
 * retries and the provider cursor is not advanced past a lead we never stored.
 *
 * Pure, and free of `server-only`, so it is testable under `node --test`.
 */

export class LeadInsertError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "LeadInsertError";
    this.code = code;
  }
}

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isDuplicate(error: DbError): boolean {
  return error?.code === "23505";
}

/**
 * The outcome of `insert(...).select("id").single()` on `leads`.
 *
 * A duplicate returns `{ duplicate: true }`; any other error — and the
 * impossible "no row and no error" — throws, so the caller can never mistake a
 * failed write for an already-ingested lead.
 */
export function leadInsertOutcome<T>(
  created: T | null | undefined,
  error: DbError,
): { duplicate: true } | { duplicate: false; row: T } {
  if (isDuplicate(error)) return { duplicate: true };
  if (error) {
    throw new LeadInsertError(
      `Lead insert failed: ${error.message ?? "unknown error"}`,
      error.code ?? null,
    );
  }
  if (!created) throw new LeadInsertError("Lead insert returned no row.", null);
  return { duplicate: false, row: created };
}

/**
 * Where the Google Ads cursor may move to after a poll.
 *
 * The query is `submission_date_time > cursor`, ordered ascending. With no
 * failure the cursor moves to the newest submission seen. After a failure it
 * moves only to the newest submission *strictly before* the failed row's —
 * a cursor equal to the failed row's timestamp would exclude it from the next
 * query. Rows between the cursor and the failure are refetched and deduped by
 * the `(business_id, external_id)` unique key. A failed row with no timestamp
 * cannot be placed, so the cursor holds. It never moves backwards.
 *
 * `failedAt`: `undefined` = no failure; `null` = failure without a timestamp.
 * Timestamps are Google's `yyyy-MM-dd HH:mm:ss±hh:mm` in the account's own
 * time zone, which compare correctly as strings within one account.
 */
export function googleAdsCursorAfter(
  since: string,
  processed: (string | null | undefined)[],
  failedAt: string | null | undefined,
): string {
  if (failedAt === null) return since;
  let cursor = since;
  for (const value of processed) {
    if (!value) continue;
    if (failedAt !== undefined && value >= failedAt) continue;
    if (value > cursor) cursor = value;
  }
  return cursor;
}

/**
 * A provider's submission timestamp as ISO-8601, or null when it cannot be
 * read unambiguously. Accepts epoch milliseconds (LinkedIn), ISO strings with
 * an offset (Meta's `+0000` form included) and Google's space-separated form.
 */
export function toSubmittedAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else {
    const normalised = value
      .trim()
      .replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2")
      // `+0000` → `+00:00`: Date.parse is not required to accept the former.
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    parsed = Date.parse(normalised);
  }
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * `{ source_submitted_at }` for a `leads` insert (column added by 0114).
 *
 * Typed as `object` so it spreads into the generated insert type before
 * `database.types.ts` has been regenerated to include the column; drop the
 * indirection once it has.
 */
export function submittedAtColumn(value: string | number | null | undefined): object {
  return { source_submitted_at: toSubmittedAt(value) };
}
