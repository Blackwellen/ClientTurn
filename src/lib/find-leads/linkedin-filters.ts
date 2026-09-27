import { z } from "zod";

/**
 * LinkedIn's lead and account filters, as part of the search plan.
 *
 * Pure -- no `server-only` -- because the plan editor, the "Search LinkedIn"
 * link and the imported-list filter all read it, and the rules are tested
 * without a network.
 *
 * The vocabularies below are LinkedIn's own, as its search and Sales Navigator
 * show them. Every field is optional and empty by default, so a plan written
 * before this block existed parses to exactly the search it always was.
 *
 * These filters are the customer's own targeting. ClientTurn does not search
 * LinkedIn: there is no server-side LinkedIn search it may lawfully run, and it
 * never drives the customer's session or scrapes. They are used in two ways:
 *
 *   * shown as a list the customer applies by hand in LinkedIn or Sales
 *     Navigator, with a plain "Search LinkedIn" keyword link (`linkedinSearchUrl`);
 *   * applied to the customer's own imported list (`matchesIngestedLead`),
 *     where the title and seniority filters narrow what a run picks up.
 */

/* ------------------------------------------------------------ vocabularies */

export const LINKEDIN_HEADCOUNT_BANDS = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;
export type LinkedinHeadcountBand = (typeof LINKEDIN_HEADCOUNT_BANDS)[number];

export const LINKEDIN_SENIORITIES = [
  "OWNER_PARTNER",
  "CXO",
  "VP",
  "DIRECTOR",
  "EXPERIENCED_MANAGER",
  "ENTRY_LEVEL_MANAGER",
  "STRATEGIC",
  "SENIOR",
  "ENTRY_LEVEL",
  "IN_TRAINING",
] as const;
export type LinkedinSeniority = (typeof LINKEDIN_SENIORITIES)[number];

export const LINKEDIN_SENIORITY_LABELS: Record<LinkedinSeniority, string> = {
  OWNER_PARTNER: "Owner / Partner",
  CXO: "CXO",
  VP: "Vice President",
  DIRECTOR: "Director",
  EXPERIENCED_MANAGER: "Experienced Manager",
  ENTRY_LEVEL_MANAGER: "Entry Level Manager",
  STRATEGIC: "Strategic",
  SENIOR: "Senior",
  ENTRY_LEVEL: "Entry Level",
  IN_TRAINING: "In Training",
};

/** LinkedIn's job-function list, as Sales Navigator names it. */
export const LINKEDIN_FUNCTIONS = [
  "Accounting",
  "Administrative",
  "Arts and Design",
  "Business Development",
  "Community and Social Services",
  "Consulting",
  "Customer Success and Support",
  "Education",
  "Engineering",
  "Entrepreneurship",
  "Finance",
  "Healthcare Services",
  "Human Resources",
  "Information Technology",
  "Legal",
  "Marketing",
  "Media and Communication",
  "Military and Protective Services",
  "Operations",
  "Product Management",
  "Program and Project Management",
  "Purchasing",
  "Quality Assurance",
  "Real Estate",
  "Research",
  "Sales",
] as const;
export type LinkedinFunction = (typeof LINKEDIN_FUNCTIONS)[number];

export const LINKEDIN_COMPANY_TYPES = [
  "PUBLIC_COMPANY",
  "PRIVATELY_HELD",
  "NON_PROFIT",
  "EDUCATIONAL_INSTITUTION",
  "PARTNERSHIP",
  "SELF_EMPLOYED",
  "SELF_OWNED",
  "GOVERNMENT_AGENCY",
] as const;
export type LinkedinCompanyType = (typeof LINKEDIN_COMPANY_TYPES)[number];

export const LINKEDIN_COMPANY_TYPE_LABELS: Record<LinkedinCompanyType, string> = {
  PUBLIC_COMPANY: "Public company",
  PRIVATELY_HELD: "Privately held",
  NON_PROFIT: "Non-profit",
  EDUCATIONAL_INSTITUTION: "Educational institution",
  PARTNERSHIP: "Partnership",
  SELF_EMPLOYED: "Self-employed",
  SELF_OWNED: "Self-owned",
  GOVERNMENT_AGENCY: "Government agency",
};

/** Sales Navigator's tenure bands, used for both position and company. */
export const LINKEDIN_TENURE_BANDS = [
  "LESS_THAN_1",
  "1_TO_2",
  "3_TO_5",
  "6_TO_10",
  "MORE_THAN_10",
] as const;
export type LinkedinTenureBand = (typeof LINKEDIN_TENURE_BANDS)[number];

export const LINKEDIN_TENURE_LABELS: Record<LinkedinTenureBand, string> = {
  LESS_THAN_1: "Less than 1 year",
  "1_TO_2": "1 to 2 years",
  "3_TO_5": "3 to 5 years",
  "6_TO_10": "6 to 10 years",
  MORE_THAN_10: "More than 10 years",
};

/* ------------------------------------------------------------------ schema */

const text = (max: number) => z.string().trim().min(1).max(max);

export const linkedinFiltersSchema = z.object({
  /** Place names as the customer would type them into Sales Navigator. */
  geography: z.array(text(120)).max(10).default([]),
  industries: z.array(text(120)).max(20).default([]),
  headcountBands: z.array(z.enum(LINKEDIN_HEADCOUNT_BANDS)).max(8).default([]),
  /** Company headcount growth, in whole percent. Either bound may be open. */
  headcountGrowth: z
    .object({
      minPct: z.number().int().min(-100).max(1000).nullable().default(null),
      maxPct: z.number().int().min(-100).max(1000).nullable().default(null),
    })
    .default({ minPct: null, maxPct: null }),
  companyTypes: z.array(z.enum(LINKEDIN_COMPANY_TYPES)).max(8).default([]),
  seniorities: z.array(z.enum(LINKEDIN_SENIORITIES)).max(10).default([]),
  functions: z.array(z.enum(LINKEDIN_FUNCTIONS)).max(26).default([]),
  titlesInclude: z.array(text(120)).max(20).default([]),
  titlesExclude: z.array(text(120)).max(20).default([]),
  yearsInCurrentPosition: z.array(z.enum(LINKEDIN_TENURE_BANDS)).max(5).default([]),
  yearsAtCurrentCompany: z.array(z.enum(LINKEDIN_TENURE_BANDS)).max(5).default([]),
  changedJobsPast90Days: z.boolean().default(false),
  postedOnLinkedinPast30Days: z.boolean().default(false),
  keywords: z.string().trim().max(200).default(""),
});
export type LinkedinFilters = z.infer<typeof linkedinFiltersSchema>;

export function emptyLinkedinFilters(): LinkedinFilters {
  return linkedinFiltersSchema.parse({});
}

export function hasLinkedinFilters(filters: LinkedinFilters): boolean {
  return linkedinFilterLines(filters).length > 0;
}

/* ------------------------------------------------------- copyable summary */

/**
 * The filters as label/value lines.
 *
 * This is how the filters reach LinkedIn: a person applies them by hand in
 * LinkedIn or Sales Navigator. No undocumented link format is relied on.
 */
export function linkedinFilterLines(filters: LinkedinFilters): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  const push = (label: string, values: string[]) => {
    if (values.length) lines.push({ label, value: values.join(", ") });
  };

  push("Geography", filters.geography);
  push("Industry", filters.industries);
  push("Company headcount", filters.headcountBands);
  const { minPct, maxPct } = filters.headcountGrowth;
  if (minPct !== null || maxPct !== null) {
    lines.push({
      label: "Company headcount growth",
      value:
        minPct !== null && maxPct !== null
          ? `${minPct}% to ${maxPct}%`
          : minPct !== null
            ? `${minPct}% or more`
            : `Up to ${maxPct}%`,
    });
  }
  push("Company type", filters.companyTypes.map((t) => LINKEDIN_COMPANY_TYPE_LABELS[t]));
  push("Seniority level", filters.seniorities.map((s) => LINKEDIN_SENIORITY_LABELS[s]));
  push("Function", filters.functions);
  push("Current job title", filters.titlesInclude);
  push("Exclude job title", filters.titlesExclude);
  push("Years in current position", filters.yearsInCurrentPosition.map((b) => LINKEDIN_TENURE_LABELS[b]));
  push("Years at current company", filters.yearsAtCurrentCompany.map((b) => LINKEDIN_TENURE_LABELS[b]));
  if (filters.changedJobsPast90Days) lines.push({ label: "Changed jobs", value: "In the past 90 days" });
  if (filters.postedOnLinkedinPast30Days) lines.push({ label: "Posted on LinkedIn", value: "In the past 30 days" });
  if (filters.keywords) lines.push({ label: "Keywords", value: filters.keywords });

  return lines;
}

/** The same list as plain text, for the copy button. */
export function linkedinFiltersText(filters: LinkedinFilters): string {
  return linkedinFilterLines(filters)
    .map((line) => `${line.label}: ${line.value}`)
    .join("\n");
}

/* --------------------------------------------------- search LinkedIn link */

/**
 * The standard LinkedIn people-search URL, exactly as the browser shows it,
 * with keywords only. No facet ids and no Sales Navigator URL: those formats
 * are undocumented, and a link built on a guess would silently open the wrong
 * search. The filters themselves are applied by hand from the copyable list.
 */
export const LINKEDIN_PEOPLE_SEARCH = "https://www.linkedin.com/search/results/people/";

export function linkedinSearchKeywords(input: {
  titles: string[];
  industries: string[];
  keywords?: string;
}): string {
  const terms = [...input.titles.slice(0, 3), ...input.industries.slice(0, 2)];
  if (input.keywords) terms.unshift(input.keywords);
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].join(" ").slice(0, 200);
}

export function linkedinSearchUrl(keywords: string): string {
  return keywords
    ? `${LINKEDIN_PEOPLE_SEARCH}?keywords=${encodeURIComponent(keywords)}`
    : LINKEDIN_PEOPLE_SEARCH;
}

/* -------------------------------------------- filtering imported rows */

/**
 * The seniority a job title most plausibly implies, in LinkedIn's vocabulary.
 *
 * An imported export carries a title, not LinkedIn's seniority facet, so the
 * plan's seniority filter is applied by reading the title. Conservative: a
 * title that says nothing recognisable returns null, and a null seniority is
 * kept rather than dropped (see `matchesIngestedLead`), because the customer
 * already chose these people by putting them on their own list.
 */
export function inferSeniority(title: string | null | undefined): LinkedinSeniority | null {
  const t = ` ${(title ?? "").toLowerCase()} `;
  if (!t.trim()) return null;
  if (/\b(owner|partner|co-?founder|founder|proprietor)\b/.test(t)) return "OWNER_PARTNER";
  if (/\b(ceo|cto|cfo|coo|cmo|cio|cro|cpo|chief)\b|managing director/.test(t)) return "CXO";
  if (/\b(vp|svp|evp|vice president)\b/.test(t)) return "VP";
  if (/\b(director|head of)\b/.test(t)) return "DIRECTOR";
  if (/\b(senior manager|sr\.? manager|general manager)\b/.test(t)) return "EXPERIENCED_MANAGER";
  if (/\b(manager|team lead(er)?)\b/.test(t)) return "ENTRY_LEVEL_MANAGER";
  if (/\b(intern|trainee|apprentice|graduate)\b/.test(t)) return "IN_TRAINING";
  if (/\b(junior|jr\.?|assistant|associate)\b/.test(t)) return "ENTRY_LEVEL";
  if (/\b(senior|sr\.?|principal|staff)\b/.test(t)) return "SENIOR";
  if (/\b(strategist|strategy|advisor|consultant)\b/.test(t)) return "STRATEGIC";
  return null;
}

/**
 * Whether an imported lead satisfies the plan's title and seniority filters.
 *
 * Include-titles: the title must contain one of them. Exclude-titles: it must
 * contain none. Seniority: an inferred seniority must be one of those chosen;
 * an unreadable title passes, for the reason given on `inferSeniority`.
 */
export function matchesIngestedLead(
  lead: { roleTitle: string | null },
  filters: Pick<LinkedinFilters, "titlesInclude" | "titlesExclude" | "seniorities">,
): boolean {
  const title = (lead.roleTitle ?? "").toLowerCase();

  if (filters.titlesExclude.some((term) => title.includes(term.toLowerCase()))) return false;
  if (filters.titlesInclude.length > 0 && !filters.titlesInclude.some((term) => title.includes(term.toLowerCase()))) {
    return false;
  }
  if (filters.seniorities.length > 0) {
    const seniority = inferSeniority(lead.roleTitle);
    if (seniority && !filters.seniorities.includes(seniority)) return false;
  }
  return true;
}
