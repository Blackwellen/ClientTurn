import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { emitDomainEvent } from "@/lib/events/outbox";
import { enqueueCrmPushes } from "@/lib/integrations/providers/crm-trigger";
import { SALES_MOTIONS, type SalesMotion } from "@/lib/sales-library/types";
import {
  canAdvance,
  closeTargetForMotion,
  stageForEvent,
  type OpenStage,
} from "./stages";

/**
 * The one server path that writes opportunities (decision Q3, Phase 3.3).
 *
 * Every automatic move — qualification, a confirmed meeting, a checkout sent —
 * goes through `advanceLeadOpportunity`, which calls the
 * `ensure_lead_opportunity` RPC (0125): create-or-advance, forward only,
 * serialised on the lead row. Every close goes through `closeOpportunity`,
 * which calls `close_opportunity`: the outcome, its reason and the lead's
 * projected status are one transaction.
 *
 * Nothing here throws on an ordinary failure of the *side* effects (event,
 * CRM push): the opportunity write is the fact, and its notifications follow
 * it. The RPC failing is reported to the caller.
 */

// The 0125 RPCs post-date the generated database types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type OpportunityRow = {
  id: string;
  business_id: string;
  lead_id: string | null;
  prospect_company_id: string | null;
  name: string;
  stage: string;
  outcome: string;
  outcome_reason: string | null;
  closed_at: string | null;
  value: number | null;
  currency: string;
  probability: number | null;
  close_target: string;
  motion: string | null;
  expected_close_date: string | null;
  checkout_link_id: string | null;
  stage_changed_at: string | null;
  crm_provider: string | null;
  crm_external_id: string | null;
  created_at: string;
  updated_at: string;
};

export const OPPORTUNITY_FIELDS =
  "id, business_id, lead_id, prospect_company_id, name, stage, outcome, outcome_reason, closed_at, value, currency, probability, close_target, motion, expected_close_date, checkout_link_id, stage_changed_at, crm_provider, crm_external_id, created_at, updated_at";

/** The workspace's primary motion, or null. A failed read means "not set". */
export async function loadWorkspaceMotion(businessId: string): Promise<SalesMotion | null> {
  const { data, error } = await db()
    .from("business_profiles")
    .select("sales_motions")
    .eq("business_id", businessId)
    .maybeSingle();
  logWriteError({ error }, "opportunities: read motion", { businessId });
  const stored = (data as { sales_motions?: unknown } | null)?.sales_motions;
  if (!Array.isArray(stored)) return null;
  return (
    stored.find((value): value is SalesMotion =>
      (SALES_MOTIONS as readonly string[]).includes(String(value)),
    ) ?? null
  );
}

async function opportunityName(businessId: string, leadId: string): Promise<{ name: string; value: number | null }> {
  const { data } = await db()
    .from("leads")
    .select("first_name, last_name, services(name, average_value)")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  const row = data as {
    first_name: string | null;
    last_name: string | null;
    services: { name: string | null; average_value: number | null } | null;
  } | null;
  const person = [row?.first_name, row?.last_name].filter(Boolean).join(" ") || "New lead";
  const service = row?.services?.name;
  return {
    name: (service ? `${person} - ${service}` : person).slice(0, 200),
    value: row?.services?.average_value ?? null,
  };
}

export type AdvanceEvent = "QUALIFIED" | "MEETING_BOOKED" | "CHECKOUT_SENT";

export type AdvanceResult =
  | { ok: true; opportunityId: string; created: boolean; advanced: boolean; stage: string }
  | { ok: false; skipped: string };

/**
 * Creates or advances the lead's open opportunity for a funnel event.
 * Skipped (not failed) when the workspace's motion has no such stage.
 */
export async function advanceLeadOpportunity(input: {
  businessId: string;
  leadId: string;
  event: AdvanceEvent;
  checkoutLinkId?: string | null;
  /** Correlates the domain events this move emits. */
  causeKey?: string;
}): Promise<AdvanceResult> {
  const motion = await loadWorkspaceMotion(input.businessId);
  // No motion configured: default to the full meeting-led pipeline rather than
  // dropping the opportunity, because "we do not know the motion" is not "no
  // deal exists".
  const stage: OpenStage | null = motion ? stageForEvent(motion, input.event) : input.event;
  if (!stage) return { ok: false, skipped: `motion ${motion} has no ${input.event} stage` };

  const { name, value } = await opportunityName(input.businessId, input.leadId);

  const { data, error } = await db().rpc("ensure_lead_opportunity", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_stage: stage,
    p_close_target: closeTargetForMotion(motion),
    p_motion: motion,
    p_name: name,
    p_value: value,
    p_currency: "GBP",
  });

  if (error || !data) {
    console.error("[opportunities] ensure_lead_opportunity failed", {
      businessId: input.businessId,
      leadId: input.leadId,
      event: input.event,
      code: error?.code,
      message: error?.message,
    });
    return { ok: false, skipped: "write_failed" };
  }

  const result = data as {
    id: string;
    created: boolean;
    advanced: boolean;
    stage: string;
    previous_stage: string | null;
  };

  if (input.checkoutLinkId && result.stage === "CHECKOUT_SENT") {
    logWriteError(
      await db()
        .from("opportunities")
        .update({ checkout_link_id: input.checkoutLinkId })
        .eq("id", result.id)
        .eq("business_id", input.businessId),
      "opportunities: record checkout link",
      { businessId: input.businessId, opportunityId: result.id },
    );
  }

  if (result.created) {
    await emitDomainEvent({
      businessId: input.businessId,
      type: "opportunity.created",
      subject: { type: "opportunity", id: result.id },
      payload: { lead_id: input.leadId, stage: result.stage, motion },
      dedupeKey: `opportunity.created:${result.id}`,
    });
  }

  if (result.advanced) {
    // A new stage is something the CRM should see. Qualification and booking
    // already enqueue a push of their own; the job's idempotency key collapses
    // the two while one is pending.
    await enqueueCrmPushes(input.businessId, input.leadId);
  }

  return {
    ok: true,
    opportunityId: result.id,
    created: result.created,
    advanced: result.advanced,
    stage: result.stage,
  };
}

/**
 * Never lets a funnel side effect fail its caller. Qualification, booking
 * confirmation and the agent's checkout all call this after their own write
 * has already succeeded.
 */
export async function advanceLeadOpportunitySafely(
  input: Parameters<typeof advanceLeadOpportunity>[0],
): Promise<AdvanceResult> {
  try {
    return await advanceLeadOpportunity(input);
  } catch (error) {
    console.error("[opportunities] advance threw", { ...input, error });
    return { ok: false, skipped: "threw" };
  }
}

export type CloseResult = {
  opportunityId: string;
  leadId: string | null;
  outcome: "WON" | "LOST";
  previousStage: string;
  previousOutcome: string;
  leadStatus: string | null;
};

export class OpportunityCloseError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT";
  constructor(code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "OpportunityCloseError";
    this.code = code;
  }
}

/**
 * WON / LOST with a reason. The opportunity and the lead's status move in one
 * transaction (close_opportunity, 0125); the event and the CRM push follow.
 */
export async function closeOpportunity(input: {
  businessId: string;
  opportunityId: string;
  outcome: "WON" | "LOST";
  reason: string;
}): Promise<CloseResult> {
  const { data, error } = await db().rpc("close_opportunity", {
    p_business_id: input.businessId,
    p_opportunity_id: input.opportunityId,
    p_outcome: input.outcome,
    p_reason: input.reason,
  });

  if (error || !data) {
    if (error?.message?.includes("not found")) {
      throw new OpportunityCloseError("NOT_FOUND", "That opportunity could not be found.");
    }
    console.error("[opportunities] close_opportunity failed", {
      businessId: input.businessId,
      opportunityId: input.opportunityId,
      code: error?.code,
      message: error?.message,
    });
    throw new OpportunityCloseError("CONFLICT", "The opportunity could not be closed.");
  }

  const result = data as {
    id: string;
    lead_id: string | null;
    outcome: "WON" | "LOST";
    previous_stage: string;
    previous_outcome: string;
    lead_status: string | null;
  };

  // Re-closing with the same outcome is a correction of the reason, not a new
  // win: the dedupe key keeps the event to one per outcome.
  await emitDomainEvent({
    businessId: input.businessId,
    type: input.outcome === "WON" ? "opportunity.won" : "opportunity.lost",
    subject: { type: "opportunity", id: result.id },
    payload: { lead_id: result.lead_id, reason: input.reason.slice(0, 500) },
    dedupeKey: `opportunity.${input.outcome.toLowerCase()}:${result.id}`,
  });

  if (result.lead_id) await enqueueCrmPushes(input.businessId, result.lead_id);

  return {
    opportunityId: result.id,
    leadId: result.lead_id,
    outcome: result.outcome,
    previousStage: result.previous_stage,
    previousOutcome: result.previous_outcome,
    leadStatus: result.lead_status,
  };
}

/**
 * Closes the lead's open opportunity, creating one first if the lead has
 * none — a lead marked WON by hand before any opportunity existed still gets
 * its deal recorded. Used where lead status is set directly.
 */
export async function closeLeadOpportunity(input: {
  businessId: string;
  leadId: string;
  outcome: "WON" | "LOST";
  reason: string;
}): Promise<CloseResult> {
  const { data: open } = await db()
    .from("opportunities")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .eq("outcome", "OPEN")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let opportunityId = (open as { id: string } | null)?.id ?? null;
  if (!opportunityId) {
    const created = await advanceLeadOpportunity({
      businessId: input.businessId,
      leadId: input.leadId,
      event: "QUALIFIED",
    });
    if (!created.ok) {
      throw new OpportunityCloseError("CONFLICT", "No opportunity could be opened for this lead.");
    }
    opportunityId = created.opportunityId;
  }

  return closeOpportunity({ ...input, opportunityId });
}

/** The most recently updated opportunity for a lead, for CRM pushes and briefs. */
export async function latestLeadOpportunity(
  businessId: string,
  leadId: string,
): Promise<OpportunityRow | null> {
  const { data, error } = await db()
    .from("opportunities")
    .select(OPPORTUNITY_FIELDS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  logWriteError({ error }, "opportunities: read latest", { businessId, leadId });
  return (data as OpportunityRow | null) ?? null;
}

// Re-exported so callers have one import for the opportunity vocabulary.
export { canAdvance };
