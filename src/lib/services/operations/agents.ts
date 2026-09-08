import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import {
  AGENT_TYPES,
  SOURCE_DEFINITIONS,
  type AgentType,
  type SourceKey,
} from "@/lib/agents/types";
import { getAiBehaviour } from "@/lib/ai-settings/queries";
import {
  AI_REPLY_LENGTH_OPTIONS,
  AI_TONE_OPTIONS,
  type AiBehaviourSettings,
} from "@/lib/ai-settings/types";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Setting up and running the AI agents.
 *
 * Two different things live here, and the distinction matters:
 *
 *   * **Agents** — background workers a workspace configures and leaves
 *     running: sourcing prospects, chasing bookings, re-engaging old leads.
 *   * **The conversation assistant** — the thing that answers a lead's
 *     messages. One per workspace, configured rather than instantiated.
 *
 * Putting both behind the service layer is what lets an MCP client set an agent
 * up end to end, because every caller reads the same catalogue. It is also what
 * keeps that safe, and three rules do the work:
 *
 *   1. **A new agent is always a DRAFT.** Creating one starts nothing, which is
 *      why creating is a SAFE_WRITE. Getting the configuration wrong therefore
 *      costs nothing and can be corrected.
 *   2. **Starting is FINANCIAL.** A sourcing agent spends provider budget on a
 *      schedule with nobody watching, so an assistant asking to start one gets
 *      it parked for a person rather than executed. Stopping is never gated —
 *      the safe direction is always immediately available.
 *   3. **The model is not configurable.** There is no operation here that sets
 *      a model, a temperature, a token budget or a system prompt. A caller that
 *      could set those could talk the assistant out of its own guardrails, so
 *      they stay internal to `lib/ai/` and `lib/agent/` where they belong.
 *
 * Every entitlement and every precondition the Agents UI checks is re-checked
 * here, because the UI is not the authority on any of them.
 */

const SOURCE_KEYS = Object.keys(SOURCE_DEFINITIONS) as [SourceKey, ...SourceKey[]];

/* ------------------------------------------------------------------ shared */

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  agent_type: string;
  status: string;
  status_reason: string | null;
  autonomy: string;
  cadence: string;
  search_strategy_id: string | null;
  daily_prospect_cap: number;
  monthly_prospect_cap: number;
  enrich_email: boolean;
  enrich_phone: boolean;
  auto_promote_to_leads: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  total_prospects: number;
  total_leads: number;
  pending_review_count: number;
  created_at: string;
};

// One unbroken literal, not a concatenation: the typed Supabase client infers
// the row shape from the select string, and a concatenation widens it to
// `string`, which silently degrades every result here to an error type.
const AGENT_FIELDS =
  "id, name, description, agent_type, status, status_reason, autonomy, cadence, search_strategy_id, daily_prospect_cap, monthly_prospect_cap, enrich_email, enrich_phone, auto_promote_to_leads, next_run_at, last_run_at, last_run_status, total_prospects, total_leads, pending_review_count, created_at";

async function loadAgentOrFail(businessId: string, agentId: string): Promise<AgentRow> {
  const db = createAdminClient();
  const { data } = await db
    .from("agents")
    .select(AGENT_FIELDS)
    .eq("id", agentId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!data) throw new ServiceError("NOT_FOUND", "That agent could not be found.");
  return data as AgentRow;
}

/** The sources an agent has switched on. */
async function loadSources(businessId: string, agentId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("agent_sources")
    .select("source_key")
    .eq("business_id", businessId)
    .eq("agent_id", agentId)
    .eq("enabled", true);

  return (data ?? []).map((row) => row.source_key);
}

/** The subset reported as `before` and `after`, so a change is legible. */
function snapshot(agent: AgentRow) {
  return {
    name: agent.name,
    type: agent.agent_type,
    status: agent.status,
    autonomy: agent.autonomy,
    cadence: agent.cadence,
    dailyCap: agent.daily_prospect_cap,
    monthlyCap: agent.monthly_prospect_cap,
    enrichEmail: agent.enrich_email,
    enrichPhone: agent.enrich_phone,
  };
}

function present(agent: AgentRow, sources: string[]) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    type: agent.agent_type,
    status: agent.status,
    statusReason: agent.status_reason,
    autonomy: agent.autonomy,
    cadence: agent.cadence,
    searchPlanId: agent.search_strategy_id,
    dailyCap: agent.daily_prospect_cap,
    monthlyCap: agent.monthly_prospect_cap,
    enrichEmail: agent.enrich_email,
    enrichPhone: agent.enrich_phone,
    autoPromoteToLeads: agent.auto_promote_to_leads,
    sources,
    nextRunAt: agent.next_run_at,
    lastRunAt: agent.last_run_at,
    lastRunStatus: agent.last_run_status,
    totals: {
      prospects: agent.total_prospects,
      leads: agent.total_leads,
      awaitingReview: agent.pending_review_count,
    },
    createdAt: agent.created_at,
  };
}

/**
 * Records what happened on the agent's own activity feed.
 *
 * The service layer's audit row proves it happened; this is what the customer
 * actually reads on the agent's page, and an agent reconfigured by an assistant
 * with no trace on its own timeline would be the definition of a surprise.
 */
async function logActivity(input: {
  businessId: string;
  agentId: string;
  userId: string | null;
  eventType: string;
  title: string;
  detail?: string;
  severity?: "INFO" | "SUCCESS" | "WARNING";
}) {
  const db = createAdminClient();
  await db
    .from("agent_activity_events")
    .insert({
      business_id: input.businessId,
      agent_id: input.agentId,
      actor_user_id: input.userId,
      event_type: input.eventType,
      severity: input.severity ?? "INFO",
      title: input.title,
      detail: input.detail ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * The entitlement and precondition checks that gate starting an agent.
 *
 * Shared by `start` and `run_now` because they are the same act with different
 * timing — duplicating them would be how one of the two eventually loses one.
 */
async function assertCanRun(businessId: string, agent: AgentRow): Promise<void> {
  const entitlements = await getV4Entitlements(businessId);

  if (!entitlements.active) {
    throw new ServiceError(
      "PLAN_LIMIT",
      "This workspace does not have an active subscription.",
    );
  }

  // Only the roles that actually source prospects need the sourcing
  // entitlement. Booking and re-engagement work existing leads.
  const sources = agent.agent_type === "SOURCING" || agent.agent_type === "COMBINED";

  if (sources && !entitlements.sourcingEnabled) {
    throw new ServiceError(
      "PLAN_LIMIT",
      "Your plan does not include sourcing agents. Review Billing & Usage.",
    );
  }

  if (!sources) return;

  // Sourcing spends money the moment it runs, so it needs an approved plan
  // first. Booking and re-engagement orchestrate engines configured elsewhere
  // and re-check contactability per lead, so they have no equivalent gate.
  if (!agent.search_strategy_id) {
    throw new ServiceError(
      "CONFLICT",
      "This agent needs an approved Find Leads search plan before it can run.",
    );
  }

  const db = createAdminClient();
  const { data: plan } = await db
    .from("search_strategies")
    .select("status")
    .eq("id", agent.search_strategy_id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (plan?.status !== "APPROVED") {
    throw new ServiceError(
      "CONFLICT",
      "Approve the search plan in Find Leads before running this agent.",
    );
  }
}

/* -------------------------------------------------------------------- list */

defineOperation("agent.list", {
  schema: z.object({
    status: z
      .enum(["DRAFT", "ACTIVE", "PAUSED", "STOPPED", "NEEDS_ATTENTION", "ERROR"])
      .optional(),
    type: z.enum(AGENT_TYPES).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ status?: string; type?: AgentType }>) {
    const db = createAdminClient();
    let query = db
      .from("agents")
      .select(AGENT_FIELDS)
      .eq("business_id", context.businessId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (args.status) query = query.eq("status", args.status);
    if (args.type) query = query.eq("agent_type", args.type);

    const { data } = await query;
    const rows = (data ?? []) as AgentRow[];

    // Sources are fetched in one query rather than per agent: a caller listing
    // twenty agents should not cost twenty-one round trips.
    const { data: sources } = await db
      .from("agent_sources")
      .select("agent_id, source_key")
      .eq("business_id", context.businessId)
      .eq("enabled", true)
      .in(
        "agent_id",
        rows.map((row) => row.id),
      );

    const byAgent = new Map<string, string[]>();
    for (const row of sources ?? []) {
      byAgent.set(row.agent_id, [...(byAgent.get(row.agent_id) ?? []), row.source_key]);
    }

    return {
      data: {
        agents: rows.map((row) => present(row, byAgent.get(row.id) ?? [])),
        count: rows.length,
      },
      entityId: null,
    };
  },
});

/* --------------------------------------------------------------------- get */

defineOperation("agent.get", {
  schema: z.object({ agentId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ agentId: string }>) {
    const agent = await loadAgentOrFail(context.businessId, args.agentId);
    const sources = await loadSources(context.businessId, agent.id);

    const db = createAdminClient();
    const { data: activity } = await db
      .from("agent_activity_events")
      .select("event_type, severity, title, detail, created_at")
      .eq("business_id", context.businessId)
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      data: { agent: present(agent, sources), recentActivity: activity ?? [] },
      entityId: agent.id,
    };
  },
});

/* ------------------------------------------------------------------ create */

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  type: z.enum(AGENT_TYPES),
  cadence: z.enum(["MANUAL", "HOURLY", "DAILY", "WEEKLY"]).default("DAILY"),
  dailyCap: z.number().int().min(1).max(500).default(25),
  monthlyCap: z.number().int().min(1).max(10000).default(500),
  sources: z.array(z.enum(SOURCE_KEYS)).default([]),
  enrichEmail: z.boolean().default(true),
  enrichPhone: z.boolean().default(false),
  // Defaults to the most cautious setting. An agent created by an assistant
  // that auto-approved its own output would be a surprise nobody asked for.
  autonomy: z.enum(["REVIEW_ALL", "REVIEW_NEW", "AUTO"]).default("REVIEW_ALL"),
  searchPlanId: z.string().uuid().optional(),
});

type CreateArgs = z.infer<typeof createSchema>;

defineOperation("agent.create", {
  schema: createSchema,
  async run({ args, context }: HandlerInput<CreateArgs>) {
    const entitlements = await getV4Entitlements(context.businessId);
    if (!entitlements.active) {
      throw new ServiceError(
        "PLAN_LIMIT",
        "This workspace does not have an active subscription.",
      );
    }
    if (
      (args.type === "SOURCING" || args.type === "COMBINED") &&
      !entitlements.sourcingEnabled
    ) {
      throw new ServiceError(
        "PLAN_LIMIT",
        "Your plan does not include sourcing agents. Review Billing & Usage.",
      );
    }

    if (args.monthlyCap < args.dailyCap) {
      throw new ServiceError(
        "INVALID_INPUT",
        "The monthly limit must be at least the daily limit.",
      );
    }

    const db = createAdminClient();

    if (args.searchPlanId) {
      const { data: plan } = await db
        .from("search_strategies")
        .select("id")
        .eq("id", args.searchPlanId)
        .eq("business_id", context.businessId)
        .eq("status", "APPROVED")
        .maybeSingle();
      if (!plan) {
        throw new ServiceError(
          "INVALID_INPUT",
          "That search plan is not an approved plan in this workspace.",
        );
      }
    }

    // A source this agent type cannot use is dropped and reported as a warning
    // rather than failing the whole call — a caller that picked one from the
    // wrong list should still get a working agent, and be told what was ignored.
    const permitted = args.sources.filter((key) =>
      SOURCE_DEFINITIONS[key]?.types.includes(args.type),
    );
    const dropped = args.sources.filter((key) => !permitted.includes(key));

    const { data: business } = await db
      .from("businesses")
      .select("timezone")
      .eq("id", context.businessId)
      .maybeSingle();

    const { data: created, error } = await db
      .from("agents")
      .insert({
        business_id: context.businessId,
        created_by: context.userId,
        name: args.name,
        description: args.description ?? null,
        agent_type: args.type,
        cadence: args.cadence,
        search_strategy_id: args.searchPlanId ?? null,
        daily_prospect_cap: args.dailyCap,
        monthly_prospect_cap: args.monthlyCap,
        timezone: business?.timezone ?? "Europe/London",
        // Always. Creating an agent never starts it, whoever asked.
        status: "DRAFT",
        autonomy: args.autonomy,
        enrich_email: args.enrichEmail,
        enrich_phone: args.enrichPhone,
        // Never enabled at creation. Moving a sourced prospect into Leads is a
        // deliberate, separately-granted behaviour.
        auto_promote_to_leads: false,
      })
      .select(AGENT_FIELDS)
      .single();

    if (error || !created) {
      throw new ServiceError("CONFLICT", "That agent could not be created.");
    }

    const agent = created as AgentRow;

    if (permitted.length > 0) {
      await db.from("agent_sources").insert(
        permitted.map((key) => ({
          business_id: context.businessId,
          agent_id: agent.id,
          source_key: key,
          enabled: true,
          // Real availability is resolved on the first run; recording
          // REQUIRES_SETUP now would be a guess.
          status: "AVAILABLE" as const,
        })),
      );
    }

    await logActivity({
      businessId: context.businessId,
      agentId: agent.id,
      userId: context.userId,
      eventType: "CREATED",
      title: "Agent created",
      detail:
        context.caller === "UI"
          ? "Saved as a draft. Review the setup before starting background work."
          : `Created as a draft via ${context.caller}. Review the setup before starting it.`,
    });

    const warnings = [
      ...(dropped.length > 0
        ? [
            {
              code: "sources_dropped",
              message: `${dropped.join(", ")} cannot be used by a ${args.type} agent and ${dropped.length === 1 ? "was" : "were"} ignored.`,
            },
          ]
        : []),
      {
        code: "draft",
        message:
          "The agent is a draft and is not running. Start it when the setup is right.",
      },
    ];

    return {
      data: { agent: present(agent, permitted) },
      entityId: agent.id,
      before: null,
      after: snapshot(agent),
      warnings,
    };
  },
});

/* --------------------------------------------------------------- configure */

const configureSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    cadence: z.enum(["MANUAL", "HOURLY", "DAILY", "WEEKLY"]).optional(),
    dailyCap: z.number().int().min(1).max(500).optional(),
    monthlyCap: z.number().int().min(1).max(10000).optional(),
    sources: z.array(z.enum(SOURCE_KEYS)).optional(),
    enrichEmail: z.boolean().optional(),
    enrichPhone: z.boolean().optional(),
    autonomy: z.enum(["REVIEW_ALL", "REVIEW_NEW", "AUTO"]).optional(),
    searchPlanId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 1,
    "Name at least one setting to change.",
  );

type ConfigureArgs = z.infer<typeof configureSchema>;

defineOperation("agent.configure", {
  schema: configureSchema,
  async run({ args, context }: HandlerInput<ConfigureArgs>) {
    const before = await loadAgentOrFail(context.businessId, args.agentId);
    const db = createAdminClient();

    const dailyCap = args.dailyCap ?? before.daily_prospect_cap;
    const monthlyCap = args.monthlyCap ?? before.monthly_prospect_cap;
    if (monthlyCap < dailyCap) {
      throw new ServiceError(
        "INVALID_INPUT",
        "The monthly limit must be at least the daily limit.",
      );
    }

    if (args.searchPlanId) {
      const { data: plan } = await db
        .from("search_strategies")
        .select("id")
        .eq("id", args.searchPlanId)
        .eq("business_id", context.businessId)
        .eq("status", "APPROVED")
        .maybeSingle();
      if (!plan) {
        throw new ServiceError(
          "INVALID_INPUT",
          "That search plan is not an approved plan in this workspace.",
        );
      }
    }

    // Typed against the table rather than `Record<string, unknown>`, so a column
    // renamed in a migration fails here at compile time instead of becoming an
    // update that silently changes nothing.
    const patch: {
      name?: string;
      description?: string | null;
      cadence?: string;
      daily_prospect_cap?: number;
      monthly_prospect_cap?: number;
      enrich_email?: boolean;
      enrich_phone?: boolean;
      autonomy?: string;
      search_strategy_id?: string | null;
    } = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.description !== undefined) patch.description = args.description;
    if (args.cadence !== undefined) patch.cadence = args.cadence;
    if (args.dailyCap !== undefined) patch.daily_prospect_cap = args.dailyCap;
    if (args.monthlyCap !== undefined) patch.monthly_prospect_cap = args.monthlyCap;
    if (args.enrichEmail !== undefined) patch.enrich_email = args.enrichEmail;
    if (args.enrichPhone !== undefined) patch.enrich_phone = args.enrichPhone;
    if (args.autonomy !== undefined) patch.autonomy = args.autonomy;
    if (args.searchPlanId !== undefined) patch.search_strategy_id = args.searchPlanId;

    let dropped: string[] = [];

    if (args.sources) {
      const permitted = args.sources.filter((key) =>
        SOURCE_DEFINITIONS[key]?.types.includes(before.agent_type as AgentType),
      );
      dropped = args.sources.filter((key) => !permitted.includes(key));

      // Replaced wholesale rather than merged: `sources: [...]` is a statement
      // of what the agent should use, and a merge would make removing one
      // impossible through this operation.
      await db
        .from("agent_sources")
        .delete()
        .eq("business_id", context.businessId)
        .eq("agent_id", before.id);

      if (permitted.length > 0) {
        await db.from("agent_sources").insert(
          permitted.map((key) => ({
            business_id: context.businessId,
            agent_id: before.id,
            source_key: key,
            enabled: true,
            status: "AVAILABLE" as const,
          })),
        );
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await db
        .from("agents")
        .update(patch)
        .eq("id", before.id)
        .eq("business_id", context.businessId);
      if (error) {
        throw new ServiceError("CONFLICT", "That agent could not be updated.");
      }
    }

    const after = await loadAgentOrFail(context.businessId, before.id);
    const sources = await loadSources(context.businessId, before.id);

    await logActivity({
      businessId: context.businessId,
      agentId: before.id,
      userId: context.userId,
      eventType: "UPDATED",
      title: "Setup changed",
      detail: `Changed via ${context.caller}: ${Object.keys(patch).concat(args.sources ? ["sources"] : []).join(", ")}.`,
    });

    const warnings = [
      ...(dropped.length > 0
        ? [
            {
              code: "sources_dropped",
              message: `${dropped.join(", ")} cannot be used by a ${before.agent_type} agent and ${dropped.length === 1 ? "was" : "were"} ignored.`,
            },
          ]
        : []),
      // A running agent picks up new settings on its next tick, not mid-run.
      // Saying so is the difference between a caller reporting "done" and
      // reporting something true.
      ...(after.status === "ACTIVE"
        ? [
            {
              code: "applies_next_run",
              message: "The agent is running. The new settings apply from its next run.",
            },
          ]
        : []),
    ];

    return {
      data: { agent: present(after, sources) },
      entityId: after.id,
      before: snapshot(before),
      after: snapshot(after),
      warnings,
    };
  },
});

/* -------------------------------------------------------------- lifecycle */

/**
 * The three lifecycle moves share one implementation because they differ only
 * in the status they land on and whether they need the run preconditions. Three
 * near-identical handlers is how one of them eventually loses a check.
 */
function lifecycle(
  operation: "agent.start" | "agent.run_now" | "agent.pause" | "agent.stop",
) {
  const starting = operation === "agent.start" || operation === "agent.run_now";
  const status = starting ? "ACTIVE" : operation === "agent.pause" ? "PAUSED" : "STOPPED";

  defineOperation(operation, {
    schema: z.object({ agentId: z.string().uuid() }),
    async run({ args, context }: HandlerInput<{ agentId: string }>) {
      const before = await loadAgentOrFail(context.businessId, args.agentId);

      if (starting) await assertCanRun(context.businessId, before);

      if (before.status === status && operation !== "agent.run_now") {
        // Not an error and not a write. Recording it as a change would put a
        // meaningless row in the audit trail and in the agent's own timeline.
        return {
          data: { agent: present(before, await loadSources(context.businessId, before.id)) },
          entityId: before.id,
          warnings: [
            {
              code: "no_change",
              message: `That agent is already ${status.toLowerCase()}.`,
            },
          ],
        };
      }

      const now = new Date().toISOString();
      const db = createAdminClient();

      const { error } = await db
        .from("agents")
        .update({
          status,
          status_reason: null,
          // `run_now` sets the next run to now, which is what makes it run
          // immediately rather than at its cadence.
          next_run_at: starting ? now : null,
          activated_at: starting ? now : undefined,
          paused_at: status === "PAUSED" ? now : undefined,
        })
        .eq("id", before.id)
        .eq("business_id", context.businessId);

      if (error) throw new ServiceError("CONFLICT", "That agent could not be updated.");

      const after = await loadAgentOrFail(context.businessId, before.id);

      await logActivity({
        businessId: context.businessId,
        agentId: before.id,
        userId: context.userId,
        eventType: status,
        severity: starting ? "SUCCESS" : "INFO",
        title:
          operation === "agent.run_now"
            ? "Immediate run requested"
            : starting
              ? "Agent started"
              : `Agent ${status.toLowerCase()}`,
        detail: `Requested via ${context.caller}.`,
      });

      return {
        data: {
          agent: present(after, await loadSources(context.businessId, after.id)),
        },
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
        warnings: starting
          ? [
              {
                code: "running",
                message:
                  "The agent is now running in the background. Pause or stop it at any time.",
              },
            ]
          : [],
      };
    },
  });
}

lifecycle("agent.start");
lifecycle("agent.run_now");
lifecycle("agent.pause");
lifecycle("agent.stop");

/* ------------------------------------------------- conversation assistant */

defineOperation("ai_settings.get", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const settings = await getAiBehaviour(context.businessId);
    return { data: { settings }, entityId: context.businessId };
  },
});

const aiUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    tone: z.enum(AI_TONE_OPTIONS).optional(),
    replyLength: z.enum(AI_REPLY_LENGTH_OPTIONS).optional(),
    businessDescription: z.string().max(600).optional(),
    handoverInstruction: z.string().max(300).optional(),
    allowAiReply: z.boolean().optional(),
    allowAiInterpretation: z.boolean().optional(),
    agentMode: z.enum(["OFF", "SUGGEST_ONLY", "AUTO_REPLY"]).optional(),
    agentChannels: z.array(z.enum(["sms", "whatsapp", "email"])).max(3).optional(),
    agentHandoverOnReview: z.boolean().optional(),
    agentAnswerServiceQuestions: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Name at least one setting to change.",
  );

type AiUpdateArgs = z.infer<typeof aiUpdateSchema>;

defineOperation("ai_settings.update", {
  schema: aiUpdateSchema,
  async run({ args, context }: HandlerInput<AiUpdateArgs>) {
    const before = await getAiBehaviour(context.businessId);
    const next: AiBehaviourSettings = { ...before, ...args };

    if (next.enabled) {
      const { assertEntitlement, EntitlementError } = await import(
        "@/lib/billing/entitlements"
      );
      try {
        await assertEntitlement(context.businessId, "ai_assist");
      } catch (error) {
        throw new ServiceError(
          "PLAN_LIMIT",
          error instanceof EntitlementError
            ? error.message
            : "Your plan does not include the AI assistant.",
        );
      }
    }

    // The agent cannot be on while AI is off — it is the same capability, and a
    // workspace that turned AI off has said no to both. Reported as a warning
    // rather than silently corrected.
    const contradiction = next.agentMode !== "OFF" && !next.enabled;
    if (contradiction) next.agentMode = "OFF";

    const db = createAdminClient();

    const { error: settingsError } = await db.from("business_settings").upsert(
      { business_id: context.businessId, ai_assist_enabled: next.enabled },
      { onConflict: "business_id" },
    );
    if (settingsError) {
      throw new ServiceError("CONFLICT", "Those settings could not be saved.");
    }

    const { error: aiError } = await db.from("business_ai_settings").upsert(
      {
        business_id: context.businessId,
        tone: next.tone,
        reply_length: next.replyLength,
        business_description: next.businessDescription,
        handover_instruction: next.handoverInstruction,
        allow_ai_reply: next.allowAiReply,
        allow_ai_interpretation: next.allowAiInterpretation,
        agent_mode: next.agentMode,
        agent_channels: next.agentChannels,
        agent_handover_on_review: next.agentHandoverOnReview,
        agent_answer_service_questions: next.agentAnswerServiceQuestions,
      },
      { onConflict: "business_id" },
    );
    if (aiError) {
      throw new ServiceError("CONFLICT", "Those settings could not be saved.");
    }

    const after = await getAiBehaviour(context.businessId);

    const warnings = [
      ...(contradiction
        ? [
            {
              code: "agent_disabled",
              message:
                "The assistant was switched off because AI is off for this workspace. Turn AI on first.",
            },
          ]
        : []),
      ...(after.agentMode === "AUTO_REPLY"
        ? [
            {
              code: "auto_reply",
              message:
                "The assistant will now answer leads on its own, on the channels you enabled.",
            },
          ]
        : []),
    ];

    return {
      data: { settings: after },
      entityId: context.businessId,
      before: { ...before } as Record<string, unknown>,
      after: { ...after } as Record<string, unknown>,
      warnings,
    };
  },
});
