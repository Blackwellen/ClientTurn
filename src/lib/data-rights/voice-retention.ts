/**
 * Voice recording and transcript retention (gap map §53 retention rows,
 * §56 "Retention: recordings and transcripts past retention").
 *
 * The daily `voice.retention` job runs `enforceVoiceRetention`:
 *
 *   1. **Expire rows.** Every `voice_call_recordings` and
 *      `voice_call_transcripts` row past its `retain_until`, and, per
 *      workspace, every row older than the workspace's CURRENT
 *      `recording_retention_days` (so shortening retention in Settings ->
 *      Voice takes effect on what is already stored), is deleted. The 0150
 *      `voice_tombstone_object` trigger writes a tombstone for each stored
 *      object in the same statement.
 *   2. **Purge objects.** Every tombstone not yet purged has its R2 object
 *      deleted, then is marked `purged_at`. Tombstones have no foreign key to
 *      the workspace on purpose: deleting a workspace cascades its recording
 *      and transcript rows, the trigger tombstones their objects, and this
 *      step removes them from R2 -- nothing is orphaned.
 *
 * Idempotent: deleting a row that is already gone deletes nothing, S3/R2
 * treats deleting a missing key as success, and a tombstone whose delete
 * failed stays unpurged for the next run. Bounded per run (`limits`), so a
 * backlog drains over several days rather than timing out.
 *
 * Pure: the database and R2 are `VoiceRetentionDeps`, so the whole job is
 * tested with an in-memory store and a fake R2 (tests/voice-retention.test.ts).
 */

export const DEFAULT_RECORDING_RETENTION_DAYS = 90;

export type RetentionRowKind = "RECORDING" | "TRANSCRIPT";

export type VoiceRetentionDeps = {
  now(): Date;
  /** Workspaces with voice settings, and their current retention in days. */
  listRetention(): Promise<{ businessId: string; retentionDays: number }[]>;
  /** Up to `limit` row ids of this kind with retain_until <= now (any workspace). */
  dueByRetainUntil(kind: RetentionRowKind, now: Date, limit: number): Promise<string[]>;
  /** Up to `limit` row ids of this kind in a workspace created before `cutoff`. */
  dueByAge(kind: RetentionRowKind, businessId: string, cutoff: Date, limit: number): Promise<string[]>;
  /** Deletes the rows (the database writes the tombstones). Returns how many went. */
  deleteRows(kind: RetentionRowKind, ids: string[]): Promise<number>;
  pendingTombstones(limit: number): Promise<{ objectKey: string; businessId: string; kind: RetentionRowKind }[]>;
  markPurged(objectKeys: string[], at: Date): Promise<void>;
  /** Deletes one object from R2. Deleting a missing key must succeed. */
  deleteObject(objectKey: string): Promise<void>;
};

export type VoiceRetentionLimits = { rowsPerKind: number; tombstones: number };
export const DEFAULT_LIMITS: VoiceRetentionLimits = { rowsPerKind: 500, tombstones: 500 };

export type VoiceRetentionRun = {
  recordingsDeleted: number;
  transcriptsDeleted: number;
  objectsPurged: number;
  purgeFailures: number;
  /** Per workspace, what the age pass removed (for the audit row). */
  byWorkspace: Record<string, { recordings: number; transcripts: number }>;
};

/** The object keys a retention run may touch: the two 0150 prefixes only. */
export function isVoiceObjectKey(key: string): boolean {
  return /^voice\/(recordings|transcripts)\/[0-9a-f-]{36}\//.test(key);
}

export function retentionCutoff(now: Date, retentionDays: number): Date {
  const days = Number.isFinite(retentionDays) && retentionDays >= 1 ? Math.min(365, Math.floor(retentionDays)) : DEFAULT_RECORDING_RETENTION_DAYS;
  return new Date(now.getTime() - days * 86_400_000);
}

const KINDS: readonly RetentionRowKind[] = ["RECORDING", "TRANSCRIPT"];

export async function enforceVoiceRetention(
  deps: VoiceRetentionDeps,
  limits: VoiceRetentionLimits = DEFAULT_LIMITS,
): Promise<VoiceRetentionRun> {
  const now = deps.now();
  const run: VoiceRetentionRun = { recordingsDeleted: 0, transcriptsDeleted: 0, objectsPurged: 0, purgeFailures: 0, byWorkspace: {} };
  const add = (kind: RetentionRowKind, count: number) => {
    if (kind === "RECORDING") run.recordingsDeleted += count;
    else run.transcriptsDeleted += count;
  };

  // 1a. Rows whose own retain_until has passed.
  for (const kind of KINDS) {
    const ids = await deps.dueByRetainUntil(kind, now, limits.rowsPerKind);
    if (ids.length > 0) add(kind, await deps.deleteRows(kind, ids));
  }

  // 1b. Rows older than the workspace's current retention.
  for (const { businessId, retentionDays } of await deps.listRetention()) {
    const cutoff = retentionCutoff(now, retentionDays);
    for (const kind of KINDS) {
      const ids = await deps.dueByAge(kind, businessId, cutoff, limits.rowsPerKind);
      if (ids.length === 0) continue;
      const count = await deps.deleteRows(kind, ids);
      add(kind, count);
      const entry = (run.byWorkspace[businessId] ??= { recordings: 0, transcripts: 0 });
      if (kind === "RECORDING") entry.recordings += count;
      else entry.transcripts += count;
    }
  }

  // 2. Purge tombstoned objects: this run's, earlier failures, deleted workspaces'.
  const pending = await deps.pendingTombstones(limits.tombstones);
  const purged: string[] = [];
  for (const tombstone of pending) {
    if (!isVoiceObjectKey(tombstone.objectKey)) {
      // Never delete outside the voice prefixes, whatever a row says.
      run.purgeFailures += 1;
      continue;
    }
    try {
      await deps.deleteObject(tombstone.objectKey);
      purged.push(tombstone.objectKey);
    } catch {
      run.purgeFailures += 1;
    }
  }
  if (purged.length > 0) {
    await deps.markPurged(purged, now);
    run.objectsPurged = purged.length;
  }
  return run;
}
