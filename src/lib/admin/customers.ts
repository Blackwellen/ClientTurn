import "server-only";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { providerLabel, domainFromWebsite, titleise } from "./format";
import {
  adminRead,
  countConnectionIssues,
  namesFor,
  rollUpHealth,
  unique,
  truncate,
  type AdminClient,
} from "./shared";
import { severityForArea } from "./errors-shared";
import type {
  CustomerDetail,
  CustomerFilter,
  CustomerListResult,
  CustomerRow,
  CustomerSort,
  UsageCell,
} from "./types";

/**
 * Customers is a cross-tenant operational table, so the joins it needs cannot
 * be expressed as one PostgREST query. It is deliberately built as a small
 * number of set-based reads over the *candidate* workspaces rather than a
 * per-row fan-out: sorting by a derived column (usage, plan, activity) has to
 * see every candidate, not just the visible page, or paging would lie.
 *
 * The candidate set is capped; beyond that a search or filter is required.
 */
const CANDIDATE_CAP = 5000;

const FILTER_STATUS: Partial<Record<CustomerFilter, string[]>> = {
  trial: ["TRIALING"],
  active: ["ACTIVE"],
  past_due: ["PAST_DUE", "UNPAID"],
  cancelled: ["CANCELLED"],
};

function sanitiseSearch(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}@.\-_ ]/gu, "")
    .trim()
    .slice(0, 80);
}

export function planLabel(plan: string): string {
  if (plan === "trial") return "Trial";
  return PLANS[plan as Exclude<PlanId, "trial">]?.name ?? titleise(plan);
}

export function planMonthlyPrice(plan: string): number | null {
  if (plan === "trial") return 0;
  return PLANS[plan as Exclude<PlanId, "trial">]?.monthlyPrice ?? null;
}

/** A limit of zero or less means the plan does not meter that dimension. */
function usageCell(used: number, limit: number | null): UsageCell {
  const effective = limit !== null && limit > 0 ? limit : null;
  return {
    used,
    limit: effective,
    ratio: effective === null ? null : used / effective,
  };
}

function leadLimitFor(plan: string, snapshot: number | null): number | null {
  if (typeof snapshot === "number" && snapshot > 0) return snapshot;
  return PLANS[plan as Exclude<PlanId, "trial">]?.leadLimit ?? null;
}

function messageLimitFor(plan: string): number | null {
  return PLANS[plan as Exclude<PlanId, "trial">]?.smsSegmentAllowance ?? null;
}

type Candidate = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  createdAt: string;
};

/** Applies the filter chips and the search box to produce the candidate set. */
async function candidateIds(
  supabase: AdminClient,
  filter: CustomerFilter,
  search: string,
): Promise<string[] | null> {
  const restrictions: string[][] = [];

  const statuses = FILTER_STATUS[filter];
  if (statuses) {
    const { data } = await supabase
      .from("subscriptions")
      .select("business_id")
      .in("status", statuses)
      .limit(CANDIDATE_CAP);
    restrictions.push((data ?? []).map((row) => row.business_id));
  }

  if (filter === "connection_issue") {
    const { data } = await supabase
      .from("integrations")
      .select("business_id")
      .in("status", ["ACTION_REQUIRED", "DISCONNECTED"])
      .limit(CANDIDATE_CAP);
    restrictions.push(unique((data ?? []).map((row) => row.business_id)));
  }

  if (search) {
    const [{ data: profiles }, { data: byName }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .or(
          `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
        )
        .limit(500),
      supabase
        .from("businesses")
        .select("id")
        .or(`name.ilike.%${search}%,website.ilike.%${search}%`)
        .limit(CANDIDATE_CAP),
    ]);

    const userIds = (profiles ?? []).map((row) => row.id);
    let byOwner: string[] = [];
    if (userIds.length > 0) {
      const { data: members } = await supabase
        .from("business_members")
        .select("business_id")
        .in("user_id", userIds)
        .eq("status", "active")
        .limit(CANDIDATE_CAP);
      byOwner = unique((members ?? []).map((row) => row.business_id));
    }

    restrictions.push(
      unique([...byOwner, ...(byName ?? []).map((row) => row.id)]),
    );
  }

  if (restrictions.length === 0) return null;

  let allowed: string[] | null = null;
  for (const list of restrictions) {
    const set = new Set(list);
    allowed = allowed === null ? list : allowed.filter((id) => set.has(id));
  }
  return allowed ?? [];
}

export async function listCustomers(params: {
  filter: CustomerFilter;
  search: string;
  sort: CustomerSort;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
}): Promise<CustomerListResult> {
  const supabase = await adminRead();
  const search = sanitiseSearch(params.search);

  const allowed = await candidateIds(supabase, params.filter, search);
  if (allowed !== null && allowed.length === 0) {
    return { rows: [], total: 0, page: params.page, pageSize: params.pageSize };
  }

  let query = supabase
    .from("businesses")
    .select("id, name, website, status, created_at")
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_CAP);
  if (allowed !== null) query = query.in("id", allowed);

  const { data: businessRows } = await query;
  const candidates: Candidate[] = (businessRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    website: row.website,
    status: row.status,
    createdAt: row.created_at,
  }));

  if (candidates.length === 0) {
    return { rows: [], total: 0, page: params.page, pageSize: params.pageSize };
  }

  const ids = candidates.map((row) => row.id);

  // Four set-based reads for the whole candidate set — never one per row.
  const [subs, integrations, counters, activity] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("business_id, plan, status, lead_limit, current_period_start")
      .in("business_id", ids),
    supabase.from("integrations").select("business_id, status").in("business_id", ids),
    supabase
      .from("usage_counters")
      .select("business_id, metric, quantity, period_start")
      .in("business_id", ids)
      .in("metric", ["lead_processed", "message_sent"])
      .order("period_start", { ascending: false })
      .limit(20000),
    supabase
      .from("audit_log")
      .select("business_id, created_at")
      .in("business_id", ids)
      .order("created_at", { ascending: false })
      .limit(20000),
  ]);

  const subById = new Map((subs.data ?? []).map((row) => [row.business_id, row]));

  const healthById = new Map<string, string[]>();
  for (const row of integrations.data ?? []) {
    const list = healthById.get(row.business_id) ?? [];
    list.push(row.status);
    healthById.set(row.business_id, list);
  }

  const usageById = new Map<string, { leads: number; messages: number }>();
  const seenCounter = new Set<string>();
  for (const row of counters.data ?? []) {
    // Rows arrive newest period first, so the first sighting per
    // (workspace, metric) is the current period.
    const key = `${row.business_id}:${row.metric}`;
    if (seenCounter.has(key)) continue;
    seenCounter.add(key);
    const entry = usageById.get(row.business_id) ?? { leads: 0, messages: 0 };
    if (row.metric === "lead_processed") entry.leads = Number(row.quantity ?? 0);
    else entry.messages = Number(row.quantity ?? 0);
    usageById.set(row.business_id, entry);
  }

  const activityById = new Map<string, string>();
  for (const row of activity.data ?? []) {
    if (!row.business_id) continue;
    if (!activityById.has(row.business_id)) {
      activityById.set(row.business_id, row.created_at);
    }
  }

  const enriched = candidates.map((candidate) => {
    const sub = subById.get(candidate.id);
    const plan = sub?.plan ?? "trial";
    const usage = usageById.get(candidate.id) ?? { leads: 0, messages: 0 };
    return {
      candidate,
      plan,
      subscriptionStatus: sub?.status ?? "TRIALING",
      leadUsage: usageCell(usage.leads, leadLimitFor(plan, sub?.lead_limit ?? null)),
      messageUsage: usageCell(usage.messages, messageLimitFor(plan)),
      connectionHealth: rollUpHealth(healthById.get(candidate.id) ?? []),
      lastActivityAt: activityById.get(candidate.id) ?? null,
    };
  });

  const PLAN_ORDER = ["trial", "starter", "growth", "pro", "enterprise"];
  const STATUS_ORDER = [
    "TRIALING",
    "ACTIVE",
    "PAST_DUE",
    "UNPAID",
    "INCOMPLETE",
    "CANCELLED",
  ];

  const sortKey = (row: (typeof enriched)[number]): number | string => {
    switch (params.sort) {
      case "business":
        return row.candidate.name.toLowerCase();
      case "plan":
        return PLAN_ORDER.indexOf(row.plan);
      case "subscription":
        return STATUS_ORDER.indexOf(row.subscriptionStatus);
      case "lead_usage":
        return row.leadUsage.ratio ?? -1;
      case "message_usage":
        return row.messageUsage.ratio ?? -1;
      case "last_activity":
        return row.lastActivityAt ? new Date(row.lastActivityAt).getTime() : 0;
      case "joined":
      default:
        return new Date(row.candidate.createdAt).getTime();
    }
  };

  const sign = params.direction === "asc" ? 1 : -1;
  enriched.sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right)) * sign;
    }
    return (left - right) * sign;
  });

  const total = enriched.length;
  const from = (params.page - 1) * params.pageSize;
  const pageRows = enriched.slice(from, from + params.pageSize);

  // Owner identity is resolved only for the visible page.
  const pageIds = pageRows.map((row) => row.candidate.id);
  const { data: owners } = await supabase
    .from("business_members")
    .select("business_id, user_id, created_at")
    .in("business_id", pageIds.length > 0 ? pageIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const ownerByBusiness = new Map<string, string>();
  for (const row of owners ?? []) {
    if (!ownerByBusiness.has(row.business_id)) {
      ownerByBusiness.set(row.business_id, row.user_id);
    }
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in(
      "id",
      ownerByBusiness.size > 0
        ? [...ownerByBusiness.values()]
        : ["00000000-0000-0000-0000-000000000000"],
    );
  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));

  const rows: CustomerRow[] = pageRows.map((row) => {
    const ownerId = ownerByBusiness.get(row.candidate.id);
    const profile = ownerId ? profileById.get(ownerId) : undefined;
    return {
      id: row.candidate.id,
      name: row.candidate.name,
      domain: domainFromWebsite(row.candidate.website),
      workspaceStatus: row.candidate.status,
      ownerName:
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
        "No owner on record",
      ownerEmail: profile?.email ?? "—",
      plan: row.plan,
      planLabel: planLabel(row.plan),
      subscriptionStatus: row.subscriptionStatus,
      leadUsage: row.leadUsage,
      messageUsage: row.messageUsage,
      connectionHealth: row.connectionHealth,
      joinedAt: row.candidate.createdAt,
      lastActivityAt: row.lastActivityAt,
    };
  });

  return { rows, total, page: params.page, pageSize: params.pageSize };
}

/* ------------------------------------------------------ customer detail --- */

const AUDIT_LABELS: Record<string, string> = {
  "booking.status_changed": "Booking updated",
  "lead.status_changed": "Lead status changed",
  "member.invited": "Team member invited",
  "member.invite_accepted": "Team member joined",
  "member.removed": "Team member removed",
  "billing.plan_changed": "Plan changed",
  "integration.connected": "Connection added",
  "integration.disconnected": "Connection removed",
  "campaign.launched": "Reactivation campaign launched",
  "workspace.activated": "Workspace activated",
};

export async function getCustomerDetail(
  businessId: string,
): Promise<CustomerDetail | null> {
  const supabase = await adminRead();

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, status, industry, website, phone, timezone, onboarding_step, created_at, activated_at",
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

  const plan = subscription?.plan ?? "trial";

  const [members, integrations, events, jobErrors, counters, healthCheck] =
    await Promise.all([
      supabase
        .from("business_members")
        .select("id, user_id, role, status, created_at")
        .eq("business_id", businessId)
        .neq("status", "removed")
        .order("created_at", { ascending: true })
        .limit(50),
      // `config` and `integration_secrets` are deliberately never selected.
      supabase
        .from("integrations")
        .select(
          "id, provider_type, display_name, status, external_account_id, last_success_at, last_error_at, last_error_code, last_error_message",
        )
        .eq("business_id", businessId)
        .order("provider_type", { ascending: true }),
      supabase
        .from("audit_log")
        .select("id, action, actor_type, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("jobs")
        .select("id, type, last_error, created_at")
        .eq("business_id", businessId)
        .in("state", ["failed", "dead"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("usage_counters")
        .select("metric, quantity, period_start")
        .eq("business_id", businessId)
        .in("metric", ["lead_processed", "message_sent"])
        .order("period_start", { ascending: false })
        .limit(20),
      supabase
        .from("audit_log")
        .select("created_at")
        .eq("business_id", businessId)
        .eq("action", "admin.integration_health_check")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const userIds = unique((members.data ?? []).map((row) => row.user_id));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in(
      "id",
      userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));

  let leadsUsed = 0;
  let messagesUsed = 0;
  const seen = new Set<string>();
  for (const row of counters.data ?? []) {
    if (seen.has(row.metric)) continue;
    seen.add(row.metric);
    if (row.metric === "lead_processed") leadsUsed = Number(row.quantity ?? 0);
    else messagesUsed = Number(row.quantity ?? 0);
  }

  const statuses = (integrations.data ?? []).map((row) => row.status);

  return {
    id: business.id,
    name: business.name,
    domain: domainFromWebsite(business.website),
    status: business.status,
    industry: business.industry,
    phone: business.phone,
    website: business.website,
    timezone: business.timezone,
    onboardingStep: business.onboarding_step,
    createdAt: business.created_at,
    activatedAt: business.activated_at,
    plan,
    planLabel: planLabel(plan),
    planMonthlyPrice: planMonthlyPrice(plan),
    subscriptionStatus: subscription?.status ?? "TRIALING",
    billingInterval: subscription?.billing_interval ?? null,
    trialEndsAt: subscription?.trial_ends_at ?? null,
    currentPeriodStart: subscription?.current_period_start ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    connectionHealth: rollUpHealth(statuses),
    connectionIssueCount: countConnectionIssues(statuses),
    leadUsage: usageCell(
      leadsUsed,
      leadLimitFor(plan, subscription?.lead_limit ?? null),
    ),
    messageUsage: usageCell(messagesUsed, messageLimitFor(plan)),
    userLimit: subscription?.user_limit ?? 0,
    lastActivityAt: events.data?.[0]?.created_at ?? null,
    lastHealthCheckAt: healthCheck.data?.created_at ?? null,
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
      label: providerLabel(row.provider_type),
      status: row.status,
      // An account reference (a calendar name, a sending number) is
      // operational context. Tokens and secrets live in integration_secrets
      // and are never read by any admin query.
      accountReference: row.display_name ?? row.external_account_id,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message
        ? truncate(row.last_error_message, 160)
        : null,
    })),
    events: (events.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      label: AUDIT_LABELS[row.action] ?? titleise(row.action),
      actorType: row.actor_type,
      createdAt: row.created_at,
    })),
    errors: (jobErrors.data ?? []).map((row) => ({
      id: row.id,
      reference: null,
      area: titleise(row.type.split(".")[0]),
      message: truncate(row.last_error ?? "No error message recorded", 120),
      severity: severityForArea(row.type),
      occurredAt: row.created_at,
    })),
  };
}

/** Bounded name lookup used by the admin search endpoint. */
export async function findCustomers(
  supabase: AdminClient,
  ids: string[],
): Promise<Map<string, string>> {
  return namesFor(supabase, ids);
}
