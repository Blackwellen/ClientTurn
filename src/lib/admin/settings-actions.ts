"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";
import { catalogueEntry } from "./provider-catalogue";
import { DEFAULT_SETTINGS, SETTINGS_NAMESPACES } from "./platform-settings";

/**
 * Admin → Platform Settings writes (V4 §47).
 *
 * Every write here is versioned and logged. A settings change is a
 * platform-wide act — it alters what the workers do for every tenant at once —
 * so the "before" value is captured alongside the "after" in an append-only
 * change log, and the namespace's version number is bumped so a specific
 * change can be pointed at afterwards.
 *
 * Secrets are never accepted by any action in this file. A credential is
 * changed by pointing the provider at a different environment variable and
 * rotating that variable outside the application.
 */

/* ---------------------------------------------------- namespace versioning --- */

async function writeNamespace(
  namespace: (typeof SETTINGS_NAMESPACES)[number] | string,
  next: Record<string, unknown>,
  summary: string,
  operator: { id: string; email: string },
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const db = createAdminClient();

  const { data: current } = await db
    .from("platform_settings")
    .select("value_json, version")
    .eq("namespace", namespace)
    .maybeSingle();

  const before = (current?.value_json ?? null) as Record<string, unknown> | null;
  const version = (current?.version ?? 0) + 1;

  const { error } = await db.from("platform_settings").upsert(
    {
      namespace,
      value_json: next as never,
      version,
      updated_by: operator.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "namespace" },
  );

  if (error) return { ok: false, error: "The settings could not be saved." };

  // Append-only: the log survives every later change to the value it produced.
  await db.from("platform_setting_changes").insert({
    namespace,
    version,
    summary,
    before_json: before as never,
    after_json: next as never,
    changed_by: operator.id,
    changed_by_email: operator.email,
  });

  return { ok: true, version };
}

async function readNamespaceRaw(
  namespace: (typeof SETTINGS_NAMESPACES)[number],
): Promise<Record<string, unknown>> {
  const db = createAdminClient();
  const { data } = await db
    .from("platform_settings")
    .select("value_json")
    .eq("namespace", namespace)
    .maybeSingle();
  return {
    ...DEFAULT_SETTINGS[namespace],
    ...((data?.value_json ?? {}) as Record<string, unknown>),
  };
}

/* ------------------------------------------------------- provider config --- */

const providerInput = z.object({
  provider: z.string().trim().min(2).max(60),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(99).optional(),
  failoverOrder: z.number().int().min(1).max(99).nullable().optional(),
  countryCodes: z.array(z.string().trim().length(2)).max(60).optional(),
  unitCostEstimate: z.number().min(0).max(1000).nullable().optional(),
  unitBasis: z
    .enum(["REQUEST", "RECORD", "THOUSAND", "MESSAGE", "SEGMENT", "TOKEN", "MINUTE"])
    .nullable()
    .optional(),
  hardCostCeiling: z.number().min(0).max(1000).nullable().optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1_000_000).nullable().optional(),
  rateLimitPerHour: z.number().int().min(1).max(10_000_000).nullable().optional(),
  rateLimitPerDay: z.number().int().min(1).max(100_000_000).nullable().optional(),
  maxConcurrency: z.number().int().min(1).max(1000).nullable().optional(),
  credentialRef: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function updateProviderSettings(
  input: z.input<typeof providerInput>,
): Promise<AdminActionResult> {
  return guarded("admin.provider_settings_updated", async (operator) => {
    const parsed = providerInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those provider settings are not valid." };

    const entry = catalogueEntry(parsed.data.provider);
    if (!entry) {
      // A provider with no client code behind it cannot be configured, however
      // convincing the form looked.
      return {
        ok: false,
        error: "That provider is not in the platform catalogue.",
      };
    }

    // A credential reference must name a variable, never carry a value. The
    // shape check is what stops a pasted API key being stored in the database.
    const credentialRef = parsed.data.credentialRef;
    if (credentialRef && !/^(env|vault):[A-Za-z0-9_./-]{2,100}$/.test(credentialRef)) {
      return {
        ok: false,
        error:
          "A credential reference must be a pointer such as env:CLEARBIT_API_KEY, not a secret value.",
      };
    }

    // A ceiling below the estimated unit cost would block the provider on its
    // very first call, which is a configuration error rather than a policy.
    const ceiling = parsed.data.hardCostCeiling;
    const estimate = parsed.data.unitCostEstimate;
    if (
      ceiling !== null &&
      ceiling !== undefined &&
      estimate !== null &&
      estimate !== undefined &&
      ceiling < estimate
    ) {
      return {
        ok: false,
        error: "The cost ceiling is below the estimated unit cost, so every call would be blocked.",
      };
    }

    const db = createAdminClient();
    const { data: existing } = await db
      .from("platform_providers")
      .select("*")
      .eq("provider", parsed.data.provider)
      .maybeSingle();

    const row = {
      provider: parsed.data.provider,
      label: existing?.label ?? entry.label,
      provider_type: existing?.provider_type ?? entry.type,
      enabled: parsed.data.enabled ?? existing?.enabled ?? true,
      priority: parsed.data.priority ?? existing?.priority ?? 1,
      failover_order:
        parsed.data.failoverOrder !== undefined
          ? parsed.data.failoverOrder
          : (existing?.failover_order ?? null),
      country_codes:
        parsed.data.countryCodes?.map((code) => code.toUpperCase()) ??
        existing?.country_codes ??
        [],
      capabilities: existing?.capabilities ?? entry.capabilities,
      unit_cost_estimate:
        parsed.data.unitCostEstimate !== undefined
          ? parsed.data.unitCostEstimate
          : (existing?.unit_cost_estimate ?? null),
      unit_basis:
        parsed.data.unitBasis !== undefined
          ? parsed.data.unitBasis
          : (existing?.unit_basis ?? entry.defaultUnitBasis),
      hard_cost_ceiling:
        parsed.data.hardCostCeiling !== undefined
          ? parsed.data.hardCostCeiling
          : (existing?.hard_cost_ceiling ?? null),
      rate_limit_per_minute:
        parsed.data.rateLimitPerMinute !== undefined
          ? parsed.data.rateLimitPerMinute
          : (existing?.rate_limit_per_minute ?? null),
      rate_limit_per_hour:
        parsed.data.rateLimitPerHour !== undefined
          ? parsed.data.rateLimitPerHour
          : (existing?.rate_limit_per_hour ?? null),
      rate_limit_per_day:
        parsed.data.rateLimitPerDay !== undefined
          ? parsed.data.rateLimitPerDay
          : (existing?.rate_limit_per_day ?? null),
      max_concurrency:
        parsed.data.maxConcurrency !== undefined
          ? parsed.data.maxConcurrency
          : (existing?.max_concurrency ?? null),
      credential_ref:
        credentialRef !== undefined
          ? credentialRef
          : (existing?.credential_ref ?? entry.credentialRef),
      credential_environment: existing?.credential_environment ?? "production",
      notes: parsed.data.notes !== undefined ? parsed.data.notes : (existing?.notes ?? null),
    };

    const { error } = await db
      .from("platform_providers")
      .upsert(row, { onConflict: "provider" });

    if (error) return { ok: false, error: "The provider could not be saved." };

    const summary = `Updated ${entry.label} configuration`;
    await db.from("platform_setting_changes").insert({
      namespace: `provider:${parsed.data.provider}`,
      version: 1,
      summary,
      before_json: (existing ?? null) as never,
      after_json: row as never,
      changed_by: operator.id,
      changed_by_email: operator.email,
    });

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.provider_settings_updated",
      entityType: "platform_provider",
      metadata: { provider: parsed.data.provider, summary },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: `${entry.label} updated.` };
  });
}

/* ---------------------------------------------------------- AI & agents --- */

export async function updateAiSettings(input: {
  defaultModel?: string;
  fallbackModel?: string;
  totalDailyBudget?: number | null;
  minimumEvaluationScore?: number | null;
}): Promise<AdminActionResult> {
  return guarded("admin.platform_settings_updated", async (operator) => {
    const parsed = z
      .object({
        defaultModel: z.string().trim().min(2).max(60).optional(),
        fallbackModel: z.string().trim().min(2).max(60).optional(),
        totalDailyBudget: z.number().min(0).max(100_000).nullable().optional(),
        minimumEvaluationScore: z.number().min(0).max(1).nullable().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those AI settings are not valid." };

    const current = await readNamespaceRaw("ai");
    const next = { ...current, ...parsed.data };

    const result = await writeNamespace(
      "ai",
      next,
      "Updated AI model routing and budgets",
      operator,
    );
    if (!result.ok) return result;

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.platform_settings_updated",
      metadata: { namespace: "ai", version: result.version, summary: "AI settings updated" },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: "AI settings saved." };
  });
}

export async function updateAgentSettings(input: {
  agent: string;
  enabled?: boolean;
  primaryModel?: string;
  fallbackModel?: string;
  dailySpendCap?: number | null;
}): Promise<AdminActionResult> {
  return guarded("admin.platform_settings_updated", async (operator) => {
    const parsed = z
      .object({
        agent: z.string().trim().min(2).max(60),
        enabled: z.boolean().optional(),
        primaryModel: z.string().trim().min(2).max(60).optional(),
        fallbackModel: z.string().trim().min(2).max(60).optional(),
        dailySpendCap: z.number().min(0).max(100_000).nullable().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those agent settings are not valid." };

    const current = await readNamespaceRaw("ai");
    const agents = { ...((current.agents ?? {}) as Record<string, unknown>) };
    const existing = (agents[parsed.data.agent] ?? {}) as Record<string, unknown>;

    const { agent, ...changes } = parsed.data;
    agents[agent] = { ...existing, ...changes };

    const result = await writeNamespace(
      "ai",
      { ...current, agents },
      parsed.data.enabled === false
        ? `Disabled ${agent}`
        : parsed.data.enabled === true
          ? `Enabled ${agent}`
          : `Updated ${agent} routing`,
      operator,
    );
    if (!result.ok) return result;

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.platform_settings_updated",
      metadata: { namespace: "ai", agent, changes },
    });

    revalidatePath("/admin/settings");
    return {
      ok: true,
      // Disabling stops *new* runs. A run already claimed by a worker finishes,
      // and saying otherwise would misrepresent what the toggle does.
      message:
        parsed.data.enabled === false
          ? "Disabled. No new runs will start; any run already in flight completes."
          : "Agent settings saved.",
    };
  });
}

/**
 * The global AI kill switch. Distinct from disabling every agent one at a
 * time: this is one flag the runtime checks before anything else, so it takes
 * effect immediately and can be lifted just as fast.
 */
export async function setAiKillSwitch(input: {
  enabled: boolean;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("admin.ai_kill_switch_toggled", async (operator) => {
    const parsed = z
      .object({ enabled: z.boolean(), reason: z.string().trim().min(8).max(500) })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Record why the kill switch is being changed." };
    }

    const current = await readNamespaceRaw("ai");
    const next = {
      ...current,
      killSwitch: parsed.data.enabled,
      killSwitchReason: parsed.data.reason,
      killSwitchAt: parsed.data.enabled ? new Date().toISOString() : null,
    };

    const result = await writeNamespace(
      "ai",
      next,
      parsed.data.enabled
        ? `AI kill switch engaged: ${parsed.data.reason}`
        : `AI kill switch released: ${parsed.data.reason}`,
      operator,
    );
    if (!result.ok) return result;

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.ai_kill_switch_toggled",
      metadata: {
        enabled: parsed.data.enabled,
        reason: parsed.data.reason,
        summary: parsed.data.enabled ? "Kill switch engaged" : "Kill switch released",
      },
    });

    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: parsed.data.enabled
        ? "Kill switch engaged. No agent will start a new run."
        : "Kill switch released. Agents resume on their own schedules.",
    };
  });
}

/* ------------------------------------------------------------- outreach --- */

export async function updateOutreachSettings(input: {
  globalDailyEmailCap?: number | null;
  globalDailySmsCap?: number | null;
  globalDailyWhatsappCap?: number | null;
  perMailboxDailyCap?: number | null;
  campaignConcurrency?: number | null;
  bounceThreshold?: number | null;
  complaintThreshold?: number | null;
  minimumDeliveryRate?: number | null;
  socialChannelsEnabled?: boolean;
}): Promise<AdminActionResult> {
  return guarded("admin.platform_settings_updated", async (operator) => {
    const cap = z.number().int().min(0).max(100_000_000).nullable().optional();
    const percent = z.number().min(0).max(100).nullable().optional();

    const parsed = z
      .object({
        globalDailyEmailCap: cap,
        globalDailySmsCap: cap,
        globalDailyWhatsappCap: cap,
        perMailboxDailyCap: cap,
        campaignConcurrency: z.number().int().min(1).max(1000).nullable().optional(),
        bounceThreshold: percent,
        complaintThreshold: percent,
        minimumDeliveryRate: percent,
        socialChannelsEnabled: z.boolean().optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those outreach limits are not valid." };

    const current = await readNamespaceRaw("outreach");
    const next = { ...current, ...parsed.data };

    // A per-mailbox cap above the global cap is meaningless: the global cap is
    // the ceiling every lower-level control has to sit under.
    const perMailbox = next.perMailboxDailyCap;
    const globalEmail = next.globalDailyEmailCap;
    if (
      typeof perMailbox === "number" &&
      typeof globalEmail === "number" &&
      perMailbox > globalEmail
    ) {
      return {
        ok: false,
        error: "The per-mailbox cap cannot exceed the global daily email cap.",
      };
    }

    const result = await writeNamespace(
      "outreach",
      next,
      "Updated global outreach caps and mailbox health thresholds",
      operator,
    );
    if (!result.ok) return result;

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.platform_settings_updated",
      metadata: { namespace: "outreach", version: result.version },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: "Outreach settings saved." };
  });
}

/* -------------------------------------------------------- feature flags --- */

export async function updateFeatureFlag(input: {
  key: string;
  label?: string;
  description?: string;
  status?: "ENABLED" | "BETA" | "DISABLED";
  rolloutPercent?: number;
}): Promise<AdminActionResult> {
  return guarded("admin.feature_flag_updated", async (operator) => {
    const parsed = z
      .object({
        key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_.-]+$/),
        label: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(500).optional(),
        status: z.enum(["ENABLED", "BETA", "DISABLED"]).optional(),
        rolloutPercent: z.number().int().min(0).max(100).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "A flag key must be lowercase letters, digits, . _ or -." };
    }

    const db = createAdminClient();
    const { data: existing } = await db
      .from("platform_feature_flags")
      .select("key, label, status, rollout_percent")
      .eq("key", parsed.data.key)
      .maybeSingle();

    if (!existing && !parsed.data.label) {
      return { ok: false, error: "Give the new flag a label." };
    }

    const { error } = await db.from("platform_feature_flags").upsert(
      {
        key: parsed.data.key,
        label: parsed.data.label ?? existing?.label ?? parsed.data.key,
        description: parsed.data.description,
        status: parsed.data.status ?? existing?.status ?? "DISABLED",
        rollout_percent:
          parsed.data.rolloutPercent ?? existing?.rollout_percent ?? 0,
        updated_by: operator.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    if (error) return { ok: false, error: "The flag could not be saved." };

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.feature_flag_updated",
      entityType: "platform_feature_flag",
      metadata: {
        key: parsed.data.key,
        status: parsed.data.status,
        rollout_percent: parsed.data.rolloutPercent,
        summary: `Flag ${parsed.data.key} set to ${parsed.data.status ?? existing?.status ?? "DISABLED"}`,
      },
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: "Feature flag saved." };
  });
}
