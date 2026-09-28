import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/jobs/queue";
import type { DomainEventRow } from "@/lib/events/types";
import {
  planDeadlineCheckIn,
  planNoShow,
  planNotNowResume,
  planQuoteExpired,
  planWinBack,
  statedDateOf,
  triggerJobKey,
  winBackPlan,
  type ReengagementTrigger,
  type TriggerPlan,
} from "./triggers";
import { loadReengagementSettings, type ReengagementSettings } from "./service";

/**
 * Plans intent-driven re-engagement triggers as scheduled jobs.
 *
 * Two entry points, both idempotent:
 *
 *   * `planFromDomainEvent` -- the outbox consumer. A no-show (from the
 *     bookings SQL trigger), a lost deal (opportunities service) and a
 *     re-assessed lead (a NOT_NOW or a stated timeframe) each plan their
 *     trigger the moment they are recorded.
 *   * `sweepReengagementTriggers` -- the hourly backstop. Anything due now
 *     that has no trigger job yet (an event missed, a signal recorded before
 *     this shipped) is planned.
 *
 * A trigger job is planned at most once per (trigger, source), ever: the job
 * row is the record, found by its idempotency key in any state. Retries,
 * re-dispatched events and overlapping sweeps all collapse onto it.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type TriggerJobPayload = {
  trigger: ReengagementTrigger;
  sourceId: string;
  leadId: string;
  dueAt: string;
  expiresAt: string;
  optimiseSendTime: boolean;
  /** Set once the best-send-time step has moved the job, so it is not moved twice. */
  slotted?: boolean;
  /** Frequency deferrals so far (bounded). */
  deferrals?: number;
};

/** Whether this trigger has ever been planned (a job with its key, in any state). */
async function alreadyPlanned(key: string): Promise<boolean> {
  const { data, error } = await db().from("jobs").select("id").eq("idempotency_key", key).limit(1);
  if (error) throw new Error(`reengage: job lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Queues one trigger job at its due time. Returns true when a job was queued
 * now, false when it already existed or its moment has passed.
 */
export async function scheduleTrigger(input: {
  businessId: string;
  leadId: string;
  plan: TriggerPlan;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const { plan } = input;
  if (plan.expiresAt.getTime() <= now.getTime()) return false;
  const key = triggerJobKey(plan.trigger, plan.sourceId);
  if (await alreadyPlanned(key)) return false;
  const payload: TriggerJobPayload = {
    trigger: plan.trigger,
    sourceId: plan.sourceId,
    leadId: input.leadId,
    dueAt: plan.dueAt.toISOString(),
    expiresAt: plan.expiresAt.toISOString(),
    optimiseSendTime: plan.optimiseSendTime,
  };
  const id = await enqueue("reengage.trigger", payload as unknown as Record<string, unknown>, {
    businessId: input.businessId,
    runAt: plan.dueAt.getTime() > now.getTime() ? plan.dueAt : now,
    priority: 90,
    maxAttempts: 4,
    idempotencyKey: key,
  });
  return Boolean(id);
}

function enabledFor(trigger: ReengagementTrigger, settings: ReengagementSettings): boolean {
  if (trigger === "NOT_NOW_RESUME" || trigger === "DEADLINE_PASSED") return settings.notNowEnabled;
  if (trigger === "NO_SHOW_REBOOK" || trigger === "NO_SHOW_NUDGE") return settings.noShowEnabled;
  // An expired quote is a win-back of a deal that went quiet.
  return settings.winBackEnabled;
}

/* ------------------------------------------------------------ sources --- */

type SignalRow = {
  id: string;
  business_id: string;
  lead_id: string;
  signal_type: string;
  resume_at: string | null;
  flat_until: string | null;
  observed_at: string | null;
  retracted_at: string | null;
};

const SIGNAL_COLUMNS = "id, business_id, lead_id, signal_type, resume_at, flat_until, observed_at, retracted_at";

function planForSignal(row: SignalRow): TriggerPlan | null {
  const signal = {
    id: row.id,
    type: row.signal_type,
    resume_at: row.resume_at,
    flat_until: row.flat_until,
    observed_at: row.observed_at,
    retracted_at: row.retracted_at,
  };
  return row.signal_type === "NOT_NOW" ? planNotNowResume(signal) : planDeadlineCheckIn(signal);
}

/**
 * The lead's current NOT_NOW / TIMEFRAME signals: only the newest of each type
 * is planned (an older one is superseded by what the lead said since).
 */
export async function planIntentTriggersForLead(businessId: string, leadId: string, now = new Date()): Promise<number> {
  const settings = await loadReengagementSettings(businessId);
  if (!settings.notNowEnabled) return 0;
  const { data, error } = await db()
    .from("lead_intent_signals")
    .select(SIGNAL_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .in("signal_type", ["NOT_NOW", "TIMEFRAME"])
    .is("retracted_at", null)
    .order("observed_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`reengage: signals read failed: ${error.message}`);
  const newest = new Map<string, SignalRow>();
  for (const row of (data ?? []) as SignalRow[]) if (!newest.has(row.signal_type)) newest.set(row.signal_type, row);
  let planned = 0;
  for (const row of newest.values()) {
    const plan = planForSignal(row);
    if (plan && (await scheduleTrigger({ businessId, leadId, plan, now }))) planned += 1;
  }
  return planned;
}

export async function planNoShowTriggers(input: {
  businessId: string;
  leadId: string;
  bookingId: string;
  noShowAt: string;
  now?: Date;
}): Promise<number> {
  const settings = await loadReengagementSettings(input.businessId);
  if (!settings.noShowEnabled) return 0;
  let planned = 0;
  for (const plan of planNoShow({ id: input.bookingId, noShowAt: input.noShowAt })) {
    if (await scheduleTrigger({ businessId: input.businessId, leadId: input.leadId, plan, now: input.now })) planned += 1;
  }
  return planned;
}

/** The date the lead gave before a loss ("come back in March"), if any. */
async function statedResumeBefore(businessId: string, leadId: string, lostAt: string): Promise<Date | null> {
  const { data, error } = await db()
    .from("lead_intent_signals")
    .select(SIGNAL_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .in("signal_type", ["NOT_NOW", "TIMEFRAME"])
    .is("retracted_at", null)
    .lte("observed_at", lostAt)
    .order("observed_at", { ascending: false })
    .limit(5);
  if (error) return null;
  for (const row of (data ?? []) as SignalRow[]) {
    if (row.signal_type === "NOT_NOW" && row.resume_at) return new Date(row.resume_at);
    const stated = statedDateOf({ type: row.signal_type, flat_until: row.flat_until, observed_at: row.observed_at });
    if (stated) return stated;
  }
  return null;
}

export async function planWinBackTrigger(input: {
  businessId: string;
  opportunityId: string;
  leadId: string;
  reason: string | null;
  lostAt: string;
  now?: Date;
}): Promise<{ planned: boolean; skip?: string }> {
  const now = input.now ?? new Date();
  const settings = await loadReengagementSettings(input.businessId);
  if (!settings.winBackEnabled) return { planned: false, skip: "disabled" };
  const decision = planWinBack({
    reason: input.reason,
    lostAt: input.lostAt,
    now,
    statedResumeAt: await statedResumeBefore(input.businessId, input.leadId, input.lostAt),
  });
  if (decision.action === "skip") return { planned: false, skip: decision.reason };
  const planned = await scheduleTrigger({
    businessId: input.businessId,
    leadId: input.leadId,
    plan: winBackPlan(input.opportunityId, decision),
    now,
  });
  return { planned };
}

/**
 * An expired quote (brief §72): one check-in a week later, through the same
 * trigger job, stop conditions and frequency guard as every other trigger.
 * Called by the quote.expire job the moment a quote expires; the sweep is the
 * backstop.
 */
export async function planQuoteExpiredTrigger(input: {
  businessId: string;
  leadId: string;
  quoteId: string;
  expiredAt: string;
  now?: Date;
}): Promise<boolean> {
  const settings = await loadReengagementSettings(input.businessId);
  if (!settings.winBackEnabled) return false;
  const plan = planQuoteExpired({ id: input.quoteId, expiredAt: input.expiredAt });
  if (!plan) return false;
  return scheduleTrigger({ businessId: input.businessId, leadId: input.leadId, plan, now: input.now });
}

/* ------------------------------------------------------ outbox consumer --- */

/**
 * The domain-event consumer (events/outbox.ts). Idempotent: every plan is
 * keyed, so a re-dispatched event plans nothing twice.
 */
export async function planFromDomainEvent(event: Pick<DomainEventRow, "business_id" | "type" | "subject_type" | "subject_id" | "payload" | "occurred_at">): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const leadId =
    typeof payload.lead_id === "string" ? payload.lead_id : event.subject_type === "lead" ? event.subject_id : null;
  if (!leadId) return;

  switch (event.type) {
    case "meeting.no_show": {
      const bookingId = typeof payload.booking_id === "string" ? payload.booking_id : event.subject_id;
      if (!bookingId) return;
      await planNoShowTriggers({ businessId: event.business_id, leadId, bookingId, noShowAt: event.occurred_at });
      return;
    }
    case "opportunity.lost": {
      if (!event.subject_id) return;
      await planWinBackTrigger({
        businessId: event.business_id,
        opportunityId: event.subject_id,
        leadId,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        lostAt: event.occurred_at,
      });
      return;
    }
    // A re-assessment that found a NOT_NOW or a timeframe: plan from the
    // stored signals, never from the event's own summary.
    case "lead.intent_changed":
    case "lead.scored":
      await planIntentTriggersForLead(event.business_id, leadId);
      return;
    default:
      return;
  }
}

export const REENGAGEMENT_PLAN_EVENTS = ["meeting.no_show", "opportunity.lost", "lead.intent_changed", "lead.scored"] as const;

/* --------------------------------------------------------------- sweep --- */

const SWEEP_LIMIT = 300;
const DAY_MS = 86_400_000;

/**
 * The hourly backstop: plans every trigger that is due (or recently due) and
 * has no job yet. Bounded per run; the keys make overlap harmless.
 */
export async function sweepReengagementTriggers(now = new Date()): Promise<{ planned: number; examined: number }> {
  let planned = 0;
  let examined = 0;
  const settingsCache = new Map<string, ReengagementSettings>();
  const settingsFor = async (businessId: string) => {
    let settings = settingsCache.get(businessId);
    if (!settings) {
      settings = await loadReengagementSettings(businessId);
      settingsCache.set(businessId, settings);
    }
    return settings;
  };

  // 1. NOT_NOW resume dates and stated timeframes due in the last 14 days.
  //    A TIMEFRAME's flat_until is the stated date + 7 days, so a stated date
  //    in the window has flat_until up to 7 days ahead.
  const recent = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const [notNow, timeframe] = await Promise.all([
    db()
      .from("lead_intent_signals")
      .select(SIGNAL_COLUMNS)
      .eq("signal_type", "NOT_NOW")
      .is("retracted_at", null)
      .gte("resume_at", recent)
      .lte("resume_at", now.toISOString())
      .order("resume_at", { ascending: true })
      .limit(SWEEP_LIMIT),
    db()
      .from("lead_intent_signals")
      .select(SIGNAL_COLUMNS)
      .eq("signal_type", "TIMEFRAME")
      .is("retracted_at", null)
      .gte("flat_until", new Date(now.getTime() - 7 * DAY_MS).toISOString())
      .lte("flat_until", new Date(now.getTime() + 7 * DAY_MS).toISOString())
      .order("flat_until", { ascending: true })
      .limit(SWEEP_LIMIT),
  ]);
  if (notNow.error) throw new Error(`reengage.sweep: NOT_NOW read failed: ${notNow.error.message}`);
  if (timeframe.error) throw new Error(`reengage.sweep: TIMEFRAME read failed: ${timeframe.error.message}`);
  const leads = new Map<string, string>();
  for (const row of [...((notNow.data ?? []) as SignalRow[]), ...((timeframe.data ?? []) as SignalRow[])]) {
    leads.set(row.lead_id, row.business_id);
  }
  for (const [leadId, businessId] of leads) {
    examined += 1;
    if (!(await settingsFor(businessId)).notNowEnabled) continue;
    planned += await planIntentTriggersForLead(businessId, leadId, now);
  }

  // 2. No-shows recorded in the last three days.
  const { data: noShows, error: noShowError } = await db()
    .from("bookings")
    .select("id, business_id, lead_id, updated_at")
    .eq("status", "no_show")
    .gte("updated_at", new Date(now.getTime() - 3 * DAY_MS).toISOString())
    .limit(SWEEP_LIMIT);
  if (noShowError) throw new Error(`reengage.sweep: bookings read failed: ${noShowError.message}`);
  for (const row of (noShows ?? []) as { id: string; business_id: string; lead_id: string; updated_at: string }[]) {
    examined += 1;
    if (!(await settingsFor(row.business_id)).noShowEnabled) continue;
    planned += await planNoShowTriggers({ businessId: row.business_id, leadId: row.lead_id, bookingId: row.id, noShowAt: row.updated_at, now });
  }

  // 3. Deals lost in the last year whose win-back is due within the window.
  const { data: lost, error: lostError } = await db()
    .from("opportunities")
    .select("id, business_id, lead_id, outcome_reason, closed_at")
    .eq("outcome", "LOST")
    .not("lead_id", "is", null)
    .gte("closed_at", new Date(now.getTime() - 365 * DAY_MS).toISOString())
    .lte("closed_at", new Date(now.getTime() - 30 * DAY_MS).toISOString())
    .order("closed_at", { ascending: false })
    .limit(SWEEP_LIMIT);
  if (lostError) throw new Error(`reengage.sweep: opportunities read failed: ${lostError.message}`);
  for (const row of (lost ?? []) as { id: string; business_id: string; lead_id: string; outcome_reason: string | null; closed_at: string }[]) {
    examined += 1;
    if (!(await settingsFor(row.business_id)).winBackEnabled) continue;
    const result = await planWinBackTrigger({
      businessId: row.business_id,
      opportunityId: row.id,
      leadId: row.lead_id,
      reason: row.outcome_reason,
      lostAt: row.closed_at,
      now,
    });
    if (result.planned) planned += 1;
  }

  // 4. Quotes that expired in the last two weeks (the quote.expire job plans
  //    them as they expire; this catches any it missed).
  const { data: expired, error: expiredError } = await db()
    .from("quotes")
    .select("id, business_id, updated_at, opportunities!inner(lead_id)")
    .eq("status", "EXPIRED")
    .gte("updated_at", new Date(now.getTime() - 14 * DAY_MS).toISOString())
    .limit(SWEEP_LIMIT);
  // Before migration 0153 there is no quotes table: nothing to plan.
  if (!expiredError) {
    for (const row of (expired ?? []) as unknown as { id: string; business_id: string; updated_at: string; opportunities: { lead_id: string | null } | null }[]) {
      const leadId = row.opportunities?.lead_id ?? null;
      if (!leadId) continue;
      examined += 1;
      if (!(await settingsFor(row.business_id)).winBackEnabled) continue;
      if (await planQuoteExpiredTrigger({ businessId: row.business_id, leadId, quoteId: row.id, expiredAt: row.updated_at, now })) planned += 1;
    }
  }

  return { planned, examined };
}

export function enabledForTrigger(trigger: ReengagementTrigger, settings: ReengagementSettings): boolean {
  return enabledFor(trigger, settings);
}
