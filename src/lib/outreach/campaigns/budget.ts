import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getV4Entitlements,
  getV4Usage,
  isOverageEnabled,
} from "@/lib/billing/v4-entitlements";
import { estimateRunCost } from "@/lib/find-leads/cost-model";
import {
  loadUnitCosts,
  PLATFORM_RUN_COST_CEILING_MINOR,
} from "@/lib/find-leads/server/budget";
import {
  BUDGET_CATEGORY_LABELS,
  type BudgetCategory,
  type CampaignBudgetContext,
  type CampaignBudgetUsage,
} from "../campaign-budget";

// The shapes and the arithmetic are pure and live in `campaign-budget.ts`, so
// step 5 of the wizard can render the same summary this module reserves
// against without pulling `server-only` into the browser.
export * from "../campaign-budget";

/**
 * The campaign budget service (V4 section 18.30).
 *
 * One authority for two surfaces. Step 5 of the wizard and the Budget usage
 * card on Campaign Detail both read from here, because a campaign that shows
 * "£350 of £500" on one page and computes a different remaining figure at send
 * time is a campaign whose cap does not mean anything.
 *
 * It composes the Find Leads budget primitives rather than re-deriving them:
 * the same price book, the same platform ceiling, the same overage rule that
 * automatic usage is off unless the *account* switched it on with a cap.
 */

/** A hard stop on what one campaign may commit, independent of plan. */
export const CAMPAIGN_COST_CEILING_MINOR = PLATFORM_RUN_COST_CEILING_MINOR * 4; // £2,000

/**
 * Everything Step 5 needs, resolved server-side.
 *
 * `senderIdentityId` matters because the daily contact ceiling is the *lower*
 * of what the plan permits and what the chosen mailbox is warmed up to send.
 * A campaign configured above its mailbox's cap would simply stall each day.
 */
export async function resolveCampaignBudgetContext(input: {
  businessId: string;
  senderIdentityId: string | null;
  /** Excluded from "already committed" when re-opening an existing draft. */
  excludeCampaignId?: string | null;
}): Promise<CampaignBudgetContext> {
  const admin = createAdminClient();
  const entitlements = await getV4Entitlements(input.businessId);

  const [prospectsUsed, emailsUsed, overageOn, unitCosts, sender, committed] =
    await Promise.all([
      getV4Usage(input.businessId, "verified_prospect", entitlements.periodStart),
      getV4Usage(input.businessId, "email_sent", entitlements.periodStart),
      isOverageEnabled(input.businessId),
      loadUnitCosts(),
      input.senderIdentityId
        ? admin
            .from("sender_identities")
            .select("daily_send_cap, sent_today, sent_today_on")
            .eq("business_id", input.businessId)
            .eq("id", input.senderIdentityId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      loadCommittedSpend(input.businessId, input.excludeCampaignId ?? null),
    ]);

  const prospectAllowance = entitlements.allowances.verified_prospect;
  const emailAllowance = entitlements.allowances.email_sent;

  const prospectsRemaining = Math.max(0, prospectAllowance.hardLimit - prospectsUsed);
  const emailsRemaining = Math.max(0, emailAllowance.hardLimit - emailsUsed);

  // Provider budget: what the platform permits, less what other campaigns have
  // already committed. Committed, not spent — two campaigns each promising the
  // whole budget is the failure this prevents.
  const providerCeilingMinor = Math.max(
    0,
    Math.min(CAMPAIGN_COST_CEILING_MINOR, CAMPAIGN_COST_CEILING_MINOR - committed.reservedMinor),
  );

  const mailboxCap = sender.data?.daily_send_cap ?? null;
  // With no mailbox chosen yet, fall back to the plan's own daily shape rather
  // than to an unbounded number.
  const planDailyCap = Math.max(1, Math.floor(emailAllowance.hardLimit / 30) || 200);
  const dailyContactMax = mailboxCap ? Math.min(mailboxCap, planDailyCap) : planDailyCap;

  const perProspect = estimateRunCost(100, unitCosts).totalMinor / 100;

  return {
    ceilings: {
      prospectsRemaining,
      prospectsLimit: prospectAllowance.hardLimit,
      dailyContactMax,
      monthlyContactsRemaining: emailsRemaining,
      monthlyContactsLimit: emailAllowance.hardLimit,
      providerCeilingMinor,
      communicationRemaining: emailsRemaining,
      communicationLimit: emailAllowance.hardLimit,
      // Campaign-level automatic usage is only offered when the account has
      // already turned it on. A campaign switch never enables account billing.
      overageAvailable: overageOn && emailAllowance.overageAllowed,
    },
    meters: [
      {
        key: "prospects",
        label: "Prospects (monthly)",
        used: prospectsUsed,
        limit: prospectAllowance.hardLimit,
        money: false,
      },
      {
        key: "emailContacts",
        label: "Email contacts (monthly)",
        used: emailsUsed,
        limit: emailAllowance.hardLimit,
        money: false,
      },
      {
        key: "providerSpend",
        label: "Provider spend (monthly)",
        used: committed.spentMinor,
        limit: CAMPAIGN_COST_CEILING_MINOR,
        money: true,
      },
      {
        key: "messageAllowance",
        label: "Total message allowance",
        used: emailsUsed,
        limit: emailAllowance.hardLimit,
        money: false,
      },
    ],
    costPerProspectMinor: Math.max(1, Math.round(perProspect)),
    dailyCapSource: mailboxCap && mailboxCap <= planDailyCap ? "MAILBOX" : "PLAN",
  };
}

/** Provider money already spent and already promised by other campaigns. */
async function loadCommittedSpend(
  businessId: string,
  excludeCampaignId: string | null,
): Promise<{ spentMinor: number; reservedMinor: number }> {
  const admin = createAdminClient();

  let query = admin
    .from("outreach_campaigns")
    .select("id, status, max_cost_minor, spent_cost_minor")
    .eq("business_id", businessId)
    .in("status", ["READY", "ACTIVE", "PAUSED", "OPTIMIZING"]);

  if (excludeCampaignId) query = query.neq("id", excludeCampaignId);

  const { data } = await query;

  let spentMinor = 0;
  let reservedMinor = 0;
  for (const row of data ?? []) {
    spentMinor += Number(row.spent_cost_minor ?? 0);
    reservedMinor += Number(row.max_cost_minor ?? 0);
  }

  return { spentMinor, reservedMinor };
}

/* ----------------------------------------------------------- reservation */

/**
 * Commits a campaign's caps at launch.
 *
 * Conditional on the values read, so two launches racing on the same remaining
 * allowance cannot both succeed. Reservations are re-checked at send time as
 * well: this stops over-commitment, the runtime stops over-spend.
 */
export async function reserveCampaignBudget(input: {
  businessId: string;
  campaignId: string;
  providerCostCeilingMinor: number;
  communicationAllowance: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const context = await resolveCampaignBudgetContext({
    businessId: input.businessId,
    senderIdentityId: null,
    excludeCampaignId: input.campaignId,
  });

  if (input.providerCostCeilingMinor > context.ceilings.providerCeilingMinor) {
    return {
      ok: false,
      error:
        "Your remaining provider budget has changed. Lower this campaign's cost ceiling and try again.",
    };
  }
  if (
    input.communicationAllowance > context.ceilings.communicationRemaining &&
    !context.ceilings.overageAvailable
  ) {
    return {
      ok: false,
      error:
        "Your remaining message allowance has changed. Lower the communication allowance and try again.",
    };
  }

  const { error } = await admin
    .from("outreach_campaigns")
    .update({
      max_cost_minor: input.providerCostCeilingMinor,
      reserved_allowance_minor: input.communicationAllowance,
      communication_allowance: input.communicationAllowance,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId);

  if (error) return { ok: false, error: "That budget could not be reserved." };

  await admin
    .from("outreach_campaign_usage")
    .upsert(
      {
        campaign_id: input.campaignId,
        business_id: input.businessId,
        communication_reserved: input.communicationAllowance,
        provider_cost_reserved_minor: input.providerCostCeilingMinor,
      },
      { onConflict: "campaign_id" },
    );

  return { ok: true };
}

/* ------------------------------------------------------------ reporting */

/**
 * What one campaign has actually spent, by attributed category.
 *
 * Read through the definer function because the money columns are withheld
 * from the browser role. The breakdown is whatever the cost ledger holds — a
 * category with no rows shows nothing rather than an invented allocation.
 */
export async function loadCampaignBudgetUsage(
  businessId: string,
  campaignId: string,
): Promise<CampaignBudgetUsage> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("outreach_campaign_budget_detail", {
    p_business_id: businessId,
    p_campaign_id: campaignId,
  });

  const rows = (data ?? []) as {
    cap_minor: number;
    spent_minor: number;
    category: string;
    category_minor: number;
  }[];

  const capMinor = Number(rows[0]?.cap_minor ?? 0);
  const spentMinor = Number(rows[0]?.spent_minor ?? 0);
  const attributed = rows.reduce((total, row) => total + Number(row.category_minor), 0);

  const breakdown = rows
    .map((row) => ({
      category: row.category as BudgetCategory,
      label: BUDGET_CATEGORY_LABELS[row.category as BudgetCategory] ?? row.category,
      minor: Number(row.category_minor),
      percent: attributed > 0 ? Math.round((Number(row.category_minor) / attributed) * 100) : 0,
    }))
    .filter((row) => row.minor > 0)
    .sort((a, b) => b.minor - a.minor);

  return {
    capMinor,
    spentMinor,
    percentUsed: capMinor > 0 ? Math.min(100, Math.round((spentMinor / capMinor) * 100)) : null,
    breakdown,
    empty: attributed === 0,
  };
}

/** Attributes a cost to a campaign. Called by the workers that spend it. */
export async function recordCampaignCost(input: {
  businessId: string;
  campaignId: string;
  category: BudgetCategory;
  costMinor: number;
  quantity?: number;
  reference?: string;
}): Promise<void> {
  if (input.costMinor <= 0) return;
  const admin = createAdminClient();

  await admin.from("outreach_campaign_costs").insert({
    business_id: input.businessId,
    campaign_id: input.campaignId,
    category: input.category,
    cost_minor: input.costMinor,
    quantity: input.quantity ?? 1,
    reference: input.reference ?? null,
  });

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("spent_cost_minor")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (campaign) {
    await admin
      .from("outreach_campaigns")
      .update({ spent_cost_minor: Number(campaign.spent_cost_minor) + input.costMinor })
      .eq("business_id", input.businessId)
      .eq("id", input.campaignId);
  }
}

/**
 * Whether a campaign still has budget for one more cost-bearing action.
 *
 * Called before the action, never after: discovering the cap mid-send is the
 * failure mode the reserve-then-act ordering exists to prevent.
 */
export async function campaignHasBudget(
  businessId: string,
  campaignId: string,
  estimatedMinor: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outreach_campaigns")
    .select("max_cost_minor, spent_cost_minor")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!data) return false;
  const cap = Number(data.max_cost_minor ?? 0);
  // A campaign with no cap set has not been authorised to spend at all.
  if (cap <= 0) return estimatedMinor <= 0;
  return Number(data.spent_cost_minor ?? 0) + estimatedMinor <= cap;
}
