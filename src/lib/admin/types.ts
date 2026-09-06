/**
 * Admin shapes shared with client components. No `server-only` and no Supabase
 * import, so a drawer or table can use these without pulling the service-role
 * client into the browser bundle.
 */

export type IntegrationHealth =
  | "HEALTHY"
  | "DEGRADED"
  | "ACTION_REQUIRED"
  | "DISCONNECTED";

/**
 * The single connection-health vocabulary. The customer-facing Connections
 * page words these for the business owner; Platform Admin words them for the
 * operator, which is why the labels differ from `INTEGRATION_HEALTH` in
 * components/ui/badge.tsx while the underlying enum stays identical.
 */
export const CONNECTION_HEALTH_LABEL: Record<IntegrationHealth, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Needs attention",
  ACTION_REQUIRED: "Connection issue",
  DISCONNECTED: "Unknown",
};

export const CONNECTION_HEALTH_TONE = {
  HEALTHY: "success",
  DEGRADED: "warning",
  ACTION_REQUIRED: "danger",
  DISCONNECTED: "neutral",
} as const;

/* ------------------------------------------------------------- overview --- */

export const ADMIN_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

export const ADMIN_RANGE_LABEL: Record<AdminRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

/**
 * Kept short so a KPI tile can show the whole comparison rather than
 * truncating it — an ellipsised baseline tells the operator nothing.
 */
export const ADMIN_RANGE_COMPARISON: Record<AdminRange, string> = {
  "24h": "vs. previous day",
  "7d": "vs. previous week",
  "30d": "vs. previous month",
  "90d": "vs. previous quarter",
};

/** One KPI tile. `series` is real per-bucket counts, never a synthesised curve. */
export type AdminMetric = {
  key: string;
  label: string;
  value: number;
  /** Rendered as currency when true. */
  money?: boolean;
  /** Value over the immediately preceding window of the same length. */
  previous: number | null;
  /** Fractional change, e.g. 0.12 for +12%. Null when there is no baseline. */
  changeRatio: number | null;
  /** True when a rise is bad, so tone follows meaning rather than sign. */
  invert?: boolean;
  series: number[];
  hint?: string;
};

export type ProviderStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  DOWN: "Down",
  UNKNOWN: "Unknown",
};

export const PROVIDER_STATUS_TONE = {
  HEALTHY: "success",
  DEGRADED: "warning",
  DOWN: "danger",
  UNKNOWN: "neutral",
} as const;

export type PlatformProviderRow = {
  provider: string;
  label: string;
  status: ProviderStatus;
  /** 95th percentile of the stored probe latencies over the window. */
  p95Ms: number | null;
  /** Fraction of probes in the window that were healthy. Null with no probes. */
  uptime30d: number | null;
  lastIncidentAt: string | null;
  lastCheckedAt: string | null;
  /** False when the platform holds no credentials for the provider at all. */
  configured: boolean;
  detail: string | null;
};

export type RecentCustomerRow = {
  id: string;
  name: string;
  domain: string | null;
  planLabel: string;
  subscriptionStatus: string;
  joinedAt: string;
};

export type ActionRequiredKind =
  | "payment_failed"
  | "trial_ending"
  | "high_usage"
  | "integration_error"
  | "workspace_health";

export const ACTION_REQUIRED_LABEL: Record<ActionRequiredKind, string> = {
  payment_failed: "Payment failed",
  trial_ending: "Trial ending",
  high_usage: "High usage",
  integration_error: "Integration error",
  workspace_health: "Workspace health",
};

export type ActionRequiredRow = {
  id: string;
  kind: ActionRequiredKind;
  businessId: string;
  businessName: string;
  detail: string;
  occurredAt: string | null;
  /** Where clicking the row goes. Always an in-app admin destination. */
  href: string;
};

export type FailedJobRow = {
  id: string;
  jobType: string;
  jobLabel: string;
  businessId: string | null;
  businessName: string | null;
  error: string;
  attempts: number;
  occurredAt: string;
  href: string;
};

export type AdminOverview = {
  range: AdminRange;
  generatedAt: string;
  metrics: AdminMetric[];
  providers: PlatformProviderRow[];
  recentCustomers: RecentCustomerRow[];
  actionRequired: ActionRequiredRow[];
  failedJobs: FailedJobRow[];
};

/* ------------------------------------------------------------ customers --- */

export const CUSTOMER_FILTERS = [
  "all",
  "trial",
  "active",
  "past_due",
  "cancelled",
  "connection_issue",
] as const;

export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = {
  all: "All customers",
  trial: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  connection_issue: "Connection issue",
};

export const CUSTOMER_SORTS = [
  "joined",
  "business",
  "plan",
  "subscription",
  "lead_usage",
  "message_usage",
  "last_activity",
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type UsageCell = {
  used: number;
  /** Null means the plan grants an unmetered allowance. */
  limit: number | null;
  /** Null when there is no limit to be a fraction of. */
  ratio: number | null;
};

export type CustomerRow = {
  id: string;
  name: string;
  domain: string | null;
  workspaceStatus: string;
  ownerName: string;
  ownerEmail: string;
  plan: string;
  planLabel: string;
  subscriptionStatus: string;
  leadUsage: UsageCell;
  messageUsage: UsageCell;
  connectionHealth: IntegrationHealth;
  joinedAt: string;
  lastActivityAt: string | null;
};

export type CustomerListResult = {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type CustomerMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
};

export type CustomerIntegration = {
  id: string;
  provider: string;
  label: string;
  status: string;
  accountReference: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type CustomerEvent = {
  id: string;
  action: string;
  label: string;
  actorType: string;
  createdAt: string;
};

export type CustomerError = {
  id: string;
  reference: string | null;
  area: string;
  message: string;
  severity: ErrorSeverity;
  occurredAt: string;
};

export type CustomerDetail = {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  industry: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  onboardingStep: string;
  createdAt: string;
  activatedAt: string | null;
  plan: string;
  planLabel: string;
  planMonthlyPrice: number | null;
  subscriptionStatus: string;
  billingInterval: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  connectionHealth: IntegrationHealth;
  connectionIssueCount: number;
  leadUsage: UsageCell;
  messageUsage: UsageCell;
  userLimit: number;
  lastActivityAt: string | null;
  lastHealthCheckAt: string | null;
  members: CustomerMember[];
  integrations: CustomerIntegration[];
  events: CustomerEvent[];
  errors: CustomerError[];
};

/* --------------------------------------------------------------- events --- */

/**
 * The one operational-event status enum. Every source-specific status
 * (webhook_events.status, jobs.state, messages.status) is normalised into this
 * before it reaches the UI, so a badge can never mean two different things.
 */
export const EVENT_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "RETRYING",
  "FAILED",
  "DEAD_LETTERED",
  "IGNORED",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  RECEIVED: "Received",
  PROCESSING: "Processing",
  PROCESSED: "Processed",
  RETRYING: "Retrying",
  FAILED: "Failed",
  DEAD_LETTERED: "Dead lettered",
  IGNORED: "Ignored",
};

export const EVENT_STATUS_TONE = {
  RECEIVED: "neutral",
  PROCESSING: "info",
  PROCESSED: "success",
  RETRYING: "warning",
  FAILED: "danger",
  DEAD_LETTERED: "danger",
  IGNORED: "neutral",
} as const;

export const EVENT_SOURCES = ["webhook", "message", "job"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Filter vocabulary for the Events feed. Matches what the sources emit. */
export const EVENT_TYPE_FILTERS = [
  "all",
  "webhook",
  "message",
  "job",
] as const;
export type EventTypeFilter = (typeof EVENT_TYPE_FILTERS)[number];

export const EVENT_TYPE_FILTER_LABEL: Record<EventTypeFilter, string> = {
  all: "All event types",
  webhook: "Webhook",
  message: "Messaging",
  job: "Background job",
};

export const EVENT_STATUS_FILTERS = [
  "all",
  "PROCESSED",
  "RETRYING",
  "FAILED",
  "DEAD_LETTERED",
] as const;
export type EventStatusFilter = (typeof EVENT_STATUS_FILTERS)[number];

export type OperationalEvent = {
  /** `<source>:<row id>` — stable, and tells the retry path where to look. */
  id: string;
  source: EventSource;
  provider: string;
  providerLabel: string;
  type: string;
  typeLabel: string;
  businessId: string | null;
  businessName: string | null;
  status: EventStatus;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  lastError: string | null;
  /** Server-computed. The UI never decides on its own that a replay is safe. */
  retryable: boolean;
  reference: string | null;
};

export type EventListResult = {
  rows: OperationalEvent[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    processed: number;
    retrying: number;
    failed: number;
    safeToRetry: number;
  };
  safeRetryQueue: OperationalEvent[];
  providers: string[];
};

export type EventDetail = OperationalEvent & {
  maxAttempts: number | null;
  /** Redacted before it leaves the server. Never contains a credential. */
  metadata: { key: string; value: string }[];
  payloadPreview: string | null;
  /** Non-null explains, in operator language, why Safe retry is unavailable. */
  retryBlockedReason: string | null;
};

/* --------------------------------------------------------------- errors --- */

export const ERROR_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const ERROR_SEVERITY_LABEL: Record<ErrorSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const ERROR_SEVERITY_TONE = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "warning",
  LOW: "neutral",
} as const;

export const ERROR_STATUSES = [
  "OPEN",
  "INVESTIGATING",
  "RESOLVED",
  "IGNORED",
] as const;
export type ErrorTriageStatus = (typeof ERROR_STATUSES)[number];

export const ERROR_STATUS_LABEL: Record<ErrorTriageStatus, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  RESOLVED: "Resolved",
  IGNORED: "Ignored",
};

export type PlatformErrorRow = {
  fingerprint: string;
  reference: string;
  area: string;
  businessId: string | null;
  businessName: string | null;
  message: string;
  severity: ErrorSeverity;
  status: ErrorTriageStatus;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  /** Only present when a Sentry integration supplied one. Never fabricated. */
  sentryIssueUrl: string | null;
  resolvedAt: string | null;
};

export type ErrorListResult = {
  rows: PlatformErrorRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ErrorSeverity, number>;
  previousCounts: Record<ErrorSeverity, number>;
  series: Record<ErrorSeverity, number[]>;
  areas: string[];
};

/* --------------------------------------------------------------- health --- */

export type QueueHealthStatus = "HEALTHY" | "DEGRADED" | "STALLED";

export const QUEUE_STATUS_LABEL: Record<QueueHealthStatus, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  STALLED: "Stalled",
};

export const QUEUE_STATUS_TONE = {
  HEALTHY: "success",
  DEGRADED: "warning",
  STALLED: "danger",
} as const;

export type QueueHealthRow = {
  key: string;
  label: string;
  pending: number;
  processing: number;
  failed: number;
  lastRunAt: string | null;
  status: QueueHealthStatus;
};

export type DegradedWorkspaceRow = {
  id: string;
  businessId: string;
  businessName: string;
  area: string;
  impact: string;
  since: string | null;
  status: "Investigating" | "Degraded" | "Critical";
};

export type SystemHealth = {
  checkedAt: string | null;
  summary: {
    providersMonitored: number;
    healthyProviders: number;
    degradedServices: number;
    failedJobs: number;
    workspacesWithIssues: number;
  };
  providers: PlatformProviderRow[];
  queues: QueueHealthRow[];
  degradedWorkspaces: DegradedWorkspaceRow[];
};

/* --------------------------------------------------------------- search --- */

export type AdminSearchResult = {
  kind: "customer" | "event" | "error";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};
