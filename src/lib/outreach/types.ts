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

export type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  minimumGrade: string;
  priority: number;
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
export type CampaignListData = {
  campaigns: CampaignRow[];
  /** Prospects ready and approved but not yet in any campaign. */
  unassignedReady: number;
  hasSender: boolean;
  senders: SenderIdentityRow[];
  /** True when a mailbox is connected, so a sender identity can be created. */
  mailboxConnected: boolean;
};
