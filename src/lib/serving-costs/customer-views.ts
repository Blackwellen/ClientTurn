/**
 * Serving costs are admin-only (owner decisions, 2026-09-30: "Hide voice call
 * cost from customers"; AI usage in AI credits). Helpers that drop a cost
 * field at the server boundary, before a view model reaches a browser.
 *
 * Pure: no `server-only`, no I/O.
 */

/** A call card without its cost, whatever the viewer's role. */
export function withoutCallCost<T extends { costGbp: number | null }>(card: T): T {
  return { ...card, costGbp: null };
}
