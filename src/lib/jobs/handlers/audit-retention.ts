import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { recordAudit } from "@/lib/audit";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  enforceAuditRetention,
  type AuditRetentionDeps,
} from "@/lib/data-rights/audit-retention";

/**
 * The daily `audit.retention` job (docs/CRON.md, internal review IR-09):
 * deletes audit_log rows past each workspace's retention (12 months unless
 * the owner chose otherwise within the plan cap). Rules and batching live in
 * lib/data-rights/audit-retention.ts; this is its database.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export const liveAuditRetentionDeps: AuditRetentionDeps = {
  now: () => new Date(),
  async listWorkspaces(afterId, limit) {
    let query = db().from("businesses").select("id").order("id", { ascending: true }).limit(limit);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new Error(`audit retention: businesses read failed (${error.code})`);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  },
  async listConfiguredMonths() {
    const { data, error } = await db()
      .from("workspace_security_settings")
      .select("business_id, audit_retention_months")
      .limit(50_000);
    if (error) {
      if (isSchemaLag(error)) return null;
      throw new Error(`audit retention: settings read failed (${error.code})`);
    }
    return new Map(
      ((data ?? []) as { business_id: string; audit_retention_months: number }[]).map((row) => [
        row.business_id,
        row.audit_retention_months,
      ]),
    );
  },
  async planOf(businessId) {
    return (await getEntitlements(businessId)).plan;
  },
  async purgeBatch(businessId, before, limit) {
    const { data, error } = await db().rpc("audit_log_purge_batch", {
      p_business_id: businessId,
      p_before: before.toISOString(),
      p_limit: limit,
    });
    if (error) throw new Error(`audit retention: purge failed (${error.code})`);
    return typeof data === "number" ? data : 0;
  },
};

export async function handleAuditRetention() {
  const run = await enforceAuditRetention(liveAuditRetentionDeps);
  if (run.skipped) {
    console.warn("[audit-retention] skipped: migration 0180 not applied");
    return;
  }

  // One summary row per workspace purged, written after the purge so it is
  // the newest entry in that workspace's history.
  for (const entry of run.perWorkspace) {
    await recordAudit({
      businessId: entry.businessId,
      actorType: "system",
      action: "security.audit_log_purged",
      entityType: "business",
      entityId: entry.businessId,
      metadata: { deleted: entry.deleted, retention_months: entry.months },
    });
  }
  if (run.platformDeleted > 0 || run.failures > 0 || run.budgetExhausted) {
    await recordAudit({
      businessId: null,
      actorType: "system",
      action: "security.audit_log_purged",
      metadata: {
        platform_deleted: run.platformDeleted,
        total_deleted: run.deleted,
        workspaces: run.workspacesPurged,
        failures: run.failures,
        budget_exhausted: run.budgetExhausted,
      },
    });
  }
  if (run.failures > 0) {
    // Retry-safe: the next attempt (or tomorrow's run) resumes where this stopped.
    throw new Error(`audit retention: ${run.failures} workspace(s) failed`);
  }
}
