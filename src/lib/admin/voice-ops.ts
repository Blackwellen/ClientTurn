import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { USD_TO_GBP } from "@/lib/voice/cost";
import { logEvent } from "@/lib/observability/log";
import {
  countryOfDestination,
  gmReport,
  suspiciousUsage,
  SUSPICION_THRESHOLDS,
  voiceRevenueLines,
  type CostRow,
  type GmReport,
  type LedgerSaleRow,
  type SuspicionFlag,
} from "./voice-ops-model";

/**
 * Admin -> System -> Voice ops: the platform-wide read (brief §58-59).
 *
 * Service role, platform-admin callers only (the (ops) layout and the page
 * both run requirePlatformAdmin). Every read is bounded. A missing voice
 * table means "voice is not on this database yet" and the whole view says so;
 * a missing 0158 column only hides the control it belongs to.
 *
 * Nothing here calls a provider: spend is the cost ledger, revenue the
 * minute ledger's sales, and liveness the call rows.
 */

type Db = SupabaseClient;
const db = (): Db => createAdminClient() as unknown as Db;

export const VOICE_WEBHOOK_PROVIDERS = ["retell", "twilio_voice", "twilio_regulatory"] as const;
const LIVE_STATES = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP"];
const MAX = 20_000;

export type VoiceOpsWorkspace = {
  businessId: string;
  name: string;
  killSwitch: boolean;
  outboundPaused: boolean | null;
  spendLimitGbp: number | null;
  minutesToday: number;
  minutesMonth: number;
  providerSpendMonthGbp: number;
  liveCalls: number;
  queued: number;
  concurrencyLimit: number | null;
  suspicion: SuspicionFlag[];
  suspicionDetail: string[];
};

export type VoiceOpsNumber = {
  id: string;
  businessId: string;
  businessName: string;
  e164Masked: string;
  state: string;
  needsAttention: boolean;
  lastError: string | null;
  suspended: boolean | null;
};

export type VoiceOps =
  | { state: "not_installed"; reason: string }
  | { state: "unavailable"; reason: string }
  | {
      state: "ready";
      generatedAt: string;
      month: string;
      totals: {
        activeCalls: number;
        queueDepth: number;
        claimedInQueue: number;
        minutesToday: number;
        minutesMonth: number;
        providerSpendMonthGbp: number;
        retailRevenueMonthGbp: number;
        gm: number | null;
        callFailuresToday: number;
        webhookFailures7d: number;
        quotesSentMonth: number | null;
        paymentsMonth: { count: number; amountGbp: number } | null;
      };
      workspaces: VoiceOpsWorkspace[];
      numbers: VoiceOpsNumber[];
      numberStates: { state: string; count: number }[];
      providerErrors: { reason: string; count: number }[];
      failedWebhooks: { id: string; provider: string; eventType: string | null; lastError: string | null; receivedAt: string }[];
      failedJobs: { id: string; type: string; businessId: string | null; lastError: string | null; createdAt: string }[];
      entitlementOverrides: { businessId: string; businessName: string; key: string; value: string; reason: string; expiresAt: string | null }[];
      gm: GmReport;
      controlsInstalled: boolean;
      openVoiceAlerts: { id: string; businessName: string | null; severity: string; title: string; createdAt: string }[];
    };

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function startOfMonthUtc(now: Date, back = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
}

/** Last 3 digits only: an operator needs to tell numbers apart, not dial them. */
export function maskE164(e164: string | null): string {
  if (!e164) return "Not assigned";
  return `${e164.slice(0, 3)} ••• ${e164.slice(-3)}`;
}

class NotInstalled extends Error {}

async function must<T>(label: string, run: () => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (isSchemaLag(error)) throw new NotInstalled(label);
    throw new Error(`${label}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

async function optional<T>(run: () => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>): Promise<T[] | null> {
  const { data, error } = await run();
  if (error) return isSchemaLag(error) ? null : Promise.reject(new Error(error.message));
  return (data ?? []) as T[];
}

export async function getVoiceOps(now = new Date()): Promise<VoiceOps> {
  try {
    const today = startOfDayUtc(now);
    const month = startOfMonthUtc(now);
    const sixMonths = startOfMonthUtc(now, 5);
    const weekAgo = new Date(today.getTime() - 7 * 864e5);

    const [liveCalls, recentCalls, queue, settings, numbers, costs, ledger, businesses] = await Promise.all([
      must<{ business_id: string }>("voice_calls", () => db().from("voice_calls").select("business_id").in("state", LIVE_STATES).limit(MAX)),
      must<{
        id: string;
        business_id: string;
        route: string;
        outcome: string | null;
        destination_class: string | null;
        billed_sec: number | null;
        duration_sec: number | null;
        answered_at: string | null;
        disconnection_reason: string | null;
        created_at: string;
      }>("voice_calls", () =>
        db()
          .from("voice_calls")
          .select("id, business_id, route, outcome, destination_class, billed_sec, duration_sec, answered_at, disconnection_reason, created_at")
          .gte("created_at", sixMonths.toISOString())
          .order("created_at", { ascending: false })
          .limit(MAX),
      ),
      must<{ business_id: string; claimed_at: string | null }>("voice_call_queue", () => db().from("voice_call_queue").select("business_id, claimed_at").limit(MAX)),
      must<{ business_id: string; admin_kill_switch: boolean; workspace_concurrency: number }>("voice_settings", () =>
        db().from("voice_settings").select("business_id, admin_kill_switch, workspace_concurrency").limit(MAX),
      ),
      must<{ id: string; business_id: string; e164: string | null; provisioning_state: string; needs_attention: boolean; last_error: string | null }>("business_numbers", () =>
        db().from("business_numbers").select("id, business_id, e164, provisioning_state, needs_attention, last_error").limit(MAX),
      ),
      must<CostRow>("voice_cost_ledger", () =>
        db()
          .from("voice_cost_ledger")
          .select("id, business_id, voice_call_id, provider, metric, total_cost, currency, reconciles_id, occurred_at")
          .gte("occurred_at", sixMonths.toISOString())
          .limit(MAX),
      ),
      must<LedgerSaleRow>("voice_minute_ledger", () =>
        db()
          .from("voice_minute_ledger")
          .select("business_id, kind, pack_delta_sec, included_delta_sec, created_at")
          .in("kind", ["PACK_PURCHASE", "PACK_REFUND", "PERIOD_GRANT"])
          .gte("created_at", sixMonths.toISOString())
          .limit(MAX),
      ),
      must<{ id: string; name: string }>("businesses", () => db().from("businesses").select("id, name").limit(MAX)),
    ]);

    const [controls, suspensions, webhooks, jobs, grants, quotesSent, payments, alerts] = await Promise.all([
      optional<{ business_id: string; admin_outbound_paused: boolean; admin_spend_limit_gbp_month: number | string | null }>(() =>
        db().from("voice_settings").select("business_id, admin_outbound_paused, admin_spend_limit_gbp_month").limit(MAX),
      ),
      optional<{ id: string; admin_suspended_at: string | null }>(() => db().from("business_numbers").select("id, admin_suspended_at").limit(MAX)),
      must<{ id: string; provider: string; event_type: string | null; last_error: string | null; received_at: string }>("webhook_events", () =>
        db()
          .from("webhook_events")
          .select("id, provider, event_type, last_error, received_at")
          .in("provider", [...VOICE_WEBHOOK_PROVIDERS])
          .eq("status", "failed")
          .gte("received_at", weekAgo.toISOString())
          .order("received_at", { ascending: false })
          .limit(200),
      ),
      must<{ id: string; type: string; business_id: string | null; last_error: string | null; created_at: string }>("jobs", () =>
        db()
          .from("jobs")
          .select("id, type, business_id, last_error, created_at")
          .like("type", "voice.%")
          .in("state", ["failed", "dead"])
          .gte("created_at", weekAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      optional<{ business_id: string; entitlement_key: string; numeric_value: number | null; boolean_value: boolean | null; text_value: string | null; reason: string; expires_at: string | null }>(() =>
        db()
          .from("business_entitlement_grants")
          .select("business_id, entitlement_key, numeric_value, boolean_value, text_value, reason, expires_at")
          .ilike("entitlement_key", "%voice%")
          .is("revoked_at", null)
          .limit(500),
      ),
      optional<{ id: number }>(() => db().from("quote_events").select("id").eq("event_type", "quote.sent").gte("occurred_at", month.toISOString()).limit(MAX)),
      optional<{ amount_minor: number; currency: string }>(() =>
        db().from("checkout_payments").select("amount_minor, currency").in("status", ["MATCHED", "LINKED"]).gte("paid_at", month.toISOString()).limit(MAX),
      ),
      optional<{ id: string; business_id: string | null; severity: string; title: string; created_at: string; metrics_json: Record<string, unknown> | null }>(() =>
        db()
          .from("economics_alerts")
          .select("id, business_id, severity, title, created_at, metrics_json")
          .eq("alert_type", "MARGIN_BELOW_THRESHOLD")
          .eq("status", "OPEN")
          .order("created_at", { ascending: false })
          .limit(50),
      ),
    ]);

    const names = new Map(businesses.map((b) => [b.id, b.name]));
    const monthIso = month.toISOString();
    const todayIso = today.toISOString();

    // GM over six months of sales and costs, with the call dimensions.
    const { lines, unpriced } = voiceRevenueLines(ledger);
    const gm = gmReport({
      revenue: lines,
      costs,
      calls: recentCalls
        .filter((c) => typeof c.billed_sec === "number" && c.billed_sec > 0)
        .map((c) => ({
          callId: c.id,
          businessId: c.business_id,
          route: c.route,
          country: countryOfDestination(c.destination_class),
          billedSec: c.billed_sec as number,
        })),
      usdToGbp: USD_TO_GBP,
      unpricedLedgerRows: unpriced,
      names: Object.fromEntries(names),
    });
    const monthKey = monthIso.slice(0, 7);
    const monthRow = gm.month.find((r) => r.key === monthKey);

    // Per-workspace usage for today, the month, and the previous 7 days.
    const perWorkspace = new Map<string, { today: number; month: number; days: number[]; callsToday: number; shortToday: number; connectedDurToday: number; failedToday: number }>();
    // 0 = yesterday ... 6 = seven days ago (calls before today only).
    const dayIndex = (iso: string) => Math.floor((today.getTime() - Date.parse(iso)) / 864e5);
    for (const c of recentCalls) {
      const entry = perWorkspace.get(c.business_id) ?? { today: 0, month: 0, days: [0, 0, 0, 0, 0, 0, 0], callsToday: 0, shortToday: 0, connectedDurToday: 0, failedToday: 0 };
      const minutes = (c.billed_sec ?? 0) / 60;
      if (c.created_at >= monthIso) entry.month += minutes;
      if (c.created_at >= todayIso) {
        entry.today += minutes;
        if (c.outcome && c.outcome !== "CANCELLED") entry.callsToday += 1;
        if (c.outcome === "FAILED") entry.failedToday += 1;
        if (c.answered_at && typeof c.duration_sec === "number") {
          entry.connectedDurToday += 1;
          if (c.duration_sec < SUSPICION_THRESHOLDS.shortCallSec) entry.shortToday += 1;
        }
      } else {
        const idx = dayIndex(c.created_at);
        if (idx >= 0 && idx < 7) entry.days[idx] += minutes;
      }
      perWorkspace.set(c.business_id, entry);
    }

    const spendMonth = new Map<string, number>();
    const superseded = new Set(costs.map((c) => c.reconciles_id).filter(Boolean));
    for (const c of costs) {
      if (superseded.has(c.id) || !c.business_id || c.occurred_at < monthIso) continue;
      const amount = Number(c.total_cost);
      if (!Number.isFinite(amount)) continue;
      spendMonth.set(c.business_id, (spendMonth.get(c.business_id) ?? 0) + (c.currency === "GBP" ? amount : amount * USD_TO_GBP));
    }

    const liveBy = new Map<string, number>();
    for (const c of liveCalls) liveBy.set(c.business_id, (liveBy.get(c.business_id) ?? 0) + 1);
    const queuedBy = new Map<string, number>();
    for (const q of queue) if (!q.claimed_at) queuedBy.set(q.business_id, (queuedBy.get(q.business_id) ?? 0) + 1);
    const controlBy = new Map((controls ?? []).map((c) => [c.business_id, c]));

    const workspaceIds = new Set<string>([...settings.map((s) => s.business_id), ...perWorkspace.keys(), ...numbers.map((n) => n.business_id)]);
    const workspaces: VoiceOpsWorkspace[] = [...workspaceIds].map((id) => {
      const s = settings.find((row) => row.business_id === id);
      const usage = perWorkspace.get(id);
      const suspicion = usage
        ? suspiciousUsage({
            todayMinutes: usage.today,
            previousDailyMinutes: usage.days,
            callsToday: usage.callsToday,
            shortCallsToday: usage.shortToday,
            connectedWithDurationToday: usage.connectedDurToday,
            failedToday: usage.failedToday,
          })
        : { flags: [], detail: [] };
      const control = controlBy.get(id);
      return {
        businessId: id,
        name: names.get(id) ?? "Unknown workspace",
        killSwitch: Boolean(s?.admin_kill_switch),
        outboundPaused: controls === null ? null : Boolean(control?.admin_outbound_paused),
        spendLimitGbp: control?.admin_spend_limit_gbp_month === null || control?.admin_spend_limit_gbp_month === undefined ? null : Number(control.admin_spend_limit_gbp_month),
        minutesToday: Math.round((usage?.today ?? 0) * 10) / 10,
        minutesMonth: Math.round((usage?.month ?? 0) * 10) / 10,
        providerSpendMonthGbp: Math.round((spendMonth.get(id) ?? 0) * 100) / 100,
        liveCalls: liveBy.get(id) ?? 0,
        queued: queuedBy.get(id) ?? 0,
        concurrencyLimit: s?.workspace_concurrency ?? null,
        suspicion: suspicion.flags,
        suspicionDetail: suspicion.detail,
      };
    });
    workspaces.sort((a, b) => b.suspicion.length - a.suspicion.length || b.minutesMonth - a.minutesMonth || a.name.localeCompare(b.name));

    const suspendedBy = new Map((suspensions ?? []).map((n) => [n.id, Boolean(n.admin_suspended_at)]));
    const stateCounts = new Map<string, number>();
    for (const n of numbers) stateCounts.set(n.provisioning_state, (stateCounts.get(n.provisioning_state) ?? 0) + 1);

    const providerErrors = new Map<string, number>();
    for (const c of recentCalls) {
      if (c.outcome !== "FAILED" || c.created_at < weekAgo.toISOString()) continue;
      const key = (c.disconnection_reason ?? "unknown").slice(0, 60);
      providerErrors.set(key, (providerErrors.get(key) ?? 0) + 1);
    }
    for (const n of numbers) if (n.last_error) providerErrors.set("number provisioning error", (providerErrors.get("number provisioning error") ?? 0) + 1);

    const gbpPayments = (payments ?? []).filter((p) => p.currency === "GBP");
    return {
      state: "ready",
      generatedAt: now.toISOString(),
      month: monthKey,
      totals: {
        activeCalls: liveCalls.length,
        queueDepth: queue.filter((q) => !q.claimed_at).length,
        claimedInQueue: queue.filter((q) => q.claimed_at).length,
        minutesToday: Math.round(workspaces.reduce((s, w) => s + w.minutesToday, 0) * 10) / 10,
        minutesMonth: Math.round(workspaces.reduce((s, w) => s + w.minutesMonth, 0) * 10) / 10,
        providerSpendMonthGbp: Math.round([...spendMonth.values()].reduce((s, v) => s + v, 0) * 100) / 100,
        retailRevenueMonthGbp: monthRow?.revenueGbp ?? 0,
        gm: monthRow?.gm ?? null,
        callFailuresToday: recentCalls.filter((c) => c.outcome === "FAILED" && c.created_at >= todayIso).length,
        webhookFailures7d: webhooks.length,
        quotesSentMonth: quotesSent === null ? null : quotesSent.length,
        paymentsMonth: payments === null ? null : { count: payments.length, amountGbp: Math.round(gbpPayments.reduce((s, p) => s + p.amount_minor, 0)) / 100 },
      },
      workspaces,
      numbers: numbers.map((n) => ({
        id: n.id,
        businessId: n.business_id,
        businessName: names.get(n.business_id) ?? "Unknown workspace",
        e164Masked: maskE164(n.e164),
        state: n.provisioning_state,
        needsAttention: n.needs_attention,
        lastError: n.last_error ? n.last_error.slice(0, 160) : null,
        suspended: suspensions === null ? null : (suspendedBy.get(n.id) ?? false),
      })),
      numberStates: [...stateCounts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
      providerErrors: [...providerErrors.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      failedWebhooks: webhooks.slice(0, 20).map((w) => ({ id: w.id, provider: w.provider, eventType: w.event_type, lastError: w.last_error ? w.last_error.slice(0, 160) : null, receivedAt: w.received_at })),
      failedJobs: jobs.slice(0, 20).map((j) => ({ id: j.id, type: j.type, businessId: j.business_id, lastError: j.last_error ? j.last_error.slice(0, 160) : null, createdAt: j.created_at })),
      entitlementOverrides: (grants ?? []).map((g) => ({
        businessId: g.business_id,
        businessName: names.get(g.business_id) ?? "Unknown workspace",
        key: g.entitlement_key,
        value: g.boolean_value !== null ? String(g.boolean_value) : g.numeric_value !== null ? String(g.numeric_value) : (g.text_value ?? ""),
        reason: g.reason,
        expiresAt: g.expires_at,
      })),
      gm,
      controlsInstalled: controls !== null,
      openVoiceAlerts: (alerts ?? [])
        .filter((a) => (a.metrics_json as { scope?: string } | null)?.scope === "voice")
        .map((a) => ({ id: a.id, businessName: a.business_id ? (names.get(a.business_id) ?? null) : null, severity: a.severity, title: a.title, createdAt: a.created_at })),
    };
  } catch (error) {
    if (error instanceof NotInstalled) {
      return { state: "not_installed", reason: `Voice is not on this database yet (${error.message} is missing). Apply migrations 0150 and 0151.` };
    }
    logEvent("analytics.read_failed", { area: "admin_voice_ops", error }, "error");
    return { state: "unavailable", reason: "Voice operations could not be loaded right now." };
  }
}
