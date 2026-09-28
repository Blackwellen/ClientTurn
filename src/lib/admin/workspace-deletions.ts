import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import {
  daysSince,
  decide,
  deletionDueAt,
  type DeletionSchedule,
} from "@/lib/billing/workspace-deletion";
import type { AdminDeletionRow } from "./workspace-deletions-types";

export type { AdminDeletionRow } from "./workspace-deletions-types";

/**
 * Admin -> Billing -> Scheduled deletions: every cancelled workspace on the
 * day-90 schedule, what the daily job would do today (the same `decide` the
 * job runs, so the view is the dry run), and its hold. Read-only.
 */
export async function listScheduledDeletions(now: Date = new Date()): Promise<{
  available: boolean;
  enabled: boolean;
  rows: AdminDeletionRow[];
}> {
  const db = createAdminClient() as unknown as SupabaseClient;
  const enabled = process.env.WORKSPACE_DELETION_ENABLED === "true";
  const { data, error } = await db
    .from("workspace_deletion_schedule")
    .select("business_id, ended_at, notice_day60_sent_at, notice_day83_sent_at, hold, hold_reason, held_at, deletion_started_at, deleted_at, last_result, businesses ( name )")
    .order("ended_at", { ascending: true })
    .limit(500);

  if (error) {
    if (!isSchemaMissing(error)) console.error("[admin] deletion schedule read failed", error.message);
    return { available: false, enabled, rows: [] };
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const schedule: DeletionSchedule = {
      businessId: String(row.business_id),
      endedAt: String(row.ended_at),
      noticeDay60At: (row.notice_day60_sent_at as string | null) ?? null,
      noticeDay83At: (row.notice_day83_sent_at as string | null) ?? null,
      hold: Boolean(row.hold),
      holdReason: (row.hold_reason as string | null) ?? null,
      deletionStartedAt: (row.deletion_started_at as string | null) ?? null,
      deletedAt: (row.deleted_at as string | null) ?? null,
    };
    const decision = decide(schedule, now);
    return {
      businessId: schedule.businessId,
      businessName: (row.businesses as { name?: string } | null)?.name ?? "Workspace",
      endedAt: schedule.endedAt,
      day: daysSince(schedule.endedAt, now),
      deleteOn: deletionDueAt(schedule).toISOString(),
      noticeDay60At: schedule.noticeDay60At,
      noticeDay83At: schedule.noticeDay83At,
      hold: schedule.hold,
      holdReason: schedule.holdReason,
      deletionStartedAt: schedule.deletionStartedAt,
      deletedAt: schedule.deletedAt,
      today:
        decision.kind === "skip"
          ? decision.reason === "held" ? "Held" : decision.reason === "deleted" ? "Deleted" : "Read-only"
          : decision.kind === "notice" ? `Day-${decision.day} notice`
          : decision.kind === "wait_after_notice" ? "Waiting 7 days after the final notice"
          : "Delete",
    } satisfies AdminDeletionRow;
  });

  return { available: true, enabled, rows };
}
