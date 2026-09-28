/**
 * Which stored Stripe event a redelivery may re-apply (the billing webhook's
 * inbox claim). Pure, so it is tested without a database.
 *
 * `failed`: the earlier attempt threw and recorded why; Stripe's retry must
 * re-apply it.
 *
 * `processing` older than the lease: the earlier attempt was killed mid-way
 * (the function's time limit, a crash) and never recorded an outcome. Before
 * this (backend QA 2026-09-28) such a row was stuck: every Stripe retry hit
 * the unique index and was acknowledged as a "duplicate", so the subscription
 * change, dunning step or dispute was lost. The lease is far above the route's
 * 60-second limit, so a live attempt is never reclaimed from under itself.
 */
export const STRIPE_PROCESSING_LEASE_MS = 5 * 60_000;

/** The PostgREST `or` filter for rows a redelivery may reclaim. */
export function stripeReclaimFilter(now: Date): string {
  const cutoff = new Date(now.getTime() - STRIPE_PROCESSING_LEASE_MS).toISOString();
  return `status.eq.failed,and(status.eq.processing,received_at.lt.${cutoff})`;
}

/** The same rule in code (tests, and anything reading a row it already has). */
export function stripeEventReclaimable(row: { status: string; received_at: string }, now: Date): boolean {
  if (row.status === "failed") return true;
  return row.status === "processing" && Date.parse(row.received_at) < now.getTime() - STRIPE_PROCESSING_LEASE_MS;
}
