/**
 * The assistant's discount on a quote (brief §74), over the same injected
 * store and effects as service-core.ts, so the service operation
 * (`quote.apply_discount`), the agent's `propose_discount` tool and the tests
 * run the same code. Pure: relative imports only.
 *
 * The discount is a whole-quote percentage. The decision is the quote core's:
 * `approvalVerdict` with the assistant's policy (quotes/discount-policy.ts
 * `aiDiscountPolicy`: the owner's AI limits plus the workspace's approval rules
 * and margin floor), computed on the full calculation, cost included, which
 * the assistant itself never sees.
 *
 *   DENY               nothing changes (POLICY_BLOCKED); the assistant holds the price
 *   REQUIRE_APPROVAL   the discounted revision is stored needing approval; a
 *                      person approves it before it can be sent
 *   ALLOW              the discounted revision is stored ready to send
 *
 * A sent or viewed quote gets a NEW revision (its link stops working until the
 * new one is sent), exactly as a person's revise would; a draft is changed in
 * place. The discount is priced against the revision's own catalogue
 * snapshot, so nothing else about the quote moves.
 */

import { calculateQuote } from "./calculate.ts";
import type { DiscountPolicy } from "./discount-policy.ts";
import { approvalVerdict, presentCalculation, reviseQuote, QuoteServiceError, type ApprovalVerdict, type QuoteActor, type QuoteDeps } from "./service-core.ts";
import type { QuoteCalculation, QuoteDiscount } from "./types.ts";

export type ApplyDiscountArgs = {
  quoteId: string;
  discount: QuoteDiscount;
  /** The assistant's context, set by the agent runtime (never the model). */
  ai?: { afterObjection: boolean; priorAiConcessions: number; policy?: DiscountPolicy };
  /** Decide only: nothing is written. */
  dryRun?: boolean;
};

export type ApplyDiscountResult = {
  quoteId: string;
  revisionId: string | null;
  revised: boolean;
  dryRun: boolean;
  approval: ApprovalVerdict;
  calculation: ReturnType<typeof presentCalculation>;
};

const DISCOUNTABLE = new Set(["DRAFT", "APPROVED", "SENT", "VIEWED"]);

export async function applyQuoteDiscount(deps: QuoteDeps, businessId: string, actor: QuoteActor, args: ApplyDiscountArgs): Promise<ApplyDiscountResult> {
  const builder = await deps.can("quote_builder_enabled");
  if (!builder.allowed) throw new QuoteServiceError("PLAN_LIMIT", builder.message ?? "Quotes are not on this plan.");
  if (actor.kind === "AI") {
    const ai = await deps.can("quote_ai_enabled");
    if (!ai.allowed) throw new QuoteServiceError("PLAN_LIMIT", ai.message ?? "AI quote drafting is not on this plan.");
  }

  const quote = await deps.store.loadQuote(businessId, args.quoteId);
  if (!quote || !quote.currentRevisionId) throw new QuoteServiceError("NOT_FOUND", "That quote could not be found.");
  if (!DISCOUNTABLE.has(quote.status)) throw new QuoteServiceError("CONFLICT", `A ${quote.status.toLowerCase().replace("_", " ")} quote cannot be discounted.`);
  const revision = await deps.store.loadRevision(businessId, quote.currentRevisionId);
  if (!revision) throw new QuoteServiceError("CONFLICT", "That quote's current revision could not be read.");

  const input = { ...revision.calcInput, quoteDiscount: args.discount };
  const priced = calculateQuote(input);
  if (!priced.ok) {
    throw new QuoteServiceError("INVALID_INPUT", priced.issues[0]?.message ?? "That discount could not be priced.", priced.issues);
  }
  const calc: QuoteCalculation = priced.quote;

  const settings = await deps.store.loadSettings(businessId);
  const effective = actor.kind === "AI" && args.ai?.policy ? { ...settings, discountPolicy: args.ai.policy } : settings;
  const approvals = await deps.can("quote_approval_enabled");
  const verdict = approvalVerdict(effective, calc, actor, approvals.allowed, args.ai ? { afterObjection: args.ai.afterObjection, priorAiConcessions: args.ai.priorAiConcessions } : undefined);
  if (verdict.denied) throw new QuoteServiceError("POLICY_BLOCKED", verdict.detail);
  if (verdict.required && !approvals.allowed) {
    // No approval chain on this plan: a discount that needs one cannot be given by the assistant.
    throw new QuoteServiceError("POLICY_BLOCKED", "That discount needs a person's approval, and approvals are not on this plan.");
  }

  const internal = actor.kind === "SYSTEM" || actor.role === "owner" || actor.role === "admin";
  if (args.dryRun) {
    return { quoteId: quote.id, revisionId: null, revised: false, dryRun: true, approval: verdict, calculation: presentCalculation(calc, internal) };
  }

  let revisionId = revision.id;
  let revised = false;
  if (quote.status !== "DRAFT" || revision.frozenAt) {
    const next = await reviseQuote(deps, businessId, actor, { quoteId: quote.id });
    revisionId = next.revisionId;
    revised = true;
  }
  const stored = await deps.store.replaceDraftRevision(businessId, revisionId, {
    calcInput: input,
    calculation: calc,
    calculationHash: calc.calculationHash,
    approvalRequired: verdict.required,
    internalNote: revision.internalNote,
    aiRationale: actor.kind === "AI" ? `Discount within the workspace policy: ${verdict.detail}` : revision.aiRationale,
  });
  if (!stored) throw new QuoteServiceError("CONFLICT", "That quote changed while the discount was being applied.");
  return { quoteId: quote.id, revisionId, revised, dryRun: false, approval: verdict, calculation: presentCalculation(calc, internal) };
}
