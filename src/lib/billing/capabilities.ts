import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "./entitlements";
import {
  CAPABILITIES,
  resolveCapabilities,
  type Capability,
  type CapabilityDecision,
  type CapabilityGrantRow,
  type PlanCapabilityRow,
} from "./capability-rules";

export {
  CAPABILITIES,
  CAPABILITY_LABEL,
  type Capability,
  type CapabilityDecision,
} from "./capability-rules";

/**
 * `can(businessId, capability)`: the one server-side capability check (gap
 * map §60). Reads the workspace's plan and subscription state
 * (`getEntitlements`), the plan's `plan_entitlements` rows and the
 * workspace's live `business_entitlement_grants`, and resolves them with the
 * pure rules in `capability-rules.ts`.
 *
 * Quote, e-signature, invoicing and voice gates call only this. The UI may
 * read the same decision to show a locked state, but the enforcement is the
 * server call inside each operation.
 *
 * Cached per request: a page that asks about five capabilities reads the
 * rows once.
 */
export const capabilitiesFor = cache(async (businessId: string): Promise<Record<Capability, CapabilityDecision>> => {
  const entitlements = await getEntitlements(businessId);
  const admin = createAdminClient();
  const [planRows, grantRows] = await Promise.all([
    admin
      .from("plan_entitlements")
      .select("metric, hard_limit")
      .eq("plan_key", entitlements.plan)
      .in("metric", [...CAPABILITIES]),
    admin
      .from("business_entitlement_grants")
      .select("entitlement_key, numeric_value, boolean_value, expires_at, revoked_at")
      .eq("business_id", businessId)
      .in("entitlement_key", [...CAPABILITIES])
      .is("revoked_at", null),
  ]);
  if (planRows.error) throw new Error(`Could not read plan capabilities: ${planRows.error.message}`);
  if (grantRows.error) throw new Error(`Could not read capability grants: ${grantRows.error.message}`);

  const decisions = resolveCapabilities({
    plan: entitlements.plan,
    active: entitlements.active,
    planRows: (planRows.data ?? []) as PlanCapabilityRow[],
    grants: (grantRows.data ?? []) as CapabilityGrantRow[],
    now: new Date(),
  });
  // AI quote drafting also follows the existing AI-assistant entitlement.
  // (The workspace's own AI toggle is checked by the agent runtime.)
  if (decisions.quote_ai_enabled.allowed && !entitlements.aiAssistAllowed) {
    decisions.quote_ai_enabled = {
      ...decisions.quote_ai_enabled,
      allowed: false,
      reason: "NOT_IN_PLAN",
      message: "AI assist is not included on this plan, so the assistant cannot draft quotes.",
    };
  }
  return decisions;
});

export async function can(businessId: string, capability: Capability): Promise<CapabilityDecision> {
  const all = await capabilitiesFor(businessId);
  return all[capability];
}

export class CapabilityError extends Error {
  readonly decision: CapabilityDecision;
  constructor(decision: CapabilityDecision) {
    super(decision.message ?? "This feature is not available on your plan.");
    this.name = "CapabilityError";
    this.decision = decision;
  }
}

/** Throws a CapabilityError when the capability is not allowed. */
export async function assertCan(businessId: string, capability: Capability): Promise<CapabilityDecision> {
  const decision = await can(businessId, capability);
  if (!decision.allowed) throw new CapabilityError(decision);
  return decision;
}
