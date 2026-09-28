import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import {
  LEASE_SECONDS,
  leadCommercialLockId,
  type CommercialActionKind,
  type LeaseHolder,
} from "./locks";

/**
 * Claims one commercial action on a lead (brief §73; locks.ts): the lead's
 * advisory lock (shared with the voice dial), the one-actor lease, and the
 * action's idempotency key, in one transaction (`claim_commercial_action`,
 * migration 0160).
 *
 *   { ok: true, duplicate: false }  go ahead
 *   { ok: true, duplicate: true }   this exact action was already claimed: the
 *                                   caller returns the existing result
 *   { ok: false, heldBy }           another kind of actor is working the lead
 *
 * Before 0160 is applied the RPC is missing: `degraded: true` and the caller
 * relies on the per-row idempotency keys (a duplicate quote, send or approval
 * request is still impossible; only the cross-actor lease is not enforced).
 */
export type CommercialClaim =
  | { ok: true; duplicate: boolean; degraded?: true }
  | { ok: false; reason: "HELD" | "NOT_FOUND"; heldBy: LeaseHolder | null; until: string | null };

export async function claimCommercialAction(input: {
  businessId: string;
  leadId: string;
  holder: LeaseHolder;
  holderRef?: string | null;
  kind: CommercialActionKind;
  actionKey: string;
}): Promise<CommercialClaim> {
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await db.rpc("claim_commercial_action", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_lead_lock_id: leadCommercialLockId(input.businessId, input.leadId),
    p_holder_kind: input.holder,
    p_holder_ref: input.holderRef ?? null,
    p_action_kind: input.kind,
    p_action_key: input.actionKey.slice(0, 200),
    p_lease_seconds: LEASE_SECONDS[input.holder],
  });
  if (error) {
    if (isSchemaLag(error)) {
      return { ok: true, duplicate: false, degraded: true };
    }
    throw new Error(`claim_commercial_action failed: ${error.message}`);
  }
  const result = (data ?? {}) as { ok?: boolean; duplicate?: boolean; reason?: string; held_by?: LeaseHolder; until?: string };
  if (result.ok) return { ok: true, duplicate: result.duplicate === true };
  return {
    ok: false,
    reason: result.reason === "NOT_FOUND" ? "NOT_FOUND" : "HELD",
    heldBy: result.held_by ?? null,
    until: result.until ?? null,
  };
}

/** Lets go of a lease early. Never throws: an unreleased lease simply expires. */
export async function releaseCommercialLease(input: { businessId: string; leadId: string; holder: LeaseHolder }): Promise<void> {
  try {
    const db = createAdminClient() as unknown as SupabaseClient;
    await db.rpc("release_commercial_lease", {
      p_business_id: input.businessId,
      p_lead_id: input.leadId,
      p_holder_kind: input.holder,
    });
  } catch {
    // The lease expires on its own.
  }
}
