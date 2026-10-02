/**
 * Customer AI limits in AI credits (owner decision, 2026-09-30).
 *
 * Pure: no `server-only`, no I/O, relative `.ts` imports, so it is unit
 * tested. Import it from SERVER code only: it carries the internal £ rate
 * that turns an old pound limit into credits, and that rate must not ship in
 * a browser bundle. Client components get credits, already converted.
 *
 * How limits are stored and enforced:
 *
 *   * A limit the customer sets is written as `ai_budgets.ceiling_tokens`
 *     (credits x AI_TOKENS_PER_CREDIT). `decideSpend` already enforces
 *     `ceiling_tokens` against `ai_spend_snapshot` tokens, so the limit is
 *     enforced in the customer's own unit, not converted to money.
 *   * The per-lead scopes keep the platform's £ default on the workspace row
 *     as a hidden backstop (`ceiling_minor`), so a workspace row never loosens
 *     the £ bound the platform row gave it. Plan and emergency £ ceilings are
 *     platform rows and apply as before; they are admin-only.
 *   * A row saved before credits existed has only `ceiling_minor`. It keeps
 *     being enforced in pounds, and reads back as credits at the reference
 *     rate (rounded down, so the shown limit is never looser than the real one).
 */

import { MODEL_ASSUMPTIONS } from "../billing/unit-costs.ts";
import { AI_TOKENS_PER_CREDIT } from "../billing/tokens.ts";
import { DEFAULT_LEAD_TOKEN_CEILING } from "./budget.ts";

/**
 * Pence per AI credit at the typical model mix (economics.md: the
 * agent_decision envelope on the mini tier, $1.09 per 1M tokens, converted at
 * the model FX rate). About 0.082p, so £1 is about 1,215 credits.
 */
export const REFERENCE_PENCE_PER_CREDIT =
  (MODEL_ASSUMPTIONS.aiTypicalPerMillionTokens * 100 * AI_TOKENS_PER_CREDIT) / 1_000_000;

/** An old pound limit in credits, rounded down. */
export function penceToCredits(minor: number): number {
  if (!Number.isFinite(minor) || minor <= 0) return 0;
  return Math.floor(minor / REFERENCE_PENCE_PER_CREDIT);
}

/** Ledger tokens in whole credits, rounded down. */
export function tokensToWholeCredits(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor(tokens / AI_TOKENS_PER_CREDIT);
}

export type CeilingRow = { ceilingMinor: number | null; ceilingTokens: number | null };

/**
 * The limit a row sets, in credits: the tighter of its token ceiling and its
 * (converted) pound ceiling. Null when the row sets neither.
 */
export function creditLimitFromRow(row: CeilingRow | null | undefined): number | null {
  if (!row) return null;
  const limits: number[] = [];
  if (row.ceilingTokens !== null && row.ceilingTokens !== undefined) limits.push(tokensToWholeCredits(row.ceilingTokens));
  if (row.ceilingMinor !== null && row.ceilingMinor !== undefined) limits.push(penceToCredits(row.ceilingMinor));
  return limits.length ? Math.min(...limits) : null;
}

/**
 * The platform default for a scope in credits. The LEAD scope always carries
 * a token cap (DEFAULT_LEAD_TOKEN_CEILING) when its row sets none, exactly as
 * `remainingFromBudgets` enforces it.
 */
export function platformDefaultCredits(scope: string, row: CeilingRow | null | undefined): number | null {
  if (scope === "LEAD") {
    return creditLimitFromRow({
      ceilingMinor: row?.ceilingMinor ?? null,
      ceilingTokens: row?.ceilingTokens ?? DEFAULT_LEAD_TOKEN_CEILING,
    });
  }
  return creditLimitFromRow(row);
}

/**
 * What to write for a credit limit: tokens for enforcement, plus the platform
 * £ default as the hidden backstop on the per-lead scopes.
 */
export function rowForCreditLimit(
  scope: string,
  credits: number,
  platformMinor: number | null,
): { ceiling_tokens: number; ceiling_minor: number | null } {
  return {
    ceiling_tokens: Math.round(credits * AI_TOKENS_PER_CREDIT),
    ceiling_minor: scope === "WORKSPACE_MONTH" ? null : platformMinor,
  };
}
