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
  summariseTokens,
  TOKEN_PACKS,
  type TokenPackKey,
  type TokenSummary,
} from "./tokens";
import type { PlanId } from "./plans";

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

  await admin.from("ai_token_ledger").insert({
    business_id: businessId,
    period_start: period.periodStart,
    delta_tokens: included,
    reason: entitlements.plan === "trial" ? "TRIAL_GRANT" : "PLAN_GRANT",
    idempotency_key: `grant:${period.periodStart}:${entitlements.plan}`,
    balance_after: included + carriedPurchased,
    metadata: { carriedPurchased },
  });

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

/**
 * The pre-flight check. Returns false when there is not enough allowance left
 * to safely attempt a call of this size — the caller then skips the model
 * entirely rather than spending on a call it cannot pay for.
 */
export async function hasTokenCapacity(
  businessId: string,
  estimatedTokens: number,
): Promise<{ ok: boolean; status: TokenStatus }> {
  const status = await getTokenStatus(businessId);
  return { ok: status.available >= estimatedTokens, status };
}

/**
 * Debits the true cost after a call. Idempotent on `idempotencyKey`, so a
 * retried worker cannot bill the same call twice.
 *
 * `allowOverdraw` exists for the reconciliation case only: a call that has
 * already happened must be recorded even if its real cost overshot the
 * estimate. Refusing to record it would understate usage, which is worse than
 * a small overshoot on one period.
 */
export async function recordTokenConsumption(input: {
  businessId: string;
  totalTokens: number;
  idempotencyKey: string;
  aiRunId?: string | null;
  agentRunId?: string | null;
  taskType?: string | null;
  deployment?: string | null;
}): Promise<number | null> {
  if (input.totalTokens <= 0) return null;

  const admin = createAdminClient();
  const balance = await ensureTokenBalance(input.businessId);

  const { data, error } = await admin.rpc("consume_ai_tokens", {
    target_business_id: input.businessId,
    target_period_start: balance.periodStart,
    tokens: input.totalTokens,
    consume_reason: "CONSUMPTION",
    idem_key: input.idempotencyKey,
    // The generated RPC signature takes optional arguments rather than
    // nullable ones, so an absent value is omitted rather than passed as null.
    ...(input.aiRunId ? { source_ai_run_id: input.aiRunId } : {}),
    ...(input.agentRunId ? { source_agent_run_id: input.agentRunId } : {}),
    ...(input.taskType ? { source_task_type: input.taskType } : {}),
    ...(input.deployment ? { source_deployment: input.deployment } : {}),
    allow_overdraw: true,
  });

  if (error) return null;

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

  await admin
    .from("ai_token_balances")
    .update({ warned_at_percent: threshold })
    .eq("business_id", businessId)
    .eq("period_start", periodStart);

  // Imported lazily: the notification helper pulls in the job queue, and the
  // model router must not carry that weight on every call.
  const { queueNotification } = await import("@/lib/jobs/handlers/shared");
  await queueNotification({
    businessId,
    type: "usage_limit",
    severity: summary.state === "EXHAUSTED" ? "error" : "warning",
    title:
      summary.remaining <= 0
        ? "AI tokens used up"
        : `AI tokens ${threshold}% used`,
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

export async function listTokenPurchases(businessId: string, limit = 10) {
  const { data } = await createAdminClient()
    .from("ai_token_purchases")
    .select("id, pack_key, tokens, amount_minor, currency, status, created_at, credited_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    packKey: row.pack_key,
    tokens: Number(row.tokens),
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    creditedAt: row.credited_at,
  }));
}
