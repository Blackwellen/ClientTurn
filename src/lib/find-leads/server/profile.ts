import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AcquisitionProfileView } from "../types";

/**
 * The acquisition profile: what ClientTurn knows about the customer's own
 * business, and therefore what it is allowed to say on their behalf.
 *
 * It is assembled from tables that already exist — `business_profiles` for the
 * shape of the business, `icp_profiles` for who they sell to,
 * `conversion_goals` for what a good outcome is, `business_memory_facts` for
 * everything else. Find Leads deliberately does not introduce a parallel store:
 * a second copy of "what services does this business offer" is a second copy
 * that can be wrong.
 */

const FACT_KEYS = {
  services: "business.services",
  territories: "business.territories",
  targetCustomers: "icp.target_customers",
  priceBand: "business.price_band",
} as const;

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (value && typeof value === "object" && "items" in value) {
    return stringList((value as { items: unknown }).items);
  }
  return [];
}

export async function readAcquisitionProfile(
  businessId: string,
): Promise<AcquisitionProfileView> {
  const admin = createAdminClient();

  const [profile, facts, icp, goal, analysis] = await Promise.all([
    admin
      .from("business_profiles")
      .select("website_url, business_type, analysis_status, last_analysed_at")
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("business_memory_facts")
      .select("fact_key, value_json")
      .eq("business_id", businessId)
      .in("fact_key", Object.values(FACT_KEYS)),
    admin
      .from("icp_profiles")
      .select("industries, locations, roles")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("conversion_goals")
      .select("name, type")
      .eq("business_id", businessId)
      .eq("is_default", true)
      .maybeSingle(),
    admin
      .from("business_analysis_jobs")
      .select("status")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const factMap = new Map(
    (facts.data ?? []).map((row) => [row.fact_key, row.value_json as unknown]),
  );

  const services = stringList(factMap.get(FACT_KEYS.services));
  const territories = stringList(factMap.get(FACT_KEYS.territories));
  const targetCustomers =
    stringList(factMap.get(FACT_KEYS.targetCustomers)).length > 0
      ? stringList(factMap.get(FACT_KEYS.targetCustomers))
      : stringList(icp.data?.industries);

  const locations = territories.length > 0 ? territories : stringList(icp.data?.locations);

  // "Complete" is the bar for starting a search without further questions: who
  // the business is, what it sells, where, and what a good outcome looks like.
  const complete = Boolean(
    profile.data?.business_type &&
      services.length > 0 &&
      locations.length > 0 &&
      goal.data,
  );

  // The live job's status wins over the profile's, so a running analysis shows
  // as running the moment it is queued rather than after it first writes.
  const analysisStatus = (analysis.data?.status ??
    profile.data?.analysis_status ??
    "NOT_STARTED") as AcquisitionProfileView["analysisStatus"];

  return {
    businessType: profile.data?.business_type ?? null,
    services,
    locations,
    targetCustomers,
    conversionGoal: goal.data?.name ?? null,
    websiteUrl: profile.data?.website_url ?? null,
    complete,
    analysisStatus,
    lastAnalysedAt: profile.data?.last_analysed_at ?? null,
  };
}

/**
 * The default website for the "Analyse business" field.
 *
 * Falls back to the workspace's own recorded website; never to a guess derived
 * from the business name, which would send the crawler at somebody else's site.
 */
export async function defaultWebsiteUrl(businessId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("business_profiles")
    .select("website_url")
    .eq("business_id", businessId)
    .maybeSingle();

  if (profile?.website_url) return profile.website_url;

  const { data: settings } = await admin
    .from("business_settings")
    .select("booking_url")
    .eq("business_id", businessId)
    .maybeSingle();

  // A booking URL is not a website, but it is a domain the workspace has
  // already asserted ownership of, so it is a safe prefill.
  if (!settings?.booking_url) return null;
  try {
    return new URL(settings.booking_url).origin;
  } catch {
    return null;
  }
}

export type ProfileUpdate = {
  businessType?: string | null;
  services?: string[];
  territories?: string[];
  targetCustomers?: string[];
  websiteUrl?: string | null;
  salesModel?: "SERVICE" | "SAAS" | "ECOMMERCE" | "MARKETPLACE" | "AGENCY" | "OTHER" | null;
};

/**
 * Applies a reviewed profile edit.
 *
 * Facts written here are marked `verified_by_user`, which is what distinguishes
 * them from an AI reading of a website: locked, human-confirmed facts are never
 * overwritten by a later analysis.
 */
export async function updateAcquisitionProfile(
  businessId: string,
  update: ProfileUpdate,
): Promise<void> {
  const admin = createAdminClient();

  if (
    update.businessType !== undefined ||
    update.websiteUrl !== undefined ||
    update.salesModel !== undefined
  ) {
    await admin.from("business_profiles").upsert(
      {
        business_id: businessId,
        ...(update.businessType !== undefined ? { business_type: update.businessType } : {}),
        ...(update.websiteUrl !== undefined ? { website_url: update.websiteUrl } : {}),
        ...(update.salesModel !== undefined ? { sales_model: update.salesModel } : {}),
      },
      { onConflict: "business_id" },
    );
  }

  const factWrites: { key: string; value: string[] }[] = [];
  if (update.services) factWrites.push({ key: FACT_KEYS.services, value: update.services });
  if (update.territories) {
    factWrites.push({ key: FACT_KEYS.territories, value: update.territories });
  }
  if (update.targetCustomers) {
    factWrites.push({ key: FACT_KEYS.targetCustomers, value: update.targetCustomers });
  }

  for (const write of factWrites) {
    await admin.from("business_memory_facts").upsert(
      {
        business_id: businessId,
        fact_key: write.key,
        value_json: { items: write.value } as never,
        source_type: "USER",
        confidence: 1,
        verified_by_user: true,
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: "business_id,fact_key" },
    );
  }
}
