/**
 * The shape every quote / catalogue / invoice server action returns to the
 * UI. Pure so client components can import the type without pulling server
 * code.
 */
export type QuoteActionResult<T = unknown> =
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; error: string; code: string };
