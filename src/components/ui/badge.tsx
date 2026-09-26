import * as React from "react";
import { cn } from "@/lib/cn";
import { QUALIFICATION_OUTCOME_LABEL } from "@/lib/qualification/outcome-labels";

type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-content-secondary border-line",
  accent: "bg-accent-50 text-content-accent border-accent-200/60",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  danger: "bg-danger-50 text-danger-700 border-danger-100",
  info: "bg-info-50 text-info-700 border-info-100",
  purple: "bg-purple-50 text-purple-700 border-purple-100",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-content-subtle",
  accent: "bg-accent-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  info: "bg-info-500",
  purple: "bg-purple-500",
};

export function Badge({
  tone = "neutral",
  dot,
  dense,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  dot?: boolean;
  /** For dense table rows, where a 26px chip sets the whole row's height. */
  dense?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap font-medium",
        dense
          ? "px-1.5 py-0 text-[10.5px] leading-[17px]"
          : "px-2 py-0.5 text-[11px] leading-5",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className={cn("size-1.5 rounded-full shrink-0", DOTS[tone])} />
      )}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------------
   The single status mapping. Every list, drawer and table reads from here so
   a status can never render two different colours in two places.
   -------------------------------------------------------------------------- */

export const LEAD_STATUS = {
  NEW: { label: "New", tone: "info" },
  CONTACTED: { label: "Contacted", tone: "warning" },
  RESPONDED: { label: "Responded", tone: "purple" },
  QUALIFIED: { label: "Qualified", tone: "success" },
  BOOKED: { label: "Booked", tone: "success" },
  WON: { label: "Won", tone: "success" },
  LOST: { label: "Lost", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const QUALIFICATION_STATE = {
  // Labels come from the one outcome vocabulary (qualification/outcome-labels).
  PENDING: { label: QUALIFICATION_OUTCOME_LABEL.PENDING, tone: "neutral" },
  QUALIFIED: { label: QUALIFICATION_OUTCOME_LABEL.QUALIFIED, tone: "success" },
  NOT_QUALIFIED: { label: QUALIFICATION_OUTCOME_LABEL.NOT_QUALIFIED, tone: "danger" },
  REVIEW: { label: QUALIFICATION_OUTCOME_LABEL.REVIEW, tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const MESSAGE_STATUS = {
  QUEUED: { label: "Queued", tone: "neutral" },
  SENT: { label: "Sent", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  // Not danger. Nothing is broken: policy refused the send, usually because the
  // recipient opted out. Red would send somebody hunting an outage that does
  // not exist, and a screen of red for correct behaviour teaches people to
  // ignore the colour.
  BLOCKED: { label: "Not sent", tone: "neutral" },
  RECEIVED: { label: "Received", tone: "accent" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * One vocabulary for a connection's health, matching the Connections cards
 * (`AVAILABILITY_META` in integrations/catalog.ts): a broken connection is
 * fixed by reconnecting it, so it says so, rather than "Action required" in
 * one place and "Reconnect required" in another.
 */
export const INTEGRATION_HEALTH = {
  HEALTHY: { label: "Healthy", tone: "success" },
  DEGRADED: { label: "Needs attention", tone: "warning" },
  ACTION_REQUIRED: { label: "Reconnect required", tone: "danger" },
  DISCONNECTED: { label: "Not connected", tone: "neutral" },
  TESTING: { label: "Testing", tone: "info" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * Campaign lifecycle. Tones follow meaning: green is sending, amber is held,
 * red is stopped, blue is finished, and the two "nothing is happening yet"
 * states read as neutral/violet rather than as success.
 */
export const CAMPAIGN_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "purple" },
  RUNNING: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "info" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const SUBSCRIPTION_STATUS = {
  TRIALING: { label: "Trial", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  UNPAID: { label: "Unpaid", tone: "danger" },
  INCOMPLETE: { label: "Incomplete", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BOOKING_STATUS = {
  pending: { label: "Awaiting confirmation", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No show", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * Sending-domain health (domain_health_snapshots). NOT_CHECKED is its own
 * state, deliberately not green: no snapshot means nobody has looked.
 */
export const DELIVERABILITY_STATE = {
  HEALTHY: { label: "Healthy", tone: "success" },
  WATCH: { label: "Watch", tone: "warning" },
  WARNING: { label: "Warning", tone: "danger" },
  PAUSED: { label: "Paused", tone: "danger" },
  NOT_CHECKED: { label: "Not checked", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** The duplicate queue (merge_candidates). */
export const MERGE_CANDIDATE_STATUS = {
  OPEN: { label: "Open", tone: "warning" },
  MERGED: { label: "Merged", tone: "success" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** Lead score grades (lead_scores.grade). */
export const LEAD_GRADE = {
  A: { label: "A", tone: "success" },
  B: { label: "B", tone: "accent" },
  C: { label: "C", tone: "warning" },
  D: { label: "D", tone: "neutral" },
  UNSCORED: { label: "Unscored", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** The AI budget manager's decision (ai_budget_decisions.decision). */
export const SPEND_DECISION = {
  TIER_1: { label: "Tier 1", tone: "success" },
  TIER_2: { label: "Tier 2", tone: "success" },
  TIER_3: { label: "Tier 3", tone: "info" },
  TIER_4: { label: "Tier 4", tone: "info" },
  SKIP: { label: "Skipped", tone: "warning" },
  HUMAN: { label: "Sent to a person", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * The policy engine's verdict for one channel (lead page contactability).
 * Anything short of a plain yes needs a step first, so it reads amber; only a
 * refusal is red.
 */
export const CONTACT_DECISION = {
  ALLOWED: { label: "Can contact", tone: "success" },
  REVIEW_REQUIRED: { label: "Needs a person", tone: "warning" },
  REQUIRE_CONSENT: { label: "Needs consent", tone: "warning" },
  REQUIRE_PRIVACY_NOTICE: { label: "Needs a privacy notice", tone: "warning" },
  REQUIRE_TEMPLATE: { label: "Needs an approved template", tone: "warning" },
  REQUIRE_MANUAL_ACTION: { label: "Manual step needed", tone: "warning" },
  BLOCKED: { label: "Cannot contact", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** One DNS record's verdict (lib/email/dns-health.ts). UNKNOWN is not a fail. */
export const DNS_RECORD_STATE = {
  PASS: { label: "Pass", tone: "success" },
  MISSING: { label: "Missing", tone: "warning" },
  FAIL: { label: "Fail", tone: "danger" },
  UNKNOWN: { label: "Not checked", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** legitimate_interest_assessments.status. */
export const LIA_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "success" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** opportunities.outcome. */
export const OPPORTUNITY_OUTCOME = {
  OPEN: { label: "Open", tone: "info" },
  WON: { label: "Won", tone: "success" },
  LOST: { label: "Lost", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** whatsapp_templates.status (§45). Only APPROVED can be sent. */
export const WHATSAPP_TEMPLATE_STATUS = {
  APPROVED: { label: "Approved", tone: "success" },
  PENDING: { label: "In review", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PAUSED: { label: "Paused", tone: "danger" },
  DISABLED: { label: "Disabled", tone: "neutral" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** crm_pull_settings.last_run_status (§29). */
export const CRM_PULL_RUN = {
  OK: { label: "Up to date", tone: "success" },
  PARTIAL: { label: "Catching up", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

type StatusMap = Record<string, { label: string; tone: Tone }>;

const MAPS = {
  lead: LEAD_STATUS,
  qualification: QUALIFICATION_STATE,
  message: MESSAGE_STATUS,
  integration: INTEGRATION_HEALTH,
  campaign: CAMPAIGN_STATUS,
  subscription: SUBSCRIPTION_STATUS,
  booking: BOOKING_STATUS,
  deliverability: DELIVERABILITY_STATE,
  merge_candidate: MERGE_CANDIDATE_STATUS,
  lead_grade: LEAD_GRADE,
  spend_decision: SPEND_DECISION,
  contact_decision: CONTACT_DECISION,
  dns_record: DNS_RECORD_STATE,
  lia: LIA_STATUS,
  opportunity_outcome: OPPORTUNITY_OUTCOME,
  whatsapp_template: WHATSAPP_TEMPLATE_STATUS,
  crm_pull_run: CRM_PULL_RUN,
} satisfies Record<string, StatusMap>;

export type StatusKind = keyof typeof MAPS;

export function StatusBadge({
  kind,
  value,
  dot = true,
  dense,
  className,
}: {
  kind: StatusKind;
  value: string;
  dot?: boolean;
  dense?: boolean;
  className?: string;
}) {
  const entry = (MAPS[kind] as StatusMap)[value];
  if (!entry) {
    return (
      <Badge tone="neutral" dense={dense} className={className}>
        {value}
      </Badge>
    );
  }
  return (
    <Badge tone={entry.tone} dot={dot} dense={dense} className={className}>
      {entry.label}
    </Badge>
  );
}
