import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type JobType =
  | "app.ingest"
  | "lead.process"
  | "message.send"
  | "message.process_inbound"
  | "email.poll"
  | "automation.advance"
  | "booking.sync"
  | "campaign.expand"
  | "campaign.send"
  | "integration.health_check"
  | "webhook.replay"
  | "notification.send"
  | "usage.aggregate"
  | "retention.cleanup"
  | "cost.rollup_daily"
  | "cost.rollup_monthly"
  | "lead_source.poll"
  | "crm.push"
  | "notification.slack"
  | "agent.run"
  | "sourcing.run"
  | "business.analyse"
  | "recurring_search.tick"
  | "maintenance.expiry"
  | "outreach.dispatch";

export type EnqueueOptions = {
  businessId?: string | null;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** Dedupe key: the same logical job is never queued twice while pending. */
  idempotencyKey?: string;
};

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type,
      payload: payload as never,
      business_id: options.businessId ?? null,
      run_at: (options.runAt ?? new Date()).toISOString(),
      priority: options.priority ?? 100,
      max_attempts: options.maxAttempts ?? 5,
      idempotency_key: options.idempotencyKey ?? null,
    })
    .select("id")
    .single();

  // A unique violation means the identical job is already queued, which is the
  // desired outcome rather than an error.
  if (error && error.code === "23505") return null;
  if (error) throw error;

  return data.id;
}

export type ClaimedJob = {
  id: string;
  type: JobType;
  business_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/**
 * Atomically claims due jobs. FOR UPDATE SKIP LOCKED means two overlapping
 * worker invocations never process the same row.
 */
export async function claimJobs(limit: number, workerId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_jobs", {
    batch_size: limit,
    worker: workerId,
  });
  if (error) throw error;
  return (data ?? []) as ClaimedJob[];
}

export async function completeJob(jobId: string) {
  const supabase = createAdminClient();
  await supabase
    .from("jobs")
    .update({
      state: "completed",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", jobId);
}

const RETRY_BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];

export async function failJob(
  job: ClaimedJob,
  error: unknown,
  permanent = false,
) {
  const supabase = createAdminClient();
  const message = error instanceof Error ? error.message : String(error);
  const attempts = job.attempts;
  const exhausted = permanent || attempts >= job.max_attempts;

  if (exhausted) {
    await supabase
      .from("jobs")
      .update({
        state: "dead",
        last_error: message.slice(0, 2000),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id);
    return;
  }

  const delay =
    RETRY_BACKOFF_SECONDS[Math.min(attempts - 1, RETRY_BACKOFF_SECONDS.length - 1)];

  await supabase
    .from("jobs")
    .update({
      state: "pending",
      run_at: new Date(Date.now() + delay * 1000).toISOString(),
      last_error: message.slice(0, 2000),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
}
