import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Reservation } from "./budget";
import {
  creditPackMinutes,
  grantIncludedPeriod,
  MinuteStoreUnavailable,
  releaseMinutes,
  reserveMinutes,
  settleMinutes,
  type ApplyInput,
  type ApplyResult,
  type MinuteSnapshot,
  type MinuteStore,
  type ReleaseOutcome,
  type ReserveOutcome,
  type SettleOutcome,
} from "./minutes-core";

/**
 * The voice minute balance, server side: the Supabase `MinuteStore` over the
 * 0151 tables and the 0157 `voice_minutes_apply` RPC, plus the 75/90/100%
 * "buy a minute pack" notification. The arithmetic is `budget.ts`; the
 * orchestration is `minutes-core.ts`; this file is only I/O.
 *
 * Every ledger row is written with an idempotency key, so a retried job never
 * moves minutes twice. Nothing here throws on a missing migration: it throws
 * `MinuteStoreUnavailable`, which the dial path turns into a refusal (no
 * minutes can be proven, so no call is placed).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

function unavailable(what: string, error: { code?: string; message?: string }): never {
  if (error.code && MISSING.has(error.code)) {
    throw new MinuteStoreUnavailable(`Voice minutes are not set up yet (${what}).`);
  }
  throw new Error(`voice minutes: ${what}: ${error.message ?? error.code ?? "failed"}`);
}

export const supabaseMinuteStore: MinuteStore = {
  async load(businessId: string, callId: string | null): Promise<MinuteSnapshot> {
    const client = db();
    const [balance, held] = await Promise.all([
      client
        .from("voice_minute_balances")
        .select("included_remaining_sec, pack_remaining_sec, period_included_sec, period_start, period_end")
        .eq("business_id", businessId)
        .maybeSingle(),
      client
        .from("voice_minute_reservations")
        .select("voice_call_id, held_sec, from_included_sec, from_pack_sec, status, billed_sec")
        .eq("business_id", businessId)
        .or(callId ? `status.eq.HELD,voice_call_id.eq.${callId}` : "status.eq.HELD"),
    ]);
    if (balance.error) unavailable("balance", balance.error);
    if (held.error) unavailable("reservations", held.error);
    const b = balance.data as {
      included_remaining_sec: number;
      pack_remaining_sec: number;
      period_included_sec: number;
      period_start: string | null;
      period_end: string | null;
    } | null;

    const reservations: Record<string, Reservation> = {};
    for (const row of (held.data ?? []) as {
      voice_call_id: string;
      held_sec: number;
      from_included_sec: number;
      from_pack_sec: number;
      status: Reservation["status"];
      billed_sec: number | null;
    }[]) {
      reservations[row.voice_call_id] = {
        callId: row.voice_call_id,
        heldSec: row.held_sec,
        fromIncludedSec: row.from_included_sec,
        fromPackSec: row.from_pack_sec,
        status: row.status,
        ...(row.billed_sec != null ? { billedSec: row.billed_sec } : {}),
      };
    }

    let usedThisPeriodSec = 0;
    if (b?.period_start) {
      const used = await client
        .from("voice_minute_reservations")
        .select("billed_sec")
        .eq("business_id", businessId)
        .eq("status", "SETTLED")
        .gte("closed_at", b.period_start);
      if (used.error) unavailable("usage", used.error);
      for (const row of (used.data ?? []) as { billed_sec: number | null }[]) usedThisPeriodSec += row.billed_sec ?? 0;
    }

    return {
      balance: {
        includedRemainingSec: b?.included_remaining_sec ?? 0,
        packRemainingSec: b?.pack_remaining_sec ?? 0,
        periodIncludedSec: b?.period_included_sec ?? 0,
        periodStart: b?.period_start ?? null,
        periodEnd: b?.period_end ?? null,
      },
      reservations,
      usedThisPeriodSec,
    };
  },

  async apply(input: ApplyInput): Promise<ApplyResult> {
    const { data, error } = await db().rpc("voice_minutes_apply", {
      p_business_id: input.businessId,
      p_expected_included: input.expected.includedSec,
      p_expected_pack: input.expected.packSec,
      p_included_delta: input.delta.includedSec,
      p_pack_delta: input.delta.packSec,
      p_ledger: {
        kind: input.ledger.kind,
        voice_call_id: input.ledger.voiceCallId ?? "",
        route: input.ledger.route ?? "",
        idempotency_key: input.ledger.idempotencyKey,
        reason: input.ledger.reason ?? "",
        stripe_ref: input.ledger.stripeRef ?? "",
      },
      p_reservation: input.reservation
        ? {
            voice_call_id: input.reservation.voiceCallId,
            route: input.reservation.route ?? "",
            held_sec: input.reservation.heldSec,
            from_included_sec: input.reservation.fromIncludedSec,
            from_pack_sec: input.reservation.fromPackSec,
            status: input.reservation.status,
            billed_sec: input.reservation.billedSec == null ? "" : String(input.reservation.billedSec),
            shortfall_sec: String(input.reservation.shortfallSec),
          }
        : null,
      p_period: input.period
        ? {
            period_included_sec: input.period.periodIncludedSec,
            period_start: input.period.periodStart,
            period_end: input.period.periodEnd,
          }
        : null,
    });
    if (error) unavailable("apply", error);
    const result = String(data ?? "");
    if (result === "APPLIED" || result === "REPLAY" || result === "CONFLICT" || result === "INSUFFICIENT") return result;
    throw new Error(`voice minutes: unexpected apply result ${result}`);
  },
};

/* ------------------------------------------------------------ public API */

export function reserveCallMinutes(input: { businessId: string; callId: string; route: string | null; seconds?: number }): Promise<ReserveOutcome> {
  return reserveMinutes(supabaseMinuteStore, input);
}

export function releaseCallMinutes(input: { businessId: string; callId: string; route: string | null }): Promise<ReleaseOutcome> {
  return releaseMinutes(supabaseMinuteStore, input);
}

/**
 * Settle a finished call to the second and, when this call took the workspace
 * across 75%, 90% or 100% of its minutes, queue the one "buy a minute pack"
 * notification. The dedupe key carries the balance total, so a top-up re-arms
 * the thresholds (the allowance-alerts watermark rule, without its table).
 */
export async function settleCallMinutes(input: {
  businessId: string;
  callId: string;
  route: string | null;
  actualSec: number;
}): Promise<SettleOutcome> {
  const result = await settleMinutes(supabaseMinuteStore, input);
  if (result.ok && result.alert) {
    await notifyMinutesLow(input.businessId, result.alert, result.remainingSec).catch((error) => {
      console.error("[voice minutes] low-balance alert failed", {
        businessId: input.businessId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return result;
}

const BUY_PACK_HREF = "/app/settings?section=billing";

export function minutesLowCopy(threshold: 75 | 90 | 100, remainingSec: number): { title: string; body: string; severity: "warning" | "error" } {
  const minutesLeft = Math.floor(Math.max(0, remainingSec) / 60);
  if (threshold === 100) {
    return {
      title: "You're out of voice minutes",
      body: "AI calls are paused until you buy a minute pack. There is no overage, so nothing more is charged. Buy a minute pack in Settings, Voice.",
      severity: "error",
    };
  }
  return {
    title: threshold === 90 ? "Voice minutes nearly used up" : "Voice minutes running low",
    body: `You have about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} of AI calling left. Buy a minute pack so calls keep going; when minutes run out, calls stop until you top up.`,
    severity: "warning",
  };
}

async function notifyMinutesLow(businessId: string, threshold: 75 | 90 | 100, remainingSec: number): Promise<void> {
  const { queueNotification } = await import("@/lib/jobs/handlers/shared");
  const copy = minutesLowCopy(threshold, remainingSec);
  await queueNotification({
    businessId,
    type: "billing",
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    linkUrl: BUY_PACK_HREF,
    dedupeKey: `voice-minutes:${businessId}:${threshold}:${Math.floor(remainingSec / 60)}`,
  });
}

/**
 * A minute pack was paid for (the Stripe webhook, TEST mode). Idempotent per
 * Stripe reference: a redelivered event credits once.
 */
export async function creditVoicePack(input: {
  businessId: string;
  minutes: number;
  stripeRef: string;
}): Promise<ApplyResult> {
  return creditPackMinutes(supabaseMinuteStore, {
    businessId: input.businessId,
    minutes: input.minutes,
    stripeRef: input.stripeRef,
    idempotencyKey: `voice:pack:${input.stripeRef}`,
  });
}

/** The Pro voice item's included minutes for a billing period (no roll-over). */
export async function grantVoicePeriodMinutes(input: {
  businessId: string;
  includedMinutes: number;
  periodStart: string;
  periodEnd: string | null;
}): Promise<ApplyResult> {
  return grantIncludedPeriod(supabaseMinuteStore, input);
}

/** For the Settings overview and the entitlement snapshot. Never throws. */
export async function readMinuteBalance(businessId: string): Promise<{
  includedRemainingSec: number;
  packRemainingSec: number;
  periodIncludedSec: number;
  periodEnd: string | null;
  packsHeld: boolean;
  available: boolean;
}> {
  const client = db();
  const [balance, packs] = await Promise.all([
    client
      .from("voice_minute_balances")
      .select("included_remaining_sec, pack_remaining_sec, period_included_sec, period_end")
      .eq("business_id", businessId)
      .maybeSingle(),
    client
      .from("voice_minute_ledger")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("kind", "PACK_PURCHASE"),
  ]);
  if (balance.error || packs.error) {
    return { includedRemainingSec: 0, packRemainingSec: 0, periodIncludedSec: 0, periodEnd: null, packsHeld: false, available: false };
  }
  const b = balance.data as { included_remaining_sec: number; pack_remaining_sec: number; period_included_sec: number; period_end: string | null } | null;
  return {
    includedRemainingSec: b?.included_remaining_sec ?? 0,
    packRemainingSec: b?.pack_remaining_sec ?? 0,
    periodIncludedSec: b?.period_included_sec ?? 0,
    periodEnd: b?.period_end ?? null,
    packsHeld: (packs.count ?? 0) > 0,
    available: true,
  };
}
