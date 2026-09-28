import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "./entitlements";
import { getV4Entitlements } from "./v4-entitlements";
import { allowancesFor } from "./plans";
import { overLimitReport, type CountLimits, type CountUsage, type OverLimitItem } from "./allowance-gates";

/**
 * Reads for the downgrade-over-limit rule (allowance-gates.ts): what the
 * workspace holds now, against its current plan or a plan it is moving to.
 * Read-only; the enforcement lives at each creation point.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error(`over-limit count failed: ${error.message}`);
  return n ?? 0;
}

export async function countUsage(businessId: string): Promise<CountUsage> {
  const client = db();
  const [seats, senderIdentities, savedSearches, intentMonitors] = await Promise.all([
    count(client.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("status", ["active", "invited"])),
    count(client.from("sender_identities").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true)),
    count(client.from("recurring_searches").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "ACTIVE")),
    count(client.from("intent_monitors").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "ACTIVE")),
  ]);
  return { seats, senderIdentities, savedSearches, intentMonitors };
}

/** Over-limit items against the plan the workspace is on now (grants included). */
export async function overLimitNow(businessId: string): Promise<OverLimitItem[]> {
  const [entitlements, v4, usage] = await Promise.all([getEntitlements(businessId), getV4Entitlements(businessId), countUsage(businessId)]);
  // A trial or an ended workspace is governed by its lifecycle, not by this.
  if (entitlements.state === "TRIALING" || entitlements.access === "read_only") return [];
  const limits: CountLimits = {
    seats: entitlements.userLimit,
    senderIdentities: v4.allowances.sender_identity.hardLimit,
    savedSearches: v4.allowances.saved_search.hardLimit,
    intentMonitors: v4.allowances.intent_monitor.hardLimit,
  };
  return overLimitReport(usage, limits);
}

/** Over-limit items against a plan the workspace is moving to (the downgrade pre-check). */
export async function overLimitForPlan(businessId: string, plan: string): Promise<OverLimitItem[]> {
  const [usage, rows] = await Promise.all([
    countUsage(businessId),
    db()
      .from("plan_entitlements")
      .select("metric, hard_limit")
      .eq("plan_key", plan)
      .in("metric", ["sender_identity", "saved_search", "intent_monitor"]),
  ]);
  if (rows.error) throw new Error(`plan limits read failed: ${rows.error.message}`);
  const hard = new Map(((rows.data ?? []) as { metric: string; hard_limit: number | string | null }[]).map((r) => [r.metric, Number(r.hard_limit ?? 0)]));
  const limits: CountLimits = {
    seats: allowancesFor(plan).userLimit,
    senderIdentities: hard.get("sender_identity") ?? 0,
    savedSearches: hard.get("saved_search") ?? 0,
    intentMonitors: hard.get("intent_monitor") ?? 0,
  };
  return overLimitReport(usage, limits);
}
