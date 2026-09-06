/**
 * Variant allocation maths.
 *
 * Pure — no `server-only`, no Supabase, no path alias — so the two decisions
 * that determine who sees which message are unit-testable. Everything that
 * needs the database lives in `variant-assignment.ts`.
 */

/**
 * A stable 0..99 bucket for a recipient.
 *
 * FNV-1a over the recipient run id: cheap, well-distributed, and — the point —
 * reproducible, so a retried send re-derives the same variant rather than
 * re-rolling and counting the same person twice.
 */
export function bucketFor(runId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < runId.length; i += 1) {
    hash ^= runId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/**
 * Picks a variant by allocation weight.
 *
 * Allocations are treated as weights over whatever they actually sum to rather
 * than assumed to total 100. Two variants at 30% each should split the traffic
 * evenly, not leave 40% of recipients with no message at all — and an
 * experiment left at 50/50/50 by someone adding a third arm should still send.
 */
export function chooseVariant<T extends { allocation_percent: number }>(
  variants: T[],
  bucket: number,
): T | null {
  const usable = variants.filter((variant) => Number(variant.allocation_percent) > 0);
  if (usable.length === 0) return null;

  const total = usable.reduce(
    (sum, variant) => sum + Number(variant.allocation_percent),
    0,
  );
  if (total <= 0) return null;

  const target = (Math.min(99, Math.max(0, bucket)) / 100) * total;
  let running = 0;

  for (const variant of usable) {
    running += Number(variant.allocation_percent);
    if (target < running) return variant;
  }

  // Floating-point drift on the last boundary: the final variant owns it.
  return usable[usable.length - 1];
}

/**
 * Today's send ceiling for a sender that is still warming up.
 *
 * Mirrors `public.sender_daily_allowance` exactly, so the UI can show a ramping
 * sender's real limit without asking the database. A new sending domain that
 * starts at its full cap gets its reputation burned before the first reply
 * arrives; this grows linearly to the configured cap over `warmupDays`.
 */
export function warmupAllowance(input: {
  dailySendCap: number;
  warmupStartedAt: Date | null;
  warmupDays: number;
  now?: Date;
}): number {
  const { dailySendCap, warmupStartedAt, warmupDays } = input;
  if (!warmupStartedAt || warmupDays <= 0) return dailySendCap;

  const now = input.now ?? new Date();
  const elapsedDays = (now.getTime() - warmupStartedAt.getTime()) / 864e5;
  const fraction = Math.min(1, (elapsedDays + 1) / warmupDays);

  // The floor keeps day one usable: a cap of 20 would otherwise ramp from 1.
  return Math.max(5, Math.min(dailySendCap, Math.ceil(dailySendCap * fraction)));
}
