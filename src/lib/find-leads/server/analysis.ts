import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSafeUrl, checkUrlShape } from "@/lib/security/safe-fetch";
import { enqueue } from "@/lib/jobs/queue";
import type { AnalysisProgressView } from "../types";

/**
 * Website analysis: the "tell ClientTurn about your business" path.
 *
 * Two rules shape this module. First, the crawl never happens inside the
 * request — a page fetch loop in a server action holds a connection open for
 * however long a stranger's web server feels like taking. Second, what a crawl
 * concludes is a *proposal*: facts land in `business_analysis_facts` for
 * review, and only reach `business_memory_facts` when a person accepts them.
 */

/** Bounded on purpose: a marketing site's identity is on its first few pages. */
export const MAX_PAGES = 12;
export const MAX_DEPTH = 2;

/** The paths worth reading, in the order they answer the profile's questions. */
export const CANDIDATE_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/services",
  "/what-we-do",
  "/our-services",
  "/areas-we-cover",
  "/service-areas",
  "/coverage",
  "/contact",
  "/contact-us",
  "/commercial",
];

export type StartAnalysisResult =
  | { ok: true; analysisId: string }
  | { ok: false; code: AnalysisRejection };

export type AnalysisRejection =
  | "INVALID_URL"
  | "BLOCKED_SCHEME"
  | "BLOCKED_HOST"
  | "BLOCKED_PORT"
  | "DNS_FAILED"
  | "ALREADY_RUNNING";

const REJECTION_SENTENCES: Record<AnalysisRejection, string> = {
  INVALID_URL: "That does not look like a website address.",
  BLOCKED_SCHEME: "Only http and https website addresses can be analysed.",
  BLOCKED_HOST: "That address cannot be reached from ClientTurn.",
  BLOCKED_PORT: "Only standard web ports can be analysed.",
  DNS_FAILED: "That website address could not be found.",
  ALREADY_RUNNING: "An analysis is already running for this workspace.",
};

export function analysisRejectionSentence(code: AnalysisRejection): string {
  return REJECTION_SENTENCES[code] ?? "That website could not be analysed.";
}

/**
 * Validates the URL and queues the crawl.
 *
 * The full SSRF check (including DNS) runs here as well as in the worker. Doing
 * it at submit time is what lets the customer see "that address cannot be
 * reached" immediately instead of a job failing silently a minute later; doing
 * it again in the worker is what actually protects the network.
 */
export async function startAnalysis(input: {
  businessId: string;
  userId: string;
  websiteUrl: string;
}): Promise<StartAnalysisResult> {
  const shape = checkUrlShape(input.websiteUrl);
  if (!shape.ok) return { ok: false, code: shape.code as AnalysisRejection };

  const safe = await assertSafeUrl(input.websiteUrl);
  if (!safe.ok) return { ok: false, code: safe.code as AnalysisRejection };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("business_analysis_jobs")
    .insert({
      business_id: input.businessId,
      website_url: safe.url.origin,
      status: "QUEUED",
      pages_targeted: MAX_PAGES,
      requested_by: input.userId,
    })
    .select("id")
    .single();

  // The partial unique index on in-flight jobs turns a double click into a
  // constraint violation rather than a second crawl.
  if (error?.code === "23505") return { ok: false, code: "ALREADY_RUNNING" };
  if (error) throw error;

  await admin.from("business_profiles").upsert(
    {
      business_id: input.businessId,
      website_url: safe.url.origin,
      analysis_status: "QUEUED",
      analysis_error: null,
    },
    { onConflict: "business_id" },
  );

  await enqueue(
    "business.analyse",
    { analysisId: data.id, businessId: input.businessId },
    { businessId: input.businessId, idempotencyKey: `business.analyse:${data.id}` },
  );

  return { ok: true, analysisId: data.id };
}

const CATEGORY_LABELS: { category: string; label: string }[] = [
  { category: "BUSINESS_TYPE", label: "Business information" },
  { category: "SERVICES", label: "Services and products" },
  { category: "TARGET_CUSTOMERS", label: "Target customers" },
  { category: "TERRITORIES", label: "Locations" },
  { category: "CONTACT", label: "Contact details" },
];

export async function getAnalysisProgress(
  businessId: string,
  analysisId?: string,
): Promise<AnalysisProgressView | null> {
  const admin = createAdminClient();

  let query = admin
    .from("business_analysis_jobs")
    .select(
      "id, status, pages_targeted, pages_analysed, verification_state, error_code",
    )
    .eq("business_id", businessId);

  query = analysisId
    ? query.eq("id", analysisId)
    : query.order("created_at", { ascending: false }).limit(1);

  const { data: job } = await query.maybeSingle();
  if (!job) return null;

  const { data: facts } = await admin
    .from("business_analysis_facts")
    .select("category")
    .eq("business_id", businessId)
    .eq("analysis_id", job.id);

  const found = new Set((facts ?? []).map((row) => row.category));
  const running = job.status === "FETCHING" || job.status === "EXTRACTING";

  return {
    id: job.id,
    status: job.status as AnalysisProgressView["status"],
    pagesTargeted: job.pages_targeted,
    pagesAnalysed: job.pages_analysed,
    percent:
      job.pages_targeted > 0
        ? Math.min(100, Math.round((job.pages_analysed / job.pages_targeted) * 100))
        : 0,
    verificationState: job.verification_state as AnalysisProgressView["verificationState"],
    categories: CATEGORY_LABELS.map(({ category, label }) => ({
      label,
      state: found.has(category)
        ? ("FOUND" as const)
        : running
          ? ("ANALYSING" as const)
          : ("PENDING" as const),
    })),
    errorCode: job.error_code,
  };
}

export type ReviewFact = {
  id: string;
  category: string;
  label: string;
  values: string[];
  sourceUrl: string | null;
  confidence: number;
  accepted: boolean;
};

export async function listAnalysisFacts(
  businessId: string,
  analysisId: string,
): Promise<ReviewFact[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("business_analysis_facts")
    .select("id, category, value_json, source_url, confidence, accepted")
    .eq("business_id", businessId)
    .eq("analysis_id", analysisId)
    .order("category", { ascending: true });

  const labels = new Map(CATEGORY_LABELS.map((entry) => [entry.category, entry.label]));

  return (data ?? []).map((row) => {
    const value = row.value_json as { items?: unknown };
    const items = Array.isArray(value?.items)
      ? value.items.filter((item): item is string => typeof item === "string")
      : [];

    return {
      id: row.id,
      category: row.category,
      label: labels.get(row.category) ?? row.category,
      values: items,
      sourceUrl: row.source_url,
      confidence: Number(row.confidence),
      accepted: row.accepted,
    };
  });
}
