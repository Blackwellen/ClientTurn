import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { runWorkspaceDeletion } from "@/lib/billing/workspace-deletion";
import {
  DeletionScheduleMissingError,
  liveWorkspaceDeletionDeps,
} from "@/lib/billing/workspace-deletion-live";
import { parsePayload } from "./parse";

/**
 * The daily `billing.workspace_deletion` job (docs/CRON.md): the day-60 and
 * day-83 notices and the day-90 deletion of cancelled workspaces
 * (lib/billing/workspace-deletion.ts). `{ dryRun: true }` reports the plan
 * and writes nothing; the admin view runs the same plan read-only.
 *
 * Deletion is OFF until `WORKSPACE_DELETION_ENABLED=true`: without it every
 * daily run is a dry run (notices and deletion both wait), so turning the
 * policy on is a deliberate deployment step after 0170 is applied and the
 * first dry-run report has been checked.
 */

const payload = z.object({ dryRun: z.boolean().optional() }).default({});

export function workspaceDeletionEnabled(): boolean {
  return process.env.WORKSPACE_DELETION_ENABLED === "true";
}

export async function handleWorkspaceDeletion(job: ClaimedJob): Promise<void> {
  const input = parsePayload(payload, job.payload ?? {});
  const dryRun = input.dryRun === true || !workspaceDeletionEnabled();
  try {
    const report = await runWorkspaceDeletion(liveWorkspaceDeletionDeps, { dryRun });
    if (report.scheduled + report.notices + report.deleted + report.inProgress + report.cleared > 0 || dryRun) {
      console.info("[billing.workspace_deletion]", {
        dryRun: report.dryRun,
        scheduled: report.scheduled,
        cleared: report.cleared,
        notices: report.notices,
        deleted: report.deleted,
        inProgress: report.inProgress,
        held: report.held,
      });
    }
  } catch (error) {
    if (error instanceof DeletionScheduleMissingError) {
      console.warn("[billing.workspace_deletion] skipped:", error.message);
      return;
    }
    throw error;
  }
}
