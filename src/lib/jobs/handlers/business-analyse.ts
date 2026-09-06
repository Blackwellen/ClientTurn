import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { safeFetchText } from "@/lib/security/safe-fetch";
import { CANDIDATE_PATHS, MAX_PAGES } from "@/lib/find-leads/server/analysis";

/**
 * The website analysis worker.
 *
 * It reads a bounded set of pages from the customer's own site and proposes
 * facts about their business. Three things it deliberately does not do:
 *
 *   * it does not crawl the whole site — a marketing site's identity is on a
 *     handful of pages, and an unbounded crawl is a denial-of-service against
 *     someone else's server;
 *   * it does not follow links off the origin — the customer authorised their
 *     own domain, not the internet;
 *   * it does not write to `business_memory_facts`. What it finds is a
 *     proposal a person reviews, because "the website says so" is not the same
 *     as "the business confirms it".
 */

const payloadSchema = z.object({ analysisId: z.uuid(), businessId: z.uuid() });

export async function handleBusinessAnalyse(job: ClaimedJob): Promise<void> {
  const { analysisId, businessId } = payloadSchema.parse(job.payload);
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("business_analysis_jobs")
    .select("id, website_url, status")
    .eq("id", analysisId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!analysis) throw new PermanentJobError(`Analysis ${analysisId} no longer exists.`);
  if (analysis.status === "CANCELLED" || analysis.status === "READY") return;

  await admin
    .from("business_analysis_jobs")
    .update({ status: "FETCHING", started_at: new Date().toISOString() })
    .eq("id", analysisId)
    .eq("business_id", businessId);

  const pages: { url: string; text: string }[] = [];
  let analysed = 0;

  for (const path of CANDIDATE_PATHS.slice(0, MAX_PAGES)) {
    const target = `${analysis.website_url.replace(/\/$/, "")}${path}`;
    // Every hop is re-validated inside safeFetchText, including redirects, so
    // a page that redirects to an internal address is refused here too.
    const result = await safeFetchText(target);

    if (result.ok) {
      pages.push({ url: result.url, text: stripHtml(result.body) });
      analysed += 1;

      await admin
        .from("business_analysis_jobs")
        .update({ pages_analysed: analysed })
        .eq("id", analysisId)
        .eq("business_id", businessId);

      await admin.from("business_knowledge_sources").insert({
        business_id: businessId,
        source_type: "WEBSITE_PAGE",
        label: path === "/" ? "Home" : path.replace(/^\//, ""),
        url: result.url,
        status: "READY",
        extract_summary: pages[pages.length - 1].text.slice(0, 500),
        fetched_at: new Date().toISOString(),
      });
    }

    if (analysed >= MAX_PAGES) break;
  }

  if (pages.length === 0) {
    await admin
      .from("business_analysis_jobs")
      .update({
        status: "FAILED",
        error_code: "NO_PAGES_READ",
        error_message: "None of the expected pages could be read.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", analysisId)
      .eq("business_id", businessId);

    await admin
      .from("business_profiles")
      .update({ analysis_status: "FAILED", analysis_error: "No pages could be read." })
      .eq("business_id", businessId);

    await recordAudit({
      businessId,
      actorType: "system",
      action: "acquisition_profile.analysis_failed",
      entityType: "business_analysis_job",
      entityId: analysisId,
      metadata: { code: "NO_PAGES_READ" },
    });
    return;
  }

  await admin
    .from("business_analysis_jobs")
    .update({ status: "EXTRACTING" })
    .eq("id", analysisId)
    .eq("business_id", businessId);

  const facts = extractFacts(pages);

  if (facts.length > 0) {
    await admin.from("business_analysis_facts").insert(
      facts.map((fact) => ({
        business_id: businessId,
        analysis_id: analysisId,
        category: fact.category,
        value_json: { items: fact.items } as never,
        source_url: fact.sourceUrl,
        confidence: fact.confidence,
        verification_state: "UNVERIFIED" as const,
      })),
    );
  }

  await admin
    .from("business_analysis_jobs")
    .update({
      // REVIEW, not READY: a person confirms these before they become facts.
      status: "REVIEW",
      facts_found: facts.length,
      pages_analysed: analysed,
      verification_state: "UNVERIFIED",
      completed_at: new Date().toISOString(),
    })
    .eq("id", analysisId)
    .eq("business_id", businessId);

  await admin.from("business_profiles").upsert(
    {
      business_id: businessId,
      analysis_status: facts.length > 0 ? "REVIEW" : "PARTIAL",
      analysis_error: null,
      pages_analysed: analysed,
      last_analysed_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );

  await recordAudit({
    businessId,
    actorType: "system",
    action: "acquisition_profile.analysed",
    entityType: "business_analysis_job",
    entityId: analysisId,
    metadata: { pages: analysed, facts: facts.length },
  });
}

/** Tags, scripts and entities out; readable text in. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

type ExtractedFact = {
  category:
    | "BUSINESS_TYPE"
    | "SERVICES"
    | "TERRITORIES"
    | "TARGET_CUSTOMERS"
    | "CONTACT";
  items: string[];
  sourceUrl: string;
  confidence: number;
};

/**
 * Deterministic extraction.
 *
 * Vocabulary matching rather than free generation, on purpose: the profile
 * decides who gets contacted and what may be claimed on the business's behalf,
 * and a hallucinated service or coverage area there becomes a false claim in an
 * outreach message. A model may later *rank* these candidates; it does not get
 * to invent them.
 */
function extractFacts(pages: { url: string; text: string }[]): ExtractedFact[] {
  const corpus = pages.map((page) => page.text.toLowerCase()).join(" ");
  const home = pages[0]?.url ?? "";
  const facts: ExtractedFact[] = [];

  const SERVICE_TERMS = [
    "roof repair",
    "roof replacement",
    "flat roof",
    "pitched roof",
    "commercial roofing",
    "roof maintenance",
    "guttering",
    "fascias",
    "soffits",
    "cladding",
    "leadwork",
    "chimney",
    "scaffolding",
    "insulation",
    "emergency repair",
  ];
  const services = SERVICE_TERMS.filter((term) => corpus.includes(term));
  if (services.length > 0) {
    facts.push({
      category: "SERVICES",
      items: services.map(titleCase),
      sourceUrl: home,
      confidence: 0.7,
    });
  }

  const UK_PLACES = [
    "bournemouth",
    "poole",
    "christchurch",
    "dorset",
    "hampshire",
    "southampton",
    "portsmouth",
    "salisbury",
    "wiltshire",
    "devon",
    "somerset",
    "new forest",
  ];
  const territories = UK_PLACES.filter((place) => corpus.includes(place));
  if (territories.length > 0) {
    facts.push({
      category: "TERRITORIES",
      items: territories.map(titleCase),
      sourceUrl: home,
      confidence: 0.65,
    });
  }

  const CUSTOMER_TERMS = [
    "property manager",
    "facilities manager",
    "landlord",
    "housing association",
    "commercial",
    "residential",
    "schools",
    "hotels",
    "councils",
  ];
  const customers = CUSTOMER_TERMS.filter((term) => corpus.includes(term));
  if (customers.length > 0) {
    facts.push({
      category: "TARGET_CUSTOMERS",
      items: customers.map(titleCase),
      sourceUrl: home,
      confidence: 0.6,
    });
  }

  const TYPE_TERMS: [string, string][] = [
    ["roofing contractor", "Roofing contractor"],
    ["roofer", "Roofing contractor"],
    ["builder", "Building contractor"],
    ["electrician", "Electrical contractor"],
    ["plumber", "Plumbing contractor"],
    ["landscaper", "Landscaping contractor"],
  ];
  const type = TYPE_TERMS.find(([term]) => corpus.includes(term));
  if (type) {
    facts.push({
      category: "BUSINESS_TYPE",
      items: [type[1]],
      sourceUrl: home,
      confidence: 0.75,
    });
  }

  const phone = corpus.match(/(?:\+44|0)\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/);
  if (phone) {
    facts.push({
      category: "CONTACT",
      items: [phone[0].trim()],
      sourceUrl: home,
      confidence: 0.8,
    });
  }

  return facts;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
