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
 * add up to. Both the quote shown before launch and the reservation taken at
 * launch go through `summariseCampaignBudget`, so they cannot disagree.
 */

/** Sending one campaign email consumes one message from the tenant allowance. */
export const MESSAGES_PER_CONTACT = 1;

export type PlanUsageMeter = {
  key: "prospects" | "emailContacts" | "providerSpend" | "messageAllowance";
  label: string;
  used: number;
  limit: number;
  /** Rendered with a currency symbol when true; a plain count otherwise. */
  money: boolean;
};

export type CampaignBudgetContext = {
  ceilings: BudgetCeilings;
  meters: PlanUsageMeter[];
  /** Pence per verified prospect, from the live price book. */
  costPerProspectMinor: number;
  /** Which ceiling the effective daily cap actually came from. */
  dailyCapSource: "MAILBOX" | "PLAN";
};

export type CampaignBudgetSummary = {
  prospectsToSource: number;
  providerCostMinor: number;
  costPerProspectMinor: number;
  outreachContacts: number;
  emailCredits: number;
  totalCostMinor: number;
};

/**
 * The Budget summary card.
 *
 * Two things it deliberately does not do: it never quotes sourcing cost for a
 * campaign that will not source, and it never folds email credits into the
 * pounds figure — credits come out of the tenant allowance, not out of money,
 * and adding them would charge the customer twice on screen.
 */
export function summariseCampaignBudget(
  draft: CampaignDraft,
  costPerProspectMinor: number,
): CampaignBudgetSummary {
  const sourcing = draft.audience.source === "EXISTING_ONLY" ? 0 : draft.budget.prospectsPerRun;

  const uncapped = sourcing * costPerProspectMinor;
  const providerCostMinor =
    draft.budget.providerCostCeilingMinor > 0
      ? Math.min(draft.budget.providerCostCeilingMinor, uncapped)
      : uncapped;

  const contacts = Math.min(draft.budget.prospectsPerRun, draft.budget.monthlyContacts);

  return {
    prospectsToSource: sourcing,
    providerCostMinor,
    costPerProspectMinor,
    outreachContacts: contacts,
    emailCredits: contacts * MESSAGES_PER_CONTACT,
    totalCostMinor: providerCostMinor,
  };
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
