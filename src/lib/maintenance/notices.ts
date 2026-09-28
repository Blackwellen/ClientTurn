import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { MAINTENANCE_NOTICE_KIND, maintenanceNoticeJobKey } from "./email";

/**
 * Queues "Email workspace owners about this maintenance": one
 * `notification.send` job per workspace, each emailing that workspace's
 * owner(s) (email.ts has the idempotency story).
 *
 * The claim comes first: `notice_queued_at` is set with a conditional update
 * that matches only while it is still null, and only the caller whose update
 * matched queues anything. A second click, a retried action or two operators
 * at once therefore queue the emails exactly once per window.
 */

const PAGE = 1000;

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export async function queueMaintenanceNotices(windowId: string): Promise<{
  status: "queued" | "already" | "not_eligible" | "unavailable";
  queued: number;
}> {
  const client = db();
  const nowIso = new Date().toISOString();

  const { data: claimed, error: claimError } = await client
    .from("platform_maintenance_windows")
    .update({ notice_queued_at: nowIso })
    .eq("id", windowId)
    .eq("notify_owners", true)
    .is("notice_queued_at", null)
    .is("cancelled_at", null)
    .is("ended_at", null)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .select("id")
    .maybeSingle();

  if (claimError) return { status: "unavailable", queued: 0 };
  if (!claimed) {
    const { data: row } = await client
      .from("platform_maintenance_windows")
      .select("notice_queued_at")
      .eq("id", windowId)
      .maybeSingle();
    return { status: row?.notice_queued_at ? "already" : "not_eligible", queued: 0 };
  }

  // Every workspace with an active owner, once.
  const businessIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("business_members")
      .select("business_id")
      .eq("role", "owner")
      .eq("status", "active")
      .order("business_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    for (const row of data ?? []) businessIds.add(row.business_id as string);
    if (!data || data.length < PAGE) break;
  }

  let queued = 0;
  const ids = [...businessIds];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = chunk.map((businessId) => ({
      type: "notification.send",
      payload: { businessId, kind: MAINTENANCE_NOTICE_KIND, entityId: windowId },
      business_id: businessId,
      run_at: nowIso,
      priority: 120,
      max_attempts: 5,
      idempotency_key: maintenanceNoticeJobKey(windowId, businessId),
    }));
    const { error } = await client.from("jobs").insert(rows);
    if (!error) {
      queued += chunk.length;
      continue;
    }
    // A duplicate key anywhere fails the whole batch; fall back to one at a
    // time, where enqueue() treats a duplicate as "already queued".
    for (const businessId of chunk) {
      try {
        const id = await enqueue(
          "notification.send",
          { businessId, kind: MAINTENANCE_NOTICE_KIND, entityId: windowId },
          { businessId, priority: 120, idempotencyKey: maintenanceNoticeJobKey(windowId, businessId) },
        );
        if (id) queued += 1;
      } catch (enqueueError) {
        console.error("[maintenance] notice enqueue failed", { businessId, enqueueError });
      }
    }
  }

  return { status: "queued", queued };
}
