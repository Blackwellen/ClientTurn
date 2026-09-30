import * as React from "react";
import { cn } from "@/lib/cn";
import { QUALIFICATION_OUTCOME_LABEL } from "@/lib/qualification/outcome-labels";
import {
  DIMENSION_STATUS_COPY,
  ENGINE_MODE_COPY,
  INTENT_STATE_COPY,
  NBA_ACTION_COPY,
} from "@/lib/qualification-intelligence/explain";
import type {
  DimensionStatus,
  FactState,
  IntentState,
  NbaAction,
  QiEngineMode,
} from "@/lib/qualification-intelligence/types";

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

/*
 * Qualification intelligence (0134). Labels come from the one copy module
 * (qualification-intelligence/explain.ts); tones follow meaning: green is
 * ready or confirmed, amber is "check this", red is a stop or a conflict.
 */

/** lead_assessments.intent_state / leads.intent_state. */
export const INTENT_STATE = {
  NO_DETECTED_INTENT: { label: INTENT_STATE_COPY.NO_DETECTED_INTENT.label, tone: "neutral" },
  LOW: { label: INTENT_STATE_COPY.LOW.label, tone: "neutral" },
  EXPLORATORY: { label: INTENT_STATE_COPY.EXPLORATORY.label, tone: "info" },
  MEDIUM: { label: INTENT_STATE_COPY.MEDIUM.label, tone: "accent" },
  HIGH: { label: INTENT_STATE_COPY.HIGH.label, tone: "success" },
  BOOKING_READY: { label: INTENT_STATE_COPY.BOOKING_READY.label, tone: "success" },
  PURCHASE_READY: { label: INTENT_STATE_COPY.PURCHASE_READY.label, tone: "success" },
  NOT_NOW: { label: INTENT_STATE_COPY.NOT_NOW.label, tone: "warning" },
  NEGATIVE: { label: INTENT_STATE_COPY.NEGATIVE.label, tone: "danger" },
} as const satisfies Record<IntentState, { label: string; tone: Tone }>;

/** The next best action (lead_assessments.nba.next_action / leads.next_action). */
export const NBA_ACTION = {
  ASK: { label: NBA_ACTION_COPY.ASK.label, tone: "accent" },
  ANSWER: { label: NBA_ACTION_COPY.ANSWER.label, tone: "info" },
  ANSWER_AND_ASK: { label: NBA_ACTION_COPY.ANSWER_AND_ASK.label, tone: "info" },
  INFORM: { label: NBA_ACTION_COPY.INFORM.label, tone: "neutral" },
  CTA_BOOK: { label: NBA_ACTION_COPY.CTA_BOOK.label, tone: "success" },
  CTA_CHECKOUT: { label: NBA_ACTION_COPY.CTA_CHECKOUT.label, tone: "success" },
  CTA_SIGNUP: { label: NBA_ACTION_COPY.CTA_SIGNUP.label, tone: "success" },
  ESCALATE: { label: NBA_ACTION_COPY.ESCALATE.label, tone: "warning" },
  WAIT: { label: NBA_ACTION_COPY.WAIT.label, tone: "neutral" },
  NURTURE: { label: NBA_ACTION_COPY.NURTURE.label, tone: "purple" },
  DISQUALIFY: { label: NBA_ACTION_COPY.DISQUALIFY.label, tone: "danger" },
  NO_ACTION: { label: NBA_ACTION_COPY.NO_ACTION.label, tone: "neutral" },
} as const satisfies Record<NbaAction, { label: string; tone: Tone }>;

/** A qualification dimension's derived status. UNKNOWN is not a negative, so it is neutral. */
export const DIMENSION_STATUS = {
  CONFIRMED: { label: DIMENSION_STATUS_COPY.CONFIRMED.label, tone: "success" },
  INFERRED: { label: DIMENSION_STATUS_COPY.INFERRED.label, tone: "warning" },
  UNKNOWN: { label: DIMENSION_STATUS_COPY.UNKNOWN.label, tone: "neutral" },
  CONFLICTING: { label: DIMENSION_STATUS_COPY.CONFLICTING.label, tone: "danger" },
} as const satisfies Record<DimensionStatus, { label: string; tone: Tone }>;

/** lead_qualification_facts.state. */
export const FACT_STATE = {
  CONFIRMED: { label: "Confirmed", tone: "success" },
  INFERRED: { label: "Inferred", tone: "warning" },
  CONFLICTING: { label: "Conflicting", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "neutral" },
} as const satisfies Record<FactState, { label: string; tone: Tone }>;

/** The engine's rollout mode (CD-9). */
export const ENGINE_MODE = {
  OFF: { label: ENGINE_MODE_COPY.OFF.label, tone: "neutral" },
  SHADOW: { label: ENGINE_MODE_COPY.SHADOW.label, tone: "info" },
  LIVE: { label: ENGINE_MODE_COPY.LIVE.label, tone: "success" },
} as const satisfies Record<QiEngineMode, { label: string; tone: Tone }>;

/** checkout_attempts.status (0143): a checkout link the assistant sent. */
export const CHECKOUT_ATTEMPT_STATUS = {
  SENT: { label: "Sent", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  ABANDONED: { label: "Not paid yet", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** checkout_payments.status (0143): a payment received. REVIEW and UNMATCHED need a person. */
export const PAYMENT_STATUS = {
  MATCHED: { label: "Matched", tone: "success" },
  LINKED: { label: "Linked by hand", tone: "success" },
  REVIEW: { label: "Confirm lead", tone: "warning" },
  UNMATCHED: { label: "No lead found", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** quotes.status (0153, lib/quotes/lifecycle.ts). Green = the customer said yes; amber = waiting on someone. */
export const QUOTE_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  SENT: { label: "Sent", tone: "info" },
  VIEWED: { label: "Viewed", tone: "purple" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  SIGNED: { label: "Signed", tone: "success" },
  DEPOSIT_PAID: { label: "Deposit paid", tone: "success" },
  PAID: { label: "Paid", tone: "success" },
  WON: { label: "Won", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REVISED: { label: "Superseded", tone: "neutral" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** invoices.status (0154): the workspace's invoices to its customers. */
export const INVOICE_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral" },
  OPEN: { label: "Issued", tone: "info" },
  PARTIALLY_PAID: { label: "Part paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Void", tone: "neutral" },
  UNCOLLECTIBLE: { label: "Written off", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** voice_calls.state (lib/voice/state-machine.ts). Green = a conversation happened; amber = no answer yet; red = failed. */
export const VOICE_CALL_STATE = {
  REQUESTED: { label: "Requested", tone: "neutral" },
  ELIGIBILITY_CHECKED: { label: "Checked", tone: "neutral" },
  QUEUED: { label: "Queued", tone: "info" },
  DIALLING: { label: "Dialling", tone: "info" },
  RINGING: { label: "Ringing", tone: "info" },
  ANSWERED: { label: "Answered", tone: "accent" },
  IN_CONVERSATION: { label: "In conversation", tone: "accent" },
  WRAPPING_UP: { label: "Wrapping up", tone: "accent" },
  TRANSFERRED: { label: "Transferred", tone: "purple" },
  VOICEMAIL: { label: "Voicemail", tone: "warning" },
  NO_ANSWER: { label: "No answer", tone: "warning" },
  BUSY: { label: "Busy", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  ENDED: { label: "Ended", tone: "neutral" },
  POST_PROCESSING: { label: "Writing up", tone: "info" },
  COMPLETE: { label: "Complete", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** voice_call_outcomes.disposition (lib/voice/post-call.ts): what the call achieved. */
export const VOICE_CALL_DISPOSITION = {
  CONVERSATION: { label: "Conversation", tone: "info" },
  MEETING_BOOKED: { label: "Meeting booked", tone: "success" },
  CHECKOUT_LINK_SENT: { label: "Checkout link sent", tone: "success" },
  QUOTE_REQUESTED: { label: "Quote requested", tone: "success" },
  CALLBACK_REQUESTED: { label: "Callback requested", tone: "warning" },
  NOT_INTERESTED: { label: "Not interested", tone: "neutral" },
  WRONG_PERSON: { label: "Wrong person", tone: "neutral" },
  OPTED_OUT: { label: "Opted out", tone: "danger" },
  TRANSFERRED_TO_HUMAN: { label: "Passed to a person", tone: "purple" },
  NO_CONVERSATION: { label: "No conversation", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** The dedicated number's customer-facing stage (settings-model.ts numberStage). */
export const NUMBER_PROVISIONING = {
  NOT_STARTED: { label: "Not requested", tone: "neutral" },
  DETAILS_NEEDED: { label: "Business details needed", tone: "warning" },
  IN_REVIEW: { label: "In Twilio review", tone: "info" },
  SETTING_UP: { label: "Setting up", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  ACTION_NEEDED: { label: "Action needed", tone: "danger" },
  RELEASING: { label: "Release scheduled", tone: "warning" },
  RELEASED: { label: "Released", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** A workspace's voice calling status (Settings, Voice, Overview). */
export const VOICE_STATUS = {
  ON: { label: "On", tone: "success" },
  NOT_READY: { label: "On, not calling yet", tone: "warning" },
  OFF: { label: "Off", tone: "neutral" },
  PAUSED: { label: "Paused by ClientTurn", tone: "danger" },
  INTEGRATION_REQUIRED: { label: "Integration required", tone: "warning" },
  LOCKED: { label: "Not on your plan", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** Voice gross margin health (admin voice ops, voice-ops-model.ts gmHealth). Red = below the 75% floor. */
export const GM_HEALTH = {
  HEALTHY: { label: "Healthy", tone: "success" },
  WATCH: { label: "Near floor", tone: "warning" },
  BELOW_FLOOR: { label: "Below 75%", tone: "danger" },
  NO_REVENUE: { label: "No revenue", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** Suspicious voice usage flags (voice-ops-model.ts suspiciousUsage): each needs a look. */
export const VOICE_USAGE_FLAG = {
  SPIKE: { label: "Minutes spike", tone: "warning" },
  MANY_SHORT_CALLS: { label: "Many short calls", tone: "warning" },
  HIGH_FAILURE_RATE: { label: "High failure rate", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** business_numbers.provisioning_state, as the platform operator sees it. */
export const NUMBER_STATE_ADMIN = {
  NOT_REQUESTED: { label: "Not requested", tone: "neutral" },
  DETAILS_REQUIRED: { label: "Details required", tone: "warning" },
  SUBACCOUNT_CREATED: { label: "Subaccount created", tone: "info" },
  BUNDLE_SUBMITTED: { label: "Bundle submitted", tone: "info" },
  BUNDLE_IN_REVIEW: { label: "Bundle in review", tone: "info" },
  BUNDLE_APPROVED: { label: "Bundle approved", tone: "info" },
  BUNDLE_REJECTED: { label: "Bundle rejected", tone: "danger" },
  NUMBER_SEARCHING: { label: "Searching", tone: "info" },
  NUMBER_PURCHASED: { label: "Purchased", tone: "info" },
  CONFIGURED: { label: "Configured", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  RELEASE_SCHEDULED: { label: "Release scheduled", tone: "warning" },
  RELEASED: { label: "Released", tone: "neutral" },
  QUARANTINED: { label: "Quarantined", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * Platform maintenance (0161, lib/maintenance). Amber while it is only
 * scheduled or read-only; red once people lose a page.
 */
export const MAINTENANCE_STATE = {
  OFF: { label: "Off", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  ACTIVE: { label: "Active", tone: "warning" },
  ENDED: { label: "Ended", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const MAINTENANCE_LEVEL = {
  OFF: { label: "Off", tone: "neutral" },
  READ_ONLY: { label: "Read only", tone: "warning" },
  APP_OFFLINE: { label: "App offline", tone: "danger" },
  SITE_OFFLINE: { label: "Site offline", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * A platform banner's tone. The banner surfaces (components/site) read their
 * colours from this same entry, so a "critical" banner and its badge are the
 * one red everywhere.
 */
export const BANNER_TONE = {
  info: { label: "Info", tone: "info" },
  success: { label: "Success", tone: "success" },
  warning: { label: "Warning", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BANNER_STATE = {
  SCHEDULED: { label: "Scheduled", tone: "info" },
  LIVE: { label: "Live", tone: "success" },
  ENDED: { label: "Ended", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export type BadgeTone = Tone;

type StatusMap = Record<string, { label: string; tone: Tone }>;

/** automation_rule_runs.status (0163). Green ran; amber skipped with a reason; red failed; blue waiting. */
export const AUTOMATION_RUN_STATUS = {
  SUCCEEDED: { label: "Ran", tone: "success" },
  SKIPPED: { label: "Skipped", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  SCHEDULED: { label: "Waiting", tone: "info" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** An automation rule: on or off. */
export const AUTOMATION_RULE_STATE = {
  ON: { label: "On", tone: "success" },
  OFF: { label: "Off", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * Settings -> System check (lib/system-check/model.ts): green ready, red
 * needs attention (action required), grey off by choice, amber not checked.
 */
export const SYSTEM_CHECK_STATUS = {
  READY: { label: "Ready", tone: "success" },
  ATTENTION: { label: "Needs attention", tone: "danger" },
  OFF: { label: "Off by choice", tone: "neutral" },
  UNKNOWN: { label: "Couldn't check", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

const MAPS = {
  intent_state: INTENT_STATE,
  nba_action: NBA_ACTION,
  dimension_status: DIMENSION_STATUS,
  fact_state: FACT_STATE,
  engine_mode: ENGINE_MODE,
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
  checkout_attempt: CHECKOUT_ATTEMPT_STATUS,
  payment: PAYMENT_STATUS,
  quote: QUOTE_STATUS,
  invoice: INVOICE_STATUS,
  voice_call: VOICE_CALL_STATE,
  voice_disposition: VOICE_CALL_DISPOSITION,
  number_provisioning: NUMBER_PROVISIONING,
  voice_status: VOICE_STATUS,
  gm_health: GM_HEALTH,
  voice_usage_flag: VOICE_USAGE_FLAG,
  number_state_admin: NUMBER_STATE_ADMIN,
  maintenance_state: MAINTENANCE_STATE,
  maintenance_level: MAINTENANCE_LEVEL,
  banner_tone: BANNER_TONE,
  banner_state: BANNER_STATE,
  automation_run: AUTOMATION_RUN_STATUS,
  automation_rule: AUTOMATION_RULE_STATE,
  system_check: SYSTEM_CHECK_STATUS,
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
