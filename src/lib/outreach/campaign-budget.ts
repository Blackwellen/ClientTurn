import type { BudgetCeilings, CampaignDraft } from "./campaign-draft.ts";

/**
 * The campaign budget's shapes and arithmetic.
 *
 * Pure, and separate from `campaigns/budget.ts` for the same reason
 * `outreach/types.ts` is separate from `outreach/queries.ts`: step 5 of the
 * wizard is a client component and must be able to compute the summary it
 * renders without pulling `server-only` into the browser graph.
 *
 * The server resolves the ceilings; this decides what the configured numbers
 * add up to.
 */

/** Sending one campaign email consumes one message from the tenant allowance. */
export const MESSAGES_PER_CONTACT = 1;

/**
 * Serving costs are admin-only (owner decision, 2026-09-30).
 *
 * Nothing in this file's customer shapes carries money. What ClientTurn pays
 * its data providers per prospect, per refresh or per campaign is platform
 * economics, shown only under Admin → Economics. A customer sees what is
 * theirs: plan allowances (prospects, email contacts, messages) and their own
 * daily and monthly caps. The provider cost ceiling still exists and is still
 * enforced at launch and at spend time — the customer simply never sets or
 * sees it; see `effectiveProviderCostCeilingMinor`.
 */
export type PlanUsageMeter = {
  key: "prospects" | "emailContacts" | "messageAllowance";
  label: string;
  used: number;
  limit: number;
};

export type CampaignBudgetContext = {
  ceilings: BudgetCeilings;
  meters: PlanUsageMeter[];
  /** Which ceiling the effective daily cap actually came from. */
  dailyCapSource: "MAILBOX" | "PLAN";
};

export type CampaignBudgetSummary = {
  prospectsToSource: number;
  outreachContacts: number;
  emailCredits: number;
};

/**
 * The Budget summary card: allowance usage, never money.
 *
 * It never counts sourcing for a campaign that will not source, and email
 * credits come out of the tenant allowance as a head count.
 */
export function summariseCampaignBudget(draft: CampaignDraft): CampaignBudgetSummary {
  const sourcing = draft.audience.source === "EXISTING_ONLY" ? 0 : draft.budget.prospectsPerRun;
  const contacts = Math.min(draft.budget.prospectsPerRun, draft.budget.monthlyContacts);

  return {
    prospectsToSource: sourcing,
    outreachContacts: contacts,
    emailCredits: contacts * MESSAGES_PER_CONTACT,
  };
}

/**
 * The provider cost ceiling a campaign actually reserves at launch, in pence.
 *
 * The customer no longer sets this. A draft with no value (every new draft)
 * takes the whole remaining platform ceiling; a draft saved by an older wizard
 * with an explicit value keeps it, clamped to what remains so a stale value can
 * never fail a launch over a field the customer cannot see or edit.
 */
export function effectiveProviderCostCeilingMinor(
  requestedMinor: number,
  remainingCeilingMinor: number,
): number {
  const remaining = Math.max(0, Math.floor(remainingCeilingMinor));
  const requested = Math.max(0, Math.floor(requestedMinor || 0));
  return requested > 0 ? Math.min(requested, remaining) : remaining;
}

/* ------------------------------------------------------------- reporting */

export type BudgetCategory = "DATA_ENRICHMENT" | "EMAIL_SENDING" | "PROVIDER_DATA" | "OTHER";

export const BUDGET_CATEGORY_LABELS: Record<BudgetCategory, string> = {
  DATA_ENRICHMENT: "Data enrichment",
  EMAIL_SENDING: "Email sending",
  PROVIDER_DATA: "Provider data",
  OTHER: "Other",
};

export type CampaignBudgetUsage = {
  capMinor: number;
  spentMinor: number;
  /** Null when no cap is set: an uncapped campaign has no "percent used". */
  percentUsed: number | null;
  breakdown: { category: BudgetCategory; label: string; minor: number; percent: number }[];
  /** True when nothing has been attributed yet, so the card shows an empty
   *  state rather than four zero-pound rows presented as a breakdown. */
  empty: boolean;
};

/**
 * Campaign budget usage as a customer sees it: a proportion, never pounds.
 *
 * The pound figures in `CampaignBudgetUsage` are provider spend, which is
 * admin-only. "42% of this campaign's budget used" answers "can it keep
 * running?" without disclosing serving costs.
 */
export type CustomerCampaignBudget = {
  /** False when no provider budget was reserved for this campaign. */
  capped: boolean;
  percentUsed: number | null;
  breakdown: { category: BudgetCategory; label: string; percent: number }[];
  empty: boolean;
};

export function toCustomerCampaignBudget(usage: CampaignBudgetUsage): CustomerCampaignBudget {
  return {
    capped: usage.capMinor > 0,
    percentUsed: usage.percentUsed,
    breakdown: usage.breakdown.map(({ category, label, percent }) => ({ category, label, percent })),
    empty: usage.empty,
  };
}
