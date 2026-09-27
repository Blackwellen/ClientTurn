import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { enqueue } from "@/lib/jobs/queue";
import { leadDisplayName } from "@/lib/leads/types";
import { getEntitlements, type Entitlements } from "./entitlements";
import { getCreditBalances } from "./message-credits";
import { unitsFor } from "./limits-service";
import { allowancesFor } from "./plans";
import { stripe, priceIdFor } from "./stripe";
import { previewEndTrialCharge, type EndTrialPreview } from "./end-trial";
import {
  HELD_REPLY_ATTENTION_REASON,
  HELD_REPLY_ERROR_CODE,
  HELD_REPLY_MAX_AGE_HOURS,
  HELD_REPLY_ORIGINS,
  LIVE_CONVERSATION_DAYS,
  decideTrialUpgradePrompt,
  isSelfServePlan,
  pickCandidate,
  planHeldReplyRelease,
  releaseJobKey,
  type HeldReplyRow,
  type LeadFlagRow,
  type PromptCandidate,
  type PromptDecision,
  type SelfServePlan,
} from "./trial-upgrade-prompt";

/**
 * The database side of the trial "upgrade now" prompt: reads the facts the
 * pure decision (trial-upgrade-prompt.ts) needs, and releases the AI SMS
 * replies that were held at the trial's limit once the trial has converted.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const DAY_MS = 86_400_000;

function periodStartOf(entitlements: Entitlements, now: Date): string {
  // Same rule as limits-service: the Stripe period, else the calendar month.
  if (entitlements.periodStart) return entitlements.periodStart;
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
}

/* ------------------------------------------------------------- the offer */

export type TrialUpgradeOffer = {
  /** The tier chosen at checkout: what "Upgrade now" starts by default. */
  selectedPlan: SelfServePlan;
  interval: "month" | "year";
  trialEndsAt: string | null;
  card: { brand: string; last4: string } | null;
};

/** What the modal needs to show the plan, or null when the workspace is not trialling. */
export async function getTrialUpgradeOffer(businessId: string): Promise<TrialUpgradeOffer | null> {
  const entitlements = await getEntitlements(businessId);
  if (entitlements.state !== "TRIALING") return null;
  const { data } = await db()
    .from("subscriptions")
    .select("billing_interval, payment_method_brand, payment_method_last4")
    .eq("business_id", businessId)
    .maybeSingle();
  const row = (data ?? null) as {
    billing_interval: string | null;
    payment_method_brand: string | null;
    payment_method_last4: string | null;
  } | null;
  return {
    selectedPlan: isSelfServePlan(entitlements.selectedPlan) ? entitlements.selectedPlan : "starter",
    interval: row?.billing_interval === "year" ? "year" : "month",
    trialEndsAt: entitlements.trialEndsAt,
    card: row?.payment_method_last4
      ? { brand: row.payment_method_brand ?? "card", last4: row.payment_method_last4 }
      : null,
  };
}

/** Stripe's preview of the charge if the trial ended now on `plan`. */
export async function previewTrialConversion(
  businessId: string,
  plan: SelfServePlan,
): Promise<EndTrialPreview | null> {
  const { data } = await db()
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("business_id", businessId)
    .maybeSingle();
  const subscriptionId = (data as { stripe_subscription_id: string | null } | null)?.stripe_subscription_id;
  if (!subscriptionId) return null;
  return previewEndTrialCharge({ stripe, subscriptionId, targetPlan: plan, priceIdFor });
}

/* ------------------------------------------------------------- the prompt */

export type TrialUpgradePrompt = {
  decision: PromptDecision;
  offer: TrialUpgradeOffer | null;
};

type MessageRow = HeldReplyRow & { body: string | null };

/**
 * Whether to show the "continue by SMS: upgrade now" modal on this page load,
 * and about which lead. Never throws: a failed read shows nothing (the banner
 * still carries the message).
 */
export async function loadTrialUpgradePrompt(input: {
  businessId: string;
  role: string;
  preferLeadId?: string | null;
  now?: Date;
}): Promise<TrialUpgradePrompt | null> {
  try {
    const now = input.now ?? new Date();
    const entitlements = await getEntitlements(input.businessId);
    // Cheap exits first: no reads for a paying workspace or a member.
    const gate = decideTrialUpgradePrompt({
      plan: entitlements.plan,
      state: entitlements.state,
      role: input.role,
      allowance: 0,
      usedThisPeriod: 0,
      creditBalance: 0,
      candidate: null,
    });
    if (gate.show === false && (gate.reason === "not_trial" || gate.reason === "role")) return null;

    const since = periodStartOf(entitlements, now);
    const [usage, credits, candidate] = await Promise.all([
      createAdminClient().rpc("sum_usage_events", {
        p_business_id: input.businessId,
        p_metric: "sms_outbound_segment",
        p_since: since,
      }),
      getCreditBalances(input.businessId),
      findCandidate(input.businessId, now, input.preferLeadId ?? null),
    ]);
    if (usage.error) return null;

    const decision = decideTrialUpgradePrompt({
      plan: entitlements.plan,
      state: entitlements.state,
      role: input.role,
      allowance: allowancesFor("trial").smsSegmentAllowance,
      usedThisPeriod: Number(usage.data ?? 0),
      creditBalance: credits.sms,
      candidate,
    });
    if (!decision.show) return null;
    return { decision, offer: await getTrialUpgradeOffer(input.businessId) };
  } catch (error) {
    console.error("[trial-upgrade] prompt read failed", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function findCandidate(
  businessId: string,
  now: Date,
  preferLeadId: string | null,
): Promise<PromptCandidate | null> {
  const liveSince = new Date(now.getTime() - LIVE_CONVERSATION_DAYS * DAY_MS).toISOString();
  const heldSince = new Date(now.getTime() - HELD_REPLY_MAX_AGE_HOURS * 3_600_000).toISOString();

  const [held, inbound] = await Promise.all([
    db()
      .from("messages")
      .select("id, lead_id, channel, direction, status, origin, error_code, created_at, send_key, body")
      .eq("business_id", businessId)
      .eq("direction", "outbound")
      .eq("channel", "sms")
      .eq("status", "BLOCKED")
      .eq("error_code", HELD_REPLY_ERROR_CODE)
      .in("origin", [...HELD_REPLY_ORIGINS])
      .gte("created_at", heldSince)
      .order("created_at", { ascending: false })
      .limit(50),
    db()
      .from("messages")
      .select("lead_id, created_at")
      .eq("business_id", businessId)
      .eq("direction", "inbound")
      .eq("channel", "sms")
      .gte("created_at", liveSince)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (held.error || inbound.error) return null;

  const heldRows = (held.data ?? []) as MessageRow[];
  const inboundRows = (inbound.data ?? []) as { lead_id: string | null; created_at: string }[];
  const byLead = new Map<string, PromptCandidate & { lastActivityAt: string }>();
  for (const row of heldRows) {
    if (!row.lead_id || byLead.has(row.lead_id)) continue; // newest first
    byLead.set(row.lead_id, {
      leadId: row.lead_id,
      leadName: "",
      hasHeldReply: true,
      hasRecentInboundSms: false,
      heldReplyUnits: unitsFor("sms", row.body ?? ""),
      lastActivityAt: row.created_at,
    });
  }
  for (const row of inboundRows) {
    if (!row.lead_id) continue;
    const existing = byLead.get(row.lead_id);
    if (existing) {
      existing.hasRecentInboundSms = true;
      continue;
    }
    byLead.set(row.lead_id, {
      leadId: row.lead_id,
      leadName: "",
      hasHeldReply: false,
      hasRecentInboundSms: true,
      lastActivityAt: row.created_at,
    });
  }
  if (byLead.size === 0) return null;

  // Leads who opted out or were archived are not a conversation to continue.
  const { data: leads, error } = await db()
    .from("leads")
    .select("id, first_name, last_name, phone, opted_out, archived_at")
    .eq("business_id", businessId)
    .in("id", [...byLead.keys()]);
  if (error) return null;
  const live: (PromptCandidate & { lastActivityAt: string })[] = [];
  for (const lead of (leads ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    opted_out: boolean;
    archived_at: string | null;
  }[]) {
    const candidate = byLead.get(lead.id);
    if (!candidate || lead.opted_out || lead.archived_at) continue;
    live.push({ ...candidate, leadName: leadDisplayName(lead) });
  }
  return pickCandidate(live, preferLeadId);
}

/* ------------------------------------------------- releasing held replies */

export type ReleaseResult = { leadsReleased: number; messagesRequeued: number; skipped: number };

/**
 * After the trial converts: hand leads held at the SMS limit back to the
 * assistant and re-queue their held reply through the normal send path, so
 * every gate (quiet hours, opt-out, suppression, the new plan's allowance)
 * runs again before anything is sent. `attempt` makes the re-queue idempotent
 * per conversion. Never throws: the conversion itself has already happened.
 */
export async function releaseHeldSmsReplies(businessId: string, attempt: string): Promise<ReleaseResult> {
  const empty = { leadsReleased: 0, messagesRequeued: 0, skipped: 0 };
  try {
    const { data: leadRows, error: leadError } = await db()
      .from("leads")
      .select("id, human_takeover, attention_reason")
      .eq("business_id", businessId)
      .eq("human_takeover", true)
      .eq("attention_reason", HELD_REPLY_ATTENTION_REASON)
      .limit(500);
    if (leadError || !leadRows?.length) return empty;
    const leads = leadRows as LeadFlagRow[];
    const leadIds = leads.map((lead) => lead.id);

    const [held, sent] = await Promise.all([
      db()
        .from("messages")
        .select("id, lead_id, channel, direction, status, origin, error_code, created_at, send_key")
        .eq("business_id", businessId)
        .in("lead_id", leadIds)
        .eq("direction", "outbound")
        .eq("channel", "sms")
        .eq("status", "BLOCKED")
        .eq("error_code", HELD_REPLY_ERROR_CODE),
      db()
        .from("messages")
        .select("lead_id, created_at")
        .eq("business_id", businessId)
        .in("lead_id", leadIds)
        .eq("direction", "outbound")
        .in("status", ["SENT", "DELIVERED"])
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    if (held.error) return empty;

    const lastSentAt: Record<string, string> = {};
    for (const row of (sent.data ?? []) as { lead_id: string | null; created_at: string }[]) {
      if (row.lead_id && !lastSentAt[row.lead_id]) lastSentAt[row.lead_id] = row.created_at;
    }

    const plan = planHeldReplyRelease({
      messages: (held.data ?? []) as HeldReplyRow[],
      leads,
      lastSentAt,
      now: new Date(),
    });

    if (plan.leadIds.length > 0) {
      // Conditional on the reason still being this one: a person who took a
      // lead over for another reason in the meantime keeps it.
      logWriteError(
        await db()
          .from("leads")
          .update({ human_takeover: false, needs_attention: false, attention_reason: null })
          .eq("business_id", businessId)
          .in("id", plan.leadIds)
          .eq("attention_reason", HELD_REPLY_ATTENTION_REASON),
        "trial upgrade: release held leads",
        { businessId, count: plan.leadIds.length },
      );
    }

    const rows = new Map(((held.data ?? []) as HeldReplyRow[]).map((row) => [row.id, row]));
    let requeued = 0;
    for (const messageId of plan.messageIds) {
      const row = rows.get(messageId);
      if (!row?.lead_id) continue;
      const { data: reset, error } = await db()
        .from("messages")
        .update({
          status: "QUEUED",
          error_code: null,
          error_message: null,
          failed_at: null,
          scheduled_for: new Date().toISOString(),
        })
        .eq("id", messageId)
        .eq("business_id", businessId)
        .eq("status", "BLOCKED")
        .select("id");
      if (error || !reset?.length) continue;
      await enqueue(
        "message.send",
        { messageId, leadId: row.lead_id, sendKey: row.send_key ?? messageId },
        { businessId, idempotencyKey: releaseJobKey(row.send_key, messageId, attempt) },
      );
      requeued += 1;
    }
    return { leadsReleased: plan.leadIds.length, messagesRequeued: requeued, skipped: plan.skippedMessageIds.length };
  } catch (error) {
    console.error("[trial-upgrade] releasing held replies failed", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}
