import type { StageKey, StageStatus } from "./stages";
import type { PlanSummaryLine, SearchPlan } from "./plan";

/**
 * View models for the Find Leads workspace.
 *
 * Pure: no `server-only`, no Supabase. Server queries build these shapes and
 * client components render them, which is what keeps the service-role client
 * out of the browser bundle while still letting the run page be interactive.
 *
 * The money rule from V4 §112 is enforced by shape here, not by discipline:
 * these types carry *formatted* budget strings and a percentage, never raw
 * provider unit costs. There is no field a careless component could render
 * that would expose what a provider charges per record.
 */

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "PARTIAL"
  | "CANCELLED"
  | "FAILED";

export type BudgetState =
  | "WITHIN_BUDGET"
  | "NEAR_LIMIT"
  | "BUDGET_LIMIT_REACHED"
  | "PLAN_LIMIT_REACHED"
  | "PROVIDER_LIMIT_REACHED";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  PARTIAL: "Partly complete",
  CANCELLED: "Stopped",
  FAILED: "Failed",
};

export function runStatusTone(
  status: RunStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "RUNNING":
      return "info";
    case "QUEUED":
      return "accent";
    case "PAUSED":
    case "PARTIAL":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

/* ------------------------------------------------------------- run counters */

/** V4 §11.7. Every one of these is a count of real rows, never an estimate. */
export type RunCounters = {
  companiesFound: number;
  contactsFound: number;
  emailsDiscovered: number;
  verified: number;
  duplicates: number;
  suppressed: number;
  reviewRequired: number;
  ready: number;
};

export const EMPTY_COUNTERS: RunCounters = {
  companiesFound: 0,
  contactsFound: 0,
  emailsDiscovered: 0,
  verified: 0,
  duplicates: 0,
  suppressed: 0,
  reviewRequired: 0,
  ready: 0,
};

export const COUNTER_DEFINITIONS: {
  key: keyof RunCounters;
  label: string;
  /** Shown in the tooltip. The definitions are V4 §11.8 verbatim. */
  definition: string;
}[] = [
  {
    key: "companiesFound",
    label: "Companies found",
    definition: "Unique company candidates before any contact enrichment.",
  },
  {
    key: "contactsFound",
    label: "Contacts found",
    definition: "Unique candidate decision-makers at those companies.",
  },
  {
    key: "emailsDiscovered",
    label: "Emails discovered",
    definition: "Email candidates from licensed or permitted public data.",
  },
  {
    key: "verified",
    label: "Verified",
    definition: "Records that passed the configured deliverability threshold.",
  },
  {
    key: "duplicates",
    label: "Duplicates",
    definition:
      "Matches against prospects, leads, customers or contacts you already hold.",
  },
  {
    key: "suppressed",
    label: "Suppressed",
    definition:
      "Opt-out, complaint, invalid, legal or platform-suppressed records.",
  },
  {
    key: "reviewRequired",
    label: "Review required",
    definition: "Ambiguous contactability or missing information.",
  },
  {
    key: "ready",
    label: "Ready",
    definition: "Valid records meeting your score and eligibility thresholds.",
  },
];

/* ----------------------------------------------------------------- budget */

/**
 * The customer-facing budget view. `spent` and `cap` are formatted strings
 * produced server-side; there is deliberately no numeric provider cost here.
 */
export type RunBudgetView = {
  spent: string;
  cap: string;
  percentUsed: number;
  state: BudgetState;
};

/* --------------------------------------------------------- provider view */

/** A provider summary safe to show a customer: what it is doing and how much
 *  it returned. Never the query, the parameters or the price. */
export type ProviderActivity = {
  provider: string;
  displayName: string;
  /** "Searching company data…" — present tense while the run is live. */
  activity: string;
  resultCount: number;
  unit: string;
  state: "IDLE" | "ACTIVE" | "DONE" | "DEGRADED" | "FAILED";
};

/* ------------------------------------------------------------- run views */

export type RunStageView = {
  stage_number: number;
  stage_key: StageKey;
  status: StageStatus;
  safe_summary: string | null;
  record_count: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
};

export type RunIssueView = {
  id: string;
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  message: string;
  detail: string | null;
  requiresUserAction: boolean;
  createdAt: string;
};

export type RunMessageView = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM_EVENT";
  content: string;
  createdAt: string;
};

export type SourcingRunView = {
  id: string;
  title: string;
  status: RunStatus;
  sessionId: string | null;
  targetVerified: number;
  minimumGrade: string;
  reviewBeforeOutreach: boolean;
  progressPercent: number;
  currentStageNumber: number;
  startedAt: string | null;
  completedAt: string | null;
  pausedReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerCount: number;
  counters: RunCounters;
  budget: RunBudgetView;
  stages: RunStageView[];
  providers: ProviderActivity[];
  issues: RunIssueView[];
  messages: RunMessageView[];
  /** What the current role and run state permit. Computed server-side. */
  controls: RunControls;
};

export type RunControls = {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canIncreaseTarget: boolean;
  /** Why increase-target is unavailable, when it is. */
  increaseTargetReason: string | null;
};

/* --------------------------------------------------------- session views */

export type SearchSessionSummary = {
  id: string;
  title: string;
  prospectsFound: number;
  updatedAt: string;
  status: "ACTIVE" | "ARCHIVED";
};

export type SearchMessageView = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM_EVENT";
  content: string;
  /** The plan snippet the assistant rendered inline, when it proposed one. */
  planSummary: PlanSummaryLine[] | null;
  createdAt: string;
};

export type SearchSessionView = {
  id: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  saved: boolean;
  plan: SearchPlan;
  planStatus: "DRAFT" | "APPROVED" | "ARCHIVED" | "SUPERSEDED";
  strategyId: string | null;
  messages: SearchMessageView[];
  updatedAt: string;
};

/* ------------------------------------------------- acquisition profile view */

export type AcquisitionProfileView = {
  businessType: string | null;
  services: string[];
  locations: string[];
  targetCustomers: string[];
  conversionGoal: string | null;
  websiteUrl: string | null;
  complete: boolean;
  analysisStatus:
    | "NOT_STARTED"
    | "QUEUED"
    | "FETCHING"
    | "EXTRACTING"
    | "REVIEW"
    | "READY"
    | "PARTIAL"
    | "FAILED";
  lastAnalysedAt: string | null;
};

export type AnalysisProgressView = {
  id: string;
  status: AcquisitionProfileView["analysisStatus"];
  pagesTargeted: number;
  pagesAnalysed: number;
  percent: number;
  verificationState: "UNVERIFIED" | "PARTIALLY_VERIFIED" | "VERIFIED";
  /** Per-category progress, so the card can show what is still being read. */
  categories: { label: string; state: "PENDING" | "ANALYSING" | "FOUND" }[];
  errorCode: string | null;
};

/* ----------------------------------------------------------- recurring */

export type RecurringSearchView = {
  id: string;
  name: string;
  cadence: "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
  targetPerRun: number;
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export const CADENCE_LABELS: Record<RecurringSearchView["cadence"], string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

/* --------------------------------------------------------------- KPI strip */

export type FindLeadsKpi = {
  key: string;
  label: string;
  value: string;
  /** Secondary line, e.g. "124 / 500". Null when the metric has no allowance. */
  detail: string | null;
  tone: "neutral" | "success" | "warning" | "danger";
};

/* ------------------------------------------------------- run stage helper */

export function stageStatusTone(
  status: StageStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "RUNNING":
      return "info";
    case "FAILED":
      return "danger";
    case "PAUSED":
      return "warning";
    case "SKIPPED":
      return "neutral";
    default:
      return "neutral";
  }
}

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  PENDING: "Pending",
  RUNNING: "In progress",
  COMPLETED: "Done",
  SKIPPED: "Skipped",
  FAILED: "Failed",
  PAUSED: "Paused",
};

export type { StageKey, StageStatus, PlanSummaryLine };
