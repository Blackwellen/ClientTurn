/**
 * The reference data set from the Platform Admin design screens.
 *
 * Fixture data for development only. Its single consumer is the dev-only
 * visual harness at `/dev/admin-preview`, which renders the real admin views
 * so the six design states can be checked without a platform-admin session or
 * a seeded database. No production code path reads this file, and the real
 * pages never fall back to it.
 */

import type {
  ActionRequiredRow,
  AdminMetric,
  AdminOverview,
  CustomerDetail,
  CustomerListResult,
  CustomerRow,
  ErrorListResult,
  EventDetail,
  EventListResult,
  FailedJobRow,
  OperationalEvent,
  PlatformErrorRow,
  PlatformProviderRow,
  RecentCustomerRow,
  SystemHealth,
  UsageCell,
} from "./types.ts";

/** Deterministic pseudo-random walk, so screenshots are stable run to run. */
function walk(seed: number, length: number, base: number, spread: number): number[] {
  let state = seed;
  const out: number[] = [];
  let value = base;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const delta = ((state / 2147483648) - 0.45) * spread;
    value = Math.max(0, value + delta);
    out.push(Math.round(value));
  }
  return out;
}

function usage(used: number, limit: number | null): UsageCell {
  return { used, limit, ratio: limit === null ? null : used / limit };
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* ------------------------------------------------------------- overview --- */

const METRICS: AdminMetric[] = [
  {
    key: "active_customers",
    label: "Active customers",
    value: 142,
    previous: 127,
    changeRatio: 0.12,
    series: walk(11, 30, 120, 3),
    hint: "Workspaces with status active.",
  },
  {
    key: "trials",
    label: "Trials",
    value: 18,
    previous: 12,
    changeRatio: 0.5,
    series: walk(23, 30, 12, 2),
    hint: "Subscriptions currently in TRIALING.",
  },
  {
    key: "mrr",
    label: "MRR (mirror)",
    value: 34500,
    money: true,
    previous: 31944,
    changeRatio: 0.08,
    series: walk(37, 30, 30000, 900),
    hint: "Local mirror of Stripe-backed subscriptions.",
  },
  {
    key: "signups",
    label: "New signups",
    value: 6,
    previous: 2,
    changeRatio: 2,
    series: walk(41, 30, 3, 3),
    hint: "Workspaces created within the selected window.",
  },
  {
    key: "leads",
    label: "Leads processed",
    value: 2394,
    previous: 1962,
    changeRatio: 0.22,
    series: walk(53, 30, 80, 30),
    hint: "Non-test leads received across every workspace.",
  },
  {
    key: "messages",
    label: "Messages today",
    value: 12487,
    previous: 9755,
    changeRatio: 0.28,
    series: walk(67, 30, 420, 120),
    hint: "Inbound and outbound messages across every workspace.",
  },
  {
    key: "bookings",
    label: "Bookings today",
    value: 187,
    previous: 138,
    changeRatio: 0.35,
    series: walk(71, 30, 6, 4),
    hint: "Bookings created across every workspace.",
  },
  {
    key: "failed_jobs",
    label: "Failed jobs",
    value: 7,
    previous: 20,
    changeRatio: -0.65,
    invert: true,
    series: walk(83, 30, 2, 2),
    hint: "Background jobs that entered a failed or dead state.",
  },
];

const PROVIDERS: PlatformProviderRow[] = [
  {
    provider: "meta",
    label: "Meta",
    status: "HEALTHY",
    p95Ms: 320,
    uptime30d: 0.9998,
    lastIncidentAt: null,
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: null,
  },
  {
    provider: "twilio_sms",
    label: "Twilio SMS",
    status: "HEALTHY",
    p95Ms: 410,
    uptime30d: 0.9995,
    lastIncidentAt: null,
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: null,
  },
  {
    provider: "twilio_whatsapp",
    label: "WhatsApp",
    status: "HEALTHY",
    p95Ms: 380,
    uptime30d: 0.9997,
    lastIncidentAt: null,
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: "Account reachable and a WhatsApp sender is configured.",
  },
  {
    provider: "calendly",
    label: "Calendly",
    status: "DEGRADED",
    p95Ms: 1240,
    uptime30d: 0.9912,
    lastIncidentAt: minutesAgo(321),
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: "API availability only — per-workspace tokens are checked by connection health.",
  },
  {
    provider: "google_calendar",
    label: "Google Calendar",
    status: "HEALTHY",
    p95Ms: 290,
    uptime30d: 0.9999,
    lastIncidentAt: null,
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: null,
  },
  {
    provider: "stripe",
    label: "Stripe",
    status: "HEALTHY",
    p95Ms: 360,
    uptime30d: 0.9996,
    lastIncidentAt: null,
    lastCheckedAt: minutesAgo(3),
    configured: true,
    detail: null,
  },
];

const RECENT_CUSTOMERS: RecentCustomerRow[] = [
  { id: "c1", name: "Riverside Roofing", domain: "riversideroofing.com", planLabel: "Pro", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(12) },
  { id: "c2", name: "Maple Exteriors", domain: "mapleexteriors.com", planLabel: "Growth", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(28) },
  { id: "c3", name: "Oakwood Roofing", domain: "oakwoodroofing.com", planLabel: "Growth", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(64) },
  { id: "c4", name: "Pinnacle Builders", domain: "pinnaclebuilders.com", planLabel: "Pro", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(126) },
  { id: "c5", name: "Crestview Exteriors", domain: "crestviewexteriors.com", planLabel: "Growth", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(184) },
  { id: "c6", name: "Harbor Home Solutions", domain: "harborhomesolutions.com", planLabel: "Pro", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(242) },
  { id: "c7", name: "Summit Roofing", domain: "summitroofing.com", planLabel: "Growth", subscriptionStatus: "TRIALING", joinedAt: minutesAgo(302) },
  { id: "c8", name: "BrightLeaf Properties", domain: "brightleafproperties.com", planLabel: "Pro", subscriptionStatus: "ACTIVE", joinedAt: minutesAgo(361) },
];

const ACTION_REQUIRED: ActionRequiredRow[] = [
  { id: "a1", kind: "payment_failed", businessId: "c2", businessName: "Maple Exteriors", detail: "Invoice payment failed (card declined)", occurredAt: minutesAgo(126), href: "/admin/customers?customer=c2" },
  { id: "a2", kind: "trial_ending", businessId: "c7", businessName: "Summit Roofing", detail: "Trial ends in 2 days", occurredAt: minutesAgo(242), href: "/admin/customers?customer=c7" },
  { id: "a3", kind: "high_usage", businessId: "c6", businessName: "Harbor Home Solutions", detail: "Workspace at 90% of its message allowance", occurredAt: minutesAgo(361), href: "/admin/customers?customer=c6" },
  { id: "a4", kind: "workspace_health", businessId: "c8", businessName: "BrightLeaf Properties", detail: "Onboarding stalled at connect leads", occurredAt: minutesAgo(482), href: "/admin/customers?customer=c8" },
  { id: "a5", kind: "integration_error", businessId: "c4", businessName: "Pinnacle Builders", detail: "Google Ads sync failing", occurredAt: minutesAgo(721), href: "/admin/customers?customer=c4" },
];

const FAILED_JOBS: FailedJobRow[] = [
  { id: "j1", jobType: "lead_source.poll", jobLabel: "Sync leads", businessId: "c3", businessName: "Oakwood Roofing", error: "Rate limit exceeded", attempts: 4, occurredAt: minutesAgo(24), href: "/admin/system?view=events&type=job" },
  { id: "j2", jobType: "message.send", jobLabel: "Send message", businessId: "c5", businessName: "Crestview Exteriors", error: "Invalid phone number", attempts: 3, occurredAt: minutesAgo(62), href: "/admin/system?view=events&type=job" },
  { id: "j3", jobType: "booking.sync", jobLabel: "Calendar sync", businessId: "c4", businessName: "Pinnacle Builders", error: "Authentication failed", attempts: 5, occurredAt: minutesAgo(124), href: "/admin/system?view=events&type=job" },
  { id: "j4", jobType: "crm.push", jobLabel: "CRM sync", businessId: "c7", businessName: "Summit Roofing", error: "Connection timeout", attempts: 2, occurredAt: minutesAgo(182), href: "/admin/system?view=events&type=job" },
  { id: "j5", jobType: "notification.send", jobLabel: "Send email", businessId: "c2", businessName: "Maple Exteriors", error: "SMTP error", attempts: 3, occurredAt: minutesAgo(302), href: "/admin/system?view=events&type=job" },
];

export function fixtureOverview(): AdminOverview {
  return {
    range: "24h",
    generatedAt: new Date().toISOString(),
    metrics: METRICS,
    providers: PROVIDERS,
    recentCustomers: RECENT_CUSTOMERS,
    actionRequired: ACTION_REQUIRED,
    failedJobs: FAILED_JOBS,
  };
}

/* ------------------------------------------------------------ customers --- */

type Seed = {
  id: string;
  name: string;
  domain: string;
  owner: string;
  email: string;
  plan: string;
  status: string;
  leads: [number, number];
  messages: [number, number];
  health: CustomerRow["connectionHealth"];
  joined: string;
  activity: number;
};

const SEEDS: Seed[] = [
  { id: "c1", name: "Riverside Roofing", domain: "riversideroofing.com", owner: "John Smith", email: "john@riversideroofing.com", plan: "Pro", status: "ACTIVE", leads: [1842, 5000], messages: [12420, 25000], health: "HEALTHY", joined: "2024-01-12", activity: 12 },
  { id: "c2", name: "Maple Exteriors", domain: "mapleexteriors.com", owner: "Sarah Rogers", email: "sarah@mapleexteriors.com", plan: "Growth", status: "ACTIVE", leads: [954, 2500], messages: [8221, 15000], health: "HEALTHY", joined: "2024-02-03", activity: 28 },
  { id: "c3", name: "Oakwood Roofing", domain: "oakwoodroofing.com", owner: "Mike Johnson", email: "mike@oakwoodroofing.com", plan: "Growth", status: "ACTIVE", leads: [721, 2500], messages: [6421, 15000], health: "HEALTHY", joined: "2024-02-18", activity: 64 },
  { id: "c4", name: "Pinnacle Builders", domain: "pinnaclebuilders.com", owner: "Emily Wilson", email: "emily@pinnaclebuilders.com", plan: "Pro", status: "ACTIVE", leads: [643, 5000], messages: [9872, 25000], health: "DEGRADED", joined: "2024-03-05", activity: 126 },
  { id: "c5", name: "Crestview Exteriors", domain: "crestviewexteriors.com", owner: "David Thompson", email: "david@crestviewexteriors.com", plan: "Growth", status: "TRIALING", leads: [521, 2500], messages: [2114, 15000], health: "HEALTHY", joined: "2024-03-12", activity: 184 },
  { id: "c6", name: "Harbor Home Solutions", domain: "harborhomesolutions.com", owner: "Amanda King", email: "amanda@harborhomesolutions.com", plan: "Pro", status: "PAST_DUE", leads: [3421, 5000], messages: [18221, 25000], health: "ACTION_REQUIRED", joined: "2024-01-28", activity: 361 },
  { id: "c7", name: "Summit Roofing", domain: "summitroofing.com", owner: "Robert Chen", email: "robert@summitroofing.com", plan: "Growth", status: "ACTIVE", leads: [412, 2500], messages: [5004, 15000], health: "HEALTHY", joined: "2024-02-14", activity: 482 },
  { id: "c8", name: "BrightLeaf Properties", domain: "brightleafproperties.com", owner: "Lisa Martinez", email: "lisa@brightleafproperties.com", plan: "Pro", status: "CANCELLED", leads: [0, 5000], messages: [0, 25000], health: "DISCONNECTED", joined: "2023-12-02", activity: 2880 },
  { id: "c9", name: "Stonebridge Contractors", domain: "stonebridgecontractors.com", owner: "Chris Baker", email: "chris@stonebridgecontractors.com", plan: "Growth", status: "ACTIVE", leads: [1201, 2500], messages: [7332, 15000], health: "HEALTHY", joined: "2024-01-06", activity: 126 },
  { id: "c10", name: "Evergreen Roofing", domain: "evergreenroofing.com", owner: "Kevin Nguyen", email: "kevin@evergreenroofing.com", plan: "Trial", status: "ACTIVE", leads: [312, 2500], messages: [1984, 15000], health: "HEALTHY", joined: "2024-04-01", activity: 242 },
];

export function fixtureCustomers(): CustomerListResult {
  return {
    rows: SEEDS.map((seed) => ({
      id: seed.id,
      name: seed.name,
      domain: seed.domain,
      workspaceStatus: "active",
      ownerName: seed.owner,
      ownerEmail: seed.email,
      plan: seed.plan.toLowerCase(),
      planLabel: seed.plan,
      subscriptionStatus: seed.status,
      leadUsage: usage(seed.leads[0], seed.leads[1]),
      messageUsage: usage(seed.messages[0], seed.messages[1]),
      connectionHealth: seed.health,
      joinedAt: `${seed.joined}T09:00:00.000Z`,
      lastActivityAt: minutesAgo(seed.activity),
    })),
    total: 142,
    page: 1,
    pageSize: 10,
  };
}

export function fixtureCustomerDetail(): CustomerDetail {
  return {
    id: "c4",
    name: "Pinnacle Builders",
    domain: "pinnaclebuilders.com",
    status: "active",
    industry: "Construction",
    phone: "+44 20 7946 0958",
    website: "https://pinnaclebuilders.com",
    timezone: "Europe/London",
    onboardingStep: "complete",
    createdAt: "2024-03-05T09:00:00.000Z",
    activatedAt: "2024-03-06T09:00:00.000Z",
    plan: "pro",
    planLabel: "Pro",
    planMonthlyPrice: 399,
    subscriptionStatus: "ACTIVE",
    billingInterval: "month",
    trialEndsAt: null,
    currentPeriodStart: "2025-04-01T00:00:00.000Z",
    currentPeriodEnd: "2025-05-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    connectionHealth: "DEGRADED",
    connectionIssueCount: 2,
    leadUsage: usage(643, 5000),
    messageUsage: usage(9872, 25000),
    userLimit: 10,
    lastActivityAt: minutesAgo(126),
    lastHealthCheckAt: minutesAgo(45),
    members: [
      { id: "m1", name: "Emily Wilson", email: "emily@pinnaclebuilders.com", role: "owner", status: "active", joinedAt: "2024-03-05T09:00:00.000Z" },
      { id: "m2", name: "James Carter", email: "james@pinnaclebuilders.com", role: "admin", status: "active", joinedAt: "2024-03-08T09:00:00.000Z" },
      { id: "m3", name: "Priya Shah", email: "priya@pinnaclebuilders.com", role: "member", status: "active", joinedAt: "2024-04-02T09:00:00.000Z" },
      { id: "m4", name: "Daniel Lee", email: "daniel@pinnaclebuilders.com", role: "member", status: "active", joinedAt: "2025-04-08T09:00:00.000Z" },
    ],
    integrations: [
      { id: "i1", provider: "google_ads", label: "Google Ads", status: "HEALTHY", accountReference: "Pinnacle Builders Ads", lastSuccessAt: minutesAgo(184), lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
      { id: "i2", provider: "meta", label: "Meta", status: "HEALTHY", accountReference: "Pinnacle Builders", lastSuccessAt: minutesAgo(302), lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
      { id: "i3", provider: "google_calendar", label: "Google Calendar", status: "HEALTHY", accountReference: "Site visits", lastSuccessAt: minutesAgo(62), lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
      { id: "i4", provider: "twilio_sms", label: "Twilio SMS", status: "DEGRADED", accountReference: "+44 7700 900123", lastSuccessAt: minutesAgo(1440), lastErrorAt: minutesAgo(120), lastErrorCode: "429", lastErrorMessage: "Rate limited by the carrier on outbound sends" },
      { id: "i5", provider: "calendly", label: "Calendly", status: "DEGRADED", accountReference: "pinnacle-builders", lastSuccessAt: minutesAgo(720), lastErrorAt: minutesAgo(321), lastErrorCode: "404", lastErrorMessage: "Event type not found during booking sync" },
      { id: "i6", provider: "hubspot", label: "HubSpot", status: "HEALTHY", accountReference: "Pinnacle CRM", lastSuccessAt: minutesAgo(240), lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
    ],
    events: [
      { id: "e1", action: "booking.created", label: "New booking created", actorType: "system", createdAt: minutesAgo(126) },
      { id: "e2", action: "lead.processed", label: "Lead processed from Google Ads", actorType: "system", createdAt: minutesAgo(184) },
      { id: "e3", action: "member.invited", label: "Team member invited (Daniel Lee)", actorType: "user", createdAt: minutesAgo(361) },
      { id: "e4", action: "billing.plan_changed", label: "Plan upgraded to Pro", actorType: "user", createdAt: minutesAgo(2880) },
    ],
    errors: [
      { id: "x1", reference: "SMS-48219", area: "Messaging / SMS", message: "Twilio webhook delivery failed", severity: "HIGH", occurredAt: minutesAgo(1440) },
      { id: "x2", reference: "API-55032", area: "API", message: "Google Ads sync error", severity: "MEDIUM", occurredAt: minutesAgo(2880) },
    ],
  };
}

/* --------------------------------------------------------------- health --- */

export function fixtureHealth(): SystemHealth {
  return {
    checkedAt: minutesAgo(3),
    summary: {
      providersMonitored: 6,
      healthyProviders: 5,
      degradedServices: 1,
      failedJobs: 3,
      workspacesWithIssues: 2,
    },
    providers: PROVIDERS,
    queues: [
      { key: "lead_ingestion", label: "Lead ingestion", pending: 12, processing: 4, failed: 0, lastRunAt: minutesAgo(2), status: "HEALTHY" },
      { key: "message_dispatch", label: "Message dispatch", pending: 28, processing: 6, failed: 1, lastRunAt: minutesAgo(1), status: "DEGRADED" },
      { key: "booking_sync", label: "Booking sync", pending: 3, processing: 2, failed: 0, lastRunAt: minutesAgo(4), status: "HEALTHY" },
      { key: "billing_webhooks", label: "Billing webhooks", pending: 0, processing: 1, failed: 0, lastRunAt: minutesAgo(3), status: "HEALTHY" },
      { key: "notifications", label: "Notifications", pending: 45, processing: 0, failed: 3, lastRunAt: minutesAgo(58), status: "DEGRADED" },
      { key: "nightly_summaries", label: "Nightly summaries", pending: 0, processing: 0, failed: 0, lastRunAt: minutesAgo(62), status: "HEALTHY" },
    ],
    degradedWorkspaces: [
      { id: "d1", businessId: "c1", businessName: "Riverside Roofing", area: "Calendly connection", impact: "New bookings not syncing", since: minutesAgo(321), status: "Investigating" },
      { id: "d2", businessId: "c2", businessName: "Maple Exteriors", area: "WhatsApp messaging", impact: "Outbound messages delayed", since: minutesAgo(122), status: "Degraded" },
      { id: "d3", businessId: "c4", businessName: "Pinnacle Builders", area: "Lead ingestion", impact: "Some leads delayed (about 15 min)", since: minutesAgo(82), status: "Degraded" },
      { id: "d4", businessId: "c5", businessName: "Crestview Exteriors", area: "Message dispatch", impact: "Intermittent send failures", since: minutesAgo(37), status: "Investigating" },
    ],
  };
}

/* --------------------------------------------------------------- events --- */

const EVENTS: OperationalEvent[] = [
  { id: "webhook:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0aa", source: "webhook", provider: "meta", providerLabel: "Meta", type: "lead", typeLabel: "Lead webhook", businessId: "c1", businessName: "Riverside Roofing", status: "PROCESSED", attempts: 1, receivedAt: minutesAgo(12), processedAt: minutesAgo(12), lastError: null, retryable: false, reference: "evt_meta_8812" },
  { id: "webhook:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0ab", source: "webhook", provider: "stripe", providerLabel: "Stripe", type: "invoice", typeLabel: "Invoice webhook", businessId: "c2", businessName: "Maple Exteriors", status: "FAILED", attempts: 3, receivedAt: minutesAgo(28), processedAt: null, lastError: "Signature mismatch", retryable: true, reference: "evt_1PxyzStripe" },
  { id: "message:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0ac", source: "message", provider: "twilio_sms", providerLabel: "Twilio SMS", type: "outbound_message", typeLabel: "Outbound message", businessId: "c4", businessName: "Pinnacle Builders", status: "RETRYING", attempts: 2, receivedAt: minutesAgo(41), processedAt: null, lastError: "429 rate limit", retryable: false, reference: null },
  { id: "message:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0ad", source: "message", provider: "twilio_whatsapp", providerLabel: "WhatsApp", type: "outbound_message", typeLabel: "Template send", businessId: "c5", businessName: "Crestview Exteriors", status: "PROCESSED", attempts: 1, receivedAt: minutesAgo(62), processedAt: minutesAgo(61), lastError: null, retryable: false, reference: null },
  { id: "webhook:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0ae", source: "webhook", provider: "calendly", providerLabel: "Calendly", type: "booking", typeLabel: "Booking sync", businessId: "c6", businessName: "Harbor Home Solutions", status: "FAILED", attempts: 4, receivedAt: minutesAgo(122), processedAt: null, lastError: "Event type missing", retryable: true, reference: "evt_cal_4471" },
  { id: "webhook:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0af", source: "webhook", provider: "stripe", providerLabel: "Billing", type: "subscription", typeLabel: "Subscription update", businessId: "c7", businessName: "Summit Roofing", status: "PROCESSED", attempts: 1, receivedAt: minutesAgo(182), processedAt: minutesAgo(182), lastError: null, retryable: false, reference: "evt_1PsubStripe" },
  { id: "job:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0b0", source: "job", provider: "job", providerLabel: "Job", type: "webhook.replay", typeLabel: "Webhook replay", businessId: "c8", businessName: "BrightLeaf Properties", status: "RETRYING", attempts: 5, receivedAt: minutesAgo(242), processedAt: null, lastError: "Queue timeout", retryable: false, reference: null },
  { id: "job:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0b1", source: "job", provider: "job", providerLabel: "Job", type: "lead.process", typeLabel: "Process lead", businessId: "c9", businessName: "Stonebridge Contractors", status: "FAILED", attempts: 2, receivedAt: minutesAgo(302), processedAt: null, lastError: "Invalid payload", retryable: true, reference: null },
  { id: "message:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0b2", source: "message", provider: "twilio_sms", providerLabel: "Twilio SMS", type: "inbound_message", typeLabel: "Inbound reply", businessId: "c10", businessName: "Evergreen Roofing", status: "PROCESSED", attempts: 1, receivedAt: minutesAgo(362), processedAt: minutesAgo(362), lastError: null, retryable: false, reference: null },
  { id: "webhook:3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0b3", source: "webhook", provider: "meta", providerLabel: "Meta", type: "lead", typeLabel: "Lead webhook", businessId: "c3", businessName: "Oakwood Roofing", status: "PROCESSED", attempts: 1, receivedAt: minutesAgo(422), processedAt: minutesAgo(422), lastError: null, retryable: false, reference: "evt_meta_8790" },
];

export function fixtureEvents(): EventListResult {
  return {
    rows: EVENTS,
    total: 682,
    page: 1,
    pageSize: 10,
    counts: { processed: 642, retrying: 23, failed: 17, safeToRetry: 12 },
    safeRetryQueue: EVENTS.filter((event) => event.retryable),
    providers: ["calendly", "job", "meta", "stripe", "twilio_sms", "twilio_whatsapp"],
  };
}

export function fixtureEventDetail(): EventDetail {
  const base = EVENTS[1];
  return {
    ...base,
    maxAttempts: 8,
    metadata: [
      { key: "Provider event id", value: "evt_1PxyzStripe" },
      { key: "Event type", value: "invoice.payment_failed" },
      { key: "Internal id", value: "3f7c1c62-4a53-4c31-9a1a-91b0f9a1d0ab" },
    ],
    payloadPreview: JSON.stringify(
      {
        id: "evt_1PxyzStripe",
        type: "invoice.payment_failed",
        signature: "[redacted]",
        data: { object: { id: "in_1Pxyz", amount_due: 39900, currency: "gbp" } },
      },
      null,
      2,
    ),
    retryBlockedReason: null,
  };
}

/* --------------------------------------------------------------- errors --- */

const ERRORS: PlatformErrorRow[] = [
  { fingerprint: "a1b2c3d4", reference: "SMS-48219", area: "Messaging / SMS", businessId: "c4", businessName: "Pinnacle Builders", message: "Twilio webhook delivery failed", severity: "HIGH", status: "INVESTIGATING", firstSeen: minutesAgo(42), lastSeen: minutesAgo(24), occurrences: 12, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "b2c3d4e5", reference: "BILL-28412", area: "Billing", businessId: "c2", businessName: "Maple Exteriors", message: "Invoice payment attempt failed", severity: "MEDIUM", status: "OPEN", firstSeen: minutesAgo(180), lastSeen: minutesAgo(62), occurrences: 4, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "c3d4e5f6", reference: "CAL-18304", area: "Calendly", businessId: "c1", businessName: "Riverside Roofing", message: "Event type not found during booking sync", severity: "HIGH", status: "OPEN", firstSeen: minutesAgo(240), lastSeen: minutesAgo(64), occurrences: 9, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "d4e5f607", reference: "JOB-93014", area: "Jobs", businessId: "c7", businessName: "Summit Roofing", message: "Retry worker exceeded max attempts", severity: "MEDIUM", status: "OPEN", firstSeen: minutesAgo(300), lastSeen: minutesAgo(124), occurrences: 6, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "e5f60718", reference: "DB-10452", area: "Database", businessId: "c8", businessName: "BrightLeaf Properties", message: "Deadlock detected during lead import", severity: "CRITICAL", status: "OPEN", firstSeen: minutesAgo(400), lastSeen: minutesAgo(182), occurrences: 3, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "f6071829", reference: "META-44701", area: "Meta", businessId: "c3", businessName: "Oakwood Roofing", message: "Lead webhook schema mismatch", severity: "MEDIUM", status: "OPEN", firstSeen: minutesAgo(500), lastSeen: minutesAgo(242), occurrences: 5, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "07182930", reference: "WA-22014", area: "WhatsApp", businessId: "c5", businessName: "Crestview Exteriors", message: "Template not approved for outbound send", severity: "LOW", status: "OPEN", firstSeen: minutesAgo(600), lastSeen: minutesAgo(302), occurrences: 2, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "18293041", reference: "BILL-88210", area: "Billing", businessId: "c6", businessName: "Harbor Home Solutions", message: "Subscription webhook signature invalid", severity: "HIGH", status: "OPEN", firstSeen: minutesAgo(700), lastSeen: minutesAgo(362), occurrences: 7, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "29304152", reference: "API-55032", area: "API", businessId: "c9", businessName: "Stonebridge Contractors", message: "Internal 500 on customer sync endpoint", severity: "CRITICAL", status: "OPEN", firstSeen: minutesAgo(800), lastSeen: minutesAgo(422), occurrences: 11, sentryIssueUrl: null, resolvedAt: null },
  { fingerprint: "30415263", reference: "WEB-77218", area: "Webhook", businessId: "c10", businessName: "Evergreen Roofing", message: "Duplicate payload detected and rejected", severity: "LOW", status: "OPEN", firstSeen: minutesAgo(900), lastSeen: minutesAgo(482), occurrences: 8, sentryIssueUrl: null, resolvedAt: null },
];

export function fixtureErrors(): ErrorListResult {
  return {
    rows: ERRORS,
    total: 10,
    page: 1,
    pageSize: 10,
    counts: { CRITICAL: 2, HIGH: 4, MEDIUM: 7, LOW: 3 },
    previousCounts: { CRITICAL: 1, HIGH: 5, MEDIUM: 12, LOW: 4 },
    series: {
      CRITICAL: walk(101, 24, 2, 2),
      HIGH: walk(103, 24, 4, 3),
      MEDIUM: walk(107, 24, 7, 4),
      LOW: walk(109, 24, 3, 2),
    },
    areas: [...new Set(ERRORS.map((row) => row.area))].sort(),
  };
}

export function fixtureSelectedError(): PlatformErrorRow {
  return ERRORS[0];
}

export function fixtureTopBar() {
  return {
    operator: { name: "Jamie Taylor", email: "jamie@clientturn.com", role: "platform_admin" },
    recentCustomers: RECENT_CUSTOMERS.slice(0, 6).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    alertCount: 5,
  };
}

export { daysAgo as fixtureDaysAgo };
