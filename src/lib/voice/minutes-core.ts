/**
 * Voice minute accounting against a store: reserve, settle, release, pack
 * credit and the monthly included grant. Pure over an injected `MinuteStore`,
 * so the tests drive it with an in-memory store and the server wires the
 * Supabase one (`voice/minutes.ts`, over the 0157 `voice_minutes_apply` RPC).
 *
 * One algorithm: every delta is computed by `budget.ts` (reserve / settle /
 * release). The store only applies it if the balance is still what was read
 * (compare-and-swap); on CONFLICT the step re-reads and recomputes. The ledger
 * idempotency key (`voice:reserve:<call>` and so on) makes a retried step a
 * no-op. Ledger rows are append-only: a correction is a new row.
 *
 * Owner rules (2026-09-27): included minutes are drawn first, then packs; no
 * overage (a reservation the balance cannot cover is refused); a call is
 * settled TO THE SECOND (budget.ts PER_SECOND); the 75/90/100% alerts reuse
 * the one threshold rule in billing/allowance-alerts.ts.
 */

import {
  availableSec,
  DEFAULT_RESERVATION_SEC,
  release as releasePure,
  reserve as reservePure,
  settle as settlePure,
  type BillingUnit,
  type LedgerEntry,
  type MinuteAccount,
  type Reservation,
} from "./budget.ts";
import { crossedThreshold, type AllowanceAlertThreshold } from "../billing/allowance-alerts.ts";

/** Voice is billed to the second (the P1 budget's PER_SECOND unit). */
export const VOICE_BILLING_UNIT: BillingUnit = { mode: "PER_SECOND" };

export type VoiceLedgerKind = "RESERVE" | "SETTLE" | "RELEASE" | "PERIOD_GRANT" | "PERIOD_EXPIRE" | "PACK_PURCHASE" | "PACK_REFUND" | "ADJUSTMENT";

export type MinuteBalance = {
  includedRemainingSec: number;
  packRemainingSec: number;
  periodIncludedSec: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type MinuteSnapshot = {
  balance: MinuteBalance;
  /** The reservations the step may touch (at least the call's own, if any). */
  reservations: Record<string, Reservation>;
  /** Seconds billed by settled calls since the period started (for the alerts). */
  usedThisPeriodSec: number;
};

export type ReservationWrite = {
  voiceCallId: string;
  route: string | null;
  heldSec: number;
  fromIncludedSec: number;
  fromPackSec: number;
  status: Reservation["status"];
  billedSec: number | null;
  shortfallSec: number;
};

export type ApplyInput = {
  businessId: string;
  expected: { includedSec: number; packSec: number };
  delta: { includedSec: number; packSec: number };
  ledger: {
    kind: VoiceLedgerKind;
    voiceCallId: string | null;
    route: string | null;
    idempotencyKey: string;
    reason?: string | null;
    stripeRef?: string | null;
  };
  reservation?: ReservationWrite | null;
  period?: { periodIncludedSec: number; periodStart: string; periodEnd: string | null } | null;
};

export type ApplyResult = "APPLIED" | "REPLAY" | "CONFLICT" | "INSUFFICIENT";

export interface MinuteStore {
  load(businessId: string, callId: string | null): Promise<MinuteSnapshot>;
  apply(input: ApplyInput): Promise<ApplyResult>;
}

/** The store is not usable (its migration is not applied, or the database refused). */
export class MinuteStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinuteStoreUnavailable";
  }
}

const MAX_CAS_ATTEMPTS = 5;

function accountOf(s: MinuteSnapshot): MinuteAccount {
  return {
    includedRemainingSec: s.balance.includedRemainingSec,
    packRemainingSec: s.balance.packRemainingSec,
    periodIncludedSec: s.balance.periodIncludedSec,
    reservations: s.reservations,
  };
}

function one(ledger: LedgerEntry[]): LedgerEntry {
  if (ledger.length !== 1) throw new Error(`expected one ledger entry, got ${ledger.length}`);
  return ledger[0];
}

function reservationWrite(r: Reservation, route: string | null, shortfallSec = 0): ReservationWrite {
  return {
    voiceCallId: r.callId,
    route,
    heldSec: r.heldSec,
    fromIncludedSec: r.fromIncludedSec,
    fromPackSec: r.fromPackSec,
    status: r.status,
    billedSec: r.billedSec ?? null,
    shortfallSec,
  };
}

/* ------------------------------------------------------------------ reserve */

export type ReserveOutcome =
  | { ok: true; reservation: Reservation; replay: boolean; availableAfterSec: number }
  | { ok: false; reason: "INSUFFICIENT_BALANCE" | "INVALID_AMOUNT" | "ALREADY_CLOSED" | "CONTENDED"; availableSec: number };

export async function reserveMinutes(
  store: MinuteStore,
  input: { businessId: string; callId: string; route: string | null; seconds?: number },
): Promise<ReserveOutcome> {
  const seconds = input.seconds ?? DEFAULT_RESERVATION_SEC;
  let lastAvailable = 0;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const snap = await store.load(input.businessId, input.callId);
    const account = accountOf(snap);
    lastAvailable = availableSec(account);
    const r = reservePure(account, input.callId, seconds);
    if (!r.ok) return { ok: false, reason: r.reason, availableSec: r.availableSec };
    if (r.replay) return { ok: true, reservation: r.reservation, replay: true, availableAfterSec: availableSec(account) };
    const entry = one(r.ledger);
    const result = await store.apply({
      businessId: input.businessId,
      expected: { includedSec: account.includedRemainingSec, packSec: account.packRemainingSec },
      delta: { includedSec: entry.includedDeltaSec, packSec: entry.packDeltaSec },
      ledger: { kind: "RESERVE", voiceCallId: input.callId, route: input.route, idempotencyKey: entry.idempotencyKey },
      reservation: reservationWrite(r.reservation, input.route),
    });
    if (result === "APPLIED") return { ok: true, reservation: r.reservation, replay: false, availableAfterSec: availableSec(r.account) };
    if (result === "REPLAY") {
      // Written by a concurrent run of this same step: read back its hold.
      const again = await store.load(input.businessId, input.callId);
      const held = again.reservations[input.callId];
      if (held) return { ok: true, reservation: held, replay: true, availableAfterSec: availableSec(accountOf(again)) };
      return { ok: false, reason: "ALREADY_CLOSED", availableSec: availableSec(accountOf(again)) };
    }
    if (result === "INSUFFICIENT") return { ok: false, reason: "INSUFFICIENT_BALANCE", availableSec: lastAvailable };
    // CONFLICT: the balance moved under us; re-read and recompute.
  }
  return { ok: false, reason: "CONTENDED", availableSec: lastAvailable };
}

/* ------------------------------------------------------------------- settle */

export type SettleOutcome =
  | {
      ok: true;
      billedSec: number;
      shortfallSec: number;
      replay: boolean;
      /** The 75/90/100% threshold newly reached by this settlement, if any. */
      alert: AllowanceAlertThreshold | null;
      remainingSec: number;
    }
  | { ok: false; reason: "NO_RESERVATION" | "ALREADY_RELEASED" | "CONTENDED" };

/** The share of this period's minutes used, on the allowance-alerts rule. */
export function voiceThreshold(input: { periodIncludedSec: number; usedThisPeriodSec: number; includedRemainingSec: number; packRemainingSec: number }): AllowanceAlertThreshold | null {
  return crossedThreshold({
    // Used + remaining = everything available this period; the allowance's own
    // arithmetic is in seconds here, so it is expressed as used + remaining.
    allowance: 0,
    usedThisPeriod: Math.max(0, input.usedThisPeriodSec),
    creditBalance: Math.max(0, input.includedRemainingSec) + Math.max(0, input.packRemainingSec),
  });
}

export async function settleMinutes(
  store: MinuteStore,
  input: { businessId: string; callId: string; route: string | null; actualSec: number; unit?: BillingUnit },
): Promise<SettleOutcome> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const snap = await store.load(input.businessId, input.callId);
    const account = accountOf(snap);
    const s = settlePure(account, input.callId, input.actualSec, input.unit ?? VOICE_BILLING_UNIT);
    if (!s.ok) return { ok: false, reason: s.reason };
    if (s.replay) {
      return { ok: true, billedSec: s.billedSec, shortfallSec: 0, replay: true, alert: null, remainingSec: availableSec(account) };
    }
    const entry = one(s.ledger);
    const settled = s.account.reservations[input.callId];
    const result = await store.apply({
      businessId: input.businessId,
      expected: { includedSec: account.includedRemainingSec, packSec: account.packRemainingSec },
      delta: { includedSec: entry.includedDeltaSec, packSec: entry.packDeltaSec },
      ledger: { kind: "SETTLE", voiceCallId: input.callId, route: input.route, idempotencyKey: entry.idempotencyKey },
      reservation: reservationWrite(settled, input.route, s.shortfallSec),
    });
    if (result === "APPLIED") {
      // Before this call: its hold still counted as available (it had not
      // been used). After: the billed seconds are used.
      const before = voiceThreshold({
        periodIncludedSec: snap.balance.periodIncludedSec,
        usedThisPeriodSec: snap.usedThisPeriodSec,
        includedRemainingSec: account.includedRemainingSec + (snap.reservations[input.callId]?.fromIncludedSec ?? 0),
        packRemainingSec: account.packRemainingSec + (snap.reservations[input.callId]?.fromPackSec ?? 0),
      });
      const after = voiceThreshold({
        periodIncludedSec: snap.balance.periodIncludedSec,
        usedThisPeriodSec: snap.usedThisPeriodSec + s.billedSec,
        includedRemainingSec: s.account.includedRemainingSec,
        packRemainingSec: s.account.packRemainingSec,
      });
      const alert = after !== null && (before === null || after > before) ? after : null;
      return { ok: true, billedSec: s.billedSec, shortfallSec: s.shortfallSec, replay: false, alert, remainingSec: availableSec(s.account) };
    }
    if (result === "REPLAY") {
      const again = await store.load(input.businessId, input.callId);
      const r = again.reservations[input.callId];
      return { ok: true, billedSec: r?.billedSec ?? 0, shortfallSec: 0, replay: true, alert: null, remainingSec: availableSec(accountOf(again)) };
    }
    if (result === "INSUFFICIENT") {
      // Cannot happen for a settle within its hold; an overrun is already
      // capped at the balance by budget.ts. Treated as contention.
      continue;
    }
  }
  return { ok: false, reason: "CONTENDED" };
}

/* ------------------------------------------------------------------ release */

export type ReleaseOutcome = { ok: true; replay: boolean } | { ok: false; reason: "NO_RESERVATION" | "ALREADY_SETTLED" | "CONTENDED" };

export async function releaseMinutes(store: MinuteStore, input: { businessId: string; callId: string; route: string | null }): Promise<ReleaseOutcome> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const snap = await store.load(input.businessId, input.callId);
    const account = accountOf(snap);
    const r = releasePure(account, input.callId);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.replay) return { ok: true, replay: true };
    const entry = one(r.ledger);
    const released = r.account.reservations[input.callId];
    const result = await store.apply({
      businessId: input.businessId,
      expected: { includedSec: account.includedRemainingSec, packSec: account.packRemainingSec },
      delta: { includedSec: entry.includedDeltaSec, packSec: entry.packDeltaSec },
      ledger: { kind: "RELEASE", voiceCallId: input.callId, route: input.route, idempotencyKey: entry.idempotencyKey },
      reservation: reservationWrite(released, input.route),
    });
    if (result === "APPLIED" || result === "REPLAY") return { ok: true, replay: result === "REPLAY" };
  }
  return { ok: false, reason: "CONTENDED" };
}

/* ------------------------------------------------------- packs and grants */

/** A minute pack bought: prepaid pack seconds, never expire (OD-2). */
export async function creditPackMinutes(
  store: MinuteStore,
  input: { businessId: string; minutes: number; idempotencyKey: string; stripeRef: string | null },
): Promise<ApplyResult> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) throw new Error("minutes must be a positive integer");
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const snap = await store.load(input.businessId, null);
    const result = await store.apply({
      businessId: input.businessId,
      expected: { includedSec: snap.balance.includedRemainingSec, packSec: snap.balance.packRemainingSec },
      delta: { includedSec: 0, packSec: input.minutes * 60 },
      ledger: {
        kind: "PACK_PURCHASE",
        voiceCallId: null,
        route: null,
        idempotencyKey: input.idempotencyKey,
        reason: `${input.minutes} minute pack`,
        stripeRef: input.stripeRef,
      },
    });
    if (result !== "CONFLICT") return result;
  }
  return "CONFLICT";
}

/**
 * The period's included minutes (the Pro voice item's 200 a month). Included
 * minutes do not roll over: the bucket is SET to the allowance, and the ledger
 * row carries the difference (negative when unused minutes expire).
 */
export async function grantIncludedPeriod(
  store: MinuteStore,
  input: { businessId: string; includedMinutes: number; periodStart: string; periodEnd: string | null },
): Promise<ApplyResult> {
  const target = Math.max(0, Math.floor(input.includedMinutes)) * 60;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const snap = await store.load(input.businessId, null);
    const result = await store.apply({
      businessId: input.businessId,
      expected: { includedSec: snap.balance.includedRemainingSec, packSec: snap.balance.packRemainingSec },
      delta: { includedSec: target - snap.balance.includedRemainingSec, packSec: 0 },
      ledger: {
        kind: "PERIOD_GRANT",
        voiceCallId: null,
        route: null,
        idempotencyKey: `voice:period:${input.periodStart}:${target}`,
        reason: `${input.includedMinutes} included minutes for the period`,
      },
      period: { periodIncludedSec: target, periodStart: input.periodStart, periodEnd: input.periodEnd },
    });
    if (result !== "CONFLICT") return result;
  }
  return "CONFLICT";
}

/* ------------------------------------------------------------ in-memory store */

/**
 * The same compare-and-swap semantics as the 0157 RPC, in memory. Used by the
 * tests and by nothing in production.
 */
export class InMemoryMinuteStore implements MinuteStore {
  balances = new Map<string, MinuteBalance>();
  ledger: (ApplyInput["ledger"] & { businessId: string; includedDeltaSec: number; packDeltaSec: number })[] = [];
  reservations = new Map<string, ReservationWrite & { businessId: string; closedAt: string | null }>();
  /** Test hook: runs once before the next apply (simulates a concurrent writer). */
  beforeApply: (() => void) | null = null;

  balanceOf(businessId: string): MinuteBalance {
    let b = this.balances.get(businessId);
    if (!b) {
      b = { includedRemainingSec: 0, packRemainingSec: 0, periodIncludedSec: 0, periodStart: null, periodEnd: null };
      this.balances.set(businessId, b);
    }
    return b;
  }

  async load(businessId: string, callId: string | null): Promise<MinuteSnapshot> {
    const b = this.balanceOf(businessId);
    const reservations: Record<string, Reservation> = {};
    for (const [id, r] of this.reservations) {
      if (r.businessId !== businessId) continue;
      if (id !== callId && r.status !== "HELD") continue;
      reservations[id] = {
        callId: id,
        heldSec: r.heldSec,
        fromIncludedSec: r.fromIncludedSec,
        fromPackSec: r.fromPackSec,
        status: r.status,
        ...(r.billedSec != null ? { billedSec: r.billedSec } : {}),
      };
    }
    let used = 0;
    for (const r of this.reservations.values()) {
      if (r.businessId === businessId && r.status === "SETTLED") used += r.billedSec ?? 0;
    }
    return { balance: { ...b }, reservations, usedThisPeriodSec: used };
  }

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const hook = this.beforeApply;
    this.beforeApply = null;
    hook?.();
    const b = this.balanceOf(input.businessId);
    if (this.ledger.some((l) => l.businessId === input.businessId && l.idempotencyKey === input.ledger.idempotencyKey)) return "REPLAY";
    if (b.includedRemainingSec !== input.expected.includedSec || b.packRemainingSec !== input.expected.packSec) return "CONFLICT";
    if (b.includedRemainingSec + input.delta.includedSec < 0 || b.packRemainingSec + input.delta.packSec < 0) return "INSUFFICIENT";
    b.includedRemainingSec += input.delta.includedSec;
    b.packRemainingSec += input.delta.packSec;
    if (input.period) {
      b.periodIncludedSec = input.period.periodIncludedSec;
      b.periodStart = input.period.periodStart;
      b.periodEnd = input.period.periodEnd;
    }
    this.ledger.push({ ...input.ledger, businessId: input.businessId, includedDeltaSec: input.delta.includedSec, packDeltaSec: input.delta.packSec });
    if (input.reservation) {
      const existing = this.reservations.get(input.reservation.voiceCallId);
      if (!existing || existing.status === "HELD") {
        this.reservations.set(input.reservation.voiceCallId, {
          ...input.reservation,
          businessId: input.businessId,
          closedAt: input.reservation.status === "HELD" ? null : new Date().toISOString(),
        });
      }
    }
    return "APPLIED";
  }
}
