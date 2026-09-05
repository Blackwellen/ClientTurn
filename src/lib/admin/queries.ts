import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { requirePlatformAdmin } from "./guard";
import type {
  CustomerDetail,
  CustomerFilter,
  CustomerListResult,
  CustomerRow,
  IntegrationHealth,
  JobErrorRow,
  WebhookEventRow,
} from "./types";

export * from "./types";

/**
 * Every export here reads with the service-role client because platform
 * operations legitimately cross tenants. Each one therefore re-asserts
 * `requirePlatformAdmin()` first: a service-role result must never be produced
 * for a request that has not proved platform-admin status against the database.
 */

const HEALTH_RANK: Record<string, number> = {
  DISCONNECTED: 0,
  HEALTHY: 1,
  TESTING: 1,
  DEGRADED: 2,
  ACTION_REQUIRED: 3,
};

function rollUpHealth(statuses: string[]): IntegrationHealth {
  if (statuses.length === 0) return "DISCONNECTED";
  let worst = "HEALTHY";
  for (const status of statuses) {
    if ((HEALTH_RANK[status] ?? 0) > (HEALTH_RANK[worst] ?? 0)) worst = status;
  }
  if (worst === "TESTING") return "HEALTHY";
  return worst as IntegrationHealth;
}

function startOfDayUtc(offsetDays = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* ------------------------------------------------------------- overview --- */

export type OverviewCard = {
  activeCustomers: number;
  trials: number;
  mrrMirror: number;
  enterpriseAccounts: number;
  signupsToday: number;
  signupsWeek: number;
  leadsToday: number;
  messagesToday: number;
  bookingsToday: number;
  failedJobs: number;
};

export type SignupRow = {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  plan: string | null;
};

export type CancellationRow = {
  id: string;
  name: string;
  plan: string;
  cancelledAt: string | null;
};

export type ProviderHealthRow = {
  provider: string;
  healthy: number;
  degraded: number;
  actionRequired: number;
  disconnected: number;
};

export type ActionRequiredRow = {
  id: string;
  kind: "integration" | "delivery" | "billing";
  businessId: string;
  businessName: string;
  detail: string;
  occurredAt: string | null;
};

export type AdminOverview = {
  cards: OverviewCard;
  recentSignups: SignupRow[];
  recentCancellations: CancellationRow[];
  providerHealth: ProviderHealthRow[];
  actionRequired: ActionRequiredRow[];
};

export async function getAdminOverview(): Promise<AdminOverview> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  const today = startOfDayUtc();
  const weekAgo = startOfDayUtc(7);

  const [
    activeCustomers,
    trials,
    signupsToday,
    signupsWeek,
    leadsToday,
    messagesToday,
    bookingsToday,
    failedJobs,
    subscriptions,
    signupRows,
    cancelledRows,
    integrationRows,
    failedDeliveries,
    pastDue,
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "TRIALING"),
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today),
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("is_test", false)
      .gte("created_at", today),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("state", ["failed", "dead"]),
    supabase
      .from("subscriptions")
      .select("business_id, plan, status, billing_interval")
      .in("status", ["ACTIVE", "PAST_DUE"]),
    supabase
      .from("businesses")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("subscriptions")
      .select("business_id, plan, cancelled_at")
      .eq("status", "CANCELLED")
      .order("cancelled_at", { ascending: false, nullsFirst: false })
      .limit(6),
    supabase
      .from("integrations")
      .select("business_id, provider_type, status, last_error_at, last_error_message")
      .limit(5000),
    supabase
      .from("messages")
      .select("id, business_id, error_message, failed_at")
      .eq("status", "FAILED")
      .gte("created_at", daysAgo(1))
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("subscriptions")
      .select("business_id, plan, status, updated_at")
      .in("status", ["PAST_DUE", "UNPAID"])
      .limit(50),
  ]);

  let mrrMirror = 0;
  let enterpriseAccounts = 0;
  for (const row of subscriptions.data ?? []) {
    if (row.status !== "ACTIVE") continue;
    const plan = PLANS[row.plan as Exclude<PlanId, "trial">];
    if (!plan) continue;
    if (plan.monthlyPrice === null) {
      enterpriseAccounts += 1;
      continue;
    }
    mrrMirror +=
      row.billing_interval === "year" && plan.yearlyPrice !== null
        ? plan.yearlyPrice / 12
        : plan.monthlyPrice;
  }

  const planByBusiness = new Map(
    (subscriptions.data ?? []).map((row) => [row.business_id, row.plan]),
  );

  const businessNames = await namesFor(
    supabase,
    unique([
      ...(cancelledRows.data ?? []).map((r) => r.business_id),
      ...(integrationRows.data ?? [])
        .filter((r) => r.status === "ACTION_REQUIRED" || r.status === "DISCONNECTED")
        .map((r) => r.business_id),
      ...(failedDeliveries.data ?? []).map((r) => r.business_id),
      ...(pastDue.data ?? []).map((r) => r.business_id),
    ]),
  );

  const byProvider = new Map<string, ProviderHealthRow>();
  for (const row of integrationRows.data ?? []) {
    const entry = byProvider.get(row.provider_type) ?? {
      provider: row.provider_type,
      healthy: 0,
      degraded: 0,
      actionRequired: 0,
      disconnected: 0,
    };
    if (row.status === "HEALTHY" || row.status === "TESTING") entry.healthy += 1;
    else if (row.status === "DEGRADED") entry.degraded += 1;
    else if (row.status === "ACTION_REQUIRED") entry.actionRequired += 1;
    else entry.disconnected += 1;
    byProvider.set(row.provider_type, entry);
  }

  const actionRequired: ActionRequiredRow[] = [];

  for (const row of integrationRows.data ?? []) {
    if (row.status !== "ACTION_REQUIRED" && row.status !== "DISCONNECTED") continue;
    actionRequired.push({
      id: `integration-${row.business_id}-${row.provider_type}`,
      kind: "integration",
      businessId: row.business_id,
      businessName: businessNames.get(row.business_id) ?? "Unknown workspace",
      detail: `${row.provider_type} ${row.status === "DISCONNECTED" ? "disconnected" : "needs reconnection"}`,
      occurredAt: row.last_error_at,
    });
  }

  const deliveryByBusiness = new Map<string, { count: number; at: string | null }>();
  for (const row of failedDeliveries.data ?? []) {
    const entry = deliveryByBusiness.get(row.business_id) ?? { count: 0, at: null };
    entry.count += 1;
    entry.at = entry.at ?? row.failed_at;
    deliveryByBusiness.set(row.business_id, entry);
  }
  for (const [businessId, entry] of deliveryByBusiness) {
    actionRequired.push({
      id: `delivery-${businessId}`,
      kind: "delivery",
      businessId,
      businessName: businessNames.get(businessId) ?? "Unknown workspace",
      detail: `${entry.count} message ${entry.count === 1 ? "failure" : "failures"} in the last 24 hours`,
      occurredAt: entry.at,
    });
  }

  for (const row of pastDue.data ?? []) {
    actionRequired.push({
      id: `billing-${row.business_id}`,
      kind: "billing",
      businessId: row.business_id,
      businessName: businessNames.get(row.business_id) ?? "Unknown workspace",
      detail: `Subscription ${row.status === "UNPAID" ? "unpaid" : "past due"} (${row.plan})`,
      occurredAt: row.updated_at,
    });
  }

  actionRequired.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));

  return {
    cards: {
      activeCustomers: activeCustomers.count ?? 0,
      trials: trials.count ?? 0,
      mrrMirror: Math.round(mrrMirror),
      enterpriseAccounts,
      signupsToday: signupsToday.count ?? 0,
      signupsWeek: signupsWeek.count ?? 0,
      leadsToday: leadsToday.count ?? 0,
      messagesToday: messagesToday.count ?? 0,
      bookingsToday: bookingsToday.count ?? 0,
      failedJobs: failedJobs.count ?? 0,
    },
    recentSignups: (signupRows.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      status: row.status,
      plan: planByBusiness.get(row.id) ?? null,
    })),
    recentCancellations: (cancelledRows.data ?? []).map((row) => ({
      id: row.business_id,
      name: businessNames.get(row.business_id) ?? "Unknown workspace",
      plan: row.plan,
      cancelledAt: row.cancelled_at,
    })),
    providerHealth: [...byProvider.values()].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ),
    actionRequired: actionRequired.slice(0, 12),
  };
}

/* ------------------------------------------------------------ customers --- */

const FILTER_STATUS: Partial<Record<CustomerFilter, string[]>> = {
  trial: ["TRIALING"],
  active: ["ACTIVE"],
  past_due: ["PAST_DUE", "UNPAID"],
  cancelled: ["CANCELLED"],
};

function sanitiseSearch(value: string): string {
  return value.replace(/[^\p{L}\p{N}@.\-_ ]/gu, "").trim().slice(0, 80);
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function namesFor(
  supabase: AdminClient,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("businesses")
    .select("id, name")
    .in("id", ids);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

export async function listCustomers(params: {
  filter: CustomerFilter;
  search: string;
  page: number;
  pageSize: number;
}): Promise<CustomerListResult> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  const search = sanitiseSearch(params.search);
  const restrictions: string[][] = [];

  const statuses = FILTER_STATUS[params.filter];
  if (statuses) {
    const { data } = await supabase
      .from("subscriptions")
      .select("business_id")
      .in("status", statuses)
      .limit(5000);
    restrictions.push((data ?? []).map((r) => r.business_id));
  }

  if (params.filter === "integration_problem") {
    const { data } = await supabase
      .from("integrations")
      .select("business_id")
      .in("status", ["ACTION_REQUIRED", "DISCONNECTED"])
      .limit(5000);
    restrictions.push(unique((data ?? []).map((r) => r.business_id)));
  }

  if (search) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", `%${search}%`)
      .limit(200);

    const userIds = (profiles ?? []).map((p) => p.id);
    let emailBusinessIds: string[] = [];
    if (userIds.length > 0) {
      const { data: members } = await supabase
        .from("business_members")
        .select("business_id")
        .in("user_id", userIds)
        .limit(500);
      emailBusinessIds = unique((members ?? []).map((m) => m.business_id));
    }

    const { data: byName } = await supabase
      .from("businesses")
      .select("id")
      .ilike("name", `%${search}%`)
      .limit(500);

    restrictions.push(
      unique([...emailBusinessIds, ...(byName ?? []).map((b) => b.id)]),
    );
  }

  let allowedIds: string[] | null = null;
  for (const list of restrictions) {
    allowedIds =
      allowedIds === null
        ? list
        : allowedIds.filter((id) => new Set(list).has(id));
  }

  if (allowedIds !== null && allowedIds.length === 0) {
    return { rows: [], total: 0, page: params.page, pageSize: params.pageSize };
  }

  let query = supabase
    .from("businesses")
    .select("id, name, status, created_at", { count: "exact" });

  if (allowedIds !== null) query = query.in("id", allowedIds);

  const from = (params.page - 1) * params.pageSize;
  const { data: businesses, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + params.pageSize - 1);

  const pageIds = (businesses ?? []).map((b) => b.id);
  if (pageIds.length === 0) {
    return {
      rows: [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  const [subs, members, integrations] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("business_id, plan, status, current_period_start")
      .in("business_id", pageIds),
    supabase
      .from("business_members")
      .select("business_id, user_id, role, created_at")
      .in("business_id", pageIds)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("integrations")
      .select("business_id, status")
      .in("business_id", pageIds),
  ]);

  const ownerByBusiness = new Map<string, string>();
  for (const member of members.data ?? []) {
    if (member.role !== "owner") continue;
    if (!ownerByBusiness.has(member.business_id)) {
      ownerByBusiness.set(member.business_id, member.user_id);
    }
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", unique([...ownerByBusiness.values()]));

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const subByBusiness = new Map(
    (subs.data ?? []).map((s) => [s.business_id, s]),
  );

  const healthByBusiness = new Map<string, string[]>();
  for (const row of integrations.data ?? []) {
    const list = healthByBusiness.get(row.business_id) ?? [];
    list.push(row.status);
    healthByBusiness.set(row.business_id, list);
  }

  const usage = await Promise.all(
    pageIds.map(async (id) => {
      const periodStart =
        subByBusiness.get(id)?.current_period_start ?? daysAgo(30);

      const [leads, messages, lastMessage] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("business_id", id)
          .eq("is_test", false)
          .gte("created_at", periodStart),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_id", id)
          .gte("created_at", periodStart),
        supabase
          .from("messages")
          .select("created_at")
          .eq("business_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        id,
        leads: leads.count ?? 0,
        messages: messages.count ?? 0,
        lastActivityAt: lastMessage.data?.created_at ?? null,
      };
    }),
  );

  const usageById = new Map(usage.map((u) => [u.id, u]));

  const rows: CustomerRow[] = (businesses ?? []).map((business) => {
    const ownerId = ownerByBusiness.get(business.id);
    const profile = ownerId ? profileById.get(ownerId) : undefined;
    const sub = subByBusiness.get(business.id);
    const stats = usageById.get(business.id);

    return {
      id: business.id,
      name: business.name,
      workspaceStatus: business.status,
      ownerName:
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
        "—",
      ownerEmail: profile?.email ?? "—",
      plan: sub?.plan ?? "trial",
      subscriptionStatus: sub?.status ?? "TRIALING",
      leadsThisPeriod: stats?.leads ?? 0,
      messagesThisPeriod: stats?.messages ?? 0,
      integrationHealth: rollUpHealth(healthByBusiness.get(business.id) ?? []),
      joinedAt: business.created_at,
      lastActivityAt: stats?.lastActivityAt ?? null,
    };
  });

  return {
    rows,
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/* ------------------------------------------------------ customer detail --- */

export async function getCustomerDetail(
  businessId: string,
): Promise<CustomerDetail | null> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, status, industry, website, timezone, onboarding_step, created_at, activated_at",
    )
    .eq("id", businessId)
    .maybeSingle();

  if (!business) return null;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      "plan, status, billing_interval, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, lead_limit, user_limit",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  const periodStart = subscription?.current_period_start ?? daysAgo(30);

  const [
    members,
    integrations,
    events,
    jobErrors,
    leadsPeriod,
    leadsTotal,
    messagesPeriod,
    failedMessages,
    bookingsPeriod,
    aiCosts,
  ] = await Promise.all([
    supabase
      .from("business_members")
      .select("id, user_id, role, status, created_at")
      .eq("business_id", businessId)
      .neq("status", "removed")
      .order("created_at", { ascending: true })
      .limit(50),
    // `config` and `integration_secrets` are deliberately never selected here.
    supabase
      .from("integrations")
      .select(
        "id, provider_type, display_name, status, external_account_id, scopes, last_success_at, last_error_at, last_error_code, last_error_message",
      )
      .eq("business_id", businessId)
      .order("provider_type", { ascending: true }),
    supabase
      .from("audit_log")
      .select("id, action, actor_type, entity_type, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("jobs")
      .select("id, type, last_error, created_at")
      .eq("business_id", businessId)
      .in("state", ["failed", "dead"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .gte("created_at", periodStart),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", periodStart),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "FAILED")
      .gte("created_at", periodStart),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", periodStart),
    supabase
      .from("cost_events")
      .select("total_cost")
      .eq("business_id", businessId)
      .eq("provider", "azure")
      .gte("occurred_at", daysAgo(30))
      .limit(20000),
  ]);

  const userIds = unique((members.data ?? []).map((m) => m.user_id));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return {
    id: business.id,
    name: business.name,
    status: business.status,
    industry: business.industry,
    website: business.website,
    timezone: business.timezone,
    onboardingStep: business.onboarding_step,
    createdAt: business.created_at,
    activatedAt: business.activated_at,
    plan: subscription?.plan ?? "trial",
    subscriptionStatus: subscription?.status ?? "TRIALING",
    billingInterval: subscription?.billing_interval ?? null,
    trialEndsAt: subscription?.trial_ends_at ?? null,
    currentPeriodStart: subscription?.current_period_start ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    leadLimit: subscription?.lead_limit ?? 0,
    userLimit: subscription?.user_limit ?? 0,
    leadsThisPeriod: leadsPeriod.count ?? 0,
    leadsTotal: leadsTotal.count ?? 0,
    messagesThisPeriod: messagesPeriod.count ?? 0,
    failedMessagesThisPeriod: failedMessages.count ?? 0,
    bookingsThisPeriod: bookingsPeriod.count ?? 0,
    members: (members.data ?? []).map((member) => {
      const profile = profileById.get(member.user_id);
      return {
        id: member.id,
        name:
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
          "Pending invite",
        email: profile?.email ?? "—",
        role: member.role,
        status: member.status,
        joinedAt: member.created_at,
      };
    }),
    integrations: (integrations.data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider_type,
      displayName: row.display_name,
      status: row.status,
      accountReference: row.external_account_id,
      scopes: row.scopes ?? [],
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
    })),
    events: (events.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      actorType: row.actor_type,
      entityType: row.entity_type,
      createdAt: row.created_at,
    })),
    errors: (jobErrors.data ?? []).map((row) => ({
      id: row.id,
      area: row.type,
      message: row.last_error ?? "No error message recorded",
      occurredAt: row.created_at,
    })),
    economics: {
      aiCostUsd30d: (aiCosts.data ?? []).reduce(
        (total, row) => total + Number(row.total_cost ?? 0),
        0,
      ),
      aiCallCount30d: aiCosts.data?.length ?? 0,
      windowDays: 30,
    },
  };
}

/* --------------------------------------------------------------- system --- */

export type IntegrationFailure = {
  id: string;
  businessName: string;
  provider: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  occurredAt: string | null;
};

export async function getIntegrationsTab(): Promise<{
  providers: ProviderHealthRow[];
  failures: IntegrationFailure[];
}> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  const [{ data: all }, { data: failing }] = await Promise.all([
    supabase.from("integrations").select("provider_type, status").limit(5000),
    supabase
      .from("integrations")
      .select(
        "id, business_id, provider_type, status, last_error_code, last_error_message, last_error_at",
      )
      .not("last_error_at", "is", null)
      .order("last_error_at", { ascending: false })
      .limit(20),
  ]);

  const byProvider = new Map<string, ProviderHealthRow>();
  for (const row of all ?? []) {
    const entry = byProvider.get(row.provider_type) ?? {
      provider: row.provider_type,
      healthy: 0,
      degraded: 0,
      actionRequired: 0,
      disconnected: 0,
    };
    if (row.status === "HEALTHY" || row.status === "TESTING") entry.healthy += 1;
    else if (row.status === "DEGRADED") entry.degraded += 1;
    else if (row.status === "ACTION_REQUIRED") entry.actionRequired += 1;
    else entry.disconnected += 1;
    byProvider.set(row.provider_type, entry);
  }

  const names = await namesFor(
    supabase,
    unique((failing ?? []).map((r) => r.business_id)),
  );

  return {
    providers: [...byProvider.values()].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ),
    failures: (failing ?? []).map((row) => ({
      id: row.id,
      businessName: names.get(row.business_id ?? "") ?? "Unknown workspace",
      provider: row.provider_type,
      status: row.status,
      errorCode: row.last_error_code,
      errorMessage: row.last_error_message,
      occurredAt: row.last_error_at,
    })),
  };
}

export async function listWebhookEvents(params: {
  provider: string;
  status: string;
  page: number;
  pageSize: number;
  onlyStripe?: boolean;
}): Promise<{ rows: WebhookEventRow[]; total: number }> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  let query = supabase
    .from("webhook_events")
    .select(
      "id, provider, external_event_id, event_type, business_id, received_at, status, attempts, last_error, processed_at",
      { count: "exact" },
    );

  if (params.onlyStripe) query = query.eq("provider", "stripe");
  else if (params.provider !== "all") query = query.eq("provider", params.provider);

  if (params.status !== "all") query = query.eq("status", params.status);

  const from = (params.page - 1) * params.pageSize;
  const { data, count } = await query
    .order("received_at", { ascending: false })
    .range(from, from + params.pageSize - 1);

  const names = await namesFor(
    supabase,
    unique((data ?? []).map((r) => r.business_id)),
  );

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      externalEventId: row.external_event_id,
      eventType: row.event_type,
      businessName: row.business_id
        ? (names.get(row.business_id) ?? "Unknown workspace")
        : null,
      receivedAt: row.received_at,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      // Only a genuinely failed delivery is safe to replay. A processed or
      // in-flight event would be applied twice.
      retryable: row.status === "failed",
    })),
    total: count ?? 0,
  };
}

export async function getWebhookProviders(): Promise<string[]> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("webhook_events")
    .select("provider")
    .limit(2000);
  return [...new Set((data ?? []).map((r) => r.provider))].sort();
}

export type MessagingStats = {
  sent: number;
  delivered: number;
  failed: number;
  inbound: number;
  optOuts: number;
  cost: number;
  windowDays: number;
};

export async function getMessagingStats(): Promise<MessagingStats> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();
  const since = daysAgo(30);

  const [sent, delivered, failed, inbound, optOuts, usage] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .not("sent_at", "is", null)
      .gte("created_at", since),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "DELIVERED")
      .gte("created_at", since),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "FAILED")
      .gte("created_at", since),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "inbound")
      .gte("created_at", since),
    supabase
      .from("contact_suppressions")
      .select("id", { count: "exact", head: true })
      .eq("reason", "opt_out")
      .gte("created_at", since),
    supabase
      .from("usage_events")
      .select("quantity, unit_cost")
      .in("metric", ["message_sent", "campaign_message"])
      .gte("occurred_at", since)
      .limit(20000),
  ]);

  const cost = (usage.data ?? []).reduce(
    (total, row) => total + Number(row.quantity ?? 0) * Number(row.unit_cost ?? 0),
    0,
  );

  return {
    sent: sent.count ?? 0,
    delivered: delivered.count ?? 0,
    failed: failed.count ?? 0,
    inbound: inbound.count ?? 0,
    optOuts: optOuts.count ?? 0,
    cost,
    windowDays: 30,
  };
}

export type AiUsageStats = {
  calls: number;
  estimatedCost: number;
  parseFailures: number;
  handoverRate: number;
  handovers: number;
  leads: number;
  windowDays: number;
  nanoCalls: number;
  miniCalls: number;
  reviewRate: number;
};

/**
 * Reads the real metering path (ai_runs / cost_events, written by
 * src/lib/ai/usage-meter.ts on every runTask() call) rather than the generic
 * usage_events "ai_call" metric, which predates migration 0018 and nothing
 * writes to anymore.
 */
export async function getAiUsageStats(): Promise<AiUsageStats> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();
  const since = daysAgo(30);

  const [runs, cost, leads, handovers] = await Promise.all([
    supabase
      .from("ai_runs")
      .select("deployment, status")
      .gte("created_at", since)
      .limit(20000),
    supabase
      .from("cost_events")
      .select("total_cost")
      .eq("provider", "azure")
      .gte("occurred_at", since)
      .limit(20000),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("is_test", false)
      .gte("created_at", since),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("is_test", false)
      .eq("human_takeover", true)
      .gte("created_at", since),
  ]);

  let calls = 0;
  let nanoCalls = 0;
  let miniCalls = 0;
  let parseFailures = 0;
  let reviews = 0;

  for (const row of runs.data ?? []) {
    calls += 1;
    if (row.deployment === "nano") nanoCalls += 1;
    if (row.deployment === "mini") miniCalls += 1;
    if (row.status === "error") parseFailures += 1;
    if (row.status === "low_confidence") reviews += 1;
  }

  const estimatedCost = (cost.data ?? []).reduce(
    (total, row) => total + Number(row.total_cost ?? 0),
    0,
  );

  const leadCount = leads.count ?? 0;
  const handoverCount = handovers.count ?? 0;

  return {
    calls,
    estimatedCost,
    parseFailures,
    handovers: handoverCount,
    leads: leadCount,
    handoverRate: leadCount > 0 ? handoverCount / leadCount : 0,
    windowDays: 30,
    nanoCalls,
    miniCalls,
    reviewRate: calls > 0 ? reviews / calls : 0,
  };
}

export type EconomicsStats = {
  billingPeriod: string;
  totalRevenue: number;
  totalCogs: number;
  grossContribution: number;
  grossMarginPercent: number | null;
  byPlan: { plan: string; businesses: number; revenue: number; cogs: number; marginPercent: number | null }[];
  costLeaders: { businessId: string; businessName: string; cost30d: number }[];
};

function lastCompletedBillingPeriod(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads business_margin_monthly (written by the cost.rollup_monthly job) and
 * business_cost_daily. Never shown to customers — internal unit economics
 * only (§40-41). Margin figures approximate subscription revenue from plan
 * list price; see src/lib/jobs/handlers/cost-rollup.ts for the caveat.
 */
export async function getEconomicsStats(): Promise<EconomicsStats> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();
  const billingPeriod = lastCompletedBillingPeriod();

  const [margins, subs, costs] = await Promise.all([
    supabase
      .from("business_margin_monthly")
      .select("business_id, total_revenue, total_cogs, gross_contribution")
      .eq("billing_period", billingPeriod)
      .limit(5000),
    supabase.from("subscriptions").select("business_id, plan"),
    supabase
      .from("business_cost_daily")
      .select("business_id, total_cost")
      .gte("date", daysAgo(30).slice(0, 10))
      .limit(20000),
  ]);

  const planByBusiness = new Map((subs.data ?? []).map((row) => [row.business_id, row.plan]));

  const totals = (margins.data ?? []).reduce(
    (sum, row) => ({
      totalRevenue: sum.totalRevenue + Number(row.total_revenue ?? 0),
      totalCogs: sum.totalCogs + Number(row.total_cogs ?? 0),
      grossContribution: sum.grossContribution + Number(row.gross_contribution ?? 0),
    }),
    { totalRevenue: 0, totalCogs: 0, grossContribution: 0 },
  );

  const byPlanMap = new Map<
    string,
    { businesses: number; revenue: number; cogs: number; contribution: number }
  >();
  for (const row of margins.data ?? []) {
    const plan = planByBusiness.get(row.business_id) ?? "trial";
    const bucket = byPlanMap.get(plan) ?? { businesses: 0, revenue: 0, cogs: 0, contribution: 0 };
    bucket.businesses += 1;
    bucket.revenue += Number(row.total_revenue ?? 0);
    bucket.cogs += Number(row.total_cogs ?? 0);
    bucket.contribution += Number(row.gross_contribution ?? 0);
    byPlanMap.set(plan, bucket);
  }

  const costByBusiness = new Map<string, number>();
  for (const row of costs.data ?? []) {
    costByBusiness.set(
      row.business_id,
      (costByBusiness.get(row.business_id) ?? 0) + Number(row.total_cost ?? 0),
    );
  }
  const topBusinessIds = [...costByBusiness.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
  const names = await namesFor(supabase, topBusinessIds);

  return {
    billingPeriod,
    totalRevenue: totals.totalRevenue,
    totalCogs: totals.totalCogs,
    grossContribution: totals.grossContribution,
    grossMarginPercent:
      totals.totalRevenue > 0 ? (totals.grossContribution / totals.totalRevenue) * 100 : null,
    byPlan: [...byPlanMap.entries()].map(([plan, bucket]) => ({
      plan,
      businesses: bucket.businesses,
      revenue: bucket.revenue,
      cogs: bucket.cogs,
      marginPercent: bucket.revenue > 0 ? (bucket.contribution / bucket.revenue) * 100 : null,
    })),
    costLeaders: topBusinessIds.map((id) => ({
      businessId: id,
      businessName: names.get(id) ?? "Unknown",
      cost30d: costByBusiness.get(id) ?? 0,
    })),
  };
}

export async function listJobErrors(limit = 50): Promise<JobErrorRow[]> {
  await requirePlatformAdmin();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("jobs")
    .select("id, type, state, business_id, last_error, attempts, created_at")
    .in("state", ["failed", "dead"])
    .order("created_at", { ascending: false })
    .limit(limit);

  const names = await namesFor(
    supabase,
    unique((data ?? []).map((r) => r.business_id)),
  );

  return (data ?? []).map((row) => ({
    id: row.id,
    area: row.type,
    state: row.state,
    businessName: row.business_id
      ? (names.get(row.business_id) ?? "Unknown workspace")
      : null,
    message: row.last_error ?? "No error message recorded",
    attempts: row.attempts,
    occurredAt: row.created_at,
  }));
}
