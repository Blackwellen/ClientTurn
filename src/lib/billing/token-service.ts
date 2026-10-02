import "server-only";

/**
 * AI token enforcement.
 *
 * The gate every AI call passes through, and the ledger every AI call is
 * written to. Three properties matter:
 *
 *   * **Enforcement is server-side and atomic.** The debit happens inside
 *     `consume_ai_tokens`, so two workers finishing at the same instant cannot
 *     both read the same remaining balance and both decide there was room.
 *   * **Running out degrades, it does not fail.** A workspace at its limit
 *     stops getting AI wording and AI interpretation; the deterministic
 *     qualification and follow-up engines carry on exactly as they do for a
 *     workspace that never had AI. Nobody's leads go unanswered because of a
 *     billing state.
 *   * **Nothing is billed silently.** There is no overage. A workspace tops up
 *     deliberately or it waits for the period to roll over.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "./entitlements";
import {
  AI_TOKEN_ALLOWANCE,
  nextWarningThreshold,
  summariseCredits,
  summariseTokens,
  type CreditSummary,
  TOKEN_PACKS,
  type TokenPackKey,
  type TokenSummary,
} from "./tokens";
import type { PlanId } from "./plans";
import { OVERDRAW_CEILING_RATIO } from "@/lib/ai/tokens";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiPurchasedRemaining,
  attributeUnusedCredit,
  type RefundState,
  type TopUpPurchaseInput,
} from "./refundability";

/**
 * The RPCs added in migration 0116 post-date the last `database.types.ts`
 * generation. Cast at this one seam, bound so `this.rest` still resolves.
 */
type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function untypedRpc(admin: ReturnType<typeof createAdminClient>): UntypedRpc {
  return (admin.rpc as unknown as UntypedRpc).bind(admin);
}

export type TokenPeriod = { periodStart: string; periodEnd: string };

/**
 * The billing period an allowance belongs to. Falls back to a calendar month
 * when there is no subscription row yet — a workspace mid-provisioning still
 * needs a period to spend against.
 */
export function resolvePeriod(entitlementPeriod: {
  periodStart: string | null;
  periodEnd: string | null;
}): TokenPeriod {
  if (entitlementPeriod.periodStart && entitlementPeriod.periodEnd) {
    return {
      periodStart: entitlementPeriod.periodStart.slice(0, 10),
      periodEnd: entitlementPeriod.periodEnd.slice(0, 10),
    };
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

/** The plan's monthly grant, from the database, falling back to the catalogue. */
async function grantForPlan(plan: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("plan_entitlements")
    .select("hard_limit")
    .eq("plan_key", plan)
    .eq("metric", "ai_tokens")
    .maybeSingle();

  const fromDatabase = data?.hard_limit;
  if (typeof fromDatabase === "number" && fromDatabase > 0) return Math.floor(fromDatabase);

  return AI_TOKEN_ALLOWANCE[plan as PlanId] ?? AI_TOKEN_ALLOWANCE.trial;
}

export type TokenBalanceRow = {
  periodStart: string;
  periodEnd: string;
  plan: string;
  includedTokens: number;
  purchasedTokens: number;
  usedTokens: number;
  reservedTokens: number;
  blockedAt: string | null;
  warnedAtPercent: number;
};

/**
 * Reads the balance for the current period, creating it on first use.
 *
 * Purchased tokens carry forward: when a new period opens, whatever was left
 * of the purchased pool moves across. Included tokens do not — that is the
 * difference between an allowance and something someone paid for.
 */
export async function ensureTokenBalance(businessId: string): Promise<TokenBalanceRow> {
  const admin = createAdminClient();
  const entitlements = await getEntitlements(businessId);
  const period = resolvePeriod(entitlements);

  const { data: existing } = await admin
    .from("ai_token_balances")
    .select(
      "period_start, period_end, plan_key, included_tokens, purchased_tokens, used_tokens, reserved_tokens, blocked_at, warned_at_percent",
    )
    .eq("business_id", businessId)
    .eq("period_start", period.periodStart)
    .maybeSingle();

  if (existing) {
    return {
      periodStart: existing.period_start,
      periodEnd: existing.period_end,
      plan: existing.plan_key ?? entitlements.plan,
      includedTokens: Number(existing.included_tokens),
      purchasedTokens: Number(existing.purchased_tokens),
      usedTokens: Number(existing.used_tokens),
      reservedTokens: Number(existing.reserved_tokens),
      blockedAt: existing.blocked_at,
      warnedAtPercent: existing.warned_at_percent,
    };
  }

  // Carry the unspent purchased pool over from the most recent period.
  const { data: previous } = await admin
    .from("ai_token_balances")
    .select("included_tokens, purchased_tokens, used_tokens")
    .eq("business_id", businessId)
    .lt("period_start", period.periodStart)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  let carriedPurchased = 0;
  if (previous) {
    const granted = Number(previous.included_tokens) + Number(previous.purchased_tokens);
    const unspent = Math.max(granted - Number(previous.used_tokens), 0);
    // Only the purchased portion survives; the included grant expires.
    carriedPurchased = Math.min(unspent, Number(previous.purchased_tokens));
  }

  const included = await grantForPlan(entitlements.plan);

  const { data: created, error } = await admin
    .from("ai_token_balances")
    .insert({
      business_id: businessId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      plan_key: entitlements.plan,
      included_tokens: included,
      purchased_tokens: carriedPurchased,
    })
    .select(
      "period_start, period_end, plan_key, included_tokens, purchased_tokens, used_tokens, reserved_tokens, blocked_at, warned_at_percent",
    )
    .single();

  // A racing worker created it first; read theirs rather than failing.
  if (error?.code === "23505") return ensureTokenBalance(businessId);
  if (error || !created) throw error ?? new Error("Could not open a token balance.");

  // The balance row above is the grant; this is its ledger trail. Throwing
  // would not help — the next call finds the balance and never comes back
  // here — so a failure is logged (23505 is an already-written grant).
  const { error: grantLedgerError } = await admin.from("ai_token_ledger").insert({
    business_id: businessId,
    period_start: period.periodStart,
    delta_tokens: included,
    reason: entitlements.plan === "trial" ? "TRIAL_GRANT" : "PLAN_GRANT",
    idempotency_key: `grant:${period.periodStart}:${entitlements.plan}`,
    balance_after: included + carriedPurchased,
    metadata: { carriedPurchased },
  });
  if (grantLedgerError && grantLedgerError.code !== "23505") {
    console.error("[token-service] grant ledger insert failed", {
      businessId,
      periodStart: period.periodStart,
      code: grantLedgerError.code,
      message: grantLedgerError.message,
    });
  }

  return {
    periodStart: created.period_start,
    periodEnd: created.period_end,
    plan: created.plan_key ?? entitlements.plan,
    includedTokens: Number(created.included_tokens),
    purchasedTokens: Number(created.purchased_tokens),
    usedTokens: Number(created.used_tokens),
    reservedTokens: Number(created.reserved_tokens),
    blockedAt: created.blocked_at,
    warnedAtPercent: created.warned_at_percent,
  };
}

export type TokenStatus = TokenSummary & {
  periodStart: string;
  periodEnd: string;
  plan: string;
  blocked: boolean;
};

export async function getTokenStatus(businessId: string): Promise<TokenStatus> {
  const balance = await ensureTokenBalance(businessId);
  const summary = summariseTokens({
    includedTokens: balance.includedTokens,
    purchasedTokens: balance.purchasedTokens,
    usedTokens: balance.usedTokens,
    reservedTokens: balance.reservedTokens,
  });

  return {
    ...summary,
    periodStart: balance.periodStart,
    periodEnd: balance.periodEnd,
    plan: balance.plan,
    blocked: summary.remaining <= 0,
  };
}

export type CreditStatus = CreditSummary & { periodStart: string; periodEnd: string; blocked: boolean };

/**
 * The customer view of the allowance: AI credits only (owner decision,
 * 2026-09-30). Every customer surface (Billing, AI & selling, the dashboard,
 * `ai_usage.get`) reads this, never `getTokenStatus`.
 */
export async function getCreditStatus(businessId: string): Promise<CreditStatus> {
  const balance = await ensureTokenBalance(businessId);
  const credits = summariseCredits({
    includedTokens: balance.includedTokens,
    purchasedTokens: balance.purchasedTokens,
    usedTokens: balance.usedTokens,
    reservedTokens: balance.reservedTokens,
  });
  return {
    ...credits,
    periodStart: balance.periodStart,
    periodEnd: balance.periodEnd,
    blocked: credits.remainingCredits <= 0,
  };
}

/**
 * The pre-flight check (read-only). Returns false when there is not enough
 * allowance left to safely attempt a call of this size -- the caller then
 * skips the model entirely rather than spending on a call it cannot pay for.
 *
 * This is a plain read, so it is NOT atomic against concurrent workers. Any
 * caller that is about to spend should use `reserveTokenCapacity`, which
 * admits under a row lock and counts every call already in flight.
 */
export async function hasTokenCapacity(
  businessId: string,
  estimatedTokens: number,
): Promise<{ ok: boolean; status: TokenStatus }> {
  const status = await getTokenStatus(businessId);
  return { ok: status.remaining > 0 && status.available >= estimatedTokens, status };
}

/**
 * Atomic admission (B21). Holds `estimatedTokens` against the allowance until
 * the call is settled by `recordTokenConsumption({ reservationId })` or
 * released by `releaseTokenReservation`. A crashed worker's hold expires on
 * its own after five minutes.
 *
 * `ok: false` means "do not call the model" -- the caller degrades to its
 * deterministic path exactly as for a workspace without AI. A database error
 * also refuses: failing closed on spend is the safe direction.
 */
export async function reserveTokenCapacity(
  businessId: string,
  estimatedTokens: number,
): Promise<{ ok: boolean; reservationId: string | null }> {
  const balance = await ensureTokenBalance(businessId);
  const { data, error } = await untypedRpc(createAdminClient())("reserve_ai_tokens", {
    target_business_id: businessId,
    target_period_start: balance.periodStart,
    tokens: Math.max(Math.ceil(estimatedTokens), 1),
  });

  if (error) {
    console.error("[token-service] reserve_ai_tokens failed", error.message);
    return { ok: false, reservationId: null };
  }
  const reservationId = typeof data === "string" ? data : null;
  return { ok: reservationId !== null, reservationId };
}

/** Drops a hold without debiting: the call never reached the provider. */
export async function releaseTokenReservation(
  businessId: string,
  reservationId: string,
): Promise<void> {
  const { error } = await untypedRpc(createAdminClient())("release_ai_token_reservation", {
    target_business_id: businessId,
    reservation_id: reservationId,
  });
  if (error) {
    // Not fatal: an unreleased hold expires on its own.
    console.error("[token-service] release_ai_token_reservation failed", error.message);
  }
}

/**
 * Debits the true cost after a call. Idempotent on `idempotencyKey`, so a
 * retried worker cannot bill the same call twice.
 *
 * A call that already happened is always recorded -- refusing would
 * understate usage. Overdraw is bounded upstream by atomic admission
 * (`reserveTokenCapacity`), so the only overshoot left is estimate-vs-actual
 * on admitted calls. A debit that still lands beyond the emergency ceiling
 * (OVERDRAW_CEILING_RATIO x the plan allocation) is flagged `over_ceiling`
 * in the ledger; the balance is then negative, so every later admission and
 * `hasTokenCapacity` check refuses until the workspace tops up or rolls over.
 *
 * `totalTokens` is prompt + completion (see `billableTokens` in
 * `@/lib/ai/tokens`) -- never add the cached subset on top.
 */
export async function recordTokenConsumption(input: {
  businessId: string;
  totalTokens: number;
  idempotencyKey: string;
  aiRunId?: string | null;
  agentRunId?: string | null;
  taskType?: string | null;
  deployment?: string | null;
  /** The hold from `reserveTokenCapacity`, released as the debit lands. */
  reservationId?: string | null;
}): Promise<number | null> {
  if (input.totalTokens <= 0) {
    if (input.reservationId) {
      await releaseTokenReservation(input.businessId, input.reservationId);
    }
    return null;
  }

  const admin = createAdminClient();
  const balance = await ensureTokenBalance(input.businessId);

  const { data, error } = await untypedRpc(admin)("consume_ai_tokens_bounded", {
    target_business_id: input.businessId,
    target_period_start: balance.periodStart,
    tokens: Math.ceil(input.totalTokens),
    consume_reason: "CONSUMPTION",
    idem_key: input.idempotencyKey,
    source_ai_run_id: input.aiRunId ?? null,
    source_agent_run_id: input.agentRunId ?? null,
    source_task_type: input.taskType ?? null,
    source_deployment: input.deployment ?? null,
    reservation_id: input.reservationId ?? null,
    overdraw_ceiling_ratio: OVERDRAW_CEILING_RATIO,
  });

  if (error) {
    console.error("[token-service] consume_ai_tokens_bounded failed", error.message);
    return null;
  }

  await maybeWarn(input.businessId, balance.periodStart);
  return typeof data === "number" ? data : null;
}

/**
 * Notifies a workspace once per threshold crossed. The watermark on the
 * balance row is what stops this firing on every call past 80%.
 */
async function maybeWarn(businessId: string, periodStart: string): Promise<void> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("ai_token_balances")
    .select("included_tokens, purchased_tokens, used_tokens, reserved_tokens, warned_at_percent")
    .eq("business_id", businessId)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (!data) return;

  const summary = summariseTokens({
    includedTokens: Number(data.included_tokens),
    purchasedTokens: Number(data.purchased_tokens),
    usedTokens: Number(data.used_tokens),
    reservedTokens: Number(data.reserved_tokens),
  });

  const threshold = nextWarningThreshold(summary.percentUsed, data.warned_at_percent);
  if (threshold === null) return;

  const { error: watermarkError } = await admin
    .from("ai_token_balances")
    .update({ warned_at_percent: threshold })
    .eq("business_id", businessId)
    .eq("period_start", periodStart);
  // The watermark is what stops the warning repeating on every call. Without
  // it recorded, skip the notification; the next call tries both again.
  if (watermarkError) {
    console.error("[token-service] warning watermark update failed", {
      businessId,
      periodStart,
      threshold,
      code: watermarkError.code,
      message: watermarkError.message,
    });
    return;
  }

  // Imported lazily: the notification helper pulls in the job queue, and the
  // model router must not carry that weight on every call.
  const { queueNotification } = await import("@/lib/jobs/handlers/shared");
  await queueNotification({
    businessId,
    type: "usage_limit",
    severity: summary.state === "EXHAUSTED" ? "error" : "warning",
    title:
      summary.remaining <= 0
        ? "AI credits used up"
        : `AI credits ${threshold}% used`,
    body:
      summary.remaining <= 0
        ? "The assistant has paused. Your follow-up and qualification rules keep running as normal. Top up to switch it back on."
        : "Top up now to avoid the assistant pausing before your next renewal.",
    linkUrl: "/app/settings?section=billing",
    dedupeKey: `ai_tokens:${businessId}:${periodStart}:${threshold}`,
  });
}

// ------------------------------------------------------------- purchases

/**
 * Credits a paid top-up. Called from the Stripe webhook; idempotent twice over
 * — once on the purchase row's `credited_at`, once on the ledger key — because
 * a double credit is real money given away.
 */
export async function creditTokenPurchase(purchaseId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: purchase } = await admin
    .from("ai_token_purchases")
    .select("id, business_id, tokens, status, credited_at, pack_key")
    .eq("id", purchaseId)
    .maybeSingle();

  if (!purchase || purchase.credited_at) return false;
  if (purchase.status !== "PAID") return false;

  const balance = await ensureTokenBalance(purchase.business_id);

  const { error } = await admin.rpc("credit_ai_tokens", {
    target_business_id: purchase.business_id,
    target_period_start: balance.periodStart,
    tokens: Number(purchase.tokens),
    credit_reason: "PURCHASE",
    idem_key: `purchase:${purchase.id}`,
    source_purchase_id: purchase.id,
    credit_purchased: true,
  });

  if (error) return false;

  await admin
    .from("ai_token_purchases")
    .update({ credited_at: new Date().toISOString() })
    .eq("id", purchase.id)
    .is("credited_at", null);

  return true;
}

export function packFor(key: string): (typeof TOKEN_PACKS)[TokenPackKey] | null {
  return key in TOKEN_PACKS ? TOKEN_PACKS[key as TokenPackKey] : null;
}

/**
 * Recent token purchases, each with its refund state (owner policy
 * 2026-09-27: non-refundable once any credit is used). Attribution is FIFO
 * over ALL credited purchases against the purchased pool still unspent this
 * period (refundability.ts). A failed read reports nothing as refundable.
 */
export async function listTokenPurchases(businessId: string, limit = 10) {
  const admin = createAdminClient();
  const [{ data }, refundability] = await Promise.all([
    admin
      .from("ai_token_purchases")
      .select("id, pack_key, tokens, amount_minor, currency, status, created_at, credited_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit),
    tokenRefundability(businessId).catch(() => null),
  ]);

  return (data ?? []).map((row) => {
    const fifo = refundability?.get(row.id);
    const refundState: RefundState =
      fifo?.state ?? (row.status === "REFUNDED" ? "refunded" : "not_credited");
    return {
      id: row.id,
      packKey: row.pack_key,
      tokens: Number(row.tokens),
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      creditedAt: row.credited_at,
      refundable: fifo?.refundable ?? false,
      refundState,
      unusedTokens: fifo?.unused ?? 0,
    };
  });
}

async function tokenRefundability(businessId: string) {
  const balance = await ensureTokenBalance(businessId);
  // `tokens_reversed` (0142) post-dates the generated types.
  const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
    .from("ai_token_purchases")
    .select("id, tokens, tokens_reversed, status, created_at, credited_at")
    .eq("business_id", businessId)
    .in("status", ["PAID", "REFUNDED"]);
  if (error) return null;

  const purchases: TopUpPurchaseInput[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    credits: Number(row.tokens),
    reversed: Number(row.tokens_reversed ?? 0),
    status: String(row.status),
    createdAt: String(row.created_at),
    creditedAt: (row.credited_at as string | null) ?? null,
  }));
  return attributeUnusedCredit(purchases, aiPurchasedRemaining(balance));
}

/**
 * The `billing.refund_reverse` job for an AI token pack the owner refunded in
 * Stripe: reverses only the pack's tokens that are still unused (FIFO), from
 * the purchased pool of the current period, never below zero. Idempotent on
 * `refund:<purchase>:<cumulative amount refunded>`. Returns tokens reversed.
 */
export async function reverseRefundedTokenPurchase(input: {
  purchaseId: string;
  amountRefundedMinor: number;
}): Promise<number> {
  const admin = createAdminClient();
  const { data: purchase, error: readError } = await admin
    .from("ai_token_purchases")
    .select("id, business_id, status")
    .eq("id", input.purchaseId)
    .maybeSingle();
  if (readError) throw new Error(`token purchase read failed: ${readError.message}`);
  // Re-checked now: only a purchase that is (still) refunded is reversed.
  if (!purchase || purchase.status !== "REFUNDED") return 0;

  const balance = await ensureTokenBalance(purchase.business_id);
  const refunded = Math.max(Math.floor(input.amountRefundedMinor), 0);
  const { data, error } = await untypedRpc(admin)("reverse_ai_token_purchase", {
    target_purchase_id: purchase.id,
    target_period_start: balance.periodStart,
    amount_refunded_minor: refunded,
    idem_key: `refund:${purchase.id}:${refunded}`,
  });
  if (error) throw new Error(`reverse_ai_token_purchase failed: ${error.message}`);
  return Number(data ?? 0);
}
