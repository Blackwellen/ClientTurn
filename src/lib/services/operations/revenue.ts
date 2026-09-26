import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { archetypeFor } from "@/lib/sales-library/archetypes";
import {
  evaluate,
  evaluateAllChannels,
  POLICY_CHANNELS,
  type PolicyChannel,
} from "@/lib/policy/service";
import { contactabilityState } from "@/lib/policy/contactability-state";
import {
  loadBusinessContext,
  queueOutboundMessage,
  restyleMessage,
} from "@/lib/jobs/handlers/shared";
import {
  countRevenueFunnel,
  loadAiBudget,
} from "@/lib/dashboard/revenue-control";
import {
  assembleRevenueFunnel,
  LOW_SAMPLE_N,
} from "@/lib/analytics/revenue-surfaces";
import { rangeBounds, type AnalyticsRange } from "@/lib/analytics/v4-queries";
import { monthStart } from "@/lib/ai/budget";
import { leadDisplayName } from "@/lib/leads/types";
import { MergeError, resolveMergeCandidate } from "@/lib/identity/merge";
import {
  defineOperation,
  ServiceError,
  type HandlerInput,
  type HandlerOutcome,
} from "../runtime";

/**
 * Revenue-engine operations (design doc 05, Phase 5): the reads Copilot, MCP
 * and the API need to reason about a lead and a workspace -- its score, its
 * contactability, the funnel, AI usage -- plus a draft that is never sent and
 * the duplicate queue.
 *
 * The 0121-0123 tables post-date database.types.ts, so every read here goes
 * through one untyped seam. A read that fails reports UNAVAILABLE; it never
 * turns into "no score" or "zero spend", which would be a fabricated answer.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type LeadBasics = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  opted_out: boolean;
  archived_at: string | null;
};

async function loadLead(
  businessId: string,
  leadId: string,
): Promise<LeadBasics> {
  const { data, error } = await db()
    .from("leads")
    .select("id, first_name, last_name, email, phone, opted_out, archived_at")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error)
    throw new ServiceError("UNAVAILABLE", "That lead could not be read.");
  if (!data)
    throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  return data as LeadBasics;
}

/* ------------------------------------------------------ lead.score_explain */

defineOperation("lead.score_explain", {
  schema: z.object({ leadId: z.string().uuid() }),
  async run({
    args,
    context,
  }: HandlerInput<{ leadId: string }>): Promise<
    HandlerOutcome<Record<string, unknown>>
  > {
    await loadLead(context.businessId, args.leadId);
    const { data, error } = await db()
      .from("lead_scores")
      .select(
        "total, grade, dimensions, missing, confidence, why, archetype_key, motion, scoring_version, library_version, trigger_event, is_current, created_at",
      )
      .eq("business_id", context.businessId)
      .eq("lead_id", args.leadId)
      .order("created_at", { ascending: false })
      .limit(6);
    if (error)
      throw new ServiceError(
        "UNAVAILABLE",
        "Lead scores are not available yet.",
      );

    const rows = (data ?? []) as Record<string, unknown>[];
    const current = rows.find((row) => row.is_current) ?? null;
    if (!current) {
      return {
        data: { scored: false, message: "This lead has not been scored yet." },
        entityId: args.leadId,
      };
    }
    const archetypeKey = (current.archetype_key as string | null) ?? null;
    return {
      data: {
        scored: true,
        total: Number(current.total),
        grade: current.grade,
        confidence: Number(current.confidence),
        why: current.why,
        dimensions: current.dimensions,
        missing: current.missing,
        archetype: archetypeKey
          ? {
              key: archetypeKey,
              name: archetypeFor(archetypeKey)?.name ?? archetypeKey,
            }
          : null,
        motion: current.motion,
        scoredAt: current.created_at,
        trigger: current.trigger_event,
        versions: {
          scoring: current.scoring_version,
          library: current.library_version,
        },
        history: rows
          .filter((row) => row !== current)
          .map((row) => ({
            total: Number(row.total),
            grade: row.grade,
            at: row.created_at,
            trigger: row.trigger_event,
          })),
      },
      entityId: args.leadId,
    };
  },
});

/* ---------------------------------------------------- lead.contactability */

defineOperation("lead.contactability", {
  schema: z.object({
    leadId: z.string().uuid(),
    campaignType: z.enum(["WARM", "COLD", "REACTIVATION"]).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    leadId: string;
    campaignType?: "WARM" | "COLD" | "REACTIVATION";
  }>) {
    const lead = await loadLead(context.businessId, args.leadId);

    // permissionOnly and unrecorded: a question about permission, not a send.
    const { eligibility, byChannel } = await evaluateAllChannels(
      context.businessId,
      {
        type: "LEAD",
        id: lead.id,
        email: lead.email,
        phone: lead.phone,
        optedOut: lead.opted_out,
      },
      args.campaignType ?? "WARM",
      { record: false },
    );

    // The stored, trigger-derived state (0123), when this database has it.
    const stored = await db()
      .from("contactability_results")
      .select("channel, state, result, reason_code, evaluated_at")
      .eq("business_id", context.businessId)
      .eq("subject_type", "LEAD")
      .eq("subject_id", lead.id);
    const storedByChannel = new Map<
      string,
      { state: string; evaluated_at: string }
    >();
    if (!stored.error) {
      for (const row of (stored.data ?? []) as {
        channel: string;
        state: string;
        evaluated_at: string;
      }[]) {
        const previous = storedByChannel.get(row.channel);
        if (!previous || previous.evaluated_at < row.evaluated_at)
          storedByChannel.set(row.channel, row);
      }
    }

    const channels = POLICY_CHANNELS.map((channel: PolicyChannel) => {
      const decision = byChannel[channel];
      const storedRow = storedByChannel.get(channel);
      return {
        channel,
        decision: decision.outcome,
        reasonCode: decision.reasonCode,
        reason: decision.message,
        state:
          storedRow?.state ??
          contactabilityState({
            result: decision.outcome,
            reasonCode: decision.reasonCode,
            relationshipType: null,
            channel,
            evidence: null,
          }),
        stateSource: storedRow ? "stored" : "derived",
        requirements: decision.requirements ?? [],
      };
    });

    return {
      data: {
        leadId: lead.id,
        eligibility,
        archived: Boolean(lead.archived_at),
        channels,
      },
      entityId: lead.id,
    };
  },
});

/* ----------------------------------------------------------- message.draft */

const DRAFT_CHANNEL = {
  email: "EMAIL",
  sms: "SMS",
  whatsapp: "WHATSAPP",
} as const;

type DraftArgs = {
  leadId: string;
  channel: keyof typeof DRAFT_CHANNEL;
  text: string;
  subject?: string;
  polish?: boolean;
};

defineOperation("message.draft", {
  schema: z.object({
    leadId: z.string().uuid(),
    channel: z.enum(["email", "sms", "whatsapp"]),
    /** What to say. Written by the person or their assistant; optionally polished. */
    text: z.string().trim().min(1).max(2000),
    subject: z.string().trim().max(200).optional(),
    /** Restyle the wording through the workspace's AI reply settings. Facts are kept. */
    polish: z.boolean().optional(),
  }),
  async run({ args, context }: HandlerInput<DraftArgs>) {
    const lead = await loadLead(context.businessId, args.leadId);
    if (lead.archived_at)
      throw new ServiceError(
        "CONFLICT",
        "That lead is archived. Restore it before drafting to it.",
      );
    if (lead.opted_out) {
      throw new ServiceError(
        "POLICY_BLOCKED",
        "That lead has opted out, so no message will be drafted to them.",
      );
    }
    if (args.channel === "email" && !args.subject) {
      throw new ServiceError(
        "INVALID_INPUT",
        "subject: an email draft needs a subject.",
      );
    }

    const decision = await evaluate({
      businessId: context.businessId,
      subject: {
        type: "LEAD",
        id: lead.id,
        email: lead.email,
        phone: lead.phone,
        optedOut: lead.opted_out,
      },
      channel: DRAFT_CHANNEL[args.channel],
      campaignType: "WARM",
      permissionOnly: true,
      record: false,
    });
    const policyResult = {
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      message: decision.message,
    };
    if (decision.outcome === "BLOCKED")
      throw new ServiceError("POLICY_BLOCKED", decision.message);

    const warnings: { code: string; message: string }[] = [];
    let body = args.text;
    if (args.polish) {
      const business = await loadBusinessContext(context.businessId);
      if (!business)
        throw new ServiceError(
          "UNAVAILABLE",
          "The workspace settings could not be read.",
        );
      // The restyle path the automations use: AI adjusts wording only, falls
      // back to the original on any failed check, and its spend goes through
      // the budget manager in runTask.
      body = await restyleMessage(business, {
        leadId: lead.id,
        baseMessage: args.text,
        maxLength: args.channel === "email" ? 2000 : 300,
        correlationId: context.idempotencyKey ?? context.correlationId,
      });
      if (body === args.text) {
        warnings.push({
          code: "wording_kept",
          message: "Your wording was kept as written.",
        });
      }
    }

    const sendKey = `draft:${context.idempotencyKey ?? context.correlationId}`;
    let messageId: string | null;
    try {
      // enqueueSend: false -- no send job exists for this row, ever.
      messageId = await queueOutboundMessage({
        businessId: context.businessId,
        leadId: lead.id,
        channel: args.channel,
        body,
        subject: args.subject ?? null,
        origin: "manual",
        sendKey,
        enqueueSend: false,
      });
    } catch {
      throw new ServiceError("UNAVAILABLE", "The draft could not be written.");
    }
    if (!messageId)
      throw new ServiceError("UNAVAILABLE", "The draft could not be written.");

    // Same demotion as the agent's SUGGEST_ONLY draft (lib/agent/tools.ts):
    // DRAFT is a status the send worker never claims.
    const demoted = await db()
      .from("messages")
      .update({ status: "DRAFT", scheduled_for: null })
      .eq("id", messageId)
      .eq("business_id", context.businessId);
    if (demoted.error) {
      // Not reviewable as a draft, so it must not linger as QUEUED either.
      await db()
        .from("messages")
        .update({ status: "DISCARDED", scheduled_for: null })
        .eq("id", messageId)
        .eq("business_id", context.businessId);
      throw new ServiceError("UNAVAILABLE", "The draft could not be written.");
    }

    if (decision.outcome !== "ALLOWED") {
      warnings.push({ code: "permission_review", message: decision.message });
    }

    return {
      data: {
        messageId,
        status: "DRAFT",
        channel: args.channel,
        body,
        subject: args.subject ?? null,
        sent: false,
      },
      entityId: messageId,
      after: { status: "DRAFT", channel: args.channel, lead_id: lead.id },
      warnings,
      policyResult,
    };
  },
});

/* -------------------------------------------------------------- funnel.get */

defineOperation("funnel.get", {
  schema: z.object({ period: z.enum(["7d", "30d", "90d", "12m"]).optional() }),
  async run({ args, context }: HandlerInput<{ period?: AnalyticsRange }>) {
    const period = args.period ?? "30d";
    const bounds = rangeBounds(period);
    let counts;
    try {
      counts = await countRevenueFunnel(
        db(),
        context.businessId,
        bounds.from,
        bounds.to,
      );
    } catch {
      throw new ServiceError("UNAVAILABLE", "The funnel could not be read.");
    }
    const stages = assembleRevenueFunnel(counts).map((stage) => ({
      key: stage.key,
      label: stage.label,
      count: stage.tracked ? stage.count : null,
      stepRate: stage.step?.value ?? null,
      stepDenominator: stage.step?.denominator ?? null,
      smallSample: stage.step?.lowSample ?? false,
    }));
    return {
      data: {
        period,
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
        smallSampleBelow: LOW_SAMPLE_N,
        stages,
      },
      entityId: null,
    };
  },
});

/* ------------------------------------------------------------ ai_usage.get */

defineOperation("ai_usage.get", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const now = new Date();
    const since = monthStart(now).toISOString();
    const client = db();
    let budget;
    try {
      budget = await loadAiBudget(client, context.businessId, now);
    } catch {
      throw new ServiceError("UNAVAILABLE", "AI usage is not available yet.");
    }
    const [runs, decisions] = await Promise.all([
      client
        .from("ai_runs")
        .select("task_type, input_tokens, output_tokens, estimated_cost_usd")
        .eq("business_id", context.businessId)
        .gte("created_at", since)
        .limit(20000),
      client
        .from("ai_budget_decisions")
        .select("decision")
        .eq("business_id", context.businessId)
        .gte("created_at", since)
        .in("decision", ["SKIP", "HUMAN"])
        .limit(20000),
    ]);
    if (runs.error)
      throw new ServiceError("UNAVAILABLE", "AI usage could not be read.");

    const byTask = new Map<
      string,
      { calls: number; tokens: number; costUsd: number }
    >();
    for (const run of (runs.data ?? []) as {
      task_type: string;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number | string;
    }[]) {
      const row = byTask.get(run.task_type) ?? {
        calls: 0,
        tokens: 0,
        costUsd: 0,
      };
      row.calls += 1;
      row.tokens += (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
      row.costUsd += Number(run.estimated_cost_usd) || 0;
      byTask.set(run.task_type, row);
    }

    return {
      data: {
        since,
        spentGbp: Number(budget.spentGbp.toFixed(4)),
        ceilingGbp: budget.ceilingGbp,
        ceilingSource: budget.ceilingSource,
        // Null when the decision log is not available, rather than zero.
        refusedThisMonth: decisions.error
          ? null
          : (decisions.data ?? []).length,
        byTask: [...byTask.entries()]
          .map(([task, row]) => ({
            task,
            ...row,
            costUsd: Number(row.costUsd.toFixed(6)),
          }))
          .sort((a, b) => b.costUsd - a.costUsd),
      },
      entityId: null,
    };
  },
});

/* -------------------------------------------------------- merge candidates */

defineOperation("merge_candidate.list", {
  schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  async run({ args, context }: HandlerInput<{ limit?: number }>) {
    const { data, error } = await db()
      .from("merge_candidates")
      .select(
        "id, lead_a_id, lead_b_id, prospect_id, reason, evidence, created_at",
      )
      .eq("business_id", context.businessId)
      .eq("status", "OPEN")
      .order("created_at", { ascending: true })
      .limit(args.limit ?? 20);
    if (error)
      throw new ServiceError(
        "UNAVAILABLE",
        "The duplicate queue is not available yet.",
      );
    const rows = (data ?? []) as {
      id: string;
      lead_a_id: string;
      lead_b_id: string | null;
      prospect_id: string | null;
      reason: string;
      created_at: string;
    }[];
    const ids = [
      ...new Set(
        rows.flatMap((row) => [row.lead_a_id, row.lead_b_id]).filter(Boolean),
      ),
    ] as string[];
    const leads = ids.length
      ? await db()
          .from("leads")
          .select("id, first_name, last_name, phone, email, created_at")
          .eq("business_id", context.businessId)
          .in("id", ids)
      : { data: [], error: null };
    const byId = new Map(
      ((leads.data ?? []) as (LeadBasics & { created_at: string })[]).map(
        (lead) => [lead.id, lead],
      ),
    );
    const side = (id: string | null) => {
      const lead = id ? byId.get(id) : undefined;
      return lead
        ? {
            leadId: lead.id,
            name: leadDisplayName(lead),
            email: lead.email,
            createdAt: lead.created_at,
          }
        : null;
    };
    return {
      data: {
        candidates: rows.map((row) => ({
          id: row.id,
          reason: row.reason,
          createdAt: row.created_at,
          a: side(row.lead_a_id),
          b: side(row.lead_b_id),
          prospectId: row.prospect_id,
        })),
      },
      entityId: null,
    };
  },
});

defineOperation("merge_candidate.resolve", {
  schema: z.object({
    candidateId: z.string().uuid(),
    decision: z.enum(["MERGE", "DISMISS"]),
    /** The lead that keeps the record. Defaults to the older one. */
    keeperLeadId: z.string().uuid().optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    candidateId: string;
    decision: "MERGE" | "DISMISS";
    keeperLeadId?: string;
  }>) {
    try {
      const result = await resolveMergeCandidate({
        businessId: context.businessId,
        candidateId: args.candidateId,
        decision: args.decision,
        keeperId: args.keeperLeadId ?? null,
        actor: {
          userId: context.userId,
          type:
            context.caller === "MCP"
              ? "MCP_CLIENT"
              : context.caller === "API"
                ? "API_KEY"
                : "USER",
        },
      });
      return {
        data: result,
        entityId: args.candidateId,
        before: { status: "OPEN" },
        after:
          result.decision === "MERGED"
            ? {
                status: "MERGED",
                merge_event_id: result.mergeEventId,
                keeper_id: result.keeperId,
                loser_id: result.loserId,
                filled_fields: result.filledFields,
              }
            : { status: "DISMISSED" },
        warnings:
          result.decision === "MERGED"
            ? [
                {
                  code: "merge_recorded",
                  message:
                    "The merge is recorded and ClientTurn support can undo it.",
                },
              ]
            : [],
      };
    } catch (error) {
      if (error instanceof MergeError)
        throw new ServiceError(error.code, error.message);
      throw error;
    }
  },
});
