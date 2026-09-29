/**
 * Job lanes: how urgent each job type is, how long it may run, and which
 * admin health queue it belongs to (docs/CRON.md "Lanes and priorities").
 *
 * Pure: no `server-only`, no Supabase, and only a type import, so the tests
 * can load it under plain `node --test`.
 *
 * WHY LANES. Every job used to be queued at priority 100 and claimed FIFO, so
 * a voice webhook, a quote PDF and a burst of sourcing jobs all waited in the
 * same line as an inbound reply. The claim now orders by an *effective*
 * priority (migration 0163, mirrored by `effectivePriority` below):
 *
 *   CRITICAL    (<= 10)  inbound replies, first response, agent turns, voice
 *                        dial and voice webhooks, verified payments. Always
 *                        claimed first. Never ages, never waits behind bulk.
 *   INTERACTIVE (30)     follow-up sends, notifications, booking sync, the
 *                        voice post-call steps.
 *   STANDARD    (100)    quotes, invoices, CRM push, sweeps. The column default.
 *   BULK        (200)    sourcing, analysis, rollups, nightly housekeeping.
 *
 * A non-critical job gains one point per minute it has been due, down to a
 * floor of 11, so a follow-up send cannot be starved by a flood of quotes and
 * a nightly rollup still runs during a busy day, but nothing non-critical ever
 * overtakes a critical job.
 */
import type { JobType } from "./queue";

export const LANE_PRIORITY = {
  CRITICAL: 10,
  INTERACTIVE: 30,
  STANDARD: 100,
  BULK: 200,
} as const;

export type Lane = keyof typeof LANE_PRIORITY;

/** Anything at or below this is critical: claimed first, never aged. */
export const CRITICAL_MAX_PRIORITY = 10;
/** The best a non-critical job can age to. One above CRITICAL_MAX_PRIORITY. */
export const AGED_FLOOR = 11;

/**
 * How long a handler can plausibly run. The worker (worker-loop.ts) starts a
 * job only while there is enough of the 60 s function limit left for it.
 *
 *   standard  a few seconds; may start until 40 s in
 *   slow      provider round trips or a model call; may start until 25 s in
 *   long      a bounded batch that can use most of a minute; only in the
 *             first 12 s (sourcing.run carries its own 45 s budget)
 */
export type DurationClass = "standard" | "slow" | "long";

/** The admin System -> Health queue groupings (admin/health.ts). */
export type HealthQueue =
  | "lead_ingestion"
  | "message_dispatch"
  | "voice"
  | "quotes_invoices"
  | "payments_billing"
  | "booking_sync"
  | "notifications"
  | "outreach_sourcing"
  | "events_integrations"
  | "nightly_summaries";

export const HEALTH_QUEUE_LABELS: Record<HealthQueue, string> = {
  lead_ingestion: "Lead ingestion",
  message_dispatch: "Message dispatch",
  voice: "Voice calls",
  quotes_invoices: "Quotes and invoices",
  payments_billing: "Payments and billing",
  booking_sync: "Booking sync",
  notifications: "Notifications",
  outreach_sourcing: "Outreach and sourcing",
  events_integrations: "Events and integrations",
  nightly_summaries: "Nightly summaries",
};

export type JobClass = { lane: Lane; duration: DurationClass; queue: HealthQueue };

const c = (lane: Lane, duration: DurationClass, queue: HealthQueue): JobClass => ({ lane, duration, queue });

/**
 * Every job type. `tests/queue-lanes.test.ts` reads the `JobType` union out of
 * queue.ts and fails if a type is missing here, so a new job type cannot
 * silently fall into the default lane or vanish from the health view.
 * (A `Record<JobType, …>` would make that a type error instead, but the union
 * is edited by several workstreams at once and a test failure is the gentler
 * signal.) Unknown types still get a safe default at runtime.
 */
export const JOB_CLASSES: Partial<Record<JobType, JobClass>> = {
  // --- critical: someone is waiting on the other end
  "message.process_inbound": c("CRITICAL", "slow", "message_dispatch"),
  "agent.run": c("CRITICAL", "slow", "message_dispatch"),
  "lead.process": c("CRITICAL", "slow", "lead_ingestion"),
  "ingest.webhook": c("CRITICAL", "standard", "lead_ingestion"),
  "app.ingest": c("CRITICAL", "standard", "lead_ingestion"),
  "voice.dial": c("CRITICAL", "slow", "voice"),
  "voice.webhook_ingest": c("CRITICAL", "standard", "voice"),
  "payment.confirm": c("CRITICAL", "standard", "payments_billing"),

  // --- interactive: follow-up sends and what a person sees soon
  "message.send": c("INTERACTIVE", "slow", "message_dispatch"),
  "automation.advance": c("INTERACTIVE", "standard", "message_dispatch"),
  "reengage.trigger": c("INTERACTIVE", "slow", "message_dispatch"),
  "email.poll": c("INTERACTIVE", "slow", "message_dispatch"),
  "lead_source.poll": c("INTERACTIVE", "slow", "lead_ingestion"),
  "booking.sync": c("INTERACTIVE", "slow", "booking_sync"),
  "notification.send": c("INTERACTIVE", "standard", "notifications"),
  "notification.slack": c("INTERACTIVE", "standard", "notifications"),
  "slack.interaction": c("INTERACTIVE", "standard", "notifications"),
  "handoff.brief": c("INTERACTIVE", "slow", "message_dispatch"),
  "voice.text_back": c("INTERACTIVE", "standard", "voice"),
  "voice.post_call": c("INTERACTIVE", "slow", "voice"),
  "voice.retry": c("INTERACTIVE", "standard", "voice"),
  "voice.reconcile": c("INTERACTIVE", "slow", "voice"),
  "lead.score": c("INTERACTIVE", "standard", "lead_ingestion"),

  // --- standard
  "voice.recording_fetch": c("STANDARD", "long", "voice"),
  "voice.number_provision": c("STANDARD", "slow", "voice"),
  "voice.number_release": c("STANDARD", "slow", "voice"),
  "quote.render_pdf": c("STANDARD", "long", "quotes_invoices"),
  "quote.expire": c("STANDARD", "standard", "quotes_invoices"),
  "quote.nudge": c("STANDARD", "standard", "quotes_invoices"),
  "invoice.issue": c("STANDARD", "slow", "quotes_invoices"),
  "invoice.remind": c("STANDARD", "slow", "quotes_invoices"),
  "checkout.nudge": c("STANDARD", "standard", "payments_billing"),
  "billing.refund_reverse": c("STANDARD", "slow", "payments_billing"),
  "campaign.send": c("STANDARD", "slow", "message_dispatch"),
  "outreach.dispatch": c("STANDARD", "slow", "outreach_sourcing"),
  "outreach.tick": c("STANDARD", "standard", "outreach_sourcing"),
  "social.tick": c("STANDARD", "standard", "outreach_sourcing"),
  "social.advance": c("STANDARD", "slow", "outreach_sourcing"),
  "social.execute": c("STANDARD", "slow", "outreach_sourcing"),
  "linkedin_assist.draft": c("STANDARD", "standard", "outreach_sourcing"),
  "reengage.sweep": c("STANDARD", "slow", "message_dispatch"),
  "crm.push": c("STANDARD", "slow", "events_integrations"),
  "webhook.dispatch": c("STANDARD", "standard", "events_integrations"),
  "webhook.replay": c("STANDARD", "slow", "events_integrations"),
  "event.dispatch": c("STANDARD", "standard", "events_integrations"),
  "automation.dispatch": c("STANDARD", "slow", "events_integrations"),

  // --- bulk
  "sourcing.run": c("BULK", "long", "outreach_sourcing"),
  "business.analyse": c("BULK", "long", "outreach_sourcing"),
  "recurring_search.tick": c("BULK", "long", "outreach_sourcing"),
  "campaign.expand": c("BULK", "long", "message_dispatch"),
  "outreach.audience": c("BULK", "long", "outreach_sourcing"),
  "outreach.optimize": c("BULK", "slow", "outreach_sourcing"),
  "crm.pull": c("BULK", "long", "events_integrations"),
  "integration.health_check": c("BULK", "long", "events_integrations"),
  "intent.sweep": c("BULK", "long", "lead_ingestion"),
  "billing.daily": c("BULK", "long", "payments_billing"),
  "affiliate.ledger": c("BULK", "long", "payments_billing"),
  "affiliate.billing_event": c("STANDARD", "slow", "payments_billing"),
  "usage.aggregate": c("BULK", "long", "nightly_summaries"),
  "retention.cleanup": c("BULK", "long", "nightly_summaries"),
  "cost.rollup_daily": c("BULK", "long", "nightly_summaries"),
  "cost.rollup_monthly": c("BULK", "long", "nightly_summaries"),
  "maintenance.expiry": c("BULK", "long", "nightly_summaries"),
  "economics.margin_check": c("BULK", "long", "nightly_summaries"),
  "voice.margin_check": c("BULK", "long", "nightly_summaries"),
  "experiment.auto_promote": c("BULK", "long", "nightly_summaries"),
  "domain.health_check": c("BULK", "long", "nightly_summaries"),
  "email.sender_health": c("BULK", "long", "nightly_summaries"),
  "whatsapp.template_sync": c("BULK", "long", "nightly_summaries"),
  "notification.slack_digest": c("BULK", "slow", "notifications"),
  "voice.retention": c("BULK", "long", "nightly_summaries"),
  "audit.retention": c("BULK", "long", "nightly_summaries"),
  "billing.workspace_deletion": c("BULK", "long", "payments_billing"),
};

const DEFAULT_CLASS: JobClass = c("STANDARD", "slow", "events_integrations");

export function jobClassOf(type: string): JobClass {
  return (JOB_CLASSES as Record<string, JobClass | undefined>)[type] ?? DEFAULT_CLASS;
}

/** The priority `enqueue` stores when the caller does not pass one. */
export function defaultPriorityFor(type: string): number {
  return LANE_PRIORITY[jobClassOf(type).lane];
}

/**
 * The claim order (lower first). Mirrors `claim_jobs` in migration 0163:
 *
 *   priority <= 10  ->  priority                            (critical, fixed)
 *   otherwise       ->  greatest(11, priority - minutesDue) (aged, floored)
 *
 * Ties are broken by run_at (older first) in SQL and in `compareClaimOrder`.
 */
export function effectivePriority(priority: number, minutesDue: number): number {
  if (priority <= CRITICAL_MAX_PRIORITY) return priority;
  const waited = Math.max(0, Math.floor(minutesDue));
  return Math.max(AGED_FLOOR, priority - waited);
}

export type ClaimCandidate = { id: string; priority: number; runAt: number };

/** Sorts due jobs the way `claim_jobs` claims them. `now` in epoch ms. */
export function claimOrder<T extends ClaimCandidate>(jobs: T[], now: number): T[] {
  return [...jobs].sort((a, b) => {
    const ea = effectivePriority(a.priority, (now - a.runAt) / 60_000);
    const eb = effectivePriority(b.priority, (now - b.runAt) / 60_000);
    return ea - eb || a.runAt - b.runAt;
  });
}

/** Types in a duration class; the worker passes them to claim_jobs as exclusions. */
export function typesWithDuration(durations: DurationClass[]): string[] {
  return Object.entries(JOB_CLASSES)
    .filter(([, value]) => value && durations.includes(value.duration))
    .map(([type]) => type);
}

/**
 * Reaper decision, mirrored by `reap_stalled_jobs` in migration 0163. A job
 * still `running` after the stale window was killed mid-run (Vercel's time
 * limit, a crash). `attempts` was already incremented when it was claimed, so
 * a job that has used every attempt is dead-lettered instead of being put back
 * forever; any other job returns to pending and is retried.
 */
export function reapDecision(attempts: number, maxAttempts: number): "dead" | "pending" {
  return attempts >= maxAttempts ? "dead" : "pending";
}
