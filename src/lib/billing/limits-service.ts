import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/audit";
import { countSmsSegments, normaliseForSms } from "@/lib/messaging/sms-segments";
import { BOOKING_REMINDER_SEND_KEY_PREFIX, isBookingReminderSendKey } from "@/lib/automation/scheduler";
import {
  clampSmsCap,
  conversationSmsReserve,
  isEngagedLead,
  perLeadSmsCapAllows,
  smsCapKindFor,
  type SmsCapKind,
} from "@/lib/follow-up/channel-strategy";
import type { Channel } from "@/lib/messaging/types";
import type { PolicyGate } from "@/lib/jobs/send-core";
import { getEntitlements, getPeriodUsage, type Entitlements } from "./entitlements";
import { getV4Entitlements } from "./v4-entitlements";
import { getTokenStatus } from "./token-service";
import {
  consumeMessageCredits,
  getCreditBalances,
  whatsappTokensUsedSince,
  type CreditBalances,
} from "./message-credits";
import {
  whatsappBillingCategory,
  whatsappCoverageText,
  whatsappTokensFor,
  type WhatsappBillingCategory,
} from "./whatsapp-tokens";
import { loadTemplate } from "@/lib/messaging/template-registry";
import { PLANS, allowancesFor, creditBundlesFor, type MessageCreditChannel } from "./plans";
import { overLimitNotice } from "./allowance-gates";
import { overLimitNow } from "./over-limit-service";
import { READ_ONLY_RETENTION_DAYS } from "./cancellation";
import {
  allowanceAlertFor,
  mostUrgentAlert,
  nextAllowanceAlert,
  watermarkForPeriod,
  type AllowanceAlert,
} from "./allowance-alerts";
import {
  dailyCapAllows,
  limitLevel,
  limitPercent,
  nextDailyReset,
  splitConsumption,
  upsellFor,
  type LimitLevel,
  type LimitMetric,
  type UpsellOffer,
} from "./limits";
import { enforcedDailyCap, type AllocationChannel } from "./usage-allocation";
import { daysBetween, GRACE_FULL_ACCESS_DAYS, MAX_DUNNING_ATTEMPTS } from "./lifecycle";
import { getOpenDunning } from "./dunning";

/**
 * Server side of metered limits (8.13): what the send gate enforces, what the
 * meter records, and what the Usage & limits view and the app banner show.
 * Everything is derived from the same allowances (plans.ts via
 * `allowancesFor`) and the same ledger (`usage_events`), so the view cannot
 * show a number the gate does not enforce.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const METERED_CHANNELS = new Set<Channel>(["sms", "whatsapp"]);
const CAPPED_CHANNELS = new Set<Channel>(["sms", "whatsapp", "email"]);

const USAGE_METRIC: Record<MessageCreditChannel, "sms_outbound_segment" | "whatsapp_message"> = {
  sms: "sms_outbound_segment",
  whatsapp: "whatsapp_message",
};

function calendarPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function periodStartOf(entitlements: Entitlements, now = new Date()): string {
  return entitlements.periodStart ?? `${calendarPeriod(now)}T00:00:00.000Z`;
}

async function sumUsage(businessId: string, metric: string, since: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc("sum_usage_events", {
    p_business_id: businessId,
    p_metric: metric,
    p_since: since,
  });
  // A failed read must not read as zero: zero is the state that unlocks sends.
  if (error) throw new Error(`Could not read ${metric} usage: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * Units a message consumes against the balance: SMS segments, or WhatsApp
 * TOKENS by the message's billing category (whatsapp-tokens.ts: 2 for a
 * service reply or utility template, 5 for marketing; no category given is a
 * free-form service reply). The SMS body is counted as it will be sent --
 * normalised to GSM-7 punctuation just before the carrier (send-core) -- so
 * the gate does not refuse or over-count a send for a curly quote the carrier
 * never sees.
 */
export function unitsFor(
  channel: MessageCreditChannel,
  body: string,
  whatsappCategory: WhatsappBillingCategory = "SERVICE",
): number {
  return channel === "sms"
    ? Math.max(1, countSmsSegments(normaliseForSms(body)).segments)
    : whatsappTokensFor(whatsappCategory);
}

/**
 * The category a queued WhatsApp message will be billed at, read now. A
 * message that names a template is priced at that template's category (a
 * template that cannot be read, or has an unrecognised category, is priced as
 * MARKETING, the dearest); one with no template is a service reply. If the
 * window is still open the send may go as free text after all -- the meter then
 * charges the cheaper service rate, so the gate only ever errs on the safe side.
 */
async function queuedWhatsappCategory(templateId: string | null | undefined): Promise<WhatsappBillingCategory> {
  if (!templateId) return "SERVICE";
  const template = await loadTemplate(templateId).catch(() => null);
  return whatsappBillingCategory({ template: true, templateCategory: template?.category ?? null });
}

/* ----------------------------------------------------- per-lead SMS limits */

type SmsCapSettings = { followUp: number; conversation: number };

async function smsCapSettings(businessId: string): Promise<SmsCapSettings> {
  const { data, error } = await db()
    .from("business_settings")
    .select("follow_up_sms_cap_segments, conversation_sms_daily_ceiling")
    .eq("business_id", businessId)
    .maybeSingle();
  // 42703: the columns are not there yet (migration 0138 not applied). The
  // defaults apply rather than refusing every SMS on a schema lag.
  if (error && error.code !== "42703") throw new Error(`Could not read SMS caps: ${error.message}`);
  const row = (data ?? {}) as {
    follow_up_sms_cap_segments?: number | null;
    conversation_sms_daily_ceiling?: number | null;
  };
  return {
    followUp: clampSmsCap(row.follow_up_sms_cap_segments ?? undefined, "followUp"),
    conversation: clampSmsCap(row.conversation_sms_daily_ceiling ?? undefined, "conversation"),
  };
}

/**
 * Whether a lead has engaged (replied, or intent MEDIUM or above). An engaged
 * lead's automated steps are never budgeted (owner rule, channel-strategy.ts).
 * A read error counts as engaged: when unsure, conversion wins.
 */
export async function leadIsEngaged(businessId: string, leadId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("leads")
    .select("first_replied_at, intent_state")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return true;
  const row = data as { first_replied_at: string | null; intent_state: string | null };
  return isEngagedLead({ hasReplied: Boolean(row.first_replied_at), intentState: row.intent_state });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SMS segments already sent to one lead that count against a limit: automated
 * follow-up within one sequence run (booking reminders excluded), or the
 * agent's replies in the last 24 hours (the abuse ceiling). Counted from the
 * bodies as sent.
 */
async function smsSegmentsSentToLead(input: {
  businessId: string;
  leadId: string;
  kind: SmsCapKind;
  automationRunId: string | null;
  excludeMessageId?: string | null;
  at?: Date;
}): Promise<number> {
  let query = db()
    .from("messages")
    .select("id, body")
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .eq("channel", "sms")
    .eq("direction", "outbound")
    .in("status", ["SENDING", "SENT", "DELIVERED"]);
  if (input.kind === "follow_up") {
    query = query.eq("origin", "automation").not("send_key", "like", `${BOOKING_REMINDER_SEND_KEY_PREFIX}%`);
    if (input.automationRunId) query = query.eq("automation_run_id", input.automationRunId);
  } else {
    const since = new Date((input.at ?? new Date()).getTime() - DAY_MS).toISOString();
    query = query.in("origin", ["agent", "agent_handover"]).gte("created_at", since);
  }
  const { data, error } = await query;
  // A failed read must not read as zero: zero is the state that unlocks sends.
  if (error) throw new Error(`Could not count SMS sent to this lead: ${error.message}`);
  return ((data ?? []) as { id: string; body: string | null }[])
    .filter((row) => row.id !== input.excludeMessageId)
    .reduce((sum, row) => sum + Math.max(1, countSmsSegments(normaliseForSms(row.body ?? "")).segments), 0);
}

async function automationRunOf(messageId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("messages")
    .select("automation_run_id")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the message's sequence: ${error.message}`);
  return (data as { automation_run_id: string | null } | null)?.automation_run_id ?? null;
}

/**
 * The per-lead SMS limit for one send, or null when it has no objection.
 *
 *  - Automated follow-up to an UNENGAGED lead is capped per sequence run. An
 *    engaged lead (replied, or intent MEDIUM+) is not budgeted at all.
 *  - The agent's replies in a live conversation are never budgeted; only an
 *    abuse ceiling per rolling 24 hours applies, and at it the lead is handed
 *    to a person (send-store `blockedByPolicy`).
 *  - Manual, campaign, system sends and booking reminders are not limited per lead.
 */
async function perLeadSmsGate(input: {
  businessId: string;
  leadId: string;
  messageId: string | null;
  origin: string;
  sendKey: string | null;
  units: number;
  at: Date;
}): Promise<PolicyGate | null> {
  const bookingReminder = isBookingReminderSendKey(input.sendKey);
  let kind = smsCapKindFor({ origin: input.origin, bookingReminder });
  if (!kind) return null;
  if (kind === "follow_up" && (await leadIsEngaged(input.businessId, input.leadId))) {
    kind = smsCapKindFor({ origin: input.origin, bookingReminder, engaged: true });
    if (!kind) return null;
  }
  const caps = await smsCapSettings(input.businessId);
  const cap = kind === "follow_up" ? caps.followUp : caps.conversation;
  const automationRunId = kind === "follow_up" && input.messageId ? await automationRunOf(input.messageId) : null;
  const used = await smsSegmentsSentToLead({
    businessId: input.businessId,
    leadId: input.leadId,
    kind,
    automationRunId,
    excludeMessageId: input.messageId,
    at: input.at,
  });
  if (perLeadSmsCapAllows({ usedSegments: used, units: input.units, cap })) return null;
  return {
    action: "block",
    reasonCode: "BLOCKED_COST_BUDGET",
    message:
      kind === "follow_up"
        ? `This lead has not replied and has had ${used} of the ${cap} automated follow-up SMS segments allowed per sequence; later steps go by email. Raise the cap in Follow-Up, Channel & SMS budget, to send more SMS.`
        : `The AI has sent this lead ${used} SMS segments in the last 24 hours, the abuse ceiling of ${cap}. A person should take the conversation from here.`,
  };
}

/**
 * Queue-time check the follow-up worker uses to choose a channel for an
 * UNENGAGED lead: would an SMS of `units` segments fit this lead's follow-up
 * cap AND the workspace's allowance or top-up credit, without dipping into
 * the SMS kept back for live conversations (`conversationSmsReserve`)? The
 * send-time gate re-checks the cap and the allowance; this only lets the worker
 * pick email up front instead of queueing an SMS that would be refused or
 * would starve a conversation. Fails closed (false) on a read error, which
 * routes to email.
 */
export async function followUpSmsAffordable(input: {
  businessId: string;
  leadId: string;
  automationRunId: string | null;
  units?: number;
}): Promise<boolean> {
  const units = input.units ?? 1;
  try {
    const entitlements = await getEntitlements(input.businessId);
    if (!entitlements.sendingAllowed || entitlements.access === "restricted") return false;
    const [caps, used] = await Promise.all([
      smsCapSettings(input.businessId),
      smsSegmentsSentToLead({
        businessId: input.businessId,
        leadId: input.leadId,
        kind: "follow_up",
        automationRunId: input.automationRunId,
      }),
    ]);
    if (!perLeadSmsCapAllows({ usedSegments: used, units, cap: caps.followUp })) return false;
    const reserve = conversationSmsReserve({
      plan: entitlements.plan,
      allowance: allowancesFor(entitlements.plan).smsSegmentAllowance,
    });
    const split = await consumptionFor({
      businessId: input.businessId,
      entitlements,
      channel: "sms",
      units: units + reserve,
      at: new Date(),
    });
    return split.allowed;
  } catch {
    return false;
  }
}

type AllocationRow = {
  daily_caps_json: Partial<Record<AllocationChannel, number>> | null;
};

async function allocationRow(businessId: string, now = new Date()): Promise<AllocationRow | null> {
  const { data, error } = await db()
    .from("customer_usage_allocations")
    .select("daily_caps_json")
    .eq("business_id", businessId)
    .eq("billing_period", calendarPeriod(now))
    .maybeSingle();
  if (error) throw new Error(`Could not read usage settings: ${error.message}`);
  return (data as AllocationRow | null) ?? null;
}

async function sentToday(businessId: string, channel: Channel, now: Date): Promise<number> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { count, error } = await createAdminClient()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("direction", "outbound")
    .in("status", ["SENDING", "SENT", "DELIVERED"])
    .gte("created_at", startOfDay.toISOString());
  if (error) throw new Error(`Could not count today's ${channel} sends: ${error.message}`);
  return count ?? 0;
}

/* ------------------------------------------------------------- send gate */

/**
 * The refusal at zero. The reason code `BLOCKED_MONTHLY_LIMIT` is what the send
 * store keys the email re-route and the hand-over on (send-store
 * `blockedByPolicy`), so it is kept distinct from the per-lead caps.
 */
const limitReachedMessage = (channel: MessageCreditChannel, units: number) =>
  channel === "sms"
    ? "This period's SMS allowance is used up and there is no top-up credit left. Buy credits in Settings → Billing & Usage."
    : `There are not enough WhatsApp tokens left for this message (it needs ${units}). Buy a WhatsApp token pack in Settings → Billing & Usage.`;

/**
 * The billing half of the send-time gate, run immediately before a message
 * goes to the carrier. Null means "billing has no objection".
 *
 *   * dunning pause (payment failed 3+ days ago)  -> defer 24h, not dropped
 *   * daily cap for the channel reached            -> defer to tomorrow
 *   * SMS/WhatsApp: allowance, then top-up credit,
 *     otherwise                                    -> block, with the reason
 *     (no overage: owner rule 2026-09-27)
 */
export async function billingSendGate(input: {
  businessId: string;
  channel: Channel;
  body: string;
  origin: string;
  at: Date;
  /** For the per-lead SMS caps. Without a lead there is nothing to cap. */
  leadId?: string | null;
  messageId?: string | null;
  sendKey?: string | null;
  /** WhatsApp: the approved template the step queued, if any (prices it by category). */
  whatsappTemplateId?: string | null;
}): Promise<PolicyGate | null> {
  const entitlements = await getEntitlements(input.businessId);

  if (entitlements.access === "restricted") {
    return {
      action: "defer",
      at: new Date(input.at.getTime() + 24 * 60 * 60 * 1000),
      reasonCode: "BLOCKED_BUSINESS_STATE",
    };
  }
  if (!entitlements.sendingAllowed) {
    return {
      action: "block",
      reasonCode: "BLOCKED_BUSINESS_STATE",
      message: "This workspace does not have an active subscription.",
    };
  }

  const needsCaps = CAPPED_CHANNELS.has(input.channel) && input.origin !== "manual";
  const needsMetering = METERED_CHANNELS.has(input.channel);
  if (!needsCaps && !needsMetering) return null;

  const allocation = await allocationRow(input.businessId, input.at);

  // A daily cap paces automated and campaign traffic; a person typing a reply
  // is not held back by it.
  if (needsCaps) {
    const cap = enforcedDailyCap(input.channel as AllocationChannel, allocation?.daily_caps_json);
    const today = await sentToday(input.businessId, input.channel, input.at);
    if (!dailyCapAllows({ sentToday: today, cap })) {
      return { action: "defer", at: nextDailyReset(input.at), reasonCode: "BLOCKED_DAILY_LIMIT" };
    }
  }

  if (!needsMetering) return null;

  const channel = input.channel as MessageCreditChannel;
  const units = unitsFor(
    channel,
    input.body,
    channel === "whatsapp" ? await queuedWhatsappCategory(input.whatsappTemplateId) : undefined,
  );

  // Per-lead SMS budget: automated follow-up per sequence run, and a separate
  // cap on the agent's replies. Checked before the monthly allowance so a
  // refusal names the per-lead cap rather than the workspace's allowance.
  if (channel === "sms" && input.leadId) {
    const capped = await perLeadSmsGate({
      businessId: input.businessId,
      leadId: input.leadId,
      messageId: input.messageId ?? null,
      origin: input.origin,
      sendKey: input.sendKey ?? null,
      units,
      at: input.at,
    });
    if (capped) return capped;
  }

  const split = await consumptionFor({
    businessId: input.businessId,
    entitlements,
    channel,
    units,
    at: input.at,
  });

  if (!split.allowed) {
    return {
      action: "block",
      reasonCode: "BLOCKED_MONTHLY_LIMIT",
      message: limitReachedMessage(channel, units),
    };
  }
  return null;
}

async function consumptionFor(input: {
  businessId: string;
  entitlements: Entitlements;
  channel: MessageCreditChannel;
  units: number;
  at: Date;
}) {
  // WhatsApp has no included allowance on any plan (plans.ts; the margin test
  // asserts 0): every WhatsApp message is paid in tokens, so there is no
  // period usage to read. `whatsappMessageAllowance` counts messages, not
  // tokens, and is never mixed into a token split.
  if (input.channel === "whatsapp") {
    const credits = await getCreditBalances(input.businessId);
    return splitConsumption({
      quantity: input.units,
      allowance: 0,
      usedThisPeriod: 0,
      creditBalance: credits.whatsapp,
    });
  }
  const allowance = allowancesFor(input.entitlements.plan).smsSegmentAllowance;
  const [used, credits] = await Promise.all([
    sumUsage(input.businessId, USAGE_METRIC[input.channel], periodStartOf(input.entitlements, input.at)),
    getCreditBalances(input.businessId),
  ]);

  return splitConsumption({
    quantity: input.units,
    allowance,
    usedThisPeriod: used,
    creditBalance: credits[input.channel],
  });
}

/* ------------------------------------------------------------------ meter */

/**
 * After a send: records the units against the ledger (SMS by segment), then
 * spends any credit the send needed -- in that order, matching the gate.
 * There is no overage: a send the gate let through that a concurrent send
 * overtook is recorded in the ledger (it went) and the next send is refused.
 * Never throws: the message has already gone, and a failure
 * here must not fail (and so retry) a send that succeeded. Idempotent on the
 * message: a second run finds the ledger row and stops.
 */
export async function meterSendBilling(input: {
  businessId: string;
  messageId: string;
  channel: Channel;
  body: string;
  /**
   * WhatsApp: the approved template the message actually went out as (send-core
   * `message.template`), or null for a free-form reply inside the 24h window,
   * which is billed as SERVICE. A template's category decides its tokens; an
   * unrecognised one is billed as MARKETING.
   */
  whatsappTemplate?: { category: string | null } | null;
}): Promise<void> {
  if (!METERED_CHANNELS.has(input.channel)) return;
  const channel = input.channel as MessageCreditChannel;
  const operationId = `send-units:${input.messageId}`;

  try {
    const existing = await createAdminClient()
      .from("usage_events")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("operation_id", operationId)
      .limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.length) return;

    const now = new Date();
    const entitlements = await getEntitlements(input.businessId);
    const whatsappCategory =
      channel === "whatsapp"
        ? whatsappBillingCategory({
            template: Boolean(input.whatsappTemplate),
            templateCategory: input.whatsappTemplate?.category ?? null,
          })
        : undefined;
    const units = unitsFor(channel, input.body, whatsappCategory);
    // Split against usage *before* this message is recorded.
    const split = await consumptionFor({
      businessId: input.businessId,
      entitlements,
      channel,
      units,
      at: now,
    });

    await recordUsage({
      businessId: input.businessId,
      metric: USAGE_METRIC[channel],
      // The usage ledger counts SMS segments and WhatsApp MESSAGES (the admin
      // economics reads it that way); WhatsApp tokens go in the metadata and
      // in the message credit ledger.
      quantity: channel === "whatsapp" ? 1 : units,
      provider: "twilio",
      entity: { type: "message", id: input.messageId },
      operationId,
      metadata: {
        ...(channel === "whatsapp"
          ? { whatsapp_billing_category: whatsappCategory, whatsapp_tokens: units }
          : {}),
        from_allowance: split.fromAllowance,
        from_credits: split.fromCredits,
        // Units past allowance and credit: only a send that raced another
        // past the gate. Recorded so it is visible, never charged.
        uncovered: split.quantity - split.fromAllowance - split.fromCredits,
      },
    });

    if (split.fromCredits > 0) {
      await consumeMessageCredits({
        businessId: input.businessId,
        channel,
        quantity: split.fromCredits,
        messageId: input.messageId,
      });
    }

  } catch (error) {
    console.error("[billing meter] could not meter a sent message", {
      businessId: input.businessId,
      messageId: input.messageId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // "Coming up to it": tell the owner at 75%, 90% and 100%. After the meter,
  // so it sees this send; never throws, so it cannot fail or retry the send.
  await maybeNotifyAllowance(input.businessId, channel);
}

/* ------------------------------------------------------- allowance alerts */

/**
 * The running-low alert for each metered channel this workspace can use,
 * from live usage and credit (allowance-alerts.ts is the one rule). WhatsApp
 * only where the plan includes it.
 */
async function allowanceAlerts(
  businessId: string,
  entitlements: Entitlements,
  now: Date,
  channels: readonly MessageCreditChannel[] = ["sms", "whatsapp"],
): Promise<Partial<Record<MessageCreditChannel, AllowanceAlert | null>>> {
  const wanted = channels.filter((channel) => channel === "sms" || entitlements.whatsappEnabled);
  if (wanted.length === 0) return {};
  const since = periodStartOf(entitlements, now);
  const allowances = allowancesFor(entitlements.plan);
  const trial = entitlements.plan === "trial";
  const [credits, ...used] = await Promise.all([
    getCreditBalances(businessId),
    // WhatsApp is measured in tokens spent this period, the unit its balance
    // is in; SMS in segments against its allowance.
    ...wanted.map((channel) =>
      channel === "whatsapp"
        ? whatsappTokensUsedSince(businessId, since)
        : sumUsage(businessId, USAGE_METRIC[channel], since),
    ),
  ]);
  const bundles = trial ? [] : creditBundlesFor({ whatsappEnabled: entitlements.whatsappEnabled });

  const result: Partial<Record<MessageCreditChannel, AllowanceAlert | null>> = {};
  wanted.forEach((channel, index) => {
    result[channel] = allowanceAlertFor({
      channel,
      trial,
      // WhatsApp has no included allowance: tokens only.
      allowance: channel === "sms" ? allowances.smsSegmentAllowance : 0,
      usedThisPeriod: used[index],
      creditBalance: credits[channel],
      periodStart: since,
      periodEnd: entitlements.periodEnd,
      trialEndsAt: entitlements.trialEndsAt,
      now,
      bundles,
    });
  });
  return result;
}

/**
 * Notifies owners and admins once per threshold per period per channel. The
 * watermark (messaging_allowance_alerts, 0140) is raised with a conditional
 * update before anything is queued, so two concurrent sends cannot both
 * notify. Never throws.
 */
async function maybeNotifyAllowance(businessId: string, channel: MessageCreditChannel): Promise<void> {
  try {
    const now = new Date();
    const entitlements = await getEntitlements(businessId);
    if (channel === "whatsapp" && !entitlements.whatsappEnabled) return;
    const alert = (await allowanceAlerts(businessId, entitlements, now, [channel]))[channel] ?? null;
    const periodStart = periodStartOf(entitlements, now);

    const table = () => db().from("messaging_allowance_alerts");
    const { data: stored, error: readError } = await table()
      .select("period_start, warned_at_percent")
      .eq("business_id", businessId)
      .eq("channel", channel)
      .eq("period_start", periodStart)
      .maybeSingle();
    // 42P01: migration 0140 not applied yet. No watermark means no alert,
    // rather than an alert on every send.
    if (readError) {
      if (readError.code !== "42P01") throw readError;
      return;
    }
    const row = stored as { period_start: string; warned_at_percent: number } | null;
    const watermark = watermarkForPeriod(
      row ? { periodStart: row.period_start, warnedAtPercent: row.warned_at_percent } : null,
      periodStart,
    );
    const next = nextAllowanceAlert({ crossed: alert ? alert.threshold : null, watermark });
    if (next.watermark === watermark) return;

    if (!row) {
      const { error } = await table().insert({
        business_id: businessId,
        channel,
        period_start: periodStart,
        warned_at_percent: 0,
      });
      if (error && error.code !== "23505") throw error;
    }

    if (next.notify === null) {
      // A top-up took usage back under a threshold: re-arm it quietly.
      await table()
        .update({ warned_at_percent: next.watermark, updated_at: now.toISOString() })
        .eq("business_id", businessId)
        .eq("channel", channel)
        .eq("period_start", periodStart)
        .gt("warned_at_percent", next.watermark);
      return;
    }

    const { data: claimed, error: claimError } = await table()
      .update({ warned_at_percent: next.notify, updated_at: now.toISOString() })
      .eq("business_id", businessId)
      .eq("channel", channel)
      .eq("period_start", periodStart)
      .lt("warned_at_percent", next.notify)
      .select("business_id");
    if (claimError) throw claimError;
    // Another send claimed this threshold first; it sends the notification.
    if (!claimed?.length || !alert) return;

    // Lazily imported: the job queue is not needed on the gate's path.
    const { queueNotification } = await import("@/lib/jobs/handlers/shared");
    await queueNotification({
      businessId,
      type: "billing",
      severity: alert.tone === "danger" ? "error" : "warning",
      title: alert.title,
      body: alert.body,
      // The email appends this link on its own line and the in-app row opens
      // it: one click lands on Billing with the recommended pack selected
      // (or on the plan choice, in a trial).
      linkUrl: alert.action.href,
      dedupeKey: `allowance:${businessId}:${channel}:${periodStart}:${next.notify}`,
    });
    // Automation trigger (gap map §45): the allowance ran out. Claimed above,
    // so it fires once per period per channel, like the notification.
    if (next.notify === 100) {
      const { emitAutomationEvent } = await import("@/lib/automation/events");
      await emitAutomationEvent({ businessId, eventType: "usage.exhausted", payload: { metric: channel, periodStart } });
    }
  } catch (error) {
    console.error("[billing meter] allowance alert check failed", {
      businessId,
      channel,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------- limits overview */

export type LimitRow = {
  key: string;
  metric: LimitMetric | "email" | "prospects" | "search_runs";
  label: string;
  unit: string;
  monthly: { used: number; limit: number; percent: number; level: LimitLevel };
  daily: { used: number; cap: number } | null;
  credits: number | null;
  /** What happens at the limit, in words. */
  atLimit: string;
  upsell: UpsellOffer | null;
  /**
   * SMS / WhatsApp only: the running-low alert from 75% (allowance-alerts.ts),
   * the same one the banner and the owner notification use.
   */
  alert?: AllowanceAlert | null;
};

export type LimitsOverview = {
  plan: string;
  selectedPlan: string;
  state: Entitlements["state"];
  periodStart: string;
  rows: LimitRow[];
  credits: CreditBalances;
  /** Whether the plan includes WhatsApp: decides which credit bundles are offered. */
  whatsappEnabled: boolean;
};

function row(input: Omit<LimitRow, "monthly" | "upsell"> & {
  used: number;
  limit: number;
  plan: string;
  upsellMetric?: LimitMetric;
}): LimitRow {
  const { used, limit, plan, upsellMetric, ...rest } = input;
  // SMS and WhatsApp follow the running-low rule (allowance-alerts.ts), which
  // counts top-up credit and starts at 75%; everything else keeps 80% / 100%.
  const messaging = upsellMetric === "sms" || upsellMetric === "whatsapp";
  const alertLevel: LimitLevel | undefined = messaging
    ? rest.alert
      ? rest.alert.threshold === 100
        ? "reached"
        : "warning"
      : "ok"
    : undefined;
  return {
    ...rest,
    monthly: { used, limit, percent: limitPercent(used, limit), level: alertLevel ?? limitLevel(used, limit) },
    upsell: upsellMetric ? upsellFor({ metric: upsellMetric, plan, used, limit, level: alertLevel }) : null,
  };
}

/** What happens at zero on a metered channel, in words (send-store behaviour). */
function atLimitText(channel: MessageCreditChannel, credits: number): string {
  const label = channel === "sms" ? "SMS" : "WhatsApp";
  const first =
    channel === "sms"
      ? "After the monthly allowance, sends use top-up credit"
      : "WhatsApp is a paid add-on with no included messages: each message uses WhatsApp tokens (2 for a reply or utility template, 5 for a marketing template)";
  const balance =
    credits <= 0
      ? ""
      : channel === "sms"
        ? ` (${credits.toLocaleString("en-GB")} left)`
        : ` (${credits.toLocaleString("en-GB")} tokens left, ${whatsappCoverageText(credits)})`;
  return `${first}${balance}. With none left, ${label} is refused: automated steps and AI replies go by email where the lead has an address and a mailbox is connected; otherwise the lead is passed to your team.`;
}

export async function getLimitsOverview(businessId: string): Promise<LimitsOverview> {
  const now = new Date();
  const entitlements = await getEntitlements(businessId);
  const since = periodStartOf(entitlements, now);
  const allowances = allowancesFor(entitlements.plan);
  // Upsells start from the tier being paid for (or chosen, in a trial).
  const upsellPlan = entitlements.state === "TRIALING" ? entitlements.selectedPlan : entitlements.plan;

  const [allocation, credits, smsUsed, whatsappTokensUsed, periodUsage, v4, tokens, smsToday, waToday, emailToday, seats, alerts] =
    await Promise.all([
      allocationRow(businessId, now),
      getCreditBalances(businessId),
      sumUsage(businessId, "sms_outbound_segment", since),
      whatsappTokensUsedSince(businessId, since),
      getPeriodUsage(businessId, entitlements.periodStart),
      getV4Entitlements(businessId),
      getTokenStatus(businessId).catch(() => null),
      sentToday(businessId, "sms", now),
      sentToday(businessId, "whatsapp", now),
      sentToday(businessId, "email", now),
      createAdminClient()
        .from("business_members")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .in("status", ["active", "invited"]),
      allowanceAlerts(businessId, entitlements, now).catch(() => ({}) as Partial<Record<MessageCreditChannel, AllowanceAlert | null>>),
    ]);

  const [emailUsed, prospectsUsed, runsUsed] = await Promise.all([
    sumUsage(businessId, "email_sent", since),
    sumUsage(businessId, "verified_prospect", since),
    sumUsage(businessId, "search_run", since),
  ]);

  const caps = allocation?.daily_caps_json ?? null;
  const rows: LimitRow[] = [
    row({
      key: "leads",
      metric: "leads",
      label: "New leads",
      unit: "leads",
      used: periodUsage.leads,
      limit: entitlements.leadLimit,
      plan: upsellPlan,
      upsellMetric: "leads",
      daily: null,
      credits: null,
      // Honest about current behaviour (billing/lead-cap.ts): nothing that
      // arrives is ever dropped, but past the limit it is held, not contacted.
      atLimit:
        "Enquiries that arrive keep being captured and are never dropped, but past the limit they are held without follow-up, and adding a lead by hand, import, API or assistant is refused until the next period. Regularly going over means the next plan fits better.",
    }),
    row({
      key: "sms",
      metric: "sms",
      label: "SMS",
      unit: "segments",
      used: smsUsed,
      limit: allowances.smsSegmentAllowance,
      plan: upsellPlan,
      upsellMetric: "sms",
      alert: alerts.sms ?? null,
      daily: { used: smsToday, cap: enforcedDailyCap("sms", caps) },
      credits: credits.sms,
      atLimit: atLimitText("sms", credits.sms),
    }),
    row({
      key: "whatsapp",
      metric: "whatsapp",
      label: "WhatsApp",
      // Tokens: the unit WhatsApp is bought and spent in. No allowance.
      unit: "tokens",
      used: whatsappTokensUsed,
      limit: 0,
      plan: upsellPlan,
      upsellMetric: "whatsapp",
      alert: alerts.whatsapp ?? null,
      daily: { used: waToday, cap: enforcedDailyCap("whatsapp", caps) },
      credits: credits.whatsapp,
      atLimit: entitlements.whatsappEnabled
        ? atLimitText("whatsapp", credits.whatsapp)
        : "The WhatsApp add-on is not available on this plan.",
    }),
    row({
      key: "email",
      metric: "email",
      label: "Email",
      unit: "emails",
      used: emailUsed,
      limit: v4.allowances.email_sent.hardLimit,
      plan: upsellPlan,
      daily: { used: emailToday, cap: enforcedDailyCap("email", caps) },
      credits: null,
      atLimit: "Outreach email stops at the allowance until the next period, or upgrade for more.",
    }),
    row({
      key: "ai_tokens",
      metric: "ai_tokens",
      label: "AI tokens",
      unit: "tokens",
      used: tokens?.used ?? 0,
      limit: tokens?.granted ?? allowances.aiTokenAllowance,
      plan: upsellPlan,
      upsellMetric: "ai_tokens",
      daily: null,
      credits: tokens?.purchasedTokens ?? null,
      atLimit: "The AI assistant pauses; follow-up and qualification rules keep running. Top up tokens to resume.",
    }),
    row({
      key: "users",
      metric: "users",
      label: "Team members",
      unit: "seats",
      used: seats.count ?? 0,
      limit: entitlements.userLimit,
      plan: upsellPlan,
      upsellMetric: "users",
      daily: null,
      credits: null,
      atLimit: "New invitations are refused until a seat is freed or the plan is upgraded.",
    }),
    row({
      key: "prospects",
      metric: "prospects",
      label: "Verified prospects",
      unit: "prospects",
      used: prospectsUsed,
      limit: v4.allowances.verified_prospect.hardLimit,
      plan: upsellPlan,
      daily: null,
      credits: null,
      atLimit: "Sourcing stops at the allowance until the next period, or upgrade for more.",
    }),
    row({
      key: "search_runs",
      metric: "search_runs",
      label: "Sourcing runs",
      unit: "runs",
      used: runsUsed,
      limit: v4.allowances.search_run.hardLimit,
      plan: upsellPlan,
      daily: null,
      credits: null,
      atLimit: "New runs are refused until the next period.",
    }),
  ];

  return {
    plan: entitlements.plan,
    selectedPlan: entitlements.selectedPlan,
    state: entitlements.state,
    periodStart: since,
    rows,
    credits,
    whatsappEnabled: entitlements.whatsappEnabled,
  };
}

/* --------------------------------------------------------------- banner */

export type BillingNotice = {
  tone: "info" | "warning" | "danger";
  title: string;
  body: string;
  action: { label: string; href: string } | null;
  /**
   * A trial notice: the banner offers "Upgrade now" (end the trial today on
   * the card already on file) instead of, or beside, the plain link.
   */
  upgradeNow?: boolean;
};

/**
 * The one banner the app shell shows, most urgent first: a failed payment,
 * an ended subscription, a trial about to convert, then SMS / WhatsApp at
 * 75%, 90% or run out (allowance-alerts.ts). Honest: every figure is read, nothing is invented to hurry
 * anyone.
 */
export async function getBillingNotice(
  businessId: string,
  entitlements: Entitlements,
): Promise<BillingNotice | null> {
  const now = new Date();

  if (entitlements.state === "PAST_DUE_GRACE" || entitlements.state === "PAST_DUE_RESTRICTED") {
    const dunning = await getOpenDunning(businessId);
    const day = dunning ? daysBetween(new Date(dunning.firstFailedAt), now) : 0;
    return entitlements.state === "PAST_DUE_RESTRICTED"
      ? {
          tone: "danger",
          title: "Sending and AI are paused: your last payment failed",
          body: `Leads are still being captured and nothing has been deleted. We retry the charge daily (${dunning?.attempts ?? 0} of ${MAX_DUNNING_ATTEMPTS} retries so far). Update your card to resume straight away.`,
          action: { label: "Update card", href: "/api/billing/portal" },
        }
      : {
          tone: "warning",
          title: "Your last payment didn't go through",
          body: `Everything is still running. We will retry daily; if it is still unpaid ${Math.max(0, GRACE_FULL_ACCESS_DAYS - day)} day(s) from now, sending and AI pause until it is.`,
          action: { label: "Update card", href: "/api/billing/portal" },
        };
  }

  if (entitlements.state === "CANCELLED") {
    return {
      tone: "danger",
      title: "This workspace is read-only",
      body: `The subscription has ended. Your data is intact and can be exported for ${READ_ONLY_RETENTION_DAYS} days, then deleted as our privacy policy sets out; resubscribe to carry on.`,
      action: { label: "Resubscribe", href: "/start-trial" },
    };
  }

  // Over the plan's count limits (a downgrade, a lowered grant):
  // allowance-gates.ts. Nothing was removed; creating more is refused.
  const overLimit = await overLimitNow(businessId).catch(() => []);
  const overNotice = overLimitNotice(overLimit, PLANS[entitlements.plan as keyof typeof PLANS]?.name ?? entitlements.plan);
  if (overNotice) {
    return {
      tone: "warning",
      title: overNotice.title,
      body: overNotice.body,
      action: { label: "Review limits", href: "/app/settings?section=billing" },
    };
  }

  if (entitlements.state === "TRIALING" && entitlements.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(entitlements.trialEndsAt).getTime() - now.getTime()) / 86_400_000);
    if (daysLeft <= 3 && daysLeft >= 0) {
      return {
        tone: "info",
        title: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body: "Your card is charged then and the plan's full limits switch on. Change plan or cancel from Billing.",
        action: { label: "Review plan", href: "/app/settings?section=billing" },
        upgradeNow: true,
      };
    }
  }

  // SMS / WhatsApp running low (75%, 90%) or run out: the one rule the owner
  // notification and the Usage & limits row also use (allowance-alerts.ts),
  // with top-up credit counted and the recommended pack one click away.
  const alerts = await allowanceAlerts(businessId, entitlements, now);
  const alert = mostUrgentAlert([alerts.sms ?? null, alerts.whatsapp ?? null]);
  if (alert) {
    return {
      tone: alert.tone,
      title: alert.title,
      body: alert.body,
      action: alert.action,
      upgradeNow: alert.trial,
    };
  }

  return null;
}
