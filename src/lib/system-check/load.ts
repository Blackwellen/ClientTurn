import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation } from "@/lib/services";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import { getEntitlements, type Entitlements } from "@/lib/billing/entitlements";
import { checkCapacity, getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { getLimitsOverview } from "@/lib/billing/limits-service";
import { overLimitNow } from "@/lib/billing/over-limit-service";
import { can } from "@/lib/billing/capabilities";
import { PLANS } from "@/lib/billing/plans";
import { getIntegrationsView, platformConfigured } from "@/lib/integrations/queries";
import { loadProviderExtras } from "@/lib/integrations/extras";
import { loadSenderHealth } from "@/lib/settings/ai-selling-queries";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { aiMay } from "@/lib/commercial/ai-permissions";
import { loadPaymentEndpoints } from "@/lib/payments/store";
import { countOpenPaymentReviews } from "@/lib/invoicing/payment-review-store";
import { capabilityAvailable, unhealthyProviders } from "@/lib/find-leads/server/providers/registry";
import { workerIsAlive } from "@/lib/ops/alerts";
import { parseCallingHoursConfig } from "@/lib/voice/calling-hours";
import { isMailboxUsable, type AgentChannelValue, type AgentModeValue } from "@/lib/ai-settings/types";
import {
  buildReport,
  checkAgents,
  checkAi,
  checkBilling,
  checkBooking,
  checkFindLeads,
  checkMessaging,
  checkPayments,
  checkSources,
  checkVoice,
  checkWorker,
  unknownEngine,
  type EngineId,
  type EngineReport,
  type LimitLevel,
  type SystemCheckReport,
} from "./model";

/**
 * Assembles the facts for Settings -> System check (and Admin -> Customers'
 * read-only copy) and hands them to the pure rules in ./model.ts.
 *
 * Authorisation is the caller's: the Settings section calls this after
 * `requireWorkspace()` for the signed-in person's own workspace, and Admin
 * after `requirePlatformAdmin()`. Reads use the service-role client with an
 * explicit `business_id` filter on every query, so both audiences see the same
 * report. No secret, token or message body is selected; provider error text
 * the customer's own connection returned is shown, as Connections shows it.
 *
 * Each engine loads and fails on its own: a failed read makes that engine
 * UNKNOWN ("couldn't be checked") rather than guessing, and the rest render.
 */

export type SystemCheckAudience = "customer" | "admin";

const SOURCE_PROVIDERS = ["meta", "google_ads", "linkedin_ads", "tiktok_ads"] as const;

async function settle(id: EngineId, load: () => Promise<EngineReport>): Promise<EngineReport> {
  try {
    return await load();
  } catch (error) {
    console.error(`[system-check] ${id} read failed`, error instanceof Error ? error.message : error);
    return unknownEngine(id);
  }
}

type Base = {
  businessId: string;
  timezone: string;
  entitlements: Entitlements;
  settings: {
    ai_assist_enabled: boolean | null;
    quiet_hours_enabled: boolean | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    booking_mode: string | null;
    booking_url: string | null;
  } | null;
  ai: { agent_mode: string | null; agent_channels: string[] | null } | null;
  integrations: { provider_type: string; status: string; last_error_message: string | null; config: unknown }[];
};

async function loadBase(businessId: string): Promise<Base> {
  const db = createAdminClient();
  const [business, settings, ai, integrations, entitlements] = await Promise.all([
    db.from("businesses").select("timezone").eq("id", businessId).maybeSingle(),
    db
      .from("business_settings")
      .select("ai_assist_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, booking_mode, booking_url")
      .eq("business_id", businessId)
      .maybeSingle(),
    db.from("business_ai_settings").select("agent_mode, agent_channels").eq("business_id", businessId).maybeSingle(),
    db.from("integrations").select("provider_type, status, last_error_message, config").eq("business_id", businessId),
    getEntitlements(businessId),
  ]);
  if (business.error) throw new Error(business.error.message);
  if (settings.error) throw new Error(settings.error.message);
  if (ai.error) throw new Error(ai.error.message);
  if (integrations.error) throw new Error(integrations.error.message);
  return {
    businessId,
    timezone: (business.data as { timezone: string | null } | null)?.timezone || "Europe/London",
    entitlements,
    settings: settings.data as Base["settings"],
    ai: ai.data as Base["ai"],
    integrations: (integrations.data ?? []) as Base["integrations"],
  };
}

/** The same resolution the agent runtime applies (jobs/handlers/shared.ts): unknown = OFF. */
function agentMode(base: Base): AgentModeValue {
  return (["OFF", "SUGGEST_ONLY", "AUTO_REPLY"] as const).find((m) => m === base.ai?.agent_mode) ?? "OFF";
}

function aiAssistantOn(base: Base): boolean {
  return Boolean(base.settings?.ai_assist_enabled) && base.entitlements.aiAssistAllowed && agentMode(base) !== "OFF";
}

function mailboxRow(base: Base) {
  return base.integrations.find((row) => row.provider_type === "imap_smtp") ?? null;
}

function quietHours(base: Base) {
  return {
    enabled: base.settings?.quiet_hours_enabled ?? true,
    start: (base.settings?.quiet_hours_start ?? "20:00").slice(0, 5),
    end: (base.settings?.quiet_hours_end ?? "08:00").slice(0, 5),
    timezone: base.timezone,
  };
}

async function voiceView(businessId: string, audience: SystemCheckAudience, viewer: { userId: string | null; role: "owner" | "admin" | "member" | "viewer" }) {
  // The same registry read Settings -> Voice, Copilot and MCP make, so the
  // verdict is assertVoiceAllowed's own. Support reads it as an admin role
  // with no user (a READ: no per-person capability gate, nothing written).
  const result = await runOperation<VoiceSettingsView>("voice.settings_get", {}, {
    businessId,
    userId: audience === "admin" ? null : viewer.userId,
    role: audience === "admin" ? "admin" : viewer.role,
    caller: "UI",
    correlationId: randomUUID(),
  });
  if (!result.success) throw new Error(`voice.settings_get: ${result.code}`);
  return result.data;
}

export async function loadSystemCheck(
  businessId: string,
  options: { audience: SystemCheckAudience; userId: string | null; role: "owner" | "admin" | "member" | "viewer"; now?: Date },
): Promise<SystemCheckReport> {
  const now = options.now ?? new Date();
  const db = createAdminClient();

  let base: Base;
  try {
    base = await loadBase(businessId);
  } catch (error) {
    console.error("[system-check] base read failed", error instanceof Error ? error.message : error);
    return buildReport(
      (["ai", "messaging", "voice", "booking", "sources", "find_leads", "agents", "payments", "billing", "worker"] as EngineId[]).map(unknownEngine),
      now,
    );
  }
  const tz = base.timezone;
  const limits = getLimitsOverview(businessId);

  const engines = await Promise.all([
    settle("ai", async () =>
      checkAi({
        enabled: Boolean(base.settings?.ai_assist_enabled),
        planAllows: base.entitlements.aiAssistAllowed,
        mode: agentMode(base),
        channels: (["sms", "whatsapp", "email"] as AgentChannelValue[]).filter((c) => (base.ai?.agent_channels ?? ["sms", "whatsapp"]).includes(c)),
        whatsappEnabled: base.entitlements.whatsappEnabled,
        emailConnected: isMailboxUsable(mailboxRow(base)),
      }),
    ),

    settle("messaging", async () => {
      const [senders, overview] = await Promise.all([loadSenderHealth(businessId, now), limits]);
      const mailbox = mailboxRow(base);
      return checkMessaging(
        {
          sendingAllowed: base.entitlements.sendingAllowed,
          integrations: base.integrations.map((row) => ({ provider_type: row.provider_type, status: row.status })),
          smsPlatformReady: platformConfigured("twilio_sms"),
          whatsappPlatformReady: platformConfigured("twilio_whatsapp"),
          whatsappOnPlan: base.entitlements.whatsappEnabled,
          mailbox: mailbox ? { status: mailbox.status, lastErrorMessage: mailbox.last_error_message } : null,
          quietHours: quietHours(base),
          senders: senders.senders,
          domains: senders.domains,
          budgets: overview.rows
            .filter((row) => ["sms", "whatsapp", "email"].includes(row.key))
            .map((row) => ({ key: row.key, label: row.label, level: row.monthly.level as LimitLevel, used: row.monthly.used, limit: row.monthly.limit, credits: row.credits })),
        },
        now,
      );
    }),

    settle("voice", async () => {
      const view = await voiceView(businessId, options.audience, options);
      const hours = view.settings.callingHours ? parseCallingHoursConfig(view.settings.callingHours) : null;
      return checkVoice(
        {
          entitlement: view.entitlement,
          integration: view.integration,
          settings: { voiceEnabled: view.settings.voiceEnabled, adminKillSwitch: view.settings.adminKillSwitch, callingHours: hours && hours.ok ? hours.config : null },
          identity: view.identity,
          number: view.number,
          minutes: view.minutes,
          timezone: tz,
        },
        now,
        options.audience,
      );
    }),

    settle("booking", async () => {
      const authority = aiAuthorityOf(await loadCommercialAuthoritySettings(businessId));
      const calendly = base.integrations.find((row) => row.provider_type === "calendly");
      const config = (calendly?.config ?? null) as { event_type_uri?: unknown } | null;
      return checkBooking({
        bookingMode: base.settings?.booking_mode ?? "handover",
        bookingUrl: base.settings?.booking_url ?? null,
        calendars: base.integrations
          .filter((row) => row.provider_type === "calendly" || row.provider_type === "google_calendar")
          .map((row) => ({ provider: row.provider_type, status: row.status })),
        calendlyEventTypeChosen: typeof config?.event_type_uri === "string",
        aiMayBook: aiMay(authority, "book"),
        aiAssistantOn: aiAssistantOn(base),
      });
    }),

    settle("sources", async () => {
      const [view, extras, events, installs, failures, keys] = await Promise.all([
        getIntegrationsView(businessId, { client: db }),
        loadProviderExtras({ businessId, canManage: false }).catch(() => ({}) as Awaited<ReturnType<typeof loadProviderExtras>>),
        db
          .from("webhook_events")
          .select("provider, status, received_at, last_error")
          .eq("business_id", businessId)
          .in("provider", [...SOURCE_PROVIDERS])
          .order("received_at", { ascending: false })
          .limit(40),
        db
          .from("workspace_app_installs")
          .select("app_key, label, active, last_received_at, last_failure_at, last_failure_reason")
          .eq("business_id", businessId)
          .limit(100),
        db.from("connector_event_failures").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "OPEN"),
        db
          .from("api_keys")
          .select("last_used_at, expires_at")
          .eq("business_id", businessId)
          .is("revoked_at", null)
          .limit(200),
      ]);
      const lastEvents: Record<string, { at: string; status: string; error: string | null }> = {};
      for (const row of (events.data ?? []) as { provider: string; status: string; received_at: string; last_error: string | null }[]) {
        if (!lastEvents[row.provider]) lastEvents[row.provider] = { at: row.received_at, status: row.status, error: row.last_error };
      }
      const liveKeys = ((keys.data ?? []) as { last_used_at: string | null; expires_at: string | null }[]).filter(
        (key) => !key.expires_at || Date.parse(key.expires_at) > now.getTime(),
      );
      return checkSources(
        {
          cards: view.cards.filter((card) => (SOURCE_PROVIDERS as readonly string[]).includes(card.definition.id)),
          metaTokenExpiresAt: extras.meta?.meta?.tokenExpiresAt ?? null,
          lastEvents,
          connectors: ((installs.data ?? []) as { app_key: string; label: string | null; active: boolean; last_received_at: string | null; last_failure_at: string | null; last_failure_reason: string | null }[]).map((row) => ({
            label: row.label ?? row.app_key,
            active: row.active,
            lastReceivedAt: row.last_received_at,
            lastFailureAt: row.last_failure_at,
            lastFailureReason: row.last_failure_reason,
          })),
          openConnectorFailures: failures.count ?? 0,
          apiKeys: {
            active: liveKeys.length,
            lastUsedAt: liveKeys.map((key) => key.last_used_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null,
          },
          timezone: tz,
        },
        now,
      );
    }),

    settle("find_leads", async () => {
      const v4 = await getV4Entitlements(businessId);
      if (!v4.sourcingEnabled) {
        return checkFindLeads({ sourcingEnabled: false, searchRuns: null, verifiedProspects: null, companySearchAvailable: false, contactDiscoveryAvailable: false });
      }
      const [runs, prospects, unhealthy] = await Promise.all([
        checkCapacity(businessId, "search_run").catch(() => null),
        checkCapacity(businessId, "verified_prospect").catch(() => null),
        unhealthyProviders().catch(() => new Set<string>()),
      ]);
      return checkFindLeads({
        sourcingEnabled: true,
        searchRuns: runs,
        verifiedProspects: prospects,
        companySearchAvailable: capabilityAvailable("COMPANY_SEARCH", unhealthy),
        contactDiscoveryAvailable: capabilityAvailable("CONTACT_DISCOVERY", unhealthy),
      });
    }),

    settle("agents", async () => {
      const { data, error } = await db
        .from("agents")
        .select("id, name, status, status_reason, last_run_at, last_run_status, pending_review_count")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      return checkAgents({
        agents: (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          statusReason: row.status_reason,
          lastRunAt: row.last_run_at,
          lastRunStatus: row.last_run_status,
          pendingReviewCount: row.pending_review_count ?? 0,
        })),
        timezone: tz,
      });
    }),

    settle("payments", async () => {
      const [builder, quoteSettings, endpoints, review] = await Promise.all([
        can(businessId, "quote_builder_enabled"),
        db.from("quote_settings").select("invoice_pay_mode").eq("business_id", businessId).maybeSingle(),
        loadPaymentEndpoints(businessId),
        countOpenPaymentReviews(businessId),
      ]);
      return checkPayments({
        quotesAllowed: builder.allowed,
        invoicePayMode: (quoteSettings.data as { invoice_pay_mode?: string | null } | null)?.invoice_pay_mode ?? "NONE",
        endpoints: endpoints.state === "ok" ? endpoints.data : endpoints.state === "not_installed" ? [] : null,
        paymentsToReview: review.state === "ok" ? review.data.total : review.state === "not_installed" ? 0 : null,
        timezone: tz,
      });
    }),

    settle("billing", async () => {
      const [overview, over] = await Promise.all([limits, overLimitNow(businessId)]);
      return checkBilling({
        state: base.entitlements.state,
        planName: PLANS[base.entitlements.plan as keyof typeof PLANS]?.name ?? base.entitlements.plan,
        trialEndsAt: base.entitlements.trialEndsAt,
        overLimit: over.map((item) => ({ label: item.label, used: item.used, limit: item.limit, action: item.action })),
        limits: overview.rows
          .filter((row) => !["sms", "whatsapp", "email"].includes(row.key))
          .map((row) => ({ key: row.key, label: row.label, level: row.monthly.level as LimitLevel, used: row.monthly.used, limit: row.monthly.limit, atLimit: row.atLimit })),
        timezone: tz,
      });
    }),

    settle("worker", async () => {
      const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const [alive, last, overdue, stuck, dead, paused] = await Promise.all([
        workerIsAlive(now),
        db.from("jobs").select("completed_at").eq("business_id", businessId).eq("state", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("jobs").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("state", "pending").lt("run_at", cutoff),
        db.from("jobs").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("state", "running").lt("locked_at", cutoff),
        db.from("jobs").select("type, last_error, created_at").eq("business_id", businessId).eq("state", "dead").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(50),
        db.from("businesses").select("job_claims_paused").eq("id", businessId).maybeSingle(),
      ]);
      if (overdue.error || stuck.error || dead.error) throw new Error("jobs read failed");
      const deadRows = (dead.data ?? []) as { type: string; last_error: string | null }[];
      return checkWorker(
        {
          alive,
          lastCompletedAt: (last.data as { completed_at: string | null } | null)?.completed_at ?? null,
          overdue: overdue.count ?? 0,
          stuck: stuck.count ?? 0,
          dead: {
            count: deadRows.length,
            types: [...new Set(deadRows.map((row) => row.type))].slice(0, 5),
            latestError: options.audience === "admin" ? (deadRows[0]?.last_error?.slice(0, 300) ?? null) : null,
          },
          timezone: tz,
          claimsPaused: Boolean((paused.data as { job_claims_paused: boolean | null } | null)?.job_claims_paused),
        },
        options.audience,
      );
    }),
  ]);

  return buildReport(engines, now, tz);
}
