import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import { DEFAULT_TIERS, isTierKey, type TierDefinition } from "./tier-rules";

/**
 * Programme-level settings and tier definitions (migration 0166).
 *
 * Both tolerate 0166 not being applied yet: the settings fall back to the
 * safe defaults (nothing automatic) and the tiers to `DEFAULT_TIERS`, which
 * carry no rate uplift.
 */

/** 0166 tables post-date the generated types. */
export function untypedDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type ProgrammeSettings = {
  autoApprovePayouts: boolean;
  autoDispatchPayouts: boolean;
  fingerprintRetentionDays: number;
  clickRetentionDays: number;
  /** False when 0166 is not applied: callers show the switches as unavailable. */
  available: boolean;
};

export const SAFE_SETTINGS: ProgrammeSettings = {
  autoApprovePayouts: false,
  autoDispatchPayouts: false,
  fingerprintRetentionDays: 120,
  clickRetentionDays: 400,
  available: false,
};

export async function getProgrammeSettings(): Promise<ProgrammeSettings> {
  const { data, error } = await untypedDb()
    .from("affiliate_programme_settings")
    .select("auto_approve_payouts, auto_dispatch_payouts, fingerprint_retention_days, click_retention_days")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) {
    if (error && !isSchemaMissing(error)) console.error("[affiliates] settings read failed", error.message);
    return SAFE_SETTINGS;
  }
  const row = data as {
    auto_approve_payouts: boolean;
    auto_dispatch_payouts: boolean;
    fingerprint_retention_days: number;
    click_retention_days: number;
  };
  return {
    autoApprovePayouts: Boolean(row.auto_approve_payouts),
    autoDispatchPayouts: Boolean(row.auto_dispatch_payouts),
    fingerprintRetentionDays: row.fingerprint_retention_days,
    clickRetentionDays: row.click_retention_days,
    available: true,
  };
}

export async function loadTiers(): Promise<TierDefinition[]> {
  const { data, error } = await untypedDb()
    .from("affiliate_tiers")
    .select("key, name, rank, min_active_customers, commission_percent, description")
    .order("rank", { ascending: true });
  if (error || !data || data.length === 0) {
    if (error && !isSchemaMissing(error)) console.error("[affiliates] tiers read failed", error.message);
    return [...DEFAULT_TIERS];
  }
  return (data as Record<string, unknown>[])
    .filter((row) => isTierKey(row.key))
    .map((row) => ({
      key: row.key as TierDefinition["key"],
      name: String(row.name),
      rank: Number(row.rank),
      minActiveCustomers: Number(row.min_active_customers ?? 0),
      // `min_referred_mrr_minor` and `recurring_months` are not read: tiers
      // qualify on paid customers only and commission is one-off (0169).
      commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
      description: (row.description as string | null) ?? null,
    }));
}
