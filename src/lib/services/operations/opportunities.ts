import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import {
  closeOpportunity,
  OpportunityCloseError,
  OPPORTUNITY_FIELDS,
  type OpportunityRow,
} from "@/lib/opportunities/service";
import {
  OPEN_STAGES,
  OPPORTUNITY_STAGES,
  stagesForMotion,
  type OpenStage,
} from "@/lib/opportunities/stages";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Opportunity operations (decision Q3, Phase 3.3).
 *
 * Reads are bounded and workspace-scoped like every other domain. The two
 * writes are deliberately narrow: `set_stage` moves an OPEN opportunity within
 * the stages its motion uses, and `close` goes through `closeOpportunity`, the
 * one server function that records the outcome and its reason and projects it
 * onto the lead's status in the same transaction.
 */

// The 0125 columns post-date the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function present(row: OpportunityRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    companyId: row.prospect_company_id,
    name: row.name,
    stage: row.stage,
    outcome: row.outcome,
    outcomeReason: row.outcome_reason,
    closedAt: row.closed_at,
    value: row.value,
    currency: row.currency,
    closeTarget: row.close_target,
    motion: row.motion,
    expectedCloseDate: row.expected_close_date,
    stageChangedAt: row.stage_changed_at,
    crmProvider: row.crm_provider,
    updatedAt: row.updated_at,
  };
}

async function loadOrFail(businessId: string, opportunityId: string): Promise<OpportunityRow> {
  const { data } = await db()
    .from("opportunities")
    .select(OPPORTUNITY_FIELDS)
    .eq("id", opportunityId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) throw new ServiceError("NOT_FOUND", "That opportunity could not be found.");
  return data as OpportunityRow;
}

defineOperation("opportunity.list", {
  schema: z.object({
    leadId: z.string().uuid().optional(),
    stage: z.enum(OPPORTUNITY_STAGES).optional(),
    outcome: z.enum(["OPEN", "WON", "LOST"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ leadId?: string; stage?: string; outcome?: string; limit?: number }>) {
    let query = db()
      .from("opportunities")
      .select(OPPORTUNITY_FIELDS)
      .eq("business_id", context.businessId)
      .order("updated_at", { ascending: false })
      .limit(args.limit ?? 25);
    if (args.leadId) query = query.eq("lead_id", args.leadId);
    if (args.stage) query = query.eq("stage", args.stage);
    if (args.outcome) query = query.eq("outcome", args.outcome);

    const { data, error } = await query;
    if (error) throw new ServiceError("UNAVAILABLE", "Opportunities could not be read.");
    const rows = (data ?? []) as OpportunityRow[];
    return { data: { opportunities: rows.map(present), count: rows.length }, entityId: null };
  },
});

defineOperation("opportunity.get", {
  schema: z.object({ opportunityId: z.string().uuid() }),
  async run({ args, context }: HandlerInput<{ opportunityId: string }>) {
    const row = await loadOrFail(context.businessId, args.opportunityId);
    return {
      data: { opportunity: present(row), stagesAvailable: stagesForMotion(row.motion) },
      entityId: row.id,
    };
  },
});

defineOperation("opportunity.set_stage", {
  schema: z.object({
    opportunityId: z.string().uuid(),
    stage: z.enum(OPEN_STAGES as [OpenStage, ...OpenStage[]]),
  }),
  async run({ args, context }: HandlerInput<{ opportunityId: string; stage: OpenStage }>) {
    const before = await loadOrFail(context.businessId, args.opportunityId);

    if (before.outcome !== "OPEN") {
      throw new ServiceError(
        "CONFLICT",
        `That opportunity is already ${before.outcome.toLowerCase()}. Its stage cannot change.`,
      );
    }
    const allowed = stagesForMotion(before.motion);
    if (!allowed.includes(args.stage)) {
      throw new ServiceError(
        "INVALID_INPUT",
        `That stage is not part of this opportunity's sales motion. Use one of: ${allowed.join(", ")}.`,
      );
    }
    if (before.stage === args.stage) {
      return {
        data: { opportunity: present(before), unchanged: true },
        entityId: before.id,
        warnings: [{ code: "no_change", message: `That opportunity is already at ${args.stage}.` }],
      };
    }

    const { data, error } = await db()
      .from("opportunities")
      .update({ stage: args.stage, stage_changed_at: new Date().toISOString() })
      .eq("id", before.id)
      .eq("business_id", context.businessId)
      .eq("outcome", "OPEN")
      .select(OPPORTUNITY_FIELDS)
      .maybeSingle();
    if (error || !data) throw new ServiceError("CONFLICT", "That opportunity could not be updated.");
    const after = data as OpportunityRow;

    if (after.lead_id) await enqueueCrmPushes(context.businessId, after.lead_id);

    return {
      data: { opportunity: present(after), unchanged: false },
      entityId: after.id,
      before: { stage: before.stage },
      after: { stage: after.stage },
    };
  },
});

defineOperation("opportunity.close", {
  schema: z.object({
    opportunityId: z.string().uuid(),
    outcome: z.enum(["WON", "LOST"]),
    reason: z.string().trim().min(3).max(500),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ opportunityId: string; outcome: "WON" | "LOST"; reason: string }>) {
    const before = await loadOrFail(context.businessId, args.opportunityId);

    let closed;
    try {
      closed = await closeOpportunity({
        businessId: context.businessId,
        opportunityId: before.id,
        outcome: args.outcome,
        reason: args.reason,
      });
    } catch (error) {
      if (error instanceof OpportunityCloseError) throw new ServiceError(error.code, error.message);
      throw error;
    }

    const after = await loadOrFail(context.businessId, before.id);
    return {
      data: { opportunity: present(after), leadStatus: closed.leadStatus },
      entityId: after.id,
      before: { stage: before.stage, outcome: before.outcome, outcome_reason: before.outcome_reason },
      after: { stage: after.stage, outcome: after.outcome, outcome_reason: after.outcome_reason },
      warnings: closed.leadId
        ? [
            {
              code: "lead_status_projected",
              message: `The lead is now ${args.outcome.toLowerCase()} and its follow-up stops.`,
            },
          ]
        : [],
    };
  },
});
