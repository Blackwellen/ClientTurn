import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStuckLead } from "@/lib/analytics/revenue-surfaces";
import { leadDisplayName } from "@/lib/leads/types";
import { DOMAIN_EVENT_TYPES, INTERNAL_EVENT_TYPES } from "@/lib/events/types";
import {
  adminRead,
  namesFor,
  rangeWindow,
  redactPayload,
  unique,
  type AdminClient,
} from "./shared";
import type { AdminRange } from "./types";

/**
 * Platform-admin reads for the revenue engine (design doc 05, Phase 5):
 * stuck leads, the duplicate queue, AI spend per workspace per task, provider
 * quota usage, the domain event outbox and the audit log.
 *
 * Every read goes through `adminRead()`, which re-asserts platform-admin status
 * before a service-role client is handed out. Several tables are 0122/0123 and
 * post-date the generated types, so they are read through one untyped cast; a
 * failed read returns `unavailable` with the reason, never an empty list that
 * would read as "nothing wrong".
 */

export type AdminLoad<T> =
  { status: "ok"; data: T } | { status: "unavailable"; message: string };

function untyped(client: AdminClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

async function load<T>(
  what: string,
  run: (db: SupabaseClient, admin: AdminClient) => Promise<T>,
): Promise<AdminLoad<T>> {
  const admin = await adminRead();
  try {
    return { status: "ok", data: await run(untyped(admin), admin) };
  } catch (error) {
    console.error(`[admin] ${what} failed`, error);
    return {
      status: "unavailable",
      message: `${what} could not be loaded. The tables behind it may not be migrated on this database yet.`,
    };
  }
}

function ok<T>(result: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? ([] as unknown)) as T;
}

/* ------------------------------------------------------------- stuck leads */

export type StuckLeadRow = {
  leadId: string;
  businessId: string;
  businessName: string;
  name: string;
  status: string;
  firstRepliedAt: string;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  humanTakeover: boolean;
};

export async function listStuckLeads(): Promise<AdminLoad<StuckLeadRow[]>> {
  return load("Stuck leads", async (db, admin) => {
    const leads = ok(
      await db
        .from("leads")
        .select(
          "id, business_id, first_name, last_name, phone, status, opted_out, archived_at, is_test, first_replied_at, human_takeover",
        )
        .not("first_replied_at", "is", null)
        .eq("opted_out", false)
        .eq("is_test", false)
        .is("archived_at", null)
        .not("status", "in", "(WON,LOST,BOOKED)")
        .order("first_replied_at", { ascending: true })
        .limit(500),
    ) as {
      id: string;
      business_id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      status: string;
      opted_out: boolean;
      archived_at: string | null;
      is_test: boolean;
      first_replied_at: string;
      human_takeover: boolean;
    }[];
    if (leads.length === 0) return [];

    const conversations = ok(
      await db
        .from("conversations")
        .select("lead_id, last_outbound_at, last_inbound_at")
        .in(
          "lead_id",
          leads.map((lead) => lead.id),
        ),
    ) as {
      lead_id: string;
      last_outbound_at: string | null;
      last_inbound_at: string | null;
    }[];
    const latest = new Map<string, { out: string | null; in: string | null }>();
    const max = (a: string | null, b: string | null) =>
      !a ? b : !b ? a : a > b ? a : b;
    for (const c of conversations) {
      const prev = latest.get(c.lead_id) ?? { out: null, in: null };
      latest.set(c.lead_id, {
        out: max(prev.out, c.last_outbound_at),
        in: max(prev.in, c.last_inbound_at),
      });
    }

    const now = new Date();
    const stuck = leads.filter((lead) =>
      isStuckLead(
        {
          status: lead.status,
          optedOut: lead.opted_out,
          archivedAt: lead.archived_at,
          isTest: lead.is_test,
          firstRepliedAt: lead.first_replied_at,
          lastOutboundAt: latest.get(lead.id)?.out ?? null,
          lastInboundAt: latest.get(lead.id)?.in ?? null,
        },
        now,
      ),
    );
    const names = await namesFor(
      admin,
      unique(stuck.map((lead) => lead.business_id)),
    );
    return stuck.slice(0, 100).map((lead) => ({
      leadId: lead.id,
      businessId: lead.business_id,
      businessName: names.get(lead.business_id) ?? "Unknown workspace",
      name: leadDisplayName(lead),
      status: lead.status,
      firstRepliedAt: lead.first_replied_at,
      lastOutboundAt: latest.get(lead.id)?.out ?? null,
      lastInboundAt: latest.get(lead.id)?.in ?? null,
      humanTakeover: lead.human_takeover,
    }));
  });
}

/* --------------------------------------------------------- duplicate queue */

export type MergeCandidateRow = {
  id: string;
  businessId: string;
  businessName: string;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  leadA: {
    id: string;
    name: string;
    email: string | null;
    createdAt: string | null;
  } | null;
  leadB: {
    id: string;
    name: string;
    email: string | null;
    createdAt: string | null;
  } | null;
  prospectId: string | null;
  /** The merge this candidate produced, while it can still be undone. */
  undoableMergeEventId: string | null;
};

export async function listMergeCandidates(
  status: "OPEN" | "MERGED" | "DISMISSED",
): Promise<AdminLoad<MergeCandidateRow[]>> {
  return load("The duplicate queue", async (db, admin) => {
    const candidates = ok(
      await db
        .from("merge_candidates")
        .select(
          "id, business_id, lead_a_id, lead_b_id, prospect_id, reason, status, created_at, decided_at",
        )
        .eq("status", status)
        .order("created_at", { ascending: status === "OPEN" })
        .limit(100),
    ) as {
      id: string;
      business_id: string;
      lead_a_id: string;
      lead_b_id: string | null;
      prospect_id: string | null;
      reason: string;
      status: string;
      created_at: string;
      decided_at: string | null;
    }[];
    if (candidates.length === 0) return [];

    const leadIds = unique(
      candidates.flatMap((c) => [c.lead_a_id, c.lead_b_id]),
    );
    const leads = ok(
      await db
        .from("leads")
        .select("id, first_name, last_name, phone, email, created_at")
        .in("id", leadIds),
    ) as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      created_at: string;
    }[];
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    const present = (id: string | null) => {
      const lead = id ? byId.get(id) : null;
      return lead
        ? {
            id: lead.id,
            name: leadDisplayName(lead),
            email: lead.email,
            createdAt: lead.created_at,
          }
        : null;
    };

    // Undo is offered for merges made from this queue that are not reverted.
    const undo = new Map<string, string>();
    if (status === "MERGED") {
      const events = ok(
        await db
          .from("merge_events")
          .select("id, after, reverted_at")
          .in("rule", ["MANUAL", "PROSPECT_PROMOTION"])
          .is("reverted_at", null)
          .in("business_id", unique(candidates.map((c) => c.business_id)))
          .order("created_at", { ascending: false })
          .limit(500),
      ) as { id: string; after: { candidate_id?: string } | null }[];
      for (const event of events) {
        const candidateId = event.after?.candidate_id;
        if (candidateId && !undo.has(candidateId))
          undo.set(candidateId, event.id);
      }
    }

    const names = await namesFor(
      admin,
      unique(candidates.map((c) => c.business_id)),
    );
    return candidates.map((c) => ({
      id: c.id,
      businessId: c.business_id,
      businessName: names.get(c.business_id) ?? "Unknown workspace",
      reason: c.reason,
      status: c.status,
      createdAt: c.created_at,
      decidedAt: c.decided_at,
      leadA: present(c.lead_a_id),
      leadB: present(c.lead_b_id),
      prospectId: c.prospect_id,
      undoableMergeEventId: undo.get(c.id) ?? null,
    }));
  });
}

/* ------------------------------------------------------------------ AI spend */

export type AiSpendRow = {
  businessId: string;
  businessName: string;
  taskType: string;
  runs: number;
  tokens: number;
  costUsd: number;
  refused: number;
};

export type AiSpendData = {
  rows: AiSpendRow[];
  totalCostUsd: number;
  decisions: Record<string, number>;
  truncated: boolean;
};

const SPEND_LIMIT = 20000;

export async function getAiSpend(
  range: AdminRange,
): Promise<AdminLoad<AiSpendData>> {
  return load("AI spend", async (db, admin) => {
    const since = rangeWindow(range).start.toISOString();
    const [runs, decisions] = await Promise.all([
      db
        .from("ai_runs")
        .select(
          "business_id, task_type, input_tokens, cached_input_tokens, output_tokens, estimated_cost_usd",
        )
        .gte("created_at", since)
        .limit(SPEND_LIMIT),
      db
        .from("ai_budget_decisions")
        .select("business_id, task_type, decision")
        .gte("created_at", since)
        .limit(SPEND_LIMIT),
    ]);
    const runRows = ok(runs) as {
      business_id: string;
      task_type: string;
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number | string;
    }[];

    // ai_budget_decisions is 0122. Spend still shows when it is missing; only
    // the refusal column says it is unknown.
    const decisionRows = decisions.error
      ? null
      : ((decisions.data ?? []) as {
          business_id: string;
          task_type: string;
          decision: string;
        }[]);

    const groups = new Map<string, AiSpendRow>();
    const key = (b: string, t: string) => `${b}|${t}`;
    for (const run of runRows) {
      const row = groups.get(key(run.business_id, run.task_type)) ?? {
        businessId: run.business_id,
        businessName: "",
        taskType: run.task_type,
        runs: 0,
        tokens: 0,
        costUsd: 0,
        refused: 0,
      };
      row.runs += 1;
      row.tokens += (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
      row.costUsd += Number(run.estimated_cost_usd) || 0;
      groups.set(key(run.business_id, run.task_type), row);
    }
    const decisionCounts: Record<string, number> = {};
    for (const decision of decisionRows ?? []) {
      decisionCounts[decision.decision] =
        (decisionCounts[decision.decision] ?? 0) + 1;
      if (decision.decision !== "SKIP" && decision.decision !== "HUMAN")
        continue;
      const row = groups.get(key(decision.business_id, decision.task_type)) ?? {
        businessId: decision.business_id,
        businessName: "",
        taskType: decision.task_type,
        runs: 0,
        tokens: 0,
        costUsd: 0,
        refused: 0,
      };
      row.refused += 1;
      groups.set(key(decision.business_id, decision.task_type), row);
    }

    const rows = [...groups.values()];
    const names = await namesFor(
      admin,
      unique(rows.map((row) => row.businessId)),
    );
    for (const row of rows)
      row.businessName = names.get(row.businessId) ?? "Unknown workspace";
    rows.sort((a, b) => b.costUsd - a.costUsd);

    return {
      rows: rows.slice(0, 200),
      totalCostUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
      decisions: decisionRows ? decisionCounts : {},
      truncated: runRows.length >= SPEND_LIMIT,
    };
  });
}

/* ------------------------------------------------------------ provider quotas */

export type QuotaData = {
  /** Mailbox sending caps: the one provider quota the product enforces per sender. */
  senders: {
    id: string;
    businessName: string;
    email: string;
    sentToday: number;
    cap: number;
    /** Paused right now (paused_until in the future), decided at read time. */
    paused: boolean;
  }[];
  /** Provider volume from cost_events. No ceiling is recorded for these. */
  providerVolume: {
    provider: string;
    metric: string;
    quantity: number;
    costUsd: number;
  }[];
};

export async function getProviderQuotas(
  range: AdminRange,
): Promise<AdminLoad<QuotaData>> {
  return load("Provider quota usage", async (db, admin) => {
    const today = new Date().toISOString().slice(0, 10);
    const since = rangeWindow(range).start.toISOString();
    const [senders, costs] = await Promise.all([
      db
        .from("sender_identities")
        .select(
          "id, business_id, email, sent_today, sent_today_on, daily_send_cap, paused_until, active",
        )
        .eq("active", true)
        .order("sent_today", { ascending: false })
        .limit(200),
      db
        .from("cost_events")
        .select("provider, metric, quantity, total_cost")
        .gte("occurred_at", since)
        .limit(SPEND_LIMIT),
    ]);
    const senderRows = ok(senders) as {
      id: string;
      business_id: string;
      email: string;
      sent_today: number;
      sent_today_on: string | null;
      daily_send_cap: number;
      paused_until: string | null;
    }[];
    const costRows = ok(costs) as {
      provider: string;
      metric: string;
      quantity: number | string;
      total_cost: number | string;
    }[];

    const names = await namesFor(
      admin,
      unique(senderRows.map((s) => s.business_id)),
    );
    const volume = new Map<string, QuotaData["providerVolume"][number]>();
    for (const cost of costRows) {
      const k = `${cost.provider}|${cost.metric}`;
      const row = volume.get(k) ?? {
        provider: cost.provider,
        metric: cost.metric,
        quantity: 0,
        costUsd: 0,
      };
      row.quantity += Number(cost.quantity) || 0;
      row.costUsd += Number(cost.total_cost) || 0;
      volume.set(k, row);
    }

    return {
      senders: senderRows.map((s) => ({
        id: s.id,
        businessName: names.get(s.business_id) ?? "Unknown workspace",
        email: s.email,
        // A counter from an earlier day is not today's usage.
        sentToday: s.sent_today_on === today ? s.sent_today : 0,
        cap: s.daily_send_cap,
        paused:
          s.paused_until !== null && Date.parse(s.paused_until) > Date.now(),
      })),
      providerVolume: [...volume.values()].sort(
        (a, b) => b.costUsd - a.costUsd,
      ),
    };
  });
}

/* ------------------------------------------------------------- domain events */

export type DomainEventListRow = {
  id: string;
  businessName: string;
  type: string;
  subjectType: string;
  subjectId: string | null;
  occurredAt: string;
  dispatchedAt: string | null;
  dispatchError: string | null;
  causationDepth: number;
  payload: Record<string, unknown>;
};

export const DOMAIN_EVENT_STATES = [
  "all",
  "pending",
  "failed",
  "dispatched",
] as const;
export type DomainEventState = (typeof DOMAIN_EVENT_STATES)[number];

export async function listDomainEvents(filters: {
  type: string;
  state: DomainEventState;
  range: AdminRange;
  page: number;
  pageSize: number;
}): Promise<
  AdminLoad<{ rows: DomainEventListRow[]; total: number; types: string[] }>
> {
  return load("Domain events", async (db, admin) => {
    const since = rangeWindow(filters.range).start.toISOString();
    let query = db
      .from("domain_events")
      .select(
        "id, business_id, type, subject_type, subject_id, occurred_at, dispatched_at, dispatch_error, causation_depth, payload",
        {
          count: "exact",
        },
      )
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .range(
        (filters.page - 1) * filters.pageSize,
        filters.page * filters.pageSize - 1,
      );
    if (filters.type !== "all") query = query.eq("type", filters.type);
    if (filters.state === "pending") query = query.is("dispatched_at", null);
    if (filters.state === "failed")
      query = query.not("dispatch_error", "is", null);
    if (filters.state === "dispatched")
      query = query.not("dispatched_at", "is", null).is("dispatch_error", null);

    const result = await query;
    const rows = ok(result) as {
      id: string;
      business_id: string;
      type: string;
      subject_type: string;
      subject_id: string | null;
      occurred_at: string;
      dispatched_at: string | null;
      dispatch_error: string | null;
      causation_depth: number;
      payload: Record<string, unknown>;
    }[];
    const names = await namesFor(admin, unique(rows.map((r) => r.business_id)));
    return {
      rows: rows.map((r) => ({
        id: r.id,
        businessName: names.get(r.business_id) ?? "Unknown workspace",
        type: r.type,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        occurredAt: r.occurred_at,
        dispatchedAt: r.dispatched_at,
        dispatchError: r.dispatch_error,
        causationDepth: r.causation_depth,
        // Redacted like every other admin payload view (shared.ts).
        payload: (redactPayload(r.payload ?? {}) ?? {}) as Record<
          string,
          unknown
        >,
      })),
      total: result.count ?? rows.length,
      types: [...DOMAIN_EVENT_TYPES, ...INTERNAL_EVENT_TYPES],
    };
  });
}

/* ----------------------------------------------------------------- audit log */

export type AuditLogRow = {
  id: string;
  businessName: string | null;
  action: string;
  actorType: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export const AUDIT_ACTOR_FILTERS = [
  "all",
  "platform_admin",
  "user",
  "system",
  "provider",
] as const;
export type AuditActorFilter = (typeof AUDIT_ACTOR_FILTERS)[number];

export async function listAuditLog(filters: {
  action: string;
  actor: AuditActorFilter;
  range: AdminRange;
  page: number;
  pageSize: number;
}): Promise<AdminLoad<{ rows: AuditLogRow[]; total: number }>> {
  return load("The audit log", async (db, admin) => {
    const since = rangeWindow(filters.range).start.toISOString();
    let query = db
      .from("audit_log")
      .select(
        "id, business_id, action, actor_type, actor_user_id, entity_type, entity_id, created_at, metadata",
        {
          count: "exact",
        },
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(
        (filters.page - 1) * filters.pageSize,
        filters.page * filters.pageSize - 1,
      );
    // Prefix match on the action ("admin.", "lead.merge"); the value is
    // validated to [a-z_.] by the page before it gets here.
    if (filters.action) query = query.like("action", `${filters.action}%`);
    if (filters.actor !== "all") query = query.eq("actor_type", filters.actor);

    const result = await query;
    const rows = ok(result) as {
      id: string;
      business_id: string | null;
      action: string;
      actor_type: string;
      actor_user_id: string | null;
      entity_type: string | null;
      entity_id: string | null;
      created_at: string;
      metadata: Record<string, unknown> | null;
    }[];
    const names = await namesFor(admin, unique(rows.map((r) => r.business_id)));
    return {
      rows: rows.map((r) => ({
        id: r.id,
        businessName: r.business_id
          ? (names.get(r.business_id) ?? "Unknown workspace")
          : null,
        action: r.action,
        actorType: r.actor_type,
        actorUserId: r.actor_user_id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        createdAt: r.created_at,
        metadata: (redactPayload(r.metadata ?? {}) ?? {}) as Record<
          string,
          unknown
        >,
      })),
      total: result.count ?? rows.length,
    };
  });
}
