/**
 * Shapes and pure helpers for the Reactivation workspace
 * (`/app/reactivation`). Deliberately free of `server-only` and of any
 * Supabase import so client components (cards, table, drawer) can share them
 * with the server queries and actions.
 */

import type { CampaignStatus } from "./types";

/* ------------------------------------------------------------- rows --- */

export type CampaignIconKey =
  | "email"
  | "message"
  | "megaphone"
  | "audience"
  | "alert";

export type ReactivationCampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel: string;
  audienceLabel: string;
  icon: CampaignIconKey;
  audience: number;
  sent: number;
  replies: number;
  qualified: number;
  booked: number;
  /** 0–100. Share of the audience already processed (sent, stopped or failed). */
  progress: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  createdByName: string | null;
};

export type ReactivationTrend = {
  /** Already formatted, e.g. "+12%". */
  value: string;
  direction: "up" | "down";
};

export type ReactivationSummary = {
  eligibleLeads: number;
  eligibleThresholdDays: number;
  totalCampaigns: number;
  runningCampaigns: number;
  scheduledCampaigns: number;
  replies: number;
  repliesTrend: ReactivationTrend | null;
  qualified: number;
  qualificationRate: number;
  qualifiedTrend: ReactivationTrend | null;
  booked: number;
  bookingRate: number;
  bookedTrend: ReactivationTrend | null;
  revenue: number;
};

/* ----------------------------------------------------------- detail --- */

export type ReactivationAudienceRow = {
  id: string;
  leadId: string;
  name: string;
  service: string | null;
  lastActivityAt: string | null;
  channel: string;
  contact: string | null;
  /** Contact state, mapped to an eligibility word for the audience tab. */
  eligibility: "eligible" | "contacted" | "converted" | "excluded";
  eligibilityLabel: string;
};

export type ReactivationMessage = {
  position: number;
  label: string;
  channel: string;
  timing: string;
  enabled: boolean;
  body: string | null;
  sent: number;
};

export type ReactivationActivityEntry = {
  id: string;
  action: string;
  label: string;
  actor: string;
  at: string;
};

export type ReactivationEligibilityRule = {
  label: string;
  detail: string;
};

export type ReactivationCampaignDetail = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  channel: string;
  icon: CampaignIconKey;
  audienceLabel: string;
  estimatedAudienceSize: number;
  tags: string[];
  sendWindow: string;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  totals: {
    audience: number;
    sent: number;
    delivered: number;
    replies: number;
    qualified: number;
    booked: number;
    failed: number;
    stopped: number;
    pending: number;
    revenue: number;
  };
  progress: number;
  eligibilityRules: ReactivationEligibilityRule[];
  audienceSample: ReactivationAudienceRow[];
  audienceSampleTotal: number;
  messages: ReactivationMessage[];
  activity: ReactivationActivityEntry[];
  /** False when the workspace has no messaging provider connected. */
  providerConnected: boolean;
};

/* ---------------------------------------------------------- helpers --- */

/**
 * Card/list icon tile. Cancelled campaigns always read as an alert; otherwise
 * the tile follows the audience then the channel, so a grid of cards is
 * scannable without every tile looking the same.
 */
export function campaignIconKey(input: {
  status: string;
  channel: string;
  audienceLabel: string | null;
  name: string;
}): CampaignIconKey {
  if (input.status === "CANCELLED") return "alert";

  const haystack = (input.audienceLabel ?? "") + " " + input.name;
  const text = haystack.toLowerCase();
  if (text.includes("commercial")) return "audience";
  if (text.includes("dormant")) return "megaphone";
  if (input.channel === "whatsapp") return "message";
  return "email";
}

export const ICON_TONES: Record<
  CampaignIconKey,
  { tile: string; icon: string }
> = {
  email: { tile: "bg-success-50", icon: "text-success-600" },
  message: { tile: "bg-info-50", icon: "text-info-600" },
  megaphone: { tile: "bg-warning-50", icon: "text-warning-600" },
  audience: { tile: "bg-success-50", icon: "text-success-600" },
  alert: { tile: "bg-danger-50", icon: "text-danger-600" },
};

/** Progress bar colour follows meaning, never decoration. */
export function progressTone(
  status: CampaignStatus,
): "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "RUNNING":
    case "COMPLETED":
      return "success";
    case "PAUSED":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "accent";
  }
}

/* ------------------------------------------------- status transitions --- */

export type CampaignAction =
  | "launch"
  | "pause"
  | "resume"
  | "cancel"
  | "duplicate"
  | "edit"
  | "delete";

/**
 * The single source of truth for which actions a status permits. The server
 * re-derives from this before every mutation — the UI only uses it to decide
 * what to render, never as the authority.
 */
export function allowedActions(status: CampaignStatus): CampaignAction[] {
  switch (status) {
    case "DRAFT":
      return ["edit", "launch", "duplicate", "delete"];
    case "SCHEDULED":
      return ["edit", "pause", "cancel", "duplicate"];
    case "RUNNING":
      return ["edit", "pause", "cancel", "duplicate"];
    case "PAUSED":
      return ["edit", "resume", "cancel", "duplicate"];
    case "COMPLETED":
    case "CANCELLED":
      return ["duplicate"];
    default:
      return ["duplicate"];
  }
}

export function canPerform(status: CampaignStatus, action: CampaignAction) {
  return allowedActions(status).includes(action);
}

export function isFinal(status: CampaignStatus) {
  return status === "COMPLETED" || status === "CANCELLED";
}

export type BannerTone = "success" | "info" | "warning" | "neutral" | "danger";

/** Status banner copy at the top of the drawer Overview tab. */
export const STATUS_BANNER: Record<
  CampaignStatus,
  { title: string; description: string; tone: BannerTone }
> = {
  DRAFT: {
    title: "Campaign is a draft",
    description: "Nothing is sent until you launch it.",
    tone: "neutral",
  },
  SCHEDULED: {
    title: "Campaign is scheduled",
    description: "Sending begins at the scheduled time, inside your send window.",
    tone: "info",
  },
  RUNNING: {
    title: "Campaign is running",
    description: "Messages are being sent to your selected audience.",
    tone: "success",
  },
  PAUSED: {
    title: "Campaign is paused",
    description: "No further messages go out until you resume it.",
    tone: "warning",
  },
  COMPLETED: {
    title: "Campaign is complete",
    description: "Every eligible contact has been processed. Results are final.",
    tone: "success",
  },
  CANCELLED: {
    title: "Campaign was cancelled",
    description: "Remaining sends were stopped. Results already collected are kept.",
    tone: "danger",
  },
};

/* ------------------------------------------------------------ rates --- */

export function replyRate(sent: number, replies: number) {
  return sent === 0 ? 0 : (replies / sent) * 100;
}

/** Qualification is measured against replies — you cannot qualify a silence. */
export function qualificationRate(replies: number, qualified: number) {
  return replies === 0 ? 0 : (qualified / replies) * 100;
}

export function bookingRate(sent: number, booked: number) {
  return sent === 0 ? 0 : (booked / sent) * 100;
}
