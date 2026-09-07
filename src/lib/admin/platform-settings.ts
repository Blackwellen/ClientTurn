import "server-only";
import { titleise } from "./format";
import { PROVIDER_CATALOGUE, catalogueEntry } from "./provider-catalogue";
import { adminRead, daysAgo, truncate, type AdminClient } from "./shared";
import {
  PLATFORM_AGENTS,
  PLATFORM_AGENT_LABEL,
  type AgentSettingRow,
  type AiSettings,
  type FeatureFlagRow,
  type FlagStatus,
  type OutreachSettings,
  type PlatformProviderRow,
  type PlatformSettingsData,
  type PriceBookRow,
  type ProviderDetail,
  type ProviderHealthState,
  type ProviderType,
  type SettingChangeRow,
  type SettingsView,
  type UnitBasis,
} from "./platform-settings-types";

/**
 * Platform Settings reads (V4 §47).
 *
 * The provider list is the *catalogue joined to its overrides*: the catalogue
 * says what the platform can talk to, `platform_providers` says how an operator
 * has configured it, and the probe history says whether it is answering. A
 * provider whose credentials are not set on this deployment is reported as
 * unconfigured rather than hidden, because "why is Clearbit not being used" is
 * exactly the question this screen exists to answer.
 *
 * No value read here is ever a secret. `credentialConfigured` is a boolean
 * derived from `process.env` on the server; the variable's contents never leave
 * this module.
 */

/* -------------------------------------------------------------- defaults --- */

export const SETTINGS_NAMESPACES = ["ai", "outreach", "compliance"] as const;
export type SettingsNamespace = (typeof SETTINGS_NAMESPACES)[number];

/**
 * What each namespace means when nothing has been saved yet. Every default is
 * conservative: caps that exist, and a kill switch that is off but present.
 */
export const DEFAULT_SETTINGS: Record<SettingsNamespace, Record<string, unknown>> = {
  ai: {
    killSwitch: false,
    killSwitchReason: null,
    killSwitchAt: null,
    defaultModel: "gpt-4.1",
    fallbackModel: "gpt-4.1-mini",
    totalDailyBudget: 500,
    minimumEvaluationScore: 0.8,
    agents: {},
  },
  outreach: {
    globalDailyEmailCap: 100_000,
    globalDailySmsCap: 10_000,
    globalDailyWhatsappCap: 10_000,
    perMailboxDailyCap: 200,
    campaignConcurrency: 12,
    bounceThreshold: 2,
    complaintThreshold: 0.1,
    minimumDeliveryRate: 97,
    socialChannelsEnabled: false,
  },
  compliance: {
    requireReviewForColdEmail: true,
    suppressionCheckBeforeSend: true,
  },
};

async function readNamespace(
  supabase: AdminClient,
  namespace: SettingsNamespace,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value_json")
    .eq("namespace", namespace)
    .maybeSingle();

  const stored = (data?.value_json ?? {}) as Record<string, unknown>;
  // Merged rather than replaced, so a namespace saved before a new setting
  // existed still yields that setting's default instead of `undefined`.
  return { ...DEFAULT_SETTINGS[namespace], ...stored };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------- providers --- */

/** Whether every environment variable a provider needs is actually present. */
function credentialsPresent(requiredEnv: string[]): boolean {
  return requiredEnv.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

const PROBE_STATUS_TO_HEALTH: Record<string, ProviderHealthState> = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  DOWN: "INCIDENT",
  UNKNOWN: "UNKNOWN",
};

async function listProviders(
  supabase: AdminClient,
): Promise<PlatformProviderRow[]> {
  const [{ data: overrides }, { data: probes }] = await Promise.all([
    supabase.from("platform_providers").select("*"),
    supabase
      .from("platform_provider_checks")
      .select("provider, status, checked_at")
      .gte("checked_at", daysAgo(2))
      .order("checked_at", { ascending: false })
      .limit(500),
  ]);

  const overrideByProvider = new Map(
    (overrides ?? []).map((row) => [row.provider, row]),
  );

  // Most recent probe per provider.
  const latestProbe = new Map<string, { status: string; checked_at: string }>();
  for (const probe of probes ?? []) {
    if (!latestProbe.has(probe.provider)) {
      latestProbe.set(probe.provider, {
        status: probe.status,
        checked_at: probe.checked_at,
      });
    }
  }

  return PROVIDER_CATALOGUE.map((entry) => {
    const override = overrideByProvider.get(entry.provider);
    const probe = latestProbe.get(entry.provider);
    const configured = credentialsPresent(entry.requiredEnv);

    const status: ProviderHealthState = !configured
      ? "OFFLINE"
      : probe
        ? (PROBE_STATUS_TO_HEALTH[probe.status] ?? "UNKNOWN")
        : "UNKNOWN";

    return {
      id: override?.id ?? null,
      provider: entry.provider,
      label: override?.label ?? entry.label,
      type: (override?.provider_type as ProviderType) ?? entry.type,
      enabled: override?.enabled ?? configured,
      priority: override?.priority ?? 1,
      failoverOrder: override?.failover_order ?? null,
      countryCodes: (override?.country_codes ?? []) as string[],
      capabilities:
        (override?.capabilities ?? []).length > 0
          ? ((override?.capabilities ?? []) as string[])
          : entry.capabilities,
      unitCostEstimate:
        override?.unit_cost_estimate === null || override?.unit_cost_estimate === undefined
          ? null
          : Number(override.unit_cost_estimate),
      unitBasis: (override?.unit_basis as UnitBasis | null) ?? entry.defaultUnitBasis,
      currency: override?.currency ?? "USD",
      hardCostCeiling:
        override?.hard_cost_ceiling === null || override?.hard_cost_ceiling === undefined
          ? null
          : Number(override.hard_cost_ceiling),
      rateLimitPerMinute: override?.rate_limit_per_minute ?? null,
      rateLimitPerHour: override?.rate_limit_per_hour ?? null,
      rateLimitPerDay: override?.rate_limit_per_day ?? null,
      maxConcurrency: override?.max_concurrency ?? null,
      status,
      lastCheckedAt: probe?.checked_at ?? null,
      credentialRef: override?.credential_ref ?? entry.credentialRef,
      credentialConfigured: configured,
      credentialEnvironment: override?.credential_environment ?? "production",
      credentialRotatedAt: override?.credential_rotated_at ?? null,
      notes: override?.notes ?? null,
    } satisfies PlatformProviderRow;
  }).sort((a, b) => a.type.localeCompare(b.type) || a.priority - b.priority);
}

async function getProviderDetail(
  supabase: AdminClient,
  provider: string,
  providers: PlatformProviderRow[],
): Promise<ProviderDetail | null> {
  const row = providers.find((candidate) => candidate.provider === provider);
  if (!row) return null;

  const since = daysAgo(30);
  const { data: costs } = await supabase
    .from("cost_events")
    .select("quantity, total_cost")
    .eq("provider", provider)
    .gte("occurred_at", since)
    .limit(20_000);

  let requests = 0;
  let cost = 0;
  for (const event of costs ?? []) {
    requests += Number(event.quantity) || 0;
    cost += Number(event.total_cost) || 0;
  }

  // Error rate and latency come from the probe history, which is the only
  // per-provider timing the platform actually records.
  const { data: probes } = await supabase
    .from("platform_provider_checks")
    .select("status, latency_ms")
    .eq("provider", provider)
    .gte("checked_at", since)
    .limit(2000);

  const probeRows = probes ?? [];
  const withLatency = probeRows.filter((probe) => probe.latency_ms !== null);
  const failures = probeRows.filter(
    (probe) => probe.status === "DOWN" || probe.status === "DEGRADED",
  ).length;

  const { data: changes } = await supabase
    .from("platform_setting_changes")
    .select("created_at, summary, changed_by_email")
    .eq("namespace", `provider:${provider}`)
    .order("created_at", { ascending: false })
    .limit(8);

  // The failover chain is every other enabled provider of the same type, in
  // the order the waterfall would try them.
  const failoverChain = providers
    .filter(
      (candidate) =>
        candidate.type === row.type &&
        candidate.provider !== row.provider &&
        candidate.enabled,
    )
    .sort(
      (a, b) =>
        (a.failoverOrder ?? a.priority) - (b.failoverOrder ?? b.priority),
    )
    .map((candidate, index) => ({
      provider: candidate.provider,
      label: candidate.label,
      order: index + 1,
    }));

  return {
    ...row,
    requests30d: requests,
    cost30d: cost,
    rateLimitUsage: null,
    errorRate: probeRows.length === 0 ? null : failures / probeRows.length,
    averageLatencyMs:
      withLatency.length === 0
        ? null
        : Math.round(
            withLatency.reduce((sum, probe) => sum + (probe.latency_ms ?? 0), 0) /
              withLatency.length,
          ),
    recentChanges: (changes ?? []).map((change) => ({
      at: change.created_at,
      summary: truncate(change.summary, 120),
      by: change.changed_by_email,
    })),
    failoverChain,
  };
}

/* ------------------------------------------------------------ ai & agents --- */

async function buildAiSettings(supabase: AdminClient): Promise<AiSettings> {
  const settings = await readNamespace(supabase, "ai");
  const agentOverrides = (settings.agents ?? {}) as Record<
    string,
    { enabled?: boolean; primaryModel?: string; fallbackModel?: string; dailySpendCap?: number; dailyTokenCap?: number; perRunCostCap?: number }
  >;

  const since = daysAgo(1);
  const [{ data: runs }, { data: prompts }] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("agent_type, status, provider_cost_minor, model_cost_minor")
      .gte("created_at", since)
      .limit(20_000),
    supabase
      .from("agent_prompt_versions")
      .select("agent_type, version, status, model_hint, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const stats = new Map<string, { runs: number; spendMinor: number; failures: number }>();
  for (const run of runs ?? []) {
    const slot = stats.get(run.agent_type) ?? { runs: 0, spendMinor: 0, failures: 0 };
    slot.runs += 1;
    slot.spendMinor +=
      (Number(run.provider_cost_minor) || 0) + (Number(run.model_cost_minor) || 0);
    if (run.status === "FAILED" || run.status === "ERROR") slot.failures += 1;
    stats.set(run.agent_type, slot);
  }

  const promptsByAgent = new Map<string, typeof prompts>();
  for (const prompt of prompts ?? []) {
    const list = promptsByAgent.get(prompt.agent_type) ?? [];
    list.push(prompt);
    promptsByAgent.set(prompt.agent_type, list);
  }

  const defaultModel = String(settings.defaultModel ?? "gpt-4.1");
  const fallbackModel = String(settings.fallbackModel ?? "gpt-4.1-mini");

  const agents: AgentSettingRow[] = PLATFORM_AGENTS.map((agent) => {
    const override = agentOverrides[agent] ?? {};
    const stat = stats.get(agent);
    const agentPrompts = promptsByAgent.get(agent) ?? [];
    const active = agentPrompts.find((prompt) => prompt.status === "ACTIVE");

    return {
      agent,
      label: PLATFORM_AGENT_LABEL[agent],
      // Default on: these agents are part of the product, and a settings screen
      // that reported them all off would be lying about what is running.
      enabled: override.enabled ?? true,
      primaryModel: override.primaryModel ?? active?.model_hint ?? defaultModel,
      fallbackModel: override.fallbackModel ?? fallbackModel,
      dailySpendCap: numberOrNull(override.dailySpendCap),
      dailyTokenCap: numberOrNull(override.dailyTokenCap),
      perRunCostCap: numberOrNull(override.perRunCostCap),
      spend24h: (stat?.spendMinor ?? 0) / 100,
      runs24h: stat?.runs ?? 0,
      errorRate: stat && stat.runs > 0 ? stat.failures / stat.runs : null,
      activePromptVersion: active?.version ?? null,
      promptVersions: agentPrompts.slice(0, 6).map((prompt) => ({
        version: prompt.version,
        status: prompt.status as "DRAFT" | "ACTIVE" | "RETIRED",
        modelHint: prompt.model_hint,
        createdAt: prompt.created_at,
      })),
    };
  });

  return {
    killSwitch: settings.killSwitch === true,
    killSwitchReason:
      typeof settings.killSwitchReason === "string" ? settings.killSwitchReason : null,
    killSwitchAt:
      typeof settings.killSwitchAt === "string" ? settings.killSwitchAt : null,
    defaultModel,
    fallbackModel,
    totalDailyBudget: numberOrNull(settings.totalDailyBudget),
    spentToday: agents.reduce((sum, agent) => sum + agent.spend24h, 0),
    minimumEvaluationScore: numberOrNull(settings.minimumEvaluationScore),
    agents,
  };
}

/* --------------------------------------------------------------- outreach --- */

async function buildOutreachSettings(
  supabase: AdminClient,
): Promise<OutreachSettings> {
  const settings = await readNamespace(supabase, "outreach");
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const todayStart = since.toISOString();

  const [emails, sms, whatsapp, campaigns] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "outbound")
      .gte("created_at", todayStart),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "sms")
      .eq("direction", "outbound")
      .gte("created_at", todayStart),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel", "whatsapp")
      .eq("direction", "outbound")
      .gte("created_at", todayStart),
    supabase
      .from("outreach_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "RUNNING"),
  ]);

  return {
    globalDailyEmailCap: numberOrNull(settings.globalDailyEmailCap),
    globalDailySmsCap: numberOrNull(settings.globalDailySmsCap),
    globalDailyWhatsappCap: numberOrNull(settings.globalDailyWhatsappCap),
    perMailboxDailyCap: numberOrNull(settings.perMailboxDailyCap),
    campaignConcurrency: numberOrNull(settings.campaignConcurrency),
    bounceThreshold: numberOrNull(settings.bounceThreshold),
    complaintThreshold: numberOrNull(settings.complaintThreshold),
    minimumDeliveryRate: numberOrNull(settings.minimumDeliveryRate),
    socialChannelsEnabled: settings.socialChannelsEnabled === true,
    emailsToday: emails.count ?? 0,
    smsToday: sms.count ?? 0,
    whatsappToday: whatsapp.count ?? 0,
    activeCampaigns: campaigns.count ?? 0,
  };
}

/* ------------------------------------------------------------- price book --- */

async function listPriceBook(supabase: AdminClient): Promise<PriceBookRow[]> {
  const { data } = await supabase
    .from("provider_price_book")
    .select(
      "id, provider, product, region, currency, unit, unit_cost, effective_from, effective_to",
    )
    .order("provider", { ascending: true })
    .order("effective_from", { ascending: false })
    .limit(200);

  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    product: row.product,
    region: row.region,
    currency: row.currency,
    unit: row.unit,
    unitCost: Number(row.unit_cost),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    current:
      new Date(row.effective_from).getTime() <= now &&
      (!row.effective_to || new Date(row.effective_to).getTime() > now),
  }));
}

/* ---------------------------------------------------------- feature flags --- */

async function listFlags(supabase: AdminClient): Promise<FeatureFlagRow[]> {
  const { data } = await supabase
    .from("platform_feature_flags")
    .select("key, label, description, status, rollout_percent, business_ids, updated_at")
    .order("label", { ascending: true })
    .limit(200);

  return (data ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    status: row.status as FlagStatus,
    rolloutPercent: row.rollout_percent,
    workspaceCount: ((row.business_ids ?? []) as string[]).length,
    updatedAt: row.updated_at,
  }));
}

/* -------------------------------------------------------------- changelog --- */

async function listChangeLog(supabase: AdminClient): Promise<SettingChangeRow[]> {
  const { data } = await supabase
    .from("platform_setting_changes")
    .select("id, created_at, namespace, version, summary, changed_by_email")
    .order("created_at", { ascending: false })
    .limit(25);

  return (data ?? []).map((row) => ({
    id: row.id,
    at: row.created_at,
    namespace: titleise(row.namespace.replace("provider:", "")),
    version: row.version,
    summary: truncate(row.summary, 140),
    changedBy: row.changed_by_email,
  }));
}

/* ------------------------------------------------------------------ read --- */

export async function getPlatformSettings(
  view: SettingsView,
  providerKey?: string,
): Promise<PlatformSettingsData> {
  const supabase = await adminRead();

  const providers = await listProviders(supabase);

  const [ai, outreach, priceBook, flags, changeLog, providerDetail] =
    await Promise.all([
      buildAiSettings(supabase),
      buildOutreachSettings(supabase),
      view === "price-book" ? listPriceBook(supabase) : Promise.resolve([]),
      listFlags(supabase),
      listChangeLog(supabase),
      providerKey
        ? getProviderDetail(supabase, providerKey, providers)
        : Promise.resolve(null),
    ]);

  const withCost = providers.filter((row) => row.unitCostEstimate !== null);

  return {
    view,
    summary: {
      totalProviders: providers.length,
      healthyProviders: providers.filter((row) => row.status === "HEALTHY").length,
      degradedProviders: providers.filter((row) => row.status === "DEGRADED").length,
      offlineProviders: providers.filter(
        (row) => row.status === "OFFLINE" || row.status === "INCIDENT",
      ).length,
      averageUnitCost:
        withCost.length === 0
          ? null
          : withCost.reduce((sum, row) => sum + (row.unitCostEstimate ?? 0), 0) /
            withCost.length,
      peakRateLimitUsage: null,
      activeAgents: ai.agents.filter((agent) => agent.enabled).length,
      totalAgents: ai.agents.length,
      activeFlags: flags.filter((flag) => flag.status !== "DISABLED").length,
      totalFlags: flags.length,
    },
    providers,
    providerDetail,
    ai,
    outreach,
    priceBook,
    flags,
    changeLog,
  };
}

export { catalogueEntry };
