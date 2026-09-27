import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { getEntitlements } from "./entitlements";
import { getBillingNotice, getLimitsOverview } from "./limits-service";
import { getTokenStatus } from "./token-service";
import {
  PURCHASE_QUIET_DAYS,
  WHATSAPP_WAITING_DAYS,
  attributePurchase,
  canSeeUpsells,
  decideUpsellMoment,
  mentionsWhatsapp,
  type UpsellContext,
  type UpsellDecision,
  type UpsellFacts,
  type UpsellHistoryEvent,
  type UpsellOffer,
} from "./upsell-moments";

/**
 * The reads behind upsell moments (upsell-moments.ts decides). Never throws
 * to a page: any failed read means no suggestion, because a missing upsell
 * costs nothing and a wrong one annoys.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function upgradeSuggestionsEnabled(businessId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("business_settings")
    .select("upgrade_suggestions_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  // Column not there yet (0149 unapplied) or no row: the default, on.
  if (error || !data) return true;
  return (data as { upgrade_suggestions_enabled?: boolean }).upgrade_suggestions_enabled !== false;
}

export async function loadUpsellHistory(businessId: string, userId: string, now = new Date()): Promise<UpsellHistoryEvent[]> {
  const since = new Date(now.getTime() - (PURCHASE_QUIET_DAYS + 1) * DAY_MS).toISOString();
  const { data, error } = await db()
    .from("upsell_events")
    .select("moment, offer, surface, event, user_id, created_at")
    .eq("business_id", businessId)
    .or(`user_id.eq.${userId},event.eq.purchase`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`upsell history read failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    moment: String(row.moment),
    offer: String(row.offer),
    surface: String(row.surface),
    event: String(row.event),
    userId: (row.user_id as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

function leadName(row: { first_name?: string | null; last_name?: string | null; company_name?: string | null } | null): string {
  const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return name || row?.company_name || "A lead";
}

async function waitingOnWhatsapp(
  businessId: string,
  now: Date,
  leadId: string | null,
): Promise<{ id: string; name: string; at: string } | null> {
  const since = new Date(now.getTime() - WHATSAPP_WAITING_DAYS * DAY_MS).toISOString();
  let query = db()
    .from("messages")
    .select("lead_id, channel, body, created_at")
    .eq("business_id", businessId)
    .eq("direction", "inbound")
    .not("lead_id", "is", null)
    .gte("created_at", since)
    .or("channel.eq.whatsapp,body.ilike.*whats*app*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (leadId) query = query.eq("lead_id", leadId);
  const { data, error } = await query;
  if (error || !data) return null;
  const hit = data.find((m) => m.channel === "whatsapp" || mentionsWhatsapp(m.body as string));
  if (!hit?.lead_id) return null;
  const { data: lead } = await db()
    .from("leads")
    .select("id, first_name, last_name, company_name")
    .eq("id", hit.lead_id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!lead) return null;
  return { id: String(lead.id), name: leadName(lead), at: String(hit.created_at) };
}

export async function loadUpsellFacts(input: {
  businessId: string;
  userId: string;
  role: string;
  context: UpsellContext;
  leadId?: string | null;
  now?: Date;
}): Promise<UpsellFacts | null> {
  const now = input.now ?? new Date();
  const enabled = await upgradeSuggestionsEnabled(input.businessId);
  const entitlements = await getEntitlements(input.businessId);
  const base = {
    now,
    context: input.context,
    role: input.role,
    userId: input.userId,
    suggestionsEnabled: enabled,
    plan: entitlements.plan,
    state: entitlements.state,
  };
  // Cheap exits before the heavy reads: the decision would say no anyway.
  if (!enabled || !canSeeUpsells(input.role) || entitlements.state !== "ACTIVE" || entitlements.plan === "trial") {
    return emptyFacts({ ...base, periodStart: entitlements.periodStart ?? now.toISOString() });
  }

  const periodStart = entitlements.periodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const previousStart = new Date(periodStart);
  previousStart.setUTCMonth(previousStart.getUTCMonth() - 1);

  const [notice, limits, tokens, subscription, previousLeads, bookings, waiting, history] = await Promise.all([
    getBillingNotice(input.businessId, entitlements).catch(() => null),
    getLimitsOverview(input.businessId),
    getTokenStatus(input.businessId).catch(() => null),
    db().from("subscriptions").select("billing_interval").eq("business_id", input.businessId).maybeSingle(),
    db()
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .gte("created_at", previousStart.toISOString())
      .lt("created_at", periodStart),
    db()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .gte("created_at", periodStart)
      .not("status", "eq", "cancelled"),
    waitingOnWhatsapp(input.businessId, now, input.context === "lead" ? (input.leadId ?? null) : null),
    loadUpsellHistory(input.businessId, input.userId, now),
  ]);

  const rowOf = (key: string) => limits.rows.find((r) => r.key === key);
  const leads = rowOf("leads");
  const seats = rowOf("users");
  const prospects = rowOf("prospects");
  const whatsapp = rowOf("whatsapp");

  return {
    ...base,
    billingInterval: (subscription.data as { billing_interval?: string } | null)?.billing_interval === "year" ? "year" : "month",
    billingNoticeActive: notice !== null,
    periodStart,
    periodEnd: entitlements.periodEnd,
    leads: {
      used: leads?.monthly.used ?? 0,
      limit: leads?.monthly.limit ?? entitlements.leadLimit,
      previousPeriodUsed: previousLeads.error ? null : (previousLeads.count ?? 0),
    },
    aiTokens: tokens ? { state: tokens.state, percentUsed: tokens.percentUsed } : null,
    seats: { used: seats?.monthly.used ?? 0, limit: seats?.monthly.limit ?? entitlements.userLimit },
    prospects: prospects ? { used: prospects.monthly.used, limit: prospects.monthly.limit } : null,
    whatsapp: {
      planAllows: entitlements.whatsappEnabled,
      tokens: limits.credits.whatsapp,
      usedThisPeriod: whatsapp?.monthly.used ?? 0,
      waitingLead: waiting,
    },
    bookingsThisPeriod: bookings.error ? 0 : (bookings.count ?? 0),
    history,
  };
}

function emptyFacts(
  base: Pick<UpsellFacts, "now" | "context" | "role" | "userId" | "suggestionsEnabled" | "plan" | "state" | "periodStart">,
): UpsellFacts {
  return {
    ...base,
    billingInterval: "month",
    billingNoticeActive: false,
    periodEnd: null,
    leads: { used: 0, limit: 0, previousPeriodUsed: null },
    aiTokens: null,
    seats: { used: 0, limit: 0 },
    prospects: null,
    whatsapp: { planAllows: false, tokens: 0, usedThisPeriod: 0, waitingLead: null },
    bookingsThisPeriod: 0,
    history: [],
  };
}

export async function loadUpsellDecision(input: Parameters<typeof loadUpsellFacts>[0]): Promise<UpsellDecision | null> {
  try {
    const facts = await loadUpsellFacts(input);
    return facts ? decideUpsellMoment(facts) : null;
  } catch (error) {
    console.error("[upsell] decision failed; no suggestion shown", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Records a purchase as an upsell conversion when it follows a click on the
 * same offer (upsell-moments `attributePurchase`). Called from the Stripe
 * webhook (packs) and the plan change action (upgrades). `ref` is unique for
 * purchases (0149), so a retry does not count it twice. Never throws: this is
 * analytics, and must not fail a payment.
 */
export async function recordUpsellConversion(input: {
  businessId: string;
  offer: UpsellOffer;
  ref: string;
  now?: Date;
}): Promise<void> {
  try {
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - 8 * DAY_MS).toISOString();
    const { data, error } = await db()
      .from("upsell_events")
      .select("moment, offer, surface, event, user_id, created_at")
      .eq("business_id", input.businessId)
      .eq("offer", input.offer)
      .eq("event", "click")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) return;
    const click = attributePurchase(
      input.offer,
      data.map((row) => ({
        moment: String(row.moment),
        offer: String(row.offer),
        surface: String(row.surface),
        event: String(row.event),
        userId: (row.user_id as string | null) ?? null,
        createdAt: String(row.created_at),
      })),
      now,
    );
    if (!click) return;
    const insert = await db().from("upsell_events").insert({
      business_id: input.businessId,
      user_id: click.userId,
      moment: click.moment,
      offer: input.offer,
      surface: click.surface,
      event: "purchase",
      ref: input.ref,
    });
    // 23505: this purchase was already counted (a webhook retry).
    if (insert.error && insert.error.code !== "23505") {
      logWriteError(insert, "upsell: record conversion", { businessId: input.businessId });
    }
  } catch (error) {
    console.error("[upsell] conversion not recorded", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
