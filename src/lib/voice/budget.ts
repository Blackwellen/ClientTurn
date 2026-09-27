/**
 * Voice minute accounting. Pure; the shape copies the AI token
 * reserve/settle pattern (billing/token-service.ts, ai_token_reservations).
 *
 * Everything is in integer SECONDS so no arithmetic is fractional; minutes are
 * a display unit.
 *
 *   reserve  before dialling, hold the estimated maximum for the call
 *            (default the hard budget plus the maximum extension, 7 minutes).
 *            Included minutes are drawn first, then packs (OD-2). Refused when
 *            the balance cannot cover it: prepaid only, no overage.
 *   settle   on call end, charge the actual duration rounded up per started
 *            minute (default) or per second, and return the rest. Idempotent.
 *   release  on a call that never connected, return the whole hold. Idempotent.
 *
 * Plus: route allocations, a concurrency slot check, the dial priority order,
 * and the 75/90/100% balance thresholds.
 */

import { CALL_BUDGET_SEC, MAX_EXTENSION_SEC, type VoiceRouteKey } from "./time-governor.ts";

export type BillingUnit = { mode: "PER_STARTED_MINUTE" } | { mode: "PER_SECOND"; minimumSec?: number };
export const DEFAULT_BILLING_UNIT: BillingUnit = { mode: "PER_STARTED_MINUTE" };

export const DEFAULT_RESERVATION_SEC = CALL_BUDGET_SEC + MAX_EXTENSION_SEC;

export function billableSeconds(actualSec: number, unit: BillingUnit = DEFAULT_BILLING_UNIT): number {
  const s = Math.max(0, Math.ceil(actualSec));
  if (s === 0) return 0;
  if (unit.mode === "PER_STARTED_MINUTE") return Math.ceil(s / 60) * 60;
  return Math.max(s, unit.minimumSec ?? 0);
}

export type ReservationStatus = "HELD" | "SETTLED" | "RELEASED";
export type Reservation = {
  callId: string;
  heldSec: number;
  fromIncludedSec: number;
  fromPackSec: number;
  status: ReservationStatus;
  billedSec?: number;
};

export type MinuteAccount = {
  /** Available, already net of held reservations. */
  includedRemainingSec: number;
  packRemainingSec: number;
  /** For thresholds: this period's included allowance and what was used. */
  periodIncludedSec: number;
  reservations: Readonly<Record<string, Reservation>>;
};

export type LedgerEntry = {
  kind: "RESERVE" | "SETTLE" | "RELEASE";
  callId: string;
  /** Negative = taken from the balance, positive = returned. */
  includedDeltaSec: number;
  packDeltaSec: number;
  idempotencyKey: string;
};

export type ReserveResult =
  | { ok: true; account: MinuteAccount; reservation: Reservation; ledger: LedgerEntry[]; replay: boolean }
  | { ok: false; reason: "INSUFFICIENT_BALANCE" | "INVALID_AMOUNT" | "ALREADY_CLOSED"; availableSec: number };

export function availableSec(a: MinuteAccount): number {
  return Math.max(0, a.includedRemainingSec) + Math.max(0, a.packRemainingSec);
}

export function reserve(account: MinuteAccount, callId: string, seconds: number = DEFAULT_RESERVATION_SEC): ReserveResult {
  const existing = account.reservations[callId];
  if (existing) {
    if (existing.status !== "HELD") return { ok: false, reason: "ALREADY_CLOSED", availableSec: availableSec(account) };
    return { ok: true, account, reservation: existing, ledger: [], replay: true };
  }
  if (!Number.isInteger(seconds) || seconds <= 0) return { ok: false, reason: "INVALID_AMOUNT", availableSec: availableSec(account) };
  if (availableSec(account) < seconds) return { ok: false, reason: "INSUFFICIENT_BALANCE", availableSec: availableSec(account) };

  const fromIncludedSec = Math.min(Math.max(0, account.includedRemainingSec), seconds);
  const fromPackSec = seconds - fromIncludedSec;
  const reservation: Reservation = { callId, heldSec: seconds, fromIncludedSec, fromPackSec, status: "HELD" };
  return {
    ok: true,
    replay: false,
    reservation,
    account: {
      ...account,
      includedRemainingSec: account.includedRemainingSec - fromIncludedSec,
      packRemainingSec: account.packRemainingSec - fromPackSec,
      reservations: { ...account.reservations, [callId]: reservation },
    },
    ledger: [
      { kind: "RESERVE", callId, includedDeltaSec: -fromIncludedSec, packDeltaSec: -fromPackSec, idempotencyKey: `voice:reserve:${callId}` },
    ],
  };
}

export type SettleResult =
  | {
      ok: true;
      account: MinuteAccount;
      billedSec: number;
      /** Seconds billed beyond the hold that the balance could not cover (should be 0: the provider max duration equals the hold). */
      shortfallSec: number;
      ledger: LedgerEntry[];
      replay: boolean;
    }
  | { ok: false; reason: "NO_RESERVATION" | "ALREADY_RELEASED" };

/**
 * Settle to the actual duration. Unused seconds go back to where they came
 * from, packs first (they were drawn last). An overrun beyond the hold is taken
 * from whatever is left, included first; what cannot be covered is reported as
 * `shortfallSec` for the admin reconciliation, never as overage.
 */
export function settle(account: MinuteAccount, callId: string, actualSec: number, unit: BillingUnit = DEFAULT_BILLING_UNIT): SettleResult {
  const r = account.reservations[callId];
  if (!r) return { ok: false, reason: "NO_RESERVATION" };
  if (r.status === "RELEASED") return { ok: false, reason: "ALREADY_RELEASED" };
  if (r.status === "SETTLED") return { ok: true, account, billedSec: r.billedSec ?? 0, shortfallSec: 0, ledger: [], replay: true };

  const billed = billableSeconds(actualSec, unit);
  let included = account.includedRemainingSec;
  let pack = account.packRemainingSec;
  let incDelta = 0;
  let packDelta = 0;
  let shortfall = 0;

  if (billed <= r.heldSec) {
    let refund = r.heldSec - billed;
    const toPack = Math.min(refund, r.fromPackSec);
    refund -= toPack;
    const toIncluded = refund;
    pack += toPack;
    included += toIncluded;
    packDelta = toPack;
    incDelta = toIncluded;
  } else {
    let extra = billed - r.heldSec;
    const fromInc = Math.min(Math.max(0, included), extra);
    extra -= fromInc;
    const fromPack = Math.min(Math.max(0, pack), extra);
    extra -= fromPack;
    included -= fromInc;
    pack -= fromPack;
    incDelta = -fromInc;
    packDelta = -fromPack;
    shortfall = extra;
  }
  const settled: Reservation = { ...r, status: "SETTLED", billedSec: billed };
  return {
    ok: true,
    replay: false,
    billedSec: billed,
    shortfallSec: shortfall,
    account: {
      ...account,
      includedRemainingSec: included,
      packRemainingSec: pack,
      reservations: { ...account.reservations, [callId]: settled },
    },
    ledger: [{ kind: "SETTLE", callId, includedDeltaSec: incDelta, packDeltaSec: packDelta, idempotencyKey: `voice:settle:${callId}` }],
  };
}

export type ReleaseResult =
  | { ok: true; account: MinuteAccount; ledger: LedgerEntry[]; replay: boolean }
  | { ok: false; reason: "NO_RESERVATION" | "ALREADY_SETTLED" };

export function release(account: MinuteAccount, callId: string): ReleaseResult {
  const r = account.reservations[callId];
  if (!r) return { ok: false, reason: "NO_RESERVATION" };
  if (r.status === "SETTLED") return { ok: false, reason: "ALREADY_SETTLED" };
  if (r.status === "RELEASED") return { ok: true, account, ledger: [], replay: true };
  return {
    ok: true,
    replay: false,
    account: {
      ...account,
      includedRemainingSec: account.includedRemainingSec + r.fromIncludedSec,
      packRemainingSec: account.packRemainingSec + r.fromPackSec,
      reservations: { ...account.reservations, [callId]: { ...r, status: "RELEASED" } },
    },
    ledger: [
      { kind: "RELEASE", callId, includedDeltaSec: r.fromIncludedSec, packDeltaSec: r.fromPackSec, idempotencyKey: `voice:release:${callId}` },
    ],
  };
}

// ------------------------------------------------------ route allocations

/** Percent of the period's minutes a route may use. Absent = uncapped. */
export type RouteAllocations = Partial<Record<VoiceRouteKey, number>>;

export function validateAllocations(a: RouteAllocations): { ok: true } | { ok: false; reason: "OUT_OF_RANGE" | "SUM_OVER_100" } {
  let sum = 0;
  for (const v of Object.values(a)) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, reason: "OUT_OF_RANGE" };
    sum += v;
  }
  return sum > 100 ? { ok: false, reason: "SUM_OVER_100" } : { ok: true };
}

export function checkRouteAllocation(input: {
  route: VoiceRouteKey;
  allocations: RouteAllocations;
  periodTotalSec: number;
  usedByRouteSec: number;
  requestSec: number;
}): { allowed: true; capSec: number | null } | { allowed: false; reason: "ROUTE_ALLOCATION_EXHAUSTED"; capSec: number } {
  const pct = input.allocations[input.route];
  if (pct == null) return { allowed: true, capSec: null };
  const capSec = Math.floor((input.periodTotalSec * pct) / 100);
  if (input.usedByRouteSec + input.requestSec > capSec) return { allowed: false, reason: "ROUTE_ALLOCATION_EXHAUSTED", capSec };
  return { allowed: true, capSec };
}

// ------------------------------------------------------------ concurrency

export const DEFAULT_WORKSPACE_CONCURRENCY = 2;
/** Retell includes 20 concurrent calls before per-slot charges (research §2.1). */
export const DEFAULT_PLATFORM_CONCURRENCY = 20;

export function checkConcurrency(input: {
  workspaceActive: number;
  platformActive: number;
  workspaceLimit?: number;
  platformLimit?: number;
}): { allowed: true } | { allowed: false; reason: "WORKSPACE_CONCURRENCY_FULL" | "PLATFORM_CONCURRENCY_FULL" } {
  if (input.platformActive >= (input.platformLimit ?? DEFAULT_PLATFORM_CONCURRENCY)) {
    return { allowed: false, reason: "PLATFORM_CONCURRENCY_FULL" };
  }
  if (input.workspaceActive >= (input.workspaceLimit ?? DEFAULT_WORKSPACE_CONCURRENCY)) {
    return { allowed: false, reason: "WORKSPACE_CONCURRENCY_FULL" };
  }
  return { allowed: true };
}

// --------------------------------------------------------- priority queue

/** Highest first. */
export const QUEUE_PRIORITY = [
  "INBOUND_CALLBACK",
  "CALL_REQUESTED_FRESH",
  "BOOKING_CLOSE",
  "DIRECT_CLOSE",
  "QUALIFICATION",
  "NURTURE",
  "REACTIVATION",
] as const;
export type QueuePriority = (typeof QUEUE_PRIORITY)[number];

export type QueueItem = { id: string; priority: QueuePriority; notBefore: Date; createdAt: Date };

export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const p = QUEUE_PRIORITY.indexOf(a.priority) - QUEUE_PRIORITY.indexOf(b.priority);
  if (p) return p;
  const nb = a.notBefore.getTime() - b.notBefore.getTime();
  if (nb) return nb;
  const c = a.createdAt.getTime() - b.createdAt.getTime();
  if (c) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The due items in dial order. */
export function orderQueue<T extends QueueItem>(items: readonly T[], now: Date): T[] {
  return items.filter((i) => i.notBefore.getTime() <= now.getTime()).sort(compareQueueItems);
}

// -------------------------------------------------------------- thresholds

export type ThresholdLevel = "NONE" | "T75" | "T90" | "T100";
const LEVELS: readonly { level: Exclude<ThresholdLevel, "NONE">; pct: number }[] = [
  { level: "T75", pct: 75 },
  { level: "T90", pct: 90 },
  { level: "T100", pct: 100 },
];

export function thresholdLevel(usedSec: number, totalSec: number): ThresholdLevel {
  if (totalSec <= 0) return usedSec > 0 ? "T100" : "NONE";
  const pct = (usedSec / totalSec) * 100;
  let out: ThresholdLevel = "NONE";
  for (const l of LEVELS) if (pct >= l.pct) out = l.level;
  return out;
}

/** Thresholds newly crossed between two usage figures, for one alert each. */
export function crossedThresholds(beforeUsedSec: number, afterUsedSec: number, totalSec: number): Exclude<ThresholdLevel, "NONE">[] {
  if (totalSec <= 0) return [];
  const b = (beforeUsedSec / totalSec) * 100;
  const a = (afterUsedSec / totalSec) * 100;
  return LEVELS.filter((l) => b < l.pct && a >= l.pct).map((l) => l.level);
}
