import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessProfileData,
  ConversionGoalType,
  FactSource,
  IcpProfileRow,
} from "./types";

export * from "./types";

/** Coerces a jsonb array of strings, tolerating the shapes providers emit. */
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object" && "name" in entry
            ? String((entry as { name: unknown }).name)
            : null,
      )
      .filter((entry): entry is string => Boolean(entry));
  }
  return [];
}

/**
 * Everything the Business Profile section renders.
 *
 * One pass rather than per-card fetches: the surface is a single scroll and a
 * waterfall would be visible as the page assembling itself.
 */
export async function loadBusinessProfile(
  businessId: string,
): Promise<BusinessProfileData> {
  const supabase = await createClient();

  const [profile, facts, sources, icps, goals, learnings, prospectCounts] =
    await Promise.all([
      supabase
        .from("business_profiles")
        .select(
          "website_url, business_type, sales_model, summary, analysis_status, pages_analysed, last_analysed_at",
        )
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("business_memory_facts")
        .select(
          "id, fact_key, value_json, source_type, confidence, verified_by_user, locked, last_verified_at, created_at",
        )
        .eq("business_id", businessId)
        .order("fact_key"),
      supabase
        .from("business_knowledge_sources")
        .select("id, source_type, label, url, status, extract_summary, error_message, fetched_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("icp_profiles")
        .select("id, name, description, industries, locations, roles, company_filters, source, active")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      supabase
        .from("conversion_goals")
        .select("id, name, type, destination_type, qualification_required, is_default, active")
        .eq("business_id", businessId)
        .order("is_default", { ascending: false })
        .order("name"),
      // Only findings with a real sample size are worth showing; §54.2 requires
      // a minimum before a "learning" is presented as one.
      supabase
        .from("business_learning_events")
        .select("id, learning_type, title, detail, sample_size, confidence, created_at")
        .eq("business_id", businessId)
        .gte("sample_size", 10)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("prospects")
        .select("icp_profile_id")
        .eq("business_id", businessId)
        .not("icp_profile_id", "is", null)
        .limit(5000),
    ]);

  const countByIcp = new Map<string, number>();
  for (const row of prospectCounts.data ?? []) {
    if (!row.icp_profile_id) continue;
    countByIcp.set(row.icp_profile_id, (countByIcp.get(row.icp_profile_id) ?? 0) + 1);
  }

  const icpProfiles: IcpProfileRow[] = (icps.data ?? []).map((row) => {
    const filters = (row.company_filters ?? {}) as {
      employeeMin?: number;
      employeeMax?: number;
    };
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      industries: stringList(row.industries),
      locations: stringList(row.locations),
      roles: stringList(row.roles),
      companyFilters: filters,
      source: row.source as IcpProfileRow["source"],
      active: row.active,
      prospectCount: countByIcp.get(row.id) ?? 0,
    };
  });

  return {
    profile: profile.data
      ? {
          websiteUrl: profile.data.website_url,
          businessType: profile.data.business_type,
          salesModel: profile.data.sales_model,
          summary: profile.data.summary,
          analysisStatus: profile.data.analysis_status,
          pagesAnalysed: profile.data.pages_analysed,
          lastAnalysedAt: profile.data.last_analysed_at,
        }
      : null,
    facts: (facts.data ?? []).map((row) => ({
      id: row.id,
      factKey: row.fact_key,
      value: row.value_json,
      sourceType: row.source_type as FactSource,
      confidence: Number(row.confidence),
      verifiedByUser: row.verified_by_user,
      locked: row.locked,
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
    })),
    knowledgeSources: (sources.data ?? []).map((row) => ({
      id: row.id,
      sourceType: row.source_type as BusinessProfileData["knowledgeSources"][number]["sourceType"],
      label: row.label,
      url: row.url,
      status: row.status as BusinessProfileData["knowledgeSources"][number]["status"],
      extractSummary: row.extract_summary,
      errorMessage: row.error_message,
      fetchedAt: row.fetched_at,
    })),
    icpProfiles,
    conversionGoals: (goals.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as ConversionGoalType,
      destinationType: row.destination_type,
      qualificationRequired: row.qualification_required,
      isDefault: row.is_default,
      active: row.active,
    })),
    learnings: (learnings.data ?? []).map((row) => ({
      id: row.id,
      learningType: row.learning_type,
      title: row.title,
      detail: row.detail,
      sampleSize: row.sample_size,
      confidence: Number(row.confidence),
      createdAt: row.created_at,
    })),
  };
}
