/**
 * Prospect shapes and pure display helpers.
 *
 * Deliberately free of `server-only` and of any Supabase import, so client
 * components can use these without dragging the service-role client into the
 * browser bundle — the same rule `lib/leads/types.ts` follows.
 */

import type { OutreachEligibility } from "../policy/types.ts";

export type ProspectStatus =
  | "DISCOVERED"
  | "ENRICHING"
  | "VERIFIED"
  | "READY"
  | "APPROVED"
  | "OUTREACH_ACTIVE"
  | "REPLIED"
  | "CONVERTED"
  | "DISQUALIFIED"
  | "SUPPRESSED"
  | "BOUNCED"
  | "UNSUBSCRIBED"
  | "REVIEW";

export type Grade = "A+" | "A" | "B" | "C" | "D";

export type VerificationStatus =
  | "UNKNOWN"
  | "VALID"
  | "RISKY"
  | "INVALID"
  | "CATCH_ALL"
  | "UNVERIFIABLE";

export type RoleClassification =
  | "DECISION_MAKER"
  | "INFLUENCER"
  | "GATEKEEPER"
  | "USER"
  | "UNKNOWN";

export type ScoreFactorKey =
  | "ICP_FIT"
  | "ROLE_AUTHORITY"
  | "GEOGRAPHY"
  | "NEED"
  | "INTENT"
  | "DATA_QUALITY";

export type ProspectCompany = {
  id: string;
  name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  company_size: string | null;
  employee_count: number | null;
  location_json: Record<string, unknown>;
};

export type ProspectIntentBadge = {
  categoryId: string;
  categoryName: string;
  observedAt: string;
  expiresAt: string;
  scoreImpact: number;
  matchCount: number;
};

export type ProspectListRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  role_classification: RoleClassification;
  email: string | null;
  phone_e164: string | null;
  status: ProspectStatus;
  grade: Grade | null;
  score: number | null;
  verification_status: VerificationStatus;
  outreach_eligibility: OutreachEligibility;
  eligibility_reason: string | null;
  company: ProspectCompany | null;
  campaignId: string | null;
  campaignName: string | null;
  intent: ProspectIntentBadge | null;
  source_provider: string | null;
  last_activity_at: string | null;
  created_at: string;
  promoted_to_lead_id: string | null;
};

export type ScoreFactor = {
  factor: ScoreFactorKey;
  weight: number;
  rawValue: number;
  contribution: number;
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  evidenceSummary: string | null;
  evidenceSource: string | null;
  evidenceUrl: string | null;
  observedAt: string | null;
  confidence: number;
};

export type ProspectScore = {
  id: string;
  scoreVersion: string;
  totalScore: number;
  grade: Grade;
  explanation: string | null;
  createdAt: string;
  factors: ScoreFactor[];
};

/** One traced field value. `cost` is deliberately absent — §90 keeps raw
 *  provider cost admin-only, and the column is not granted to the browser. */
export type ProvenanceRow = {
  id: string;
  fieldName: string;
  value: unknown;
  provider: string;
  sourceType: string;
  sourceUrl: string | null;
  confidence: number;
  obtainedAt: string;
  verifiedAt: string | null;
  policyTags: string[];
};

export type ProspectQuickCounts = {
  all: number;
  aGrade: number;
  intent: number;
  ready: number;
  contacted: number;
  replied: number;
  review: number;
};

/* ---------------------------------------------------------- display helpers */

export function prospectDisplayName(prospect: {
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
}): string {
  const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim();
  return name || prospect.email || "Unnamed prospect";
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  DISCOVERED: "Discovered",
  ENRICHING: "Enriching",
  VERIFIED: "Verified",
  READY: "Ready",
  APPROVED: "Approved",
  OUTREACH_ACTIVE: "In outreach",
  REPLIED: "Replied",
  CONVERTED: "Converted",
  DISQUALIFIED: "Disqualified",
  SUPPRESSED: "Suppressed",
  BOUNCED: "Bounced",
  UNSUBSCRIBED: "Unsubscribed",
  REVIEW: "Needs review",
};

export function prospectStatusLabel(status: ProspectStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Status → badge tone. This is the single mapping for prospects, mirroring the
 * rule that lead status tones live in exactly one place.
 * Green = healthy, amber = needs a human, red = action required.
 */
export function prospectStatusTone(
  status: ProspectStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "CONVERTED":
    case "REPLIED":
      return "success";
    case "READY":
    case "APPROVED":
    case "OUTREACH_ACTIVE":
    case "VERIFIED":
      return "accent";
    case "REVIEW":
      return "warning";
    case "SUPPRESSED":
    case "BOUNCED":
    case "UNSUBSCRIBED":
    case "DISQUALIFIED":
      return "danger";
    default:
      return "neutral";
  }
}

/** A+/A are the grades worth spending outreach budget on by default (§14.2). */
export function gradeTone(grade: Grade | null): "success" | "accent" | "warning" | "neutral" {
  if (grade === "A+" || grade === "A") return "success";
  if (grade === "B") return "accent";
  if (grade === "C") return "warning";
  return "neutral";
}

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  UNKNOWN: "Unknown",
  VALID: "Verified",
  RISKY: "Risky",
  INVALID: "Invalid",
  CATCH_ALL: "Catch-all",
  UNVERIFIABLE: "Unverifiable",
};

export function verificationLabel(status: VerificationStatus): string {
  return VERIFICATION_LABELS[status] ?? "Unknown";
}

export function verificationTone(
  status: VerificationStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "VALID") return "success";
  if (status === "RISKY" || status === "CATCH_ALL") return "warning";
  if (status === "INVALID") return "danger";
  return "neutral";
}

const ROLE_LABELS: Record<RoleClassification, string> = {
  DECISION_MAKER: "Decision maker",
  INFLUENCER: "Influencer",
  GATEKEEPER: "Gatekeeper",
  USER: "End user",
  UNKNOWN: "Unclassified",
};

export function roleLabel(value: RoleClassification): string {
  return ROLE_LABELS[value] ?? "Unclassified";
}

const FACTOR_LABELS: Record<ScoreFactorKey, string> = {
  ICP_FIT: "Ideal customer fit",
  ROLE_AUTHORITY: "Role and authority",
  GEOGRAPHY: "Geography",
  NEED: "Likely need",
  INTENT: "Buying intent",
  DATA_QUALITY: "Data quality",
};

export function scoreFactorLabel(factor: ScoreFactorKey): string {
  return FACTOR_LABELS[factor] ?? factor;
}

/** Human sentence for a company's location blob, which providers shape
 *  inconsistently. */
export function locationLabel(location: Record<string, unknown> | null | undefined): string | null {
  if (!location) return null;
  const parts = ["city", "region", "country"]
    .map((key) => location[key])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

/** How fresh an intent signal is, in the product's own words. */
export function intentFreshness(observedAt: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(observedAt).getTime()) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
