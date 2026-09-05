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

export const CUSTOMER_FILTERS = [
  "all",
  "trial",
  "active",
  "past_due",
  "cancelled",
  "integration_problem",
] as const;

export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

export type CustomerRow = {
  id: string;
  name: string;
  workspaceStatus: string;
  ownerName: string;
  ownerEmail: string;
  plan: string;
  subscriptionStatus: string;
  leadsThisPeriod: number;
  messagesThisPeriod: number;
  integrationHealth: IntegrationHealth;
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
  displayName: string | null;
  status: string;
  accountReference: string | null;
  scopes: string[];
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type CustomerEvent = {
  id: string;
  action: string;
  actorType: string;
  entityType: string | null;
  createdAt: string;
};

export type CustomerError = {
  id: string;
  area: string;
  message: string;
  occurredAt: string;
};

export type CustomerDetail = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  website: string | null;
  timezone: string;
  onboardingStep: string;
  createdAt: string;
  activatedAt: string | null;
  plan: string;
  subscriptionStatus: string;
  billingInterval: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  leadLimit: number;
  userLimit: number;
  leadsThisPeriod: number;
  leadsTotal: number;
  messagesThisPeriod: number;
  failedMessagesThisPeriod: number;
  bookingsThisPeriod: number;
  members: CustomerMember[];
  integrations: CustomerIntegration[];
  events: CustomerEvent[];
  errors: CustomerError[];
  economics: CustomerEconomics;
};

/**
 * Admin-only, never surfaced to the customer (§40-41). Live-computed from
 * cost_events over the last 30 days rather than a daily rollup table, since
 * no rollup job exists yet — see docs/BUILD_PLAN.md for that follow-up.
 */
export type CustomerEconomics = {
  aiCostUsd30d: number;
  aiCallCount30d: number;
  windowDays: number;
};

export type WebhookEventRow = {
  id: string;
  provider: string;
  externalEventId: string;
  eventType: string | null;
  businessName: string | null;
  receivedAt: string;
  status: string;
  attempts: number;
  lastError: string | null;
  /** Only a genuinely safe-to-replay row is offered a Retry control. */
  retryable: boolean;
};

export type JobErrorRow = {
  id: string;
  area: string;
  state: string;
  businessName: string | null;
  message: string;
  attempts: number;
  occurredAt: string;
};

export const INTEGRATION_HEALTH_LABEL: Record<IntegrationHealth, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  ACTION_REQUIRED: "Action required",
  DISCONNECTED: "Disconnected",
};

export const INTEGRATION_HEALTH_TONE: Record<IntegrationHealth, string> = {
  HEALTHY: "text-success-600",
  DEGRADED: "text-warning-600",
  ACTION_REQUIRED: "text-danger-600",
  DISCONNECTED: "text-danger-600",
};
