/**
 * AI token allowances and top-up packs.
 *
 * Pure: no `server-only`, no Supabase, no I/O, so the pricing page, the usage
 * meter and the enforcement path all read the same numbers from one place and
 * the whole policy is unit-testable.
 *
 * What lives here is the *customer-facing* unit. A token is a countable
 * allowance that goes down as the assistant works and can be topped up. What
 * a token costs the platform is not here and never reaches a customer surface
 * — that stays in `provider_price_book` / `cost_events`, which are admin-only.
 */

import type { PlanId } from "./plans";

// ------------------------------------------------------------- allowances

/**
 * Monthly included tokens per tier. The database is the authority at runtime
 * (`plan_entitlements`, so an allowance change is a row edit rather than a
 * deploy); these are the seeded defaults and the fallback when a row is
 * missing, so the two must agree.
 */
export const AI_TOKEN_ALLOWANCE: Record<PlanId, number> = {
  trial: 100_000,
  starter: 1_000_000,
  growth: 4_000_000,
  pro: 12_000_000,
  enterprise: 40_000_000,
};

/**
 * A rough, honest yardstick for the UI. One agent turn is a system prompt plus
 * a short context window plus a two-sentence reply — call it 1,700 tokens.
 * Deliberately a round over-estimate: telling someone they have fewer
 * conversations left than they really do is the safe direction to be wrong in.
 */
export const TOKENS_PER_CONVERSATION_TURN = 1_700;

export function approximateTurns(tokens: number): number {
  return Math.max(Math.floor(tokens / TOKENS_PER_CONVERSATION_TURN), 0);
}

// ------------------------------------------------------------------ packs

export type TokenPack = {
  key: TokenPackKey;
  name: string;
  tokens: number;
  /** GBP, in minor units. Stripe holds the authoritative amount. */
  amountMinor: number;
  currency: "GBP";
  description: string;
  bestValue: boolean;
};

export const TOKEN_PACK_KEYS = ["top_up_small", "top_up_medium", "top_up_large"] as const;
export type TokenPackKey = (typeof TOKEN_PACK_KEYS)[number];

export const TOKEN_PACKS: Record<TokenPackKey, TokenPack> = {
  top_up_small: {
    key: "top_up_small",
    name: "Small top-up",
    tokens: 500_000,
    amountMinor: 1500,
    currency: "GBP",
    description: "Enough to keep going through a busy week.",
    bestValue: false,
  },
  top_up_medium: {
    key: "top_up_medium",
    name: "Medium top-up",
    tokens: 2_000_000,
    amountMinor: 4900,
    currency: "GBP",
    description: "Roughly a month of extra headroom on most plans.",
    bestValue: true,
  },
  top_up_large: {
    key: "top_up_large",
    name: "Large top-up",
    tokens: 6_000_000,
    amountMinor: 12900,
    currency: "GBP",
    description: "For a seasonal spike, or a busy quarter.",
    bestValue: false,
  },
};

export const TOKEN_PACK_LIST: TokenPack[] = TOKEN_PACK_KEYS.map((key) => TOKEN_PACKS[key]);

export function isTokenPackKey(value: string): value is TokenPackKey {
  return (TOKEN_PACK_KEYS as readonly string[]).includes(value);
}

// --------------------------------------------------------------- accounting

export type TokenBalance = {
  /** Granted by the plan for this period. Resets each period. */
  includedTokens: number;
  /** Bought as top-ups. Carries forward — a customer paid for these. */
  purchasedTokens: number;
  usedTokens: number;
  reservedTokens: number;
};

export type TokenUsageState = "HEALTHY" | "APPROACHING" | "CRITICAL" | "EXHAUSTED";

export type TokenSummary = {
  granted: number;
  used: number;
  remaining: number;
  /** Remaining minus what in-flight calls are holding. */
  available: number;
  percentUsed: number;
  state: TokenUsageState;
  approximateTurnsLeft: number;
  purchasedTokens: number;
};

/** Thresholds the meter and the warning notification both read. */
export const TOKEN_WARN_PERCENT = 80;
export const TOKEN_CRITICAL_PERCENT = 95;

export function summariseTokens(balance: TokenBalance): TokenSummary {
  const granted = balance.includedTokens + balance.purchasedTokens;
  const used = balance.usedTokens;
  const remaining = Math.max(granted - used, 0);
  const available = Math.max(remaining - balance.reservedTokens, 0);

  // No allowance at all is "exhausted", not "0% used" — a workspace with
  // nothing granted cannot do AI work, and the meter should say so.
  const percentUsed = granted <= 0 ? 100 : Math.min(Math.round((used / granted) * 100), 100);

  const state: TokenUsageState =
    remaining <= 0
      ? "EXHAUSTED"
      : percentUsed >= TOKEN_CRITICAL_PERCENT
        ? "CRITICAL"
        : percentUsed >= TOKEN_WARN_PERCENT
          ? "APPROACHING"
          : "HEALTHY";

  return {
    granted,
    used,
    remaining,
    available,
    percentUsed,
    state,
    approximateTurnsLeft: approximateTurns(available),
    purchasedTokens: balance.purchasedTokens,
  };
}

export const TOKEN_STATE_LABEL: Record<TokenUsageState, string> = {
  HEALTHY: "Plenty left",
  APPROACHING: "Running low",
  CRITICAL: "Almost gone",
  EXHAUSTED: "Used up",
};

export const TOKEN_STATE_TONE: Record<TokenUsageState, string> = {
  HEALTHY: "success",
  APPROACHING: "warning",
  CRITICAL: "warning",
  EXHAUSTED: "danger",
};

/**
 * The threshold a workspace should be warned at, given where it already has
 * been warned. Returns null when there is nothing new to say — which is what
 * stops a warning firing on every call once the meter is past 80%.
 */
export function nextWarningThreshold(
  percentUsed: number,
  warnedAtPercent: number,
): number | null {
  for (const threshold of [TOKEN_CRITICAL_PERCENT, TOKEN_WARN_PERCENT]) {
    if (percentUsed >= threshold && warnedAtPercent < threshold) return threshold;
  }
  return null;
}

// -------------------------------------------------------------- estimation

/**
 * Tokens to hold before a call, since the real cost is only known afterwards.
 * Generous on purpose: an under-estimate lets a workspace slip past its limit,
 * and the reservation is released against the true figure the moment the call
 * returns.
 */
export function estimateTokensForCall(maxOutputTokens: number, contextLength: number): number {
  // ~4 characters per token is the standard rule of thumb for English.
  const inputEstimate = Math.ceil(contextLength / 4);
  return inputEstimate + maxOutputTokens;
}

/** Compact display: 1_250_000 -> "1.25M", 4_300 -> "4.3k". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(2))}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`;
  }
  return String(Math.round(tokens));
}

export function formatPackPrice(pack: TokenPack): string {
  return `£${(pack.amountMinor / 100).toFixed(2)}`;
}

/**
 * Value per pack, for the "best value" ordering on the buy screen. Expressed
 * as tokens per pound so a larger pack reads as obviously better.
 */
export function tokensPerPound(pack: TokenPack): number {
  return pack.amountMinor === 0 ? 0 : Math.round(pack.tokens / (pack.amountMinor / 100));
}
