import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";

export type JobType =
  | "app.ingest"
  | "lead.process"
  | "lead.score"
  | "message.send"
  | "message.process_inbound"
  | "email.poll"
  | "automation.advance"
  | "booking.sync"
  | "campaign.expand"
  | "campaign.send"
  | "integration.health_check"
  | "webhook.replay"
  | "webhook.dispatch"
  | "notification.send"
  | "usage.aggregate"
  | "retention.cleanup"
  | "cost.rollup_daily"
  | "cost.rollup_monthly"
  | "lead_source.poll"
  | "crm.push"
  | "notification.slack"
  | "notification.slack_digest"
  | "slack.interaction"
  | "agent.run"
  | "sourcing.run"
  | "business.analyse"
  | "recurring_search.tick"
  | "maintenance.expiry"
  | "outreach.dispatch"
  | "outreach.audience"
  | "outreach.tick"
  | "outreach.optimize"
  | "social.tick"
  // Fanned out by `social.tick`: one `social.advance` per workspace with due
  // work, and one `social.execute` per action it decided to take. Split three
  // ways so a workspace whose sending account is restricted, or one action that
  // a platform refuses, cannot stall every other workspace's queue.
  | "social.advance"
  | "social.execute"
  | "affiliate.ledger"
  // The domain event outbox (design 03 §4): one dispatch per event.
  | "event.dispatch"
  // A verified inbound lead webhook, ingested off the request path.
  | "ingest.webhook"
  // The handoff pack for one agent handoff (Phase 3.4).
  | "handoff.brief"
  // The daily SPF/DKIM/DMARC probe of each sending domain (Phase 3.5).
  | "domain.health_check"
  // Opt-in inbound CRM sync (brief §29): a sweep, then one pull per integration.
  | "crm.pull"
  // Daily complaint-rate monitor per sender identity (brief §43).
  | "email.sender_health"
  // Syncs the WhatsApp approved-template registry (brief §45).
  | "whatsapp.template_sync"
  // Daily failed-payment retries and overage billing (Phase 8.10, 8.13).
  | "billing.daily"
  // Reverses the UNUSED credit of a refunded top-up (SMS credit, WhatsApp tokens or
  // an AI token pack), queued by the Stripe `charge.refunded` webhook.
  | "billing.refund_reverse"
  // Qualification intelligence (design 08 §B.5): every six hours, re-assess
  // the leads whose intent decay boundary has passed. Batch-limited.
  | "intent.sweep"
  // Admin -> Economics: once a day, raise an admin alert for any workspace
  // whose month-to-date or projected month-end margin is below 75%.
  | "economics.margin_check"
  // The direct-sale loop (0143): a verified payment from the customer's own
  // Stripe or an order-paid webhook, and one abandoned-checkout nudge check.
  | "payment.confirm"
  | "checkout.nudge"
  // Intent-driven re-engagement (reengagement/triggers.ts): one job per
  // trigger (a NOT_NOW resume, a stated deadline, a no-show, a lost deal),
  // re-reading state before it acts, and an hourly sweep that plans any the
  // domain-event consumer missed.
  | "reengage.trigger"
  | "reengage.sweep"
  // Quote-to-cash (P2): the PDF of a frozen revision, the expiry at its
  // valid-until, the "not opened / not accepted yet" reminder (through the
  // re-engagement frequency guard), and invoice issue + payment reminders.
  | "quote.render_pdf"
  | "quote.expire"
  | "quote.nudge"
  | "invoice.issue"
  | "invoice.remind"
  // Voice (phase P2, lib/jobs/handlers/voice.ts over lib/voice/runtime-core.ts):
  // dial one queued call, apply a stored provider event, post-process a
  // finished call, copy its recording to R2, plan the retry or fallback, and
  // drive a dedicated number's provisioning or release.
  | "voice.dial"
  | "voice.webhook_ingest"
  | "voice.post_call"
  | "voice.recording_fetch"
  | "voice.retry"
  | "voice.number_provision"
  | "voice.number_release";

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
  // A failure leaves the job locked; the stale-lock release re-runs it, and
  // every handler is retry-safe. Logged so the re-run is explicable.
  logWriteError(
    await supabase
      .from("jobs")
      .update({
        state: "completed",
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", jobId),
    "queue: complete job",
    { jobId },
  );
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
    logWriteError(
      await supabase
        .from("jobs")
        .update({
          state: "dead",
          last_error: message.slice(0, 2000),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id),
      "queue: mark job dead",
      { jobId: job.id, jobType: job.type, businessId: job.business_id, jobError: message.slice(0, 500) },
    );
    return;
  }

  const delay =
    RETRY_BACKOFF_SECONDS[Math.min(attempts - 1, RETRY_BACKOFF_SECONDS.length - 1)];

  logWriteError(
    await supabase
      .from("jobs")
      .update({
        state: "pending",
        run_at: new Date(Date.now() + delay * 1000).toISOString(),
        last_error: message.slice(0, 2000),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id),
    "queue: schedule job retry",
    { jobId: job.id, jobType: job.type, businessId: job.business_id, jobError: message.slice(0, 500) },
  );
}
