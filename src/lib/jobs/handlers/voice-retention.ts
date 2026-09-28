import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";
import { recordAudit } from "@/lib/audit";
import type { ClaimedJob } from "@/lib/jobs/queue";
import {
  enforceVoiceRetention,
  type RetentionRowKind,
  type VoiceRetentionDeps,
} from "@/lib/data-rights/voice-retention";

/**
 * The daily `voice.retention` job (docs/CRON.md): recordings and transcripts
 * past the workspace's retention, then the R2 objects of every tombstone,
 * including those of deleted workspaces. The rules live in
 * lib/data-rights/voice-retention.ts; this is its database and R2.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const TABLE: Record<RetentionRowKind, { name: string; id: string }> = {
  RECORDING: { name: "voice_call_recordings", id: "id" },
  TRANSCRIPT: { name: "voice_call_transcripts", id: "voice_call_id" },
};

function ids(data: unknown, column: string): string[] {
  return ((data ?? []) as Record<string, string>[]).map((row) => row[column]).filter(Boolean);
}

export const liveVoiceRetentionDeps: VoiceRetentionDeps = {
  now: () => new Date(),
  async listRetention() {
    const { data, error } = await db().from("voice_settings").select("business_id, recording_retention_days").limit(5000);
    if (error) throw new Error(`voice retention: settings read failed (${error.code})`);
    return ((data ?? []) as { business_id: string; recording_retention_days: number }[]).map((row) => ({
      businessId: row.business_id,
      retentionDays: row.recording_retention_days,
    }));
  },
  async dueByRetainUntil(kind, now, limit) {
    const table = TABLE[kind];
    const { data, error } = await db().from(table.name).select(table.id).lte("retain_until", now.toISOString()).limit(limit);
    if (error) throw new Error(`voice retention: ${table.name} read failed (${error.code})`);
    return ids(data, table.id);
  },
  async dueByAge(kind, businessId, cutoff, limit) {
    const table = TABLE[kind];
    const { data, error } = await db()
      .from(table.name)
      .select(table.id)
      .eq("business_id", businessId)
      .lt("created_at", cutoff.toISOString())
      .limit(limit);
    if (error) throw new Error(`voice retention: ${table.name} read failed (${error.code})`);
    return ids(data, table.id);
  },
  async deleteRows(kind, rowIds) {
    const table = TABLE[kind];
    const { data, error } = await db().from(table.name).delete().in(table.id, rowIds).select(table.id);
    if (error) throw new Error(`voice retention: ${table.name} delete failed (${error.code})`);
    return ids(data, table.id).length;
  },
  async pendingTombstones(limit) {
    const { data, error } = await db()
      .from("voice_object_tombstones")
      .select("object_key, business_id, kind")
      .is("purged_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`voice retention: tombstones read failed (${error.code})`);
    return ((data ?? []) as { object_key: string; business_id: string; kind: RetentionRowKind }[]).map((row) => ({
      objectKey: row.object_key,
      businessId: row.business_id,
      kind: row.kind,
    }));
  },
  async markPurged(keys, at) {
    const { error } = await db().from("voice_object_tombstones").update({ purged_at: at.toISOString() }).in("object_key", keys);
    if (error) throw new Error(`voice retention: tombstone update failed (${error.code})`);
  },
  deleteObject: (key) => deleteObject(key),
};

export async function handleVoiceRetention(job: ClaimedJob): Promise<void> {
  void job;
  const run = await enforceVoiceRetention(liveVoiceRetentionDeps);
  for (const [businessId, counts] of Object.entries(run.byWorkspace)) {
    await recordAudit({
      businessId,
      actorType: "system",
      action: "voice.retention_enforced",
      entityType: "business",
      entityId: businessId,
      metadata: { recordings_deleted: counts.recordings, transcripts_deleted: counts.transcripts },
    });
  }
  if (run.recordingsDeleted + run.transcriptsDeleted + run.objectsPurged + run.purgeFailures > 0) {
    console.info("[voice.retention]", run);
  }
}
