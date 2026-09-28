import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import { getEntitlements, getPeriodUsage } from "./entitlements";
import { leadCapMessage, startWorkGate, type LeadCapDecision } from "./lead-cap";

/**
 * Server half of the lead cap (lead-cap.ts). One read of "how many leads has
 * this workspace started working this period, out of how many, and may it do
 * billable work at all", and one idempotent meter.
 *
 * A failed read throws: "unknown" must never read as "room left".
 */

export type LeadCapacity = { active: boolean; used: number; limit: number };

export async function leadCapacity(businessId: string): Promise<LeadCapacity> {
  const entitlements = await getEntitlements(businessId);
  const usage = await getPeriodUsage(businessId, entitlements.periodStart);
  return { active: entitlements.active, used: usage.leads, limit: entitlements.leadLimit };
}

/** Whether this lead has already been counted (the lead.process key, `lead:<id>`). */
export async function leadAlreadyMetered(businessId: string, leadId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("usage_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("metric", "lead_processed")
    .eq("source", `lead:${leadId}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read lead usage: ${error.message}`);
  return Boolean(data);
}

export type MeterOutcome = { ok: true; metered: boolean } | { ok: false; decision: Exclude<LeadCapDecision, { allowed: true }>; message: string };

/**
 * Starting work on an existing record (a promoted prospect, a lead whose
 * follow-up is resumed): refused at the cap, otherwise counted once. The
 * usage key is the same one lead.process writes, so a lead is never counted
 * twice whichever path gets there first.
 */
export async function meterLeadIfNeeded(businessId: string, leadId: string): Promise<MeterOutcome> {
  if (await leadAlreadyMetered(businessId, leadId)) return { ok: true, metered: false };
  const capacity = await leadCapacity(businessId);
  const decision = startWorkGate({ alreadyMetered: false, ...capacity });
  if (!decision.allowed) return { ok: false, decision, message: leadCapMessage(decision.reason, capacity.limit) };
  await recordUsage({
    businessId,
    metric: "lead_processed",
    source: `lead:${leadId}`,
    // A retry of the same start is charged once (unique operation id).
    operationId: `lead_processed:start:${leadId}`,
    metadata: { via: "start_work" },
  });
  return { ok: true, metered: true };
}
