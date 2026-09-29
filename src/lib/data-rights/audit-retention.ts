/**
 * Audit-log retention (internal review IR-09). The Privacy Policy states that
 * audit and security logs are kept for 12 months; this is the rule that makes
 * it true. Pure (dependencies injected) so the job and the tests share it.
 *
 *   - Every workspace keeps its audit history for its configured period
 *     (Settings -> Security), 12 months by default, never longer than the
 *     plan allows (security-policy.ts AUDIT_RETENTION_PLAN_CAP_MONTHS).
 *   - Platform rows (business_id null: operator actions, and rows of deleted
 *     workspaces) keep the stated 12 months.
 *   - Deletes run in bounded batches (`audit_log_purge_batch`, 0180), with a
 *     per-run row budget, so a backlog drains over several days and never
 *     becomes one long transaction.
 *   - Only `audit_log` rows are affected. Exports a customer has already
 *     downloaded are their own copy; nothing else is touched.
 */
import {
  AUDIT_RETENTION_DEFAULT_MONTHS,
  auditRetentionCutoff,
  effectiveAuditRetentionMonths,
} from "../auth/security-policy.ts";

export const AUDIT_PURGE_BATCH = 1000;
/** Rows deleted per daily run across all workspaces. */
export const AUDIT_PURGE_RUN_BUDGET = 50_000;
export const AUDIT_WORKSPACE_PAGE = 500;

export type AuditRetentionDeps = {
  now: () => Date;
  /** Workspace ids, keyset-paged by id. */
  listWorkspaces: (afterId: string | null, limit: number) => Promise<string[]>;
  /** Configured months per workspace, for workspaces that set one. Null = table not there yet. */
  listConfiguredMonths: () => Promise<Map<string, number> | null>;
  planOf: (businessId: string) => Promise<string | null>;
  /** Deletes up to `limit` rows older than `before`; returns how many. */
  purgeBatch: (businessId: string | null, before: Date, limit: number) => Promise<number>;
};

export type AuditRetentionRun = {
  deleted: number;
  workspacesPurged: number;
  platformDeleted: number;
  budgetExhausted: boolean;
  failures: number;
  /** True when 0180 is not applied yet: nothing was deleted. */
  skipped: boolean;
  perWorkspace: { businessId: string; months: number; deleted: number }[];
};

export async function enforceAuditRetention(deps: AuditRetentionDeps): Promise<AuditRetentionRun> {
  const now = deps.now();
  const run: AuditRetentionRun = {
    deleted: 0,
    workspacesPurged: 0,
    platformDeleted: 0,
    budgetExhausted: false,
    failures: 0,
    skipped: false,
    perWorkspace: [],
  };

  const configured = await deps.listConfiguredMonths();
  if (configured === null) {
    run.skipped = true;
    return run;
  }

  async function drain(businessId: string | null, months: number): Promise<number> {
    const before = auditRetentionCutoff(months, now);
    let deleted = 0;
    while (run.deleted < AUDIT_PURGE_RUN_BUDGET) {
      const limit = Math.min(AUDIT_PURGE_BATCH, AUDIT_PURGE_RUN_BUDGET - run.deleted);
      const n = await deps.purgeBatch(businessId, before, limit);
      deleted += n;
      run.deleted += n;
      if (n < limit) return deleted;
    }
    run.budgetExhausted = true;
    return deleted;
  }

  try {
    run.platformDeleted = await drain(null, AUDIT_RETENTION_DEFAULT_MONTHS);
  } catch {
    run.failures += 1;
  }

  let after: string | null = null;
  while (!run.budgetExhausted) {
    const page = await deps.listWorkspaces(after, AUDIT_WORKSPACE_PAGE);
    for (const businessId of page) {
      if (run.budgetExhausted) break;
      try {
        const chosen = configured.get(businessId);
        // Only a workspace that chose something other than the default can
        // be affected by its plan cap, so only those cost a plan lookup.
        const months =
          chosen === undefined || chosen === AUDIT_RETENTION_DEFAULT_MONTHS
            ? AUDIT_RETENTION_DEFAULT_MONTHS
            : effectiveAuditRetentionMonths(chosen, await deps.planOf(businessId));
        const deleted = await drain(businessId, months);
        if (deleted > 0) {
          run.workspacesPurged += 1;
          run.perWorkspace.push({ businessId, months, deleted });
        }
      } catch {
        run.failures += 1;
      }
    }
    if (page.length < AUDIT_WORKSPACE_PAGE) break;
    after = page[page.length - 1] ?? null;
  }

  return run;
}
