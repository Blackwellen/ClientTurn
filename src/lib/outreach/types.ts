/**
 * Acquisition campaigns (V4 §16-18).
 *
 * Pure — no `server-only`, no Supabase — so labels and tones are usable from
 * client components.
 *
 * The distinction this module keeps: an acquisition campaign is *cold* outreach
 * to approved prospects. It is not the warm Follow-Up sequence, and not a
 * Reactivation campaign. Cold is email-first by policy and nothing here can
 * widen that — `ChannelPolicyService` decides at send time.
 */

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "READY",
  "ACTIVE",
  "PAUSED",
  "OPTIMIZING",
  "COMPLETED",
  "STOPPED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type CampaignFunnel = {
  audience: number;
  contacted: number;
  delivered: number;
  bounced: number;
  replies: number;
  positiveReplies: number;
  optOuts: number;
  promoted: number;
  converted: number;
  stopped: number;
  pending: number;
};

export const EMPTY_FUNNEL: CampaignFunnel = {
  audience: 0,
  contacted: 0,
  delivered: 0,
  bounced: 0,
  replies: 0,
  positiveReplies: 0,
  optOuts: 0,
  promoted: 0,
  converted: 0,
  stopped: 0,
  pending: 0,
};

/**
 * Campaign priority (§16.7).
 *
 * Stored as an integer so the scheduler can order by it directly; presented as
 * a band so a customer is choosing between four meanings rather than guessing
 * whether 40 outranks 60. Priority affects queue order and how contested
 * capacity is shared. It can never override suppression, contactability or a
 * provider ceiling — those are checked at send time regardless.
 */
export const CAMPAIGN_PRIORITIES = [
  { value: "URGENT", band: 25, label: "Urgent" },
  { value: "HIGH", band: 50, label: "High" },
  { value: "NORMAL", band: 100, label: "Normal" },
  { value: "LOW", band: 200, label: "Low" },
] as const;

export type CampaignPriority = (typeof CAMPAIGN_PRIORITIES)[number]["value"];

/** Lower integers sort first, so the band a priority falls into is the first
 *  threshold it does not exceed. */
export function priorityFor(priority: number): CampaignPriority {
  if (priority <= 25) return "URGENT";
  if (priority <= 50) return "HIGH";
  if (priority <= 100) return "NORMAL";
  return "LOW";
}

export function priorityLabel(priority: number): string {
  const key = priorityFor(priority);
  return CAMPAIGN_PRIORITIES.find((p) => p.value === key)?.label ?? "Normal";
}

export function priorityTone(
  priority: number,
): "danger" | "warning" | "neutral" | "accent" {
  const key = priorityFor(priority);
  if (key === "URGENT") return "danger";
  if (key === "HIGH") return "warning";
  if (key === "LOW") return "neutral";
  return "accent";
}

/** Where a campaign is pointed, in one line, from what is actually stored. */
export type CampaignAudience = {
  segment: string | null;
  locations: string[];
  radiusMiles: number | null;
};

export type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  minimumGrade: string;
  priority: number;
  audience: CampaignAudience;
  /**
   * The campaign's own budget, in pence, and how full it is.
   *
   * These come from `outreach_campaign_budget` (0055) rather than from the
   * columns directly: 0041 withholds `max_cost_minor` and `spent_cost_minor`
   * from the browser role, and that grant is unchanged. What the definer
   * function exposes is narrower than the grant covered — a cap the customer
   * set and that campaign's consumption of it. Provider unit economics stay
   * admin-only and are not returned.
   *
   * Null cap means uncapped, and `budgetPercent` is null with it: rendering 0%
   * for a campaign with no cap would read as "nothing spent", which is a
   * different and false claim.
   */
  budgetCapMinor: number | null;
  budgetSpentMinor: number;
  budgetPercent: number | null;
  hasBudgetCap: boolean;
  /** Who created it. Null for a campaign whose creator has left the workspace. */
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string | null;
  autoOptimize: boolean;
  reviewBeforeOutreach: boolean;
  dailyContactCap: number;
  monthlyContactCap: number;
  senderIdentityId: string | null;
  conversionGoalName: string | null;
  icpProfileName: string | null;
  sequenceStepCount: number;
  launchedAt: string | null;
  updatedAt: string | null;
  funnel: CampaignFunnel;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  ACTIVE: "Running",
  PAUSED: "Paused",
  OPTIMIZING: "Optimising",
  COMPLETED: "Completed",
  STOPPED: "Stopped",
};

export function campaignStatusLabel(status: CampaignStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function campaignStatusTone(
  status: CampaignStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "ACTIVE":
    case "OPTIMIZING":
      return "success";
    case "READY":
      return "accent";
    case "PAUSED":
      return "warning";
    case "STOPPED":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Pence to a UK money string, dropping the pence on a round amount so a
 * budget reads "£500" rather than "£500.00".
 */
export function formatMoneyMinor(minor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** A ratio that is null rather than 0 when the denominator is empty — "0% reply
 *  rate" on a campaign that has sent nothing reads as failure, not as no data. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return numerator / denominator;
}

export function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

/**
 * Why a campaign cannot be launched yet.
 *
 * Returned as a list so the UI can show every blocker at once rather than
 * revealing them one at a time across repeated attempts. The server re-checks
 * all of this at launch (§17.7) — this is the courtesy copy, not the gate.
 */
export function launchBlockers(campaign: {
  senderIdentityId: string | null;
  sequenceStepCount: number;
  conversionGoalName: string | null;
  funnel: CampaignFunnel;
}): string[] {
  const problems: string[] = [];

  if (!campaign.senderIdentityId) {
    problems.push("No verified sending identity is attached.");
  }
  if (campaign.sequenceStepCount === 0) {
    problems.push("The email sequence has no steps.");
  }
  if (!campaign.conversionGoalName) {
    problems.push("No conversion goal is set, so success cannot be measured.");
  }
  if (campaign.funnel.audience === 0) {
    problems.push("No approved prospects match this campaign's audience yet.");
  }

  return problems;
}

/** A sending identity, as the campaign builder needs to see it. */
export type SenderIdentityRow = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  coldEnabled: boolean;
  dailySendCap: number;
  hasPostalFooter: boolean;
};

/**
 * Everything the Campaigns tab renders.
 *
 * Lives here rather than beside its loader so a client component can import it
 * without pulling `server-only` into the browser graph.
 */
/** The 30-day rollup behind the performance card, with the previous 30 days
 *  alongside so the trend is a comparison rather than an assertion. */
export type CampaignPerformance = {
  contacted: number;
  replies: number;
  qualified: number;
  priorQualified: number;
  /** Qualified leads over prospects contacted. Null when nothing was sent. */
  conversionRate: number | null;
  /** Change in qualified leads against the previous window. Null when there is
   *  no previous window to compare against — an unknowable trend is not 0%. */
  qualifiedTrend: number | null;
};

export type UpcomingSend = {
  campaignId: string;
  campaignName: string;
  prospectCount: number;
  dueAt: string;
};

export type CampaignListData = {
  campaigns: CampaignRow[];
  /** Distinct owners with at least one campaign, for the Owner filter. */
  owners: { id: string; name: string }[];
  /** Prospects ready and approved but not yet in any campaign. */
  unassignedReady: number;
  hasSender: boolean;
  senders: SenderIdentityRow[];
  /** True when a mailbox is connected, so a sender identity can be created. */
  mailboxConnected: boolean;
  performance: CampaignPerformance;
  upcomingSends: UpcomingSend[];
};

/** A campaign is contributing to spend only while it can actually send. */
export function isSpendingStatus(status: CampaignStatus): boolean {
  return status === "ACTIVE" || status === "OPTIMIZING";
}

/**
 * The compliance summary in the right rail.
 *
 * Derived from real campaign state, never asserted. "Good standing" means
 * nothing in the workspace is currently blocked; anything else names the
 * campaigns concerned.
 */
export function complianceSummary(data: {
  campaigns: CampaignRow[];
  hasSender: boolean;
}): { ok: boolean; title: string; detail: string } {
  const awaitingReview = data.campaigns.filter(
    (c) => c.reviewBeforeOutreach && c.status === "DRAFT",
  );
  const overBudget = data.campaigns.filter(
    (c) => isSpendingStatus(c.status) && c.budgetPercent !== null && c.budgetPercent >= 100,
  );

  if (!data.hasSender && data.campaigns.length > 0) {
    return {
      ok: false,
      title: "No verified sending identity",
      detail: "Nothing will send until a verified mailbox is connected.",
    };
  }
  if (overBudget.length > 0) {
    return {
      ok: false,
      title: `${overBudget.length} campaign${overBudget.length === 1 ? " has" : "s have"} reached the budget cap`,
      detail: "Sending is paused for those campaigns until the cap is raised.",
    };
  }
  if (awaitingReview.length > 0) {
    return {
      ok: false,
      title: `${awaitingReview.length} campaign${awaitingReview.length === 1 ? "" : "s"} awaiting review`,
      detail: "New campaigns go through an automatic review before sending.",
    };
  }
  return {
    ok: true,
    title: "Your account is in good standing",
    detail: "No action required.",
  };
}
