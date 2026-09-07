"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";
import { jobStatusOf, reconcile, sideEffectOf } from "./jobs";

/**
 * Admin → Jobs writes (V4 §43).
 *
 * The rule this file exists to enforce: **a retry must never blindly repeat a
 * side effect the customer or a provider has already seen.** Before anything is
 * re-queued the platform asks the domain whether the original attempt actually
 * landed, and refuses when it did. Where no such record exists (`unverifiable`
 * job types) the operator has to say, explicitly, that they accept the repeat.
 *
 * The original row is never rewritten. A retry inserts a *new* job that points
 * back at the one it came from, so the failure history stays intact and two
 * operators clicking Retry cannot produce two runs — the idempotency key is
 * derived from the source job, and the queue's unique index absorbs the second.
 */

const jobInput = z.object({
  jobId: z.string().uuid(),
  /** Set only when the operator has accepted an unverifiable repeat. */
  confirmUnverifiable: z.boolean().optional(),
});

const JOB_COLUMNS =
  "id, type, business_id, payload, state, priority, attempts, max_attempts, run_at, idempotency_key, cancel_requested_at, cancelled_at, locked_by";

export async function retryJob(input: {
  jobId: string;
  confirmUnverifiable?: boolean;
}): Promise<AdminActionResult> {
  return guarded("admin.job_retried", async (operator) => {
    const parsed = jobInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That job reference is not valid." };

    const db = createAdminClient();
    const { data: job } = await db
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("id", parsed.data.jobId)
      .maybeSingle();

    if (!job) return { ok: false, error: "That job no longer exists." };

    // Re-read the state rather than trusting what the drawer was showing: the
    // worker may have picked the job up again since the page rendered.
    const status = jobStatusOf(job as never);
    if (status !== "FAILED" && status !== "DEAD_LETTER") {
      return {
        ok: false,
        error: `This job is ${status.toLowerCase().replace("_", " ")} and cannot be re-queued.`,
      };
    }

    const sideEffect = sideEffectOf(job.type);

    const verdict = await reconcile(db, {
      type: job.type,
      payload: job.payload as Record<string, unknown> | null,
      business_id: job.business_id,
    });

    if (verdict.alreadySucceeded) {
      // Not an error the operator caused — the queue simply lost the outcome.
      // Settle the row so it stops appearing as work outstanding.
      await db
        .from("jobs")
        .update({
          state: "completed",
          completed_at: new Date().toISOString(),
          last_error: `Reconciled by an operator: ${verdict.evidence}.`,
        })
        .eq("id", job.id);

      await recordAudit({
        businessId: job.business_id,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.job_reconciled",
        entityType: "job",
        entityId: job.id,
        metadata: { job_type: job.type, evidence: verdict.evidence },
      });

      revalidatePath("/admin/system");
      return {
        ok: true,
        message: `Not retried — the original attempt had already succeeded (${verdict.evidence}). The job has been settled.`,
      };
    }

    if (sideEffect === "unverifiable" && !parsed.data.confirmUnverifiable) {
      return {
        ok: false,
        error:
          "This job calls a provider that returns nothing we can check against. Confirm that repeating it is acceptable before retrying.",
      };
    }

    // A stable key derived from the source job, so a double click, or two
    // operators acting at once, produce one re-queued job rather than two.
    const idempotencyKey = `admin-retry:${job.id}`;

    const { data: existing } = await db
      .from("jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      return {
        ok: true,
        message: "This job has already been re-queued and is waiting to run.",
      };
    }

    const { error } = await db.from("jobs").insert({
      type: job.type,
      business_id: job.business_id,
      payload: job.payload as never,
      // Retries jump ahead of routine work but never ahead of critical traffic.
      priority: Math.max(50, Number(job.priority) || 100),
      max_attempts: job.max_attempts,
      idempotency_key: idempotencyKey,
      retried_from_job_id: job.id,
    });

    // A unique violation means the identical job was queued between the check
    // above and the insert, which is exactly the outcome wanted.
    if (error && error.code !== "23505") {
      return { ok: false, error: "The job could not be re-queued." };
    }

    await recordAudit({
      businessId: job.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.job_retried",
      entityType: "job",
      entityId: job.id,
      metadata: {
        job_type: job.type,
        side_effect: sideEffect,
        confirmed_unverifiable: sideEffect === "unverifiable",
        idempotency_key: idempotencyKey,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: "Re-queued. The worker will pick it up on its next pass." };
  });
}

export async function cancelJob(input: { jobId: string }): Promise<AdminActionResult> {
  return guarded("admin.job_cancelled", async (operator) => {
    const parsed = jobInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That job reference is not valid." };

    const db = createAdminClient();
    const { data: job } = await db
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("id", parsed.data.jobId)
      .maybeSingle();

    if (!job) return { ok: false, error: "That job no longer exists." };

    const status = jobStatusOf(job as never);

    if (status === "QUEUED" || status === "RETRYING") {
      // Nothing has started, so cancellation is immediate and complete.
      const now = new Date().toISOString();
      const { error } = await db
        .from("jobs")
        .update({
          state: "cancelled",
          cancel_requested_at: now,
          cancel_requested_by: operator.id,
          cancelled_at: now,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id)
        // Guards against the worker claiming the row in between the read and
        // the write: if it is no longer pending, this update matches nothing.
        .eq("state", "pending");

      if (error) return { ok: false, error: "The job could not be cancelled." };

      await recordAudit({
        businessId: job.business_id,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.job_cancelled",
        entityType: "job",
        entityId: job.id,
        metadata: { job_type: job.type, outcome: "cancelled_before_start" },
      });

      revalidatePath("/admin/system");
      return { ok: true, message: "Cancelled before it started." };
    }

    if (status === "RUNNING") {
      // The worker holds this row and may already be mid-provider-call. All the
      // platform can honestly do is record the request; claiming the remote
      // side effect was stopped would be a lie.
      await db
        .from("jobs")
        .update({
          cancel_requested_at: new Date().toISOString(),
          cancel_requested_by: operator.id,
        })
        .eq("id", job.id)
        .is("cancel_requested_at", null);

      await recordAudit({
        businessId: job.business_id,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.job_cancelled",
        entityType: "job",
        entityId: job.id,
        metadata: { job_type: job.type, outcome: "cancel_requested_while_running" },
      });

      revalidatePath("/admin/system");
      return {
        ok: true,
        message:
          "Cancellation requested. The worker will stop at its next safe point — any provider call already in flight will still complete.",
      };
    }

    return {
      ok: false,
      error: `A ${status.toLowerCase().replace("_", " ")} job has nothing left to cancel.`,
    };
  });
}

/**
 * Moves an exhausted job to the dead-letter state so it leaves the active
 * queue. Only a job that has genuinely stopped qualifies — this is a filing
 * action, not a way to stop work that is still running.
 */
export async function moveJobToDeadLetter(input: {
  jobId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.job_dead_lettered", async (operator) => {
    const parsed = jobInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That job reference is not valid." };

    const db = createAdminClient();
    const { data: job } = await db
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("id", parsed.data.jobId)
      .maybeSingle();

    if (!job) return { ok: false, error: "That job no longer exists." };

    const status = jobStatusOf(job as never);
    if (status !== "FAILED") {
      return {
        ok: false,
        error: "Only a failed job can be moved to the dead-letter queue.",
      };
    }

    await db
      .from("jobs")
      .update({ state: "dead", locked_at: null, locked_by: null })
      .eq("id", job.id)
      .eq("state", "failed");

    await recordAudit({
      businessId: job.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.job_dead_lettered",
      entityType: "job",
      entityId: job.id,
      metadata: { job_type: job.type },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: "Moved to the dead-letter queue." };
  });
}
