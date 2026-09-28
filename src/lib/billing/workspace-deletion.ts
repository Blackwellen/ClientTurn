/**
 * Day-90 deletion of a cancelled workspace (docs/BILLING.md §3; the gap that
 * section recorded). Pure: the database, notices, erasure and R2 are
 * `WorkspaceDeletionDeps`, so the whole job is tested with fakes
 * (tests/workspace-deletion.test.ts). The live deps are in
 * `workspace-deletion-live.ts`; the daily job is `billing.workspace_deletion`.
 *
 * ## Timeline (from the day the subscription ended)
 *
 * - **Day 0-89**: read-only (billing/cancellation.ts). Resubscribing restores
 *   everything and clears the schedule.
 * - **Day 60**: first notice to the owner: "deleted on <date>, export now".
 * - **Day 83**: final notice, 7 days before.
 * - **Day 90 or later**: deletion, but never sooner than 7 days after the
 *   final notice was actually sent (a job that was down on day 83 must not
 *   delete on the day it finally warns). A workspace ON HOLD (a dispute or a
 *   legal hold, set by an admin) is never notified or deleted while held.
 *
 * ## Deletion (retry-safe, bounded, re-checked before every step)
 *
 * 1. Re-read: still cancelled, not resubscribed, not held, not deleted.
 * 2. Every lead, then every remaining prospect, goes through the existing
 *    data-rights path (`data_rights_delete`): anonymised, hard-deleted, with
 *    the pseudonymous records it retains (audit, usage, billing links,
 *    suppression). Bounded per run; a large workspace finishes over several
 *    runs. Voice recordings and transcripts cascade with their lead and are
 *    tombstoned by 0150's trigger; `voice.retention` purges them.
 * 3. R2: one PREFIX tombstone per tenant prefix (logo/, import/, support/,
 *    quotes/), then the objects under each are deleted. A failed purge stays
 *    unpurged for the next run.
 * 4. `workspace_close_after_retention`: members, credentials and connections
 *    removed; the business row anonymised and marked deleted. Billing, dispute
 *    and suppression rows are kept (6 years / minimised).
 *
 * **Dry run** computes and reports the same plan and writes nothing: no
 * schedule rows, no notices, no erasure.
 */

export const DAY_MS = 86_400_000;
export const DELETE_AFTER_DAYS = 90;
export const FIRST_NOTICE_DAY = 60;
export const FINAL_NOTICE_DAY = 83;
/** The final notice must precede deletion by at least this many days. */
export const FINAL_NOTICE_LEAD_DAYS = 7;
/** Leads + prospects erased per workspace per run. */
export const DEFAULT_SUBJECTS_PER_RUN = 400;

/** The tenant prefixes R2 keys live under (storage/r2.ts `objectKey`, quotes). */
export const R2_TENANT_PREFIXES = ["logo", "import", "support", "quotes"] as const;

export type NoticeDay = typeof FIRST_NOTICE_DAY | typeof FINAL_NOTICE_DAY;

export type DeletionSchedule = {
  businessId: string;
  endedAt: string;
  noticeDay60At: string | null;
  noticeDay83At: string | null;
  hold: boolean;
  holdReason: string | null;
  deletionStartedAt: string | null;
  deletedAt: string | null;
};

export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

/** When the data will be deleted (the date the notices state). */
export function deletionDueAt(schedule: Pick<DeletionSchedule, "endedAt" | "noticeDay83At">): Date {
  const byPolicy = new Date(new Date(schedule.endedAt).getTime() + DELETE_AFTER_DAYS * DAY_MS);
  if (!schedule.noticeDay83At) return byPolicy;
  const byNotice = new Date(new Date(schedule.noticeDay83At).getTime() + FINAL_NOTICE_LEAD_DAYS * DAY_MS);
  return byNotice > byPolicy ? byNotice : byPolicy;
}

export function tenantPrefixes(businessId: string): string[] {
  return R2_TENANT_PREFIXES.map((prefix) => `${prefix}/${businessId}/`);
}

export type DeletionDecision =
  | { kind: "skip"; reason: "deleted" | "held" | "read_only" }
  | { kind: "notice"; day: NoticeDay; deleteOn: Date }
  | { kind: "wait_after_notice"; deleteOn: Date }
  | { kind: "delete" };

/**
 * What one workspace needs today. At most one notice a day: a workspace
 * first seen after day 83 gets only the final notice (the day-60 one is
 * stale by then), and deletion waits 7 days from it.
 */
export function decide(schedule: DeletionSchedule, now: Date): DeletionDecision {
  if (schedule.deletedAt) return { kind: "skip", reason: "deleted" };
  if (schedule.hold) return { kind: "skip", reason: "held" };
  const day = daysSince(schedule.endedAt, now);

  if (day >= FINAL_NOTICE_DAY && !schedule.noticeDay83At) {
    const deleteOn = deletionDueAt({ endedAt: schedule.endedAt, noticeDay83At: now.toISOString() });
    return { kind: "notice", day: FINAL_NOTICE_DAY, deleteOn };
  }
  if (day >= FIRST_NOTICE_DAY && day < FINAL_NOTICE_DAY && !schedule.noticeDay60At) {
    return { kind: "notice", day: FIRST_NOTICE_DAY, deleteOn: deletionDueAt(schedule) };
  }
  if (day < DELETE_AFTER_DAYS) return { kind: "skip", reason: "read_only" };
  const due = deletionDueAt(schedule);
  if (now < due) return { kind: "wait_after_notice", deleteOn: due };
  return { kind: "delete" };
}

/** The owner's notice. States the date, what goes, what stays and how to stop it. */
export function noticeCopy(day: NoticeDay, deleteOn: Date): { title: string; body: string } {
  const date = deleteOn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const when = day === FINAL_NOTICE_DAY ? "in 7 days" : "in 30 days";
  return {
    title: `Your ClientTurn workspace will be deleted on ${date}`,
    body:
      `Your subscription ended, so your workspace has been read-only. It will be deleted ${when}, on ${date}: ` +
      `leads, messages, recordings, files and settings. Export anything you need from Settings before then, ` +
      `or resubscribe to keep everything as it is. Billing and tax records, and minimal opt-out records, are kept as the privacy policy sets out.`,
  };
}

/* ------------------------------------------------------------ the run -- */

export type EndedSubscription = { businessId: string; endedAt: string };

export type WorkspaceDeletionDeps = {
  now(): Date;
  /** Subscriptions currently CANCELLED, with when they ended. */
  endedSubscriptions(): Promise<EndedSubscription[]>;
  /** Every schedule row not yet deleted. */
  schedules(): Promise<DeletionSchedule[]>;
  /** New schedule, or a new end date (a re-cancellation) that resets the notices. */
  upsertSchedule(businessId: string, endedAt: string): Promise<void>;
  /** The workspace resubscribed: its schedule is cleared. */
  dropSchedule(businessId: string): Promise<void>;
  /** Idempotent: keyed on workspace, day and end date. */
  sendNotice(businessId: string, day: NoticeDay, copy: { title: string; body: string }, endedAt: string): Promise<void>;
  markNotice(businessId: string, day: NoticeDay, at: Date): Promise<void>;
  /** Re-read immediately before erasing: cancelled, not held, not deleted. */
  stillDue(businessId: string): Promise<boolean>;
  markStarted(businessId: string, at: Date): Promise<void>;
  /** Erases up to `limit` subjects through data_rights_delete. */
  eraseSubjects(businessId: string, limit: number): Promise<{ erased: number; remaining: number }>;
  /** Writes PREFIX tombstones (idempotent). */
  tombstonePrefixes(businessId: string, prefixes: string[]): Promise<void>;
  /**
   * Deletes the objects under unpurged tombstones: this workspace's, or with
   * null every workspace's (the end-of-run retry of earlier failures).
   */
  purgeTombstones(businessId: string | null): Promise<{ purged: number; failures: number }>;
  closeWorkspace(businessId: string): Promise<void>;
  markDeleted(businessId: string, at: Date, result: Record<string, unknown>): Promise<void>;
  recordRun(businessId: string, at: Date, result: Record<string, unknown>): Promise<void>;
};

export type WorkspacePlan = {
  businessId: string;
  endedAt: string;
  day: number;
  decision: DeletionDecision["kind"];
  detail: string;
  deleteOn: string | null;
};

export type DeletionRunReport = {
  dryRun: boolean;
  scheduled: number;
  cleared: number;
  notices: number;
  deleted: number;
  inProgress: number;
  held: number;
  plans: WorkspacePlan[];
};

export async function runWorkspaceDeletion(
  deps: WorkspaceDeletionDeps,
  options: { dryRun?: boolean; subjectsPerRun?: number } = {},
): Promise<DeletionRunReport> {
  const dryRun = Boolean(options.dryRun);
  const now = deps.now();
  const report: DeletionRunReport = { dryRun, scheduled: 0, cleared: 0, notices: 0, deleted: 0, inProgress: 0, held: 0, plans: [] };

  // 1. Sync the schedule with the subscriptions.
  const ended = await deps.endedSubscriptions();
  const existing = await deps.schedules();
  const byBusiness = new Map(existing.map((row) => [row.businessId, row]));
  const endedIds = new Set(ended.map((row) => row.businessId));

  const current: DeletionSchedule[] = [];
  for (const sub of ended) {
    const row = byBusiness.get(sub.businessId);
    if (!row || new Date(row.endedAt).getTime() !== new Date(sub.endedAt).getTime()) {
      if (!dryRun) await deps.upsertSchedule(sub.businessId, sub.endedAt);
      report.scheduled += 1;
      current.push({
        businessId: sub.businessId,
        endedAt: sub.endedAt,
        noticeDay60At: null,
        noticeDay83At: null,
        hold: row?.hold ?? false,
        holdReason: row?.holdReason ?? null,
        deletionStartedAt: null,
        deletedAt: null,
      });
    } else {
      current.push(row);
    }
  }
  for (const row of existing) {
    // Resubscribed (no longer CANCELLED) before deletion began: clear it.
    if (!endedIds.has(row.businessId) && !row.deletedAt && !row.deletionStartedAt) {
      if (!dryRun) await deps.dropSchedule(row.businessId);
      report.cleared += 1;
    }
  }

  // 2. Notices and deletions.
  for (const schedule of current) {
    const decision = decide(schedule, now);
    const plan: WorkspacePlan = {
      businessId: schedule.businessId,
      endedAt: schedule.endedAt,
      day: daysSince(schedule.endedAt, now),
      decision: decision.kind,
      detail: decision.kind === "skip" ? decision.reason : decision.kind === "notice" ? `day ${decision.day} notice` : decision.kind,
      deleteOn: decision.kind === "notice" || decision.kind === "wait_after_notice" ? decision.deleteOn.toISOString() : deletionDueAt(schedule).toISOString(),
    };
    report.plans.push(plan);

    if (decision.kind === "skip") {
      if (decision.reason === "held") report.held += 1;
      continue;
    }
    if (decision.kind === "wait_after_notice") continue;

    if (decision.kind === "notice") {
      report.notices += 1;
      if (dryRun) continue;
      await deps.sendNotice(schedule.businessId, decision.day, noticeCopy(decision.day, decision.deleteOn), schedule.endedAt);
      await deps.markNotice(schedule.businessId, decision.day, now);
      if (decision.day === FINAL_NOTICE_DAY && !schedule.noticeDay60At) {
        // The day-60 notice is superseded, not owed.
        await deps.markNotice(schedule.businessId, FIRST_NOTICE_DAY, now);
      }
      continue;
    }

    // decision.kind === "delete"
    if (dryRun) {
      report.deleted += 1;
      continue;
    }
    if (!(await deps.stillDue(schedule.businessId))) {
      plan.detail = "no longer due on re-read";
      continue;
    }
    if (!schedule.deletionStartedAt) await deps.markStarted(schedule.businessId, now);

    const erased = await deps.eraseSubjects(schedule.businessId, options.subjectsPerRun ?? DEFAULT_SUBJECTS_PER_RUN);
    if (erased.remaining > 0) {
      report.inProgress += 1;
      plan.detail = `erased ${erased.erased}, ${erased.remaining} left for the next run`;
      await deps.recordRun(schedule.businessId, now, { erased: erased.erased, remaining: erased.remaining });
      continue;
    }

    await deps.tombstonePrefixes(schedule.businessId, tenantPrefixes(schedule.businessId));
    const purge = await deps.purgeTombstones(schedule.businessId);
    await deps.closeWorkspace(schedule.businessId);
    await deps.markDeleted(schedule.businessId, now, { erased: erased.erased, objectsPurged: purge.purged, purgeFailures: purge.failures });
    report.deleted += 1;
    plan.detail = `deleted (${erased.erased} subjects this run, ${purge.purged} objects purged)`;
  }

  // 3. Retry any tombstone an earlier run failed to purge (the workspace is
  // already closed, so nothing else would revisit it).
  if (!dryRun) await deps.purgeTombstones(null);

  return report;
}
