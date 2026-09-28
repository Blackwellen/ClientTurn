import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import {
  closeOpportunity,
  emitOpportunityStageChanged,
  loadWorkspaceMotion,
  OPPORTUNITY_FIELDS,
  type OpportunityRow,
} from "./service";
import {
  PIPELINE_SEMANTICS,
  parseSemanticMap,
  planPipelineMove,
  type PipelineMove,
  type PipelineSemantic,
  type SemanticMap,
} from "./pipeline-semantics";
import type { OpenStage } from "./stages";

/**
 * Applying the pipeline mapping (gap map §46): a quote, voice or payment
 * event moves the deal to the stage the workspace mapped its semantic to.
 * Called from the automation dispatcher (lib/automation/rule-runner.ts) for
 * every event in `EVENT_SEMANTIC`. Forward only, open deals only, motion-aware
 * (planPipelineMove); the write is compare-and-swap on the stage it read, so a
 * concurrent move is never overwritten.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** The workspace's map, or the defaults (no row, or 0163 not applied). */
export async function loadSemanticMap(businessId: string): Promise<{ map: SemanticMap; stored: boolean }> {
  const { data, error } = await db()
    .from("pipeline_stage_maps")
    .select("mapping")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !data) return { map: parseSemanticMap(null), stored: false };
  return { map: parseSemanticMap((data as { mapping: unknown }).mapping), stored: true };
}

/** The deal an event is about: the quote's or invoice's, else the lead's newest open one. */
export async function resolveOpportunity(
  businessId: string,
  refs: { opportunityId: string | null; leadId: string | null },
): Promise<OpportunityRow | null> {
  if (refs.opportunityId) {
    const { data } = await db()
      .from("opportunities")
      .select(OPPORTUNITY_FIELDS)
      .eq("business_id", businessId)
      .eq("id", refs.opportunityId)
      .maybeSingle();
    if (data) return data as OpportunityRow;
  }
  if (!refs.leadId) return null;
  const { data } = await db()
    .from("opportunities")
    .select(OPPORTUNITY_FIELDS)
    .eq("business_id", businessId)
    .eq("lead_id", refs.leadId)
    .eq("outcome", "OPEN")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as OpportunityRow | null) ?? null;
}

/** Where each semantic would land this deal now (for a rule's "Move the deal"). */
export function stagesForDeal(
  map: SemanticMap,
  motion: string | null,
  opportunity: Pick<OpportunityRow, "stage" | "outcome"> | null,
): Partial<Record<PipelineSemantic, OpenStage | null>> {
  const out: Partial<Record<PipelineSemantic, OpenStage | null>> = {};
  for (const semantic of PIPELINE_SEMANTICS) {
    const move = planPipelineMove({ semantic, map, motion, opportunity });
    out[semantic] = move.kind === "ADVANCE" ? move.stage : null;
  }
  return out;
}

export type AppliedMove = PipelineMove & { opportunityId: string | null; applied: boolean };

/** Plans and applies one semantic. Never throws: the event already happened. */
export async function applyPipelineSemantic(input: {
  businessId: string;
  semantic: PipelineSemantic;
  opportunityId: string | null;
  leadId: string | null;
}): Promise<AppliedMove> {
  try {
    const [{ map }, opportunity] = await Promise.all([
      loadSemanticMap(input.businessId),
      resolveOpportunity(input.businessId, { opportunityId: input.opportunityId, leadId: input.leadId }),
    ]);
    const motion = opportunity?.motion ?? (await loadWorkspaceMotion(input.businessId));
    const move = planPipelineMove({ semantic: input.semantic, map, motion, opportunity });
    if (move.kind === "NONE" || !opportunity) return { ...move, opportunityId: opportunity?.id ?? null, applied: false };

    if (move.kind === "CLOSE") {
      await closeOpportunity({ businessId: input.businessId, opportunityId: opportunity.id, outcome: move.outcome, reason: move.reason });
      return { ...move, opportunityId: opportunity.id, applied: true };
    }

    const { data } = await db()
      .from("opportunities")
      .update({ stage: move.stage, stage_changed_at: new Date().toISOString() })
      .eq("id", opportunity.id)
      .eq("business_id", input.businessId)
      .eq("outcome", "OPEN")
      .eq("stage", opportunity.stage)
      .select("id")
      .maybeSingle();
    if (!data) return { ...move, opportunityId: opportunity.id, applied: false };

    await emitOpportunityStageChanged({
      businessId: input.businessId,
      opportunityId: opportunity.id,
      leadId: opportunity.lead_id,
      stage: move.stage,
      previousStage: opportunity.stage,
    });
    if (opportunity.lead_id) await enqueueCrmPushes(input.businessId, opportunity.lead_id);
    return { ...move, opportunityId: opportunity.id, applied: true };
  } catch (error) {
    console.error("[pipeline] semantic move failed", {
      businessId: input.businessId,
      semantic: input.semantic,
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "NONE", reason: "failed", opportunityId: null, applied: false };
  }
}
