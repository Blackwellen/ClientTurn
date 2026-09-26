import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { KeyedTtlCache } from "./tokens";
import { buildTierConfig, FALLBACK_TIER_CONFIG, type TierConfig } from "./tiers";

/**
 * Loads model tiers and task routes from 0122's tables, cached briefly.
 *
 * Never fails a model call: a read error, an empty table or a malformed row
 * falls back to the env-configured nano/mini mapping in tiers.ts, which is
 * exactly how the router behaved before tiers lived in the database. A failed
 * read is not cached, so the next call retries.
 */

const TIER_CONFIG_TTL_MS = 60 * 1000;
const cache = new KeyedTtlCache<TierConfig>(TIER_CONFIG_TTL_MS);

/**
 * The tables post-date the last `database.types.ts` generation. One cast, at
 * this seam, as token-service.ts does for 0116's RPCs.
 */
type UntypedFrom = (table: string) => {
  select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

export async function loadTierConfig(): Promise<TierConfig> {
  const cached = cache.get("config");
  if (cached) return cached;

  try {
    const admin = createAdminClient();
    const from = (admin.from as unknown as UntypedFrom).bind(admin);
    const [tiers, routes] = await Promise.all([
      from("ai_model_tiers").select(
        "tier, provider, deployment_alias, deployment_name, price_currency, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, enabled",
      ),
      from("ai_task_routes").select("task_type, default_tier, allowed_tiers"),
    ]);

    if (tiers.error || routes.error) {
      console.error("[tier-config] read failed; using env fallback", {
        tiers: tiers.error?.message ?? null,
        routes: routes.error?.message ?? null,
      });
      return FALLBACK_TIER_CONFIG;
    }

    const config = buildTierConfig(
      (tiers.data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          tier: row.tier,
          provider: row.provider as "none" | "azure_openai",
          deploymentAlias: row.deployment_alias as "nano" | "mini" | null,
          deploymentName: (row.deployment_name as string | null) ?? null,
          priceCurrency: row.price_currency as "USD" | "GBP",
          inputPricePer1m: row.input_price_per_1m as number,
          cachedInputPricePer1m: row.cached_input_price_per_1m as number,
          outputPricePer1m: row.output_price_per_1m as number,
          enabled: Boolean(row.enabled),
        };
      }),
      (routes.data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          taskType: String(row.task_type),
          defaultTier: row.default_tier,
          allowedTiers: row.allowed_tiers,
        };
      }),
    );
    cache.set("config", config);
    return config;
  } catch (error) {
    console.error("[tier-config] read threw; using env fallback", error);
    return FALLBACK_TIER_CONFIG;
  }
}
