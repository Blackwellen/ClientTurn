/**
 * Reading the `{ error }` of a Supabase write.
 *
 * supabase-js does not throw: a constraint violation, an RLS denial or a
 * network failure comes back as `{ error }`, and a caller that does not read it
 * carries on as though the write happened. These two helpers are the only two
 * ways a write result should be handled:
 *
 * - `assertWrite` for a write the caller's correctness depends on (consent,
 *   suppression, send state, billing, booking, qualification). It throws, so a
 *   job is retried by the queue and a server action reports failure instead of
 *   success.
 * - `logWriteError` for an observability-only write (a webhook_events status,
 *   an activity row). It logs with context and lets the caller continue.
 *
 * Pure: no server-only import, so it can be unit tested directly.
 */

export type WriteErrorLike = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type WriteResultLike = { error: WriteErrorLike | null };

export type WriteContext = Record<string, string | number | boolean | null | undefined>;

/** Thrown by `assertWrite`. Carries the operation and the Postgres code. */
export class WriteError extends Error {
  readonly operation: string;
  readonly code: string | null;
  readonly context: WriteContext;

  constructor(operation: string, error: WriteErrorLike, context: WriteContext = {}) {
    super(`${operation} failed: ${error.message}`);
    this.name = "WriteError";
    this.operation = operation;
    this.code = error.code ?? null;
    this.context = context;
  }
}

/**
 * Throws a `WriteError` when the write failed. `ignoreCodes` names Postgres
 * error codes that are the outcome the caller wanted (e.g. 23505 on an
 * idempotent insert).
 */
export function assertWrite(
  result: WriteResultLike,
  operation: string,
  context: WriteContext = {},
  options: { ignoreCodes?: readonly string[] } = {},
): void {
  const { error } = result;
  if (!error) return;
  if (error.code && options.ignoreCodes?.includes(error.code)) return;
  throw new WriteError(operation, error, context);
}

/**
 * Logs a failed observability-only write and returns false; returns true when
 * the write succeeded. Never throws.
 */
export function logWriteError(
  result: WriteResultLike,
  operation: string,
  context: WriteContext = {},
): boolean {
  const { error } = result;
  if (!error) return true;
  console.error(`[write] ${operation} failed`, {
    ...context,
    code: error.code ?? null,
    message: error.message,
  });
  return false;
}
