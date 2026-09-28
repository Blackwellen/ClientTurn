import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import { recordAudit } from "@/lib/audit";
import { deleteSubject, SubjectNotFoundError } from "@/lib/data-rights/executor";
import { deleteObject, listObjectKeys } from "@/lib/storage/r2";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import type {
  DeletionSchedule,
  NoticeDay,
  WorkspaceDeletionDeps,
} from "./workspace-deletion";

/**
 * The database, notices, data-rights erasure and R2 behind
 * `runWorkspaceDeletion` (workspace-deletion.ts). Service role throughout:
 * every table here is server-only (0170).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type ScheduleRow = {
  business_id: string;
  ended_at: string;
  notice_day60_sent_at: string | null;
  notice_day83_sent_at: string | null;
  hold: boolean;
  hold_reason: string | null;
  deletion_started_at: string | null;
  deleted_at: string | null;
};

function toSchedule(row: ScheduleRow): DeletionSchedule {
  return {
    businessId: row.business_id,
    endedAt: row.ended_at,
    noticeDay60At: row.notice_day60_sent_at,
    noticeDay83At: row.notice_day83_sent_at,
    hold: row.hold,
    holdReason: row.hold_reason,
    deletionStartedAt: row.deletion_started_at,
    deletedAt: row.deleted_at,
  };
}

/** Thrown when 0170 is not applied: the job then does nothing at all. */
export class DeletionScheduleMissingError extends Error {}

function check(error: { code?: string; message: string } | null, what: string) {
  if (!error) return;
  if (isSchemaMissing(error)) throw new DeletionScheduleMissingError(`${what}: migration 0170 not applied`);
  throw new Error(`workspace deletion: ${what} failed (${error.code ?? error.message})`);
}

async function ownerId(businessId: string): Promise<string | null> {
  const { data } = await db()
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  return (data as { user_id: string } | null)?.user_id ?? null;
}

export const liveWorkspaceDeletionDeps: WorkspaceDeletionDeps = {
  now: () => new Date(),

  async endedSubscriptions() {
    const { data, error } = await db()
      .from("subscriptions")
      .select("business_id, cancelled_at, current_period_end, updated_at")
      .eq("status", "CANCELLED")
      .limit(5000);
    check(error, "subscriptions read");
    return ((data ?? []) as { business_id: string; cancelled_at: string | null; current_period_end: string | null; updated_at: string | null }[])
      .map((row) => ({
        businessId: row.business_id,
        // The same fallback order as cancellation.ts retentionSchedule.
        endedAt: row.cancelled_at ?? row.current_period_end ?? row.updated_at ?? new Date().toISOString(),
      }));
  },

  async schedules() {
    const { data, error } = await db()
      .from("workspace_deletion_schedule")
      .select("business_id, ended_at, notice_day60_sent_at, notice_day83_sent_at, hold, hold_reason, deletion_started_at, deleted_at")
      .is("deleted_at", null)
      .limit(5000);
    check(error, "schedule read");
    return ((data ?? []) as ScheduleRow[]).map(toSchedule);
  },

  async upsertSchedule(businessId, endedAt) {
    // A new end date resets the notices; a hold survives (an admin set it).
    const { error } = await db()
      .from("workspace_deletion_schedule")
      .upsert(
        {
          business_id: businessId,
          ended_at: endedAt,
          notice_day60_sent_at: null,
          notice_day83_sent_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id" },
      );
    check(error, "schedule upsert");
  },

  async dropSchedule(businessId) {
    const { error } = await db()
      .from("workspace_deletion_schedule")
      .delete()
      .eq("business_id", businessId)
      .is("deletion_started_at", null)
      .is("deleted_at", null);
    check(error, "schedule clear");
  },

  async sendNotice(businessId, day, copy, endedAt) {
    const owner = await ownerId(businessId);
    await enqueue(
      "notification.send",
      {
        businessId,
        type: "billing",
        severity: day === 83 ? "error" : "warning",
        title: copy.title,
        body: copy.body,
        linkUrl: "/app/settings?section=billing",
        userId: owner,
      },
      {
        businessId,
        // Idempotent: one notice per workspace, day and end date.
        idempotencyKey: `notification.send:workspace_deletion:${businessId}:${day}:${endedAt.slice(0, 10)}`,
      },
    );
    await recordAudit({
      businessId,
      actorType: "system",
      action: "workspace.deletion_notice_sent",
      entityType: "business",
      entityId: businessId,
      metadata: { day, endedAt },
    });
  },

  async markNotice(businessId, day: NoticeDay, at) {
    const column = day === 60 ? "notice_day60_sent_at" : "notice_day83_sent_at";
    const { error } = await db()
      .from("workspace_deletion_schedule")
      .update({ [column]: at.toISOString(), updated_at: at.toISOString() })
      .eq("business_id", businessId)
      .is(column, null);
    check(error, "notice mark");
  },

  async stillDue(businessId) {
    const [sub, schedule] = await Promise.all([
      db().from("subscriptions").select("status").eq("business_id", businessId).maybeSingle(),
      db().from("workspace_deletion_schedule").select("hold, deleted_at").eq("business_id", businessId).maybeSingle(),
    ]);
    const status = (sub.data as { status: string } | null)?.status;
    const row = schedule.data as { hold: boolean; deleted_at: string | null } | null;
    return status === "CANCELLED" && Boolean(row) && !row!.hold && !row!.deleted_at;
  },

  async markStarted(businessId, at) {
    const { error } = await db()
      .from("workspace_deletion_schedule")
      .update({ deletion_started_at: at.toISOString(), updated_at: at.toISOString() })
      .eq("business_id", businessId)
      .is("deletion_started_at", null);
    check(error, "start mark");
    await recordAudit({
      businessId,
      actorType: "system",
      action: "workspace.deletion_started",
      entityType: "business",
      entityId: businessId,
      metadata: { policy: "day90_after_cancellation" },
    });
  },

  async eraseSubjects(businessId, limit) {
    const actor = {
      businessId,
      requestedBy: null,
      caller: "SYSTEM" as const,
      reason: "Day-90 deletion after cancellation (billing/workspace-deletion.ts)",
    };
    let erased = 0;

    const leads = await db().from("leads").select("id").eq("business_id", businessId).limit(limit);
    for (const row of (leads.data ?? []) as { id: string }[]) {
      try {
        await deleteSubject("LEAD", row.id, actor);
      } catch (error) {
        if (!(error instanceof SubjectNotFoundError)) throw error;
      }
      erased += 1;
    }

    if (erased < limit) {
      const prospects = await db().from("prospects").select("id").eq("business_id", businessId).limit(limit - erased);
      for (const row of (prospects.data ?? []) as { id: string }[]) {
        try {
          await deleteSubject("PROSPECT", row.id, actor);
        } catch (error) {
          if (!(error instanceof SubjectNotFoundError)) throw error;
        }
        erased += 1;
      }
    }

    const [leadCount, prospectCount] = await Promise.all([
      db().from("leads").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      db().from("prospects").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    ]);
    return { erased, remaining: (leadCount.count ?? 0) + (prospectCount.count ?? 0) };
  },

  async tombstonePrefixes(businessId, prefixes) {
    const { error } = await db()
      .from("r2_object_tombstones")
      .upsert(
        prefixes.map((key) => ({ object_key: key, business_id: businessId, kind: "PREFIX", reason: "WORKSPACE_DELETED" })),
        { onConflict: "object_key", ignoreDuplicates: true },
      );
    check(error, "tombstone write");
  },

  async purgeTombstones(businessId) {
    let query = db().from("r2_object_tombstones").select("object_key, kind").is("purged_at", null).limit(200);
    if (businessId) query = query.eq("business_id", businessId);
    const { data, error } = await query;
    check(error, "tombstone read");

    let purged = 0;
    let failures = 0;
    for (const row of (data ?? []) as { object_key: string; kind: "OBJECT" | "PREFIX" }[]) {
      try {
        const keys = row.kind === "PREFIX" ? await listObjectKeys(row.object_key, 1000) : [row.object_key];
        for (const key of keys) await deleteObject(key);
        // A prefix with more than 1000 objects stays pending for the next run.
        if (row.kind === "PREFIX" && keys.length >= 1000) continue;
        await db().from("r2_object_tombstones").update({ purged_at: new Date().toISOString() }).eq("object_key", row.object_key);
        purged += keys.length;
      } catch (purgeError) {
        failures += 1;
        console.error("[workspace-deletion] R2 purge failed", {
          key: row.object_key,
          message: purgeError instanceof Error ? purgeError.message : String(purgeError),
        });
      }
    }
    return { purged, failures };
  },

  async closeWorkspace(businessId) {
    const { error } = await db().rpc("workspace_close_after_retention", { p_business_id: businessId });
    check(error, "workspace close");
  },

  async markDeleted(businessId, at, result) {
    const { error } = await db()
      .from("workspace_deletion_schedule")
      .update({ deleted_at: at.toISOString(), last_run_at: at.toISOString(), last_result: result, updated_at: at.toISOString() })
      .eq("business_id", businessId);
    check(error, "deleted mark");
    await recordAudit({
      businessId,
      actorType: "system",
      action: "workspace.deleted_after_retention",
      entityType: "business",
      entityId: businessId,
      metadata: result,
    });
  },

  async recordRun(businessId, at, result) {
    await db()
      .from("workspace_deletion_schedule")
      .update({ last_run_at: at.toISOString(), last_result: result, updated_at: at.toISOString() })
      .eq("business_id", businessId);
  },
};
