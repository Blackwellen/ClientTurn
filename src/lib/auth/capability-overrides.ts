import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAPABILITY_COLUMNS, overridesFromRow, type CapabilityOverrides } from "./capabilities";

/**
 * Reads per-person capability overrides (0172) with the service role, scoped to
 * one workspace. Kept apart from `./permissions.ts` so the service runtime can
 * import it without pulling in the request/session modules.
 */

/** Postgres "undefined column" / PostgREST "column not found". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export class CapabilityReadError extends Error {
  constructor() {
    super("CAPABILITY_UNAVAILABLE");
    this.name = "CapabilityReadError";
  }
}

/**
 * The person's overrides. Before migration 0172 is applied the columns do not
 * exist, and that case returns no overrides, which is exactly the old
 * role-only behaviour. Any other read failure throws, so a check fails closed.
 */
export async function readCapabilityOverrides(
  businessId: string,
  userId: string,
): Promise<CapabilityOverrides> {
  const client = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await client
    .from("business_members")
    .select(CAPABILITY_COLUMNS)
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code && MISSING_COLUMN_CODES.has(error.code)) return {};
    throw new CapabilityReadError();
  }
  return overridesFromRow(data as unknown as Record<string, unknown> | null);
}

/** Every override in a workspace, keyed by membership id (Settings -> Team). */
export async function readWorkspaceOverrides(
  businessId: string,
): Promise<{ available: boolean; byMembership: Map<string, CapabilityOverrides> }> {
  const client = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await client
    .from("business_members")
    .select(`id, ${CAPABILITY_COLUMNS}`)
    .eq("business_id", businessId)
    .neq("status", "removed");

  const byMembership = new Map<string, CapabilityOverrides>();
  if (error) {
    if (error.code && MISSING_COLUMN_CODES.has(error.code)) return { available: false, byMembership };
    throw new CapabilityReadError();
  }
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    byMembership.set(String(row.id), overridesFromRow(row));
  }
  return { available: true, byMembership };
}
