import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OutreachEligibility } from "@/lib/policy/types";
import { ACTIVE_INTENT_ONLY, applyProspectFilters, needsCompanyJoin } from "./filter-sql";
import type { ProspectActivity, ProspectActivityKind } from "./activity";
import type { ProspectFilters } from "./filters";
import type {
  Grade,
  ProspectIntentBadge,
  ProspectListRow,
  ProspectQuickCounts,
  ProspectScore,
  ProspectStatus,
  ProvenanceRow,
  RoleClassification,
  VerificationStatus,
} from "./types";

export * from "./types";

/**
 * Prospect reads.
 *
 * Everything here goes through the RLS-scoped client, so a query that forgets
 * its `business_id` filter still returns nothing across tenants. The explicit
 * `business_id` predicate is an additional filter, never the only guard — the
 * same rule `lib/leads/queries.ts` follows.
 *
 * Cost columns are not selected anywhere in this file: they are revoked from
 * the browser role in 0036, and a customer surface has no business reading
 * provider spend (§90, §112).
 */

const PROSPECT_COLUMNS = `
  id, first_name, last_name, role_title, role_classification, email, phone_e164,
  status, grade, score, verification_status, outreach_eligibility, eligibility_reason,
  campaign_id, source_provider, last_activity_at, last_contacted_at, replied_at,
  approved_at, promoted_at, last_intent_at, created_at, promoted_to_lead_id`;

const COMPANY_COLUMNS = `id, name, domain, website_url, industry, company_size,
                         employee_count, location_json`;

const LIST_SELECT = `${PROSPECT_COLUMNS},
  prospect_companies ( ${COMPANY_COLUMNS} )
`;

/** The same select with the company joined inwardly, so a company-scoped
 *  filter actually restricts the prospect rows rather than only the embed. */
const LIST_SELECT_INNER = `${PROSPECT_COLUMNS},
  prospect_companies!inner ( ${COMPANY_COLUMNS} )
`;

type RawProspect = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  role_classification: string;
  email: string | null;
  phone_e164: string | null;
  status: string;
  grade: string | null;
  score: number | null;
  verification_status: string;
  outreach_eligibility: string;
  eligibility_reason: string | null;
  campaign_id: string | null;
  source_provider: string | null;
  last_activity_at: string | null;
  last_contacted_at: string | null;
  replied_at: string | null;
  approved_at: string | null;
  promoted_at: string | null;
  last_intent_at: string | null;
  created_at: string;
  promoted_to_lead_id: string | null;
  prospect_companies: {
    id: string;
    name: string;
    domain: string | null;
    website_url: string | null;
    industry: string | null;
    company_size: string | null;
    employee_count: number | null;
    location_json: Record<string, unknown> | null;
  } | null;
};

function toListRow(
  raw: RawProspect,
  intent: Map<string, ProspectIntentBadge>,
  campaigns: Map<string, string>,
  activity?: Map<string, ProspectActivity>,
): ProspectListRow {
  const company = raw.prospect_companies;
  return {
    id: raw.id,
    first_name: raw.first_name,
    last_name: raw.last_name,
    role_title: raw.role_title,
    role_classification: raw.role_classification as RoleClassification,
    email: raw.email,
    phone_e164: raw.phone_e164,
    status: raw.status as ProspectStatus,
    grade: raw.grade as Grade | null,
    score: raw.score === null ? null : Number(raw.score),
    verification_status: raw.verification_status as VerificationStatus,
    outreach_eligibility: raw.outreach_eligibility as OutreachEligibility,
    eligibility_reason: raw.eligibility_reason,
    company: company
      ? {
          id: company.id,
          name: company.name,
          domain: company.domain,
          website_url: company.website_url,
          industry: company.industry,
          company_size: company.company_size,
          employee_count: company.employee_count,
          location_json: company.location_json ?? {},
        }
      : null,
    campaignId: raw.campaign_id,
    campaignName: raw.campaign_id ? (campaigns.get(raw.campaign_id) ?? null) : null,
    intent: intent.get(raw.id) ?? null,
    source_provider: raw.source_provider,
    last_activity_at: raw.last_activity_at,
    lastActivity: activity?.get(raw.id) ?? null,
    created_at: raw.created_at,
    promoted_to_lead_id: raw.promoted_to_lead_id,
  };
}

export type ProspectPage = {
  rows: ProspectListRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * The Prospects inbox. Paged and filtered in Postgres — a workspace on the Pro
 * plan can hold tens of thousands of prospects, so nothing is sliced in JS.
 */
export async function listProspects(
  businessId: string,
  filters: ProspectFilters,
): Promise<ProspectPage> {
  const supabase = await createClient();

  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  let query = supabase
    .from("prospects")
    .select(needsCompanyJoin(filters) ? LIST_SELECT_INNER : LIST_SELECT, { count: "exact" })
    .eq("business_id", businessId)
    .eq("is_test", false)
    // A promoted prospect lives in Leads now. Showing it in both places is the
    // fastest way to make the Prospect/Lead boundary meaningless.
    .is("promoted_to_lead_id", null);

  query = applyProspectFilters(query, filters);

  switch (filters.sort) {
    case "recent":
      query = query.order("created_at", { ascending: false });
      break;
    case "activity":
      query = query.order("last_activity_at", { ascending: false, nullsFirst: false });
      break;
    case "name":
      query = query
        .order("role_title", { ascending: true, nullsFirst: false })
        .order("last_name", { ascending: true, nullsFirst: false });
      break;
    case "company":
      query = query.order("company_id", { ascending: true, nullsFirst: false });
      break;
    case "intent":
      // Freshness of the newest live signal. `last_intent_at` is maintained by
      // the intent writer, so this is an indexed column order rather than a
      // per-row lookup.
      query = query.order("last_intent_at", { ascending: false, nullsFirst: false });
      break;
    case "score":
      query = query
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    default:
      // Relevance: the strongest prospect that is also actionable. Eligibility
      // first, then score — a suppressed A is not more relevant than an
      // eligible B, because nothing can be done with it.
      query = query
        .order("outreach_eligibility", { ascending: true })
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
  }

  const { data, count } = await query.range(from, to);
  const rows = (data ?? []) as unknown as RawProspect[];

  // Intent and campaign names are resolved for the page's rows only, so the
  // cost of both is bounded by page size rather than by workspace size.
  const ids = rows.map((r) => r.id);
  const [intent, campaigns, activity] = await Promise.all([
    loadIntentBadges(businessId, ids),
    loadCampaignNames(
      businessId,
      rows.map((r) => r.campaign_id).filter((v): v is string => Boolean(v)),
    ),
    Promise.resolve(loadLastActivity(businessId, rows)),
  ]);

  return {
    rows: rows.map((row) => toListRow(row, intent, campaigns, activity)),
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

/**
 * What last happened to each prospect on the page.
 *
 * Resolved from timestamps the prospect row already carries rather than from a
 * join against messages: the row is written by the same code paths that send,
 * reply and promote, so the answer is already there. A per-row message lookup
 * would be the N+1 that §21.7 warns about, for a single table cell.
 *
 * The winner is simply the most recent of the candidate timestamps. Where two
 * are equal the more advanced state wins, because "replied" and "email sent"
 * at the same instant means the reply is what a reader needs to see.
 */
function loadLastActivity(
  _businessId: string,
  rows: RawProspect[],
): Map<string, ProspectActivity> {
  const out = new Map<string, ProspectActivity>();

  for (const row of rows) {
    const candidates: { kind: ProspectActivityKind; at: string | null }[] = [
      { kind: "SOURCED", at: row.created_at },
      { kind: "INTENT_DETECTED", at: row.last_intent_at },
      { kind: "APPROVED", at: row.approved_at },
      { kind: "EMAIL_SENT", at: row.last_contacted_at },
      { kind: "REPLY_RECEIVED", at: row.replied_at },
      { kind: "PROMOTED", at: row.promoted_at },
    ];

    let best: ProspectActivity | null = null;
    for (const candidate of candidates) {
      if (!candidate.at) continue;
      if (!best || candidate.at >= best.at) {
        best = { kind: candidate.kind, at: candidate.at };
      }
    }

    // A suppressed prospect's headline is its suppression, whatever happened
    // before it — that is the state a reader has to act on.
    if (best && (row.status === "SUPPRESSED" || row.status === "UNSUBSCRIBED")) {
      best = { kind: "SUPPRESSED", at: row.last_activity_at ?? best.at };
    }

    if (best) out.set(row.id, best);
  }

  return out;
}

/** Highest live intent signal per prospect, via the SQL function so an expired
 *  signal can never be counted. */
async function loadIntentBadges(
  businessId: string,
  prospectIds: string[],
): Promise<Map<string, ProspectIntentBadge>> {
  const out = new Map<string, ProspectIntentBadge>();
  if (prospectIds.length === 0) return out;

  const supabase = await createClient();
  const { data } = await supabase.rpc("prospect_live_intent", {
    p_business_id: businessId,
    p_prospect_ids: prospectIds,
  });

  for (const row of data ?? []) {
    out.set(row.prospect_id, {
      categoryId: row.intent_category_id,
      categoryName: row.category_name,
      observedAt: row.observed_at,
      expiresAt: row.expires_at,
      scoreImpact: Number(row.score_impact),
      matchCount: row.match_count,
    });
  }
  return out;
}

async function loadCampaignNames(
  businessId: string,
  campaignIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(campaignIds)];
  if (unique.length === 0) return out;

  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_campaigns")
    .select("id, name")
    .eq("business_id", businessId)
    .in("id", unique);

  for (const row of data ?? []) out.set(row.id, row.name);
  return out;
}

/** Quick-filter chip counts, in one round trip rather than seven. */
export const getProspectQuickCounts = cache(
  async (businessId: string): Promise<ProspectQuickCounts> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("prospect_quick_counts", {
      p_business_id: businessId,
    });

    const row = Array.isArray(data) ? data[0] : null;
    return {
      all: row?.all_count ?? 0,
      aGrade: row?.a_grade ?? 0,
      intent: row?.intent ?? 0,
      ready: row?.ready ?? 0,
      contacted: row?.contacted ?? 0,
      replied: row?.replied ?? 0,
      review: row?.review ?? 0,
    };
  },
);

/* ----------------------------------------------------------------- drawer */

export type ProspectDetail = {
  prospect: ProspectListRow;
  score: ProspectScore | null;
  provenance: ProvenanceRow[];
  intentEvents: {
    id: string;
    categoryName: string;
    signalType: string;
    source: string;
    sourceUrl: string | null;
    observedAt: string;
    expiresAt: string;
    evidenceSummary: string | null;
    expired: boolean;
  }[];
  research: {
    id: string;
    type: string;
    provider: string;
    status: string;
    summary: string | null;
    completedAt: string | null;
  }[];
  verification: {
    id: string;
    channel: string;
    provider: string;
    result: string;
    verifiedAt: string;
  }[];
  conversationId: string | null;
  messages: {
    id: string;
    direction: string;
    channel: string;
    subject: string | null;
    body: string;
    status: string;
    replyClassification: string | null;
    createdAt: string;
    sentAt: string | null;
  }[];
  permission: {
    relationshipType: string;
    consentStatus: string;
    subscriberType: string;
    consentEvidence: string | null;
    country: string | null;
  } | null;
  eligibilityByChannel: {
    channel: string;
    result: string;
    reasonCode: string;
    policyVersion: string;
    evaluatedAt: string;
  }[];
};

export async function getProspectDetail(
  businessId: string,
  prospectId: string,
): Promise<ProspectDetail | null> {
  const supabase = await createClient();

  const { data: raw } = await supabase
    .from("prospects")
    .select(LIST_SELECT + ", conversation_id")
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  if (!raw) return null;
  const prospectRaw = raw as unknown as RawProspect & { conversation_id: string | null };

  const [intent, campaigns] = await Promise.all([
    loadIntentBadges(businessId, [prospectId]),
    loadCampaignNames(businessId, prospectRaw.campaign_id ? [prospectRaw.campaign_id] : []),
  ]);

  const [
    scoreResult,
    provenanceResult,
    intentEventsResult,
    researchResult,
    verificationResult,
    messagesResult,
    permissionResult,
    eligibilityResult,
  ] = await Promise.all([
    supabase
      .from("prospect_scores")
      .select("id, score_version, total_score, grade, explanation, created_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("prospect_data_sources")
      .select(
        "id, field_name, value_json, provider, source_type, source_url, confidence, obtained_at, verified_at, policy_tags",
      )
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("obtained_at", { ascending: false })
      .limit(100),
    supabase
      .from("intent_events")
      .select(
        "id, signal_type, source, source_url, observed_at, expires_at, evidence_summary, intent_categories ( name )",
      )
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("observed_at", { ascending: false })
      .limit(50),
    supabase
      .from("prospect_enrichments")
      .select("id, enrichment_type, provider, status, result_json, completed_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("requested_at", { ascending: false })
      .limit(50),
    supabase
      .from("prospect_verifications")
      .select("id, channel, provider, result, verified_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("verified_at", { ascending: false })
      .limit(20),
    supabase
      .from("messages")
      .select(
        "id, direction, channel, subject, body, status, reply_classification, created_at, sent_at",
      )
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("contact_permissions")
      .select("relationship_type, consent_status, subscriber_type, consent_evidence, country")
      .eq("business_id", businessId)
      .eq("subject_type", "PROSPECT")
      .eq("subject_id", prospectId)
      .maybeSingle(),
    supabase
      .from("contactability_results")
      .select("channel, result, reason_code, policy_version, evaluated_at")
      .eq("business_id", businessId)
      .eq("subject_type", "PROSPECT")
      .eq("subject_id", prospectId),
  ]);

  const scoreRow = scoreResult.data;
  let score: ProspectScore | null = null;

  if (scoreRow) {
    const { data: factorRows } = await supabase
      .from("prospect_score_factors")
      .select(
        "factor, weight, raw_value, contribution, direction, evidence_summary, evidence_source, evidence_url, observed_at, confidence",
      )
      .eq("business_id", businessId)
      .eq("prospect_score_id", scoreRow.id);

    score = {
      id: scoreRow.id,
      scoreVersion: scoreRow.score_version,
      totalScore: Number(scoreRow.total_score),
      grade: scoreRow.grade as Grade,
      explanation: scoreRow.explanation,
      createdAt: scoreRow.created_at,
      factors: (factorRows ?? []).map((f) => ({
        factor: f.factor as ProspectScore["factors"][number]["factor"],
        weight: Number(f.weight),
        rawValue: Number(f.raw_value),
        contribution: Number(f.contribution),
        direction: f.direction as "POSITIVE" | "NEGATIVE" | "NEUTRAL",
        evidenceSummary: f.evidence_summary,
        evidenceSource: f.evidence_source,
        evidenceUrl: f.evidence_url,
        observedAt: f.observed_at,
        confidence: Number(f.confidence),
      })),
    };
  }

  const now = Date.now();

  return {
    prospect: toListRow(prospectRaw, intent, campaigns),
    score,
    provenance: (provenanceResult.data ?? []).map((row) => ({
      id: row.id,
      fieldName: row.field_name,
      value: row.value_json,
      provider: row.provider,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      confidence: Number(row.confidence),
      obtainedAt: row.obtained_at,
      verifiedAt: row.verified_at,
      policyTags: Array.isArray(row.policy_tags) ? (row.policy_tags as string[]) : [],
    })),
    intentEvents: (intentEventsResult.data ?? []).map((row) => {
      const category = row.intent_categories as unknown as { name: string } | null;
      return {
        id: row.id,
        categoryName: category?.name ?? "Intent",
        signalType: row.signal_type,
        source: row.source,
        sourceUrl: row.source_url,
        observedAt: row.observed_at,
        expiresAt: row.expires_at,
        evidenceSummary: row.evidence_summary,
        expired: new Date(row.expires_at).getTime() <= now,
      };
    }),
    research: (researchResult.data ?? []).map((row) => ({
      id: row.id,
      type: row.enrichment_type,
      provider: row.provider,
      status: row.status,
      summary:
        row.result_json && typeof row.result_json === "object"
          ? ((row.result_json as Record<string, unknown>).summary as string | null) ?? null
          : null,
      completedAt: row.completed_at,
    })),
    verification: (verificationResult.data ?? []).map((row) => ({
      id: row.id,
      channel: row.channel,
      provider: row.provider,
      result: row.result,
      verifiedAt: row.verified_at,
    })),
    conversationId: prospectRaw.conversation_id,
    messages: (messagesResult.data ?? []).map((row) => ({
      id: row.id,
      direction: row.direction,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      status: row.status,
      replyClassification: row.reply_classification,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    })),
    permission: permissionResult.data
      ? {
          relationshipType: permissionResult.data.relationship_type,
          consentStatus: permissionResult.data.consent_status,
          subscriberType: permissionResult.data.subscriber_type,
          consentEvidence: permissionResult.data.consent_evidence,
          country: permissionResult.data.country,
        }
      : null,
    eligibilityByChannel: (eligibilityResult.data ?? []).map((row) => ({
      channel: row.channel,
      result: row.result,
      reasonCode: row.reason_code,
      policyVersion: row.policy_version,
      evaluatedAt: row.evaluated_at,
    })),
  };
}

/* ------------------------------------------------------------ filter options */

export type ProspectFilterOptions = {
  industries: string[];
  companySizes: string[];
  locations: string[];
  roles: string[];
  campaigns: { id: string; name: string }[];
  icpProfiles: { id: string; name: string }[];
  intentCategories: { id: string; name: string }[];
  providers: string[];
};

/**
 * Distinct values for the advanced filter panel.
 *
 * Read through the service role and hard-scoped to the caller's workspace:
 * PostgREST has no DISTINCT, and pulling every prospect row into the app just
 * to collect industries would be far worse than one narrow admin query.
 */
export const getProspectFilterOptions = cache(
  async (businessId: string): Promise<ProspectFilterOptions> => {
    const admin = createAdminClient();

    const [companies, prospects, campaigns, icps, intents] = await Promise.all([
      admin
        .from("prospect_companies")
        .select("industry, company_size, location_json")
        .eq("business_id", businessId)
        .limit(1000),
      admin
        .from("prospects")
        .select("role_title, source_provider")
        .eq("business_id", businessId)
        .limit(1000),
      admin
        .from("outreach_campaigns")
        .select("id, name")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(100),
      admin
        .from("icp_profiles")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name"),
      admin
        .from("intent_categories")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name"),
    ]);

    const sorted = (values: (string | null)[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
        a.localeCompare(b, "en-GB"),
      );

    const cities = (companies.data ?? [])
      .map((r) => (r.location_json as Record<string, unknown> | null)?.city)
      .map((v) => (typeof v === "string" ? v : null));

    return {
      industries: sorted((companies.data ?? []).map((r) => r.industry)),
      companySizes: sorted((companies.data ?? []).map((r) => r.company_size)),
      locations: sorted(cities).slice(0, 100),
      roles: sorted((prospects.data ?? []).map((r) => r.role_title)).slice(0, 100),
      campaigns: campaigns.data ?? [],
      icpProfiles: icps.data ?? [],
      intentCategories: intents.data ?? [],
      providers: sorted((prospects.data ?? []).map((r) => r.source_provider)),
    };
  },
);

/* ------------------------------------------------------- explainable score */

export type ProspectScoringDetail = {
  prospect: ProspectListRow;
  score: ProspectScore | null;
  /** Older scores, so a decision taken under a previous policy version can
   *  still be explained against the policy that produced it (§14.8). */
  history: {
    id: string;
    scoreVersion: string;
    totalScore: number;
    grade: Grade;
    createdAt: string;
  }[];
};

/**
 * Everything the Explainable Prospect Scoring page renders.
 *
 * The current score and its factors only — this page never recomputes. A page
 * that scored on render would show a different number from the one the campaign
 * gate actually used, which defeats the purpose of explaining it.
 */
export async function getProspectScoring(
  businessId: string,
  prospectId: string,
): Promise<ProspectScoringDetail | null> {
  const supabase = await createClient();

  const { data: raw } = await supabase
    .from("prospects")
    .select(LIST_SELECT)
    .eq("business_id", businessId)
    .eq("id", prospectId)
    .maybeSingle();

  if (!raw) return null;
  const prospectRaw = raw as unknown as RawProspect;

  const [intent, campaigns, currentScore, historyResult] = await Promise.all([
    loadIntentBadges(businessId, [prospectId]),
    loadCampaignNames(businessId, prospectRaw.campaign_id ? [prospectRaw.campaign_id] : []),
    supabase
      .from("prospect_scores")
      .select("id, score_version, total_score, grade, explanation, created_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("prospect_scores")
      .select("id, score_version, total_score, grade, created_at")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  let score: ProspectScore | null = null;
  const scoreRow = currentScore.data;

  if (scoreRow) {
    const { data: factorRows } = await supabase
      .from("prospect_score_factors")
      .select(
        "factor, weight, raw_value, contribution, direction, evidence_summary, evidence_source, evidence_url, observed_at, confidence",
      )
      .eq("business_id", businessId)
      .eq("prospect_score_id", scoreRow.id);

    score = {
      id: scoreRow.id,
      scoreVersion: scoreRow.score_version,
      totalScore: Number(scoreRow.total_score),
      grade: scoreRow.grade as Grade,
      explanation: scoreRow.explanation,
      createdAt: scoreRow.created_at,
      factors: (factorRows ?? []).map((f) => ({
        factor: f.factor as ProspectScore["factors"][number]["factor"],
        weight: Number(f.weight),
        rawValue: Number(f.raw_value),
        contribution: Number(f.contribution),
        direction: f.direction as "POSITIVE" | "NEGATIVE" | "NEUTRAL",
        evidenceSummary: f.evidence_summary,
        evidenceSource: f.evidence_source,
        evidenceUrl: f.evidence_url,
        observedAt: f.observed_at,
        confidence: Number(f.confidence),
      })),
    };
  }

  return {
    prospect: toListRow(prospectRaw, intent, campaigns, loadLastActivity(businessId, [prospectRaw])),
    score,
    history: (historyResult.data ?? []).map((row) => ({
      id: row.id,
      scoreVersion: row.score_version,
      totalScore: Number(row.total_score),
      grade: row.grade as Grade,
      createdAt: row.created_at,
    })),
  };
}

/* --------------------------------------------------------------- inbox KPIs */

export type ProspectKpi = {
  key: string;
  label: string;
  value: number;
  /**
   * Change against the previous 30 days, as a fraction.
   *
   * Null where the schema cannot support the comparison honestly. "Ready for
   * outreach" and "In campaigns" are *states*, not events: nothing records when
   * a prospect entered them, so there is no previous-period figure to compare
   * against and no trend is shown rather than a made-up one.
   */
  trend: number | null;
};

const THIRTY_DAYS_MS = 30 * 864e5;

/**
 * The five counters above the Prospects inbox (§12.2).
 *
 * Count-only queries — `head: true` with an exact count — so none of them
 * transfers a row. Ten narrow counts is far cheaper than one query that returns
 * the table and counts in JS, and every predicate here is covered by an index.
 */
export const getProspectKpis = cache(
  async (businessId: string): Promise<ProspectKpi[]> => {
    const supabase = await createClient();

    const now = Date.now();
    const currentFrom = new Date(now - THIRTY_DAYS_MS).toISOString();
    const priorFrom = new Date(now - 2 * THIRTY_DAYS_MS).toISOString();

    const base = () =>
      supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_test", false);

    const [
      found,
      foundCurrent,
      foundPrior,
      verified,
      ready,
      inCampaign,
      converted,
      convertedCurrent,
      convertedPrior,
    ] = await Promise.all([
      base().is("promoted_to_lead_id", null),
      base().gte("created_at", currentFrom),
      base().gte("created_at", priorFrom).lt("created_at", currentFrom),
      base().eq("verification_status", "VALID").is("promoted_to_lead_id", null),
      base()
        .in("status", ["READY", "APPROVED"])
        .eq("outreach_eligibility", "ELIGIBLE")
        .is("promoted_to_lead_id", null),
      base().not("campaign_id", "is", null).is("promoted_to_lead_id", null),
      base().not("promoted_to_lead_id", "is", null),
      base().gte("promoted_at", currentFrom),
      base().gte("promoted_at", priorFrom).lt("promoted_at", currentFrom),
    ]);

    const change = (current: number | null, prior: number | null): number | null => {
      // Growth from nothing is undefined, not infinite. Showing "+100%" for a
      // workspace's first month would be a claim about a baseline that never
      // existed.
      if (!prior || prior <= 0) return null;
      return ((current ?? 0) - prior) / prior;
    };

    return [
      {
        key: "found",
        label: "Prospects found",
        value: found.count ?? 0,
        trend: change(foundCurrent.count, foundPrior.count),
      },
      {
        key: "verified",
        label: "Verified contacts",
        value: verified.count ?? 0,
        trend: null,
      },
      {
        key: "ready",
        label: "Ready for outreach",
        value: ready.count ?? 0,
        trend: null,
      },
      {
        key: "campaigns",
        label: "In campaigns",
        value: inCampaign.count ?? 0,
        trend: null,
      },
      {
        key: "converted",
        label: "Converted to leads",
        value: converted.count ?? 0,
        trend: change(convertedCurrent.count, convertedPrior.count),
      },
    ];
  },
);

export { ACTIVE_INTENT_ONLY };
