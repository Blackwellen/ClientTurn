import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emptyPlan, parsePlan, type SearchPlan } from "../plan";
import type {
  PlanSummaryLine,
  SearchMessageView,
  SearchSessionSummary,
  SearchSessionView,
} from "../types";

/**
 * Search sessions: the conversation and the structured plan it produces.
 *
 * Reads and writes both use the service-role client scoped explicitly by
 * `business_id`, following the pattern the rest of the product uses: the
 * caller has already passed `requireWorkspace()`, RLS is the backstop, and the
 * explicit `.eq("business_id", …)` on every query is the actual guard. A
 * session id from a URL is never trusted on its own.
 */

export async function listSessions(
  businessId: string,
  options: { limit?: number; includeArchived?: boolean } = {},
): Promise<SearchSessionSummary[]> {
  const admin = createAdminClient();

  let query = admin
    .from("search_sessions")
    .select("id, title, prospects_found, updated_at, status")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 30);

  if (!options.includeArchived) query = query.eq("status", "ACTIVE");

  const { data } = await query;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    prospectsFound: row.prospects_found ?? 0,
    updatedAt: row.updated_at,
    status: row.status as "ACTIVE" | "ARCHIVED",
  }));
}

/**
 * Groups sessions the way the rail shows them. Pure enough to test, but it
 * lives here because "today" depends on the workspace's clock, not the
 * browser's.
 */
export type SessionGroup = { label: string; sessions: SearchSessionSummary[] };

export function groupSessions(
  sessions: SearchSessionSummary[],
  now: Date = new Date(),
): SessionGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 864e5);
  const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 864e5);

  const buckets: SessionGroup[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Last 7 days", sessions: [] },
    { label: "Older", sessions: [] },
  ];

  for (const session of sessions) {
    const at = new Date(session.updatedAt);
    if (at >= startOfToday) buckets[0].sessions.push(session);
    else if (at >= startOfYesterday) buckets[1].sessions.push(session);
    else if (at >= sevenDaysAgo) buckets[2].sessions.push(session);
    else buckets[3].sessions.push(session);
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}

/** The plan snippet an assistant message rendered inline, if it had one. */
function planSummaryFrom(structured: unknown): PlanSummaryLine[] | null {
  if (!structured || typeof structured !== "object") return null;
  const summary = (structured as { planSummary?: unknown }).planSummary;
  if (!Array.isArray(summary)) return null;

  return summary
    .filter(
      (line): line is PlanSummaryLine =>
        Boolean(line) &&
        typeof line === "object" &&
        typeof (line as PlanSummaryLine).label === "string" &&
        typeof (line as PlanSummaryLine).value === "string",
    )
    .slice(0, 12);
}

export async function getSession(
  businessId: string,
  sessionId: string,
): Promise<SearchSessionView | null> {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("search_sessions")
    .select("id, title, status, latest_strategy_id, updated_at")
    .eq("business_id", businessId)
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;

  const [{ data: messages }, { data: strategy }] = await Promise.all([
    admin
      .from("search_messages")
      .select("id, role, content, structured_data, created_at")
      .eq("business_id", businessId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(200),
    session.latest_strategy_id
      ? admin
          .from("search_strategies")
          .select("id, strategy_json, status")
          .eq("business_id", businessId)
          .eq("id", session.latest_strategy_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // A plan that no longer validates (schema tightened since it was written) is
  // treated as absent rather than run: the customer re-approves a plan the
  // current rules accept.
  const plan = parsePlan(strategy?.strategy_json) ?? emptyPlan();

  return {
    id: session.id,
    title: session.title,
    status: session.status as "ACTIVE" | "ARCHIVED",
    saved: Boolean(session.latest_strategy_id),
    plan,
    planStatus: (strategy?.status ?? "DRAFT") as SearchSessionView["planStatus"],
    strategyId: strategy?.id ?? null,
    updatedAt: session.updated_at,
    messages: (messages ?? []).map(
      (row): SearchMessageView => ({
        id: row.id,
        role: row.role as SearchMessageView["role"],
        content: row.content,
        planSummary: planSummaryFrom(row.structured_data),
        createdAt: row.created_at,
      }),
    ),
  };
}

export async function createSession(input: {
  businessId: string;
  userId: string;
  title?: string;
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("search_sessions")
    .insert({
      business_id: input.businessId,
      user_id: input.userId,
      title: input.title?.trim() || "New search",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function appendMessage(input: {
  businessId: string;
  sessionId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM_EVENT";
  content: string;
  structured?: Record<string, unknown> | null;
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("search_messages")
    .insert({
      business_id: input.businessId,
      session_id: input.sessionId,
      role: input.role,
      content: input.content,
      structured_data: (input.structured ?? null) as never,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Touch the session so the rail's recency ordering reflects the conversation,
  // not just plan edits.
  await admin
    .from("search_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("business_id", input.businessId)
    .eq("id", input.sessionId);

  return data.id;
}

/**
 * Writes a new plan version.
 *
 * Plans are versioned rather than mutated: a run that has already started
 * references the exact plan it was authorised against, so editing the session
 * afterwards cannot retroactively change what the customer approved. Any edit
 * also drops the plan back to DRAFT — approval does not survive a change to
 * what was approved.
 */
export async function saveStrategy(input: {
  businessId: string;
  sessionId: string;
  plan: SearchPlan;
  changedBy: "USER" | "SEARCH_AGENT" | "OPTIMIZATION";
  changedByUserId: string | null;
  estimateMinor: number;
  estimatedCalls: Record<string, number>;
  costBand: "WITHIN_PLAN" | "NEAR_LIMIT" | "EXCEEDS_PLAN" | "REQUIRES_OVERAGE";
}): Promise<string> {
  const admin = createAdminClient();

  const { data: previous } = await admin
    .from("search_strategies")
    .select("id, version, strategy_json")
    .eq("business_id", input.businessId)
    .eq("session_id", input.sessionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (previous?.version ?? 0) + 1;

  const { data: strategy, error } = await admin
    .from("search_strategies")
    .insert({
      business_id: input.businessId,
      session_id: input.sessionId,
      version,
      strategy_json: input.plan as never,
      estimated_cost_minor: input.estimateMinor,
      estimated_provider_calls: input.estimatedCalls as never,
      estimated_cost_band: input.costBand,
      status: "DRAFT",
    })
    .select("id")
    .single();

  if (error) throw error;

  if (previous) {
    await admin
      .from("search_strategies")
      .update({ status: "SUPERSEDED" })
      .eq("business_id", input.businessId)
      .eq("id", previous.id)
      .in("status", ["DRAFT", "APPROVED"]);
  }

  await admin.from("search_strategy_versions").insert({
    business_id: input.businessId,
    strategy_id: strategy.id,
    version,
    changed_by: input.changedBy,
    changed_by_user_id: input.changedByUserId,
    diff_json: diffPlans(previous?.strategy_json, input.plan) as never,
    snapshot_json: input.plan as never,
  });

  await admin
    .from("search_sessions")
    .update({ latest_strategy_id: strategy.id })
    .eq("business_id", input.businessId)
    .eq("id", input.sessionId);

  return strategy.id;
}

/** A shallow field-level diff. Enough to answer "what changed and who did it". */
function diffPlans(before: unknown, after: SearchPlan): Record<string, unknown> {
  const previous = parsePlan(before);
  if (!previous) return { created: true };

  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof SearchPlan)[]) {
    const a = JSON.stringify(previous[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) changes[key] = { from: previous[key], to: after[key] };
  }
  return changes;
}

export async function renameSession(
  businessId: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("search_sessions")
    .update({ title: title.trim().slice(0, 120) || "New search" })
    .eq("business_id", businessId)
    .eq("id", sessionId);
}

export async function archiveSession(
  businessId: string,
  sessionId: string,
): Promise<void> {
  const admin = createAdminClient();
  // Archiving hides the session; it never deletes the runs or prospects that
  // came from it, which remain the provenance for records already in the
  // workspace.
  await admin
    .from("search_sessions")
    .update({ status: "ARCHIVED" })
    .eq("business_id", businessId)
    .eq("id", sessionId);
}

export async function duplicateSession(input: {
  businessId: string;
  userId: string;
  sessionId: string;
}): Promise<string | null> {
  const admin = createAdminClient();

  const source = await getSession(input.businessId, input.sessionId);
  if (!source) return null;

  const newId = await createSession({
    businessId: input.businessId,
    userId: input.userId,
    title: `${source.title} (copy)`.slice(0, 120),
  });

  await admin.from("search_strategies").insert({
    business_id: input.businessId,
    session_id: newId,
    version: 1,
    strategy_json: source.plan as never,
    status: "DRAFT",
  });

  const { data: copied } = await admin
    .from("search_strategies")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("session_id", newId)
    .maybeSingle();

  if (copied) {
    await admin
      .from("search_sessions")
      .update({ latest_strategy_id: copied.id })
      .eq("business_id", input.businessId)
      .eq("id", newId);
  }

  return newId;
}
