import {
  LINKEDIN_FUNCTIONS,
  LINKEDIN_HEADCOUNT_BANDS,
  LINKEDIN_SENIORITY_LABELS,
  LINKEDIN_TENURE_LABELS,
  type LinkedinFilters,
  type LinkedinSeniority,
  type LinkedinTenureBand,
} from "./linkedin-filters.ts";

/**
 * "Open this search in Sales Navigator": a best-effort deep link.
 *
 * Pure, and the only place the link format lives.
 *
 * ## Why this is a link and not a search
 *
 * Without a SNAP partner contract LinkedIn permits no server-side search, and
 * ClientTurn never drives a customer's logged-in session or scrapes a page. So
 * the customer runs the search themselves, in their own Sales Navigator, and
 * exports what they choose. This builds the URL that opens that search with as
 * many of the plan's filters pre-filled as we can express.
 *
 * ## Why "best effort"
 *
 * The format is **undocumented**. It is the Rest.li-style `query=(filters:
 * List(...))` string Sales Navigator writes into its own address bar, and the
 * facet ids below are the ones it uses there. LinkedIn can change either at
 * any time. So:
 *
 *   * the builder reports which filters it could and could not express, and
 *     the UI says so;
 *   * the UI always shows the full filter list as copyable text beside the
 *     link (`linkedinFiltersText`), which works whatever happens to the format;
 *   * a filter that needs a LinkedIn id we do not hold (most regions, every
 *     industry, company type) is left out of the link rather than guessed.
 */

export const SALES_NAVIGATOR_PEOPLE_SEARCH = "https://www.linkedin.com/sales/search/people";

/** Sales Navigator's seniority facet ids (the 2023+ ten-level set). */
const SENIORITY_IDS: Record<LinkedinSeniority, number> = {
  IN_TRAINING: 100,
  ENTRY_LEVEL: 110,
  SENIOR: 120,
  STRATEGIC: 130,
  ENTRY_LEVEL_MANAGER: 200,
  EXPERIENCED_MANAGER: 210,
  DIRECTOR: 220,
  VP: 300,
  CXO: 310,
  OWNER_PARTNER: 320,
};

/** Headcount facet ids: B = 1-10 through I = 10,001+. */
const HEADCOUNT_IDS = ["B", "C", "D", "E", "F", "G", "H", "I"] as const;

const TENURE_IDS: Record<LinkedinTenureBand, number> = {
  LESS_THAN_1: 1,
  "1_TO_2": 2,
  "3_TO_5": 3,
  "6_TO_10": 4,
  MORE_THAN_10: 5,
};

/** Function ids are LinkedIn's alphabetical numbering, with Support last (26). */
function functionId(name: (typeof LINKEDIN_FUNCTIONS)[number]): number {
  if (name === "Customer Success and Support") return 26;
  const ordered = LINKEDIN_FUNCTIONS.filter((f) => f !== "Customer Success and Support");
  return ordered.indexOf(name) + 1;
}

/**
 * The few geography ids we hold. Anything else is left for the customer to
 * add in Sales Navigator, rather than sent as free text the facet ignores.
 */
const REGION_IDS: Record<string, { id: number; text: string }> = {
  "united kingdom": { id: 101165590, text: "United Kingdom" },
  uk: { id: 101165590, text: "United Kingdom" },
  gb: { id: 101165590, text: "United Kingdom" },
  england: { id: 102299470, text: "England, United Kingdom" },
  london: { id: 90009496, text: "London Area, United Kingdom" },
};

/**
 * Encodes a value for inside the Rest.li structure. `encodeURIComponent`
 * leaves ( ) ' ! * alone, and a bracket or comma inside a title would end the
 * structure early, so those are escaped too.
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

type Value = { id?: string | number; text: string; excluded?: boolean };

function facet(type: string, values: Value[]): string {
  const list = values
    .map((value) => {
      const id = value.id !== undefined ? `id:${encodeValue(String(value.id))},` : "";
      return `(${id}text:${encodeValue(value.text)},selectionType:${value.excluded ? "EXCLUDED" : "INCLUDED"})`;
    })
    .join(",");
  return `(type:${type},values:List(${list}))`;
}

export type SalesNavigatorLink = {
  url: string;
  /** Filter labels the link carries. */
  applied: string[];
  /** Filter labels the customer must add by hand in Sales Navigator. */
  notApplied: string[];
};

export function buildSalesNavigatorSearchUrl(filters: LinkedinFilters): SalesNavigatorLink {
  const parts: string[] = [];
  const applied: string[] = [];
  const notApplied: string[] = [];

  if (filters.geography.length) {
    const known = filters.geography
      .map((place) => REGION_IDS[place.trim().toLowerCase()])
      .filter((entry): entry is { id: number; text: string } => Boolean(entry));
    if (known.length) {
      parts.push(facet("REGION", [...new Map(known.map((k) => [k.id, k])).values()].map((k) => ({ id: k.id, text: k.text }))));
      applied.push("Geography");
    }
    if (known.length < filters.geography.length) notApplied.push("Geography");
  }

  if (filters.industries.length) notApplied.push("Industry");
  if (filters.companyTypes.length) notApplied.push("Company type");

  if (filters.headcountBands.length) {
    parts.push(
      facet(
        "COMPANY_HEADCOUNT",
        filters.headcountBands.map((band) => ({
          id: HEADCOUNT_IDS[LINKEDIN_HEADCOUNT_BANDS.indexOf(band)],
          text: band,
        })),
      ),
    );
    applied.push("Company headcount");
  }

  const { minPct, maxPct } = filters.headcountGrowth;
  if (minPct !== null || maxPct !== null) {
    const range = [minPct !== null ? `min:${minPct}` : null, maxPct !== null ? `max:${maxPct}` : null]
      .filter(Boolean)
      .join(",");
    parts.push(`(type:COMPANY_HEADCOUNT_GROWTH,rangeValue:(${range}))`);
    applied.push("Company headcount growth");
  }

  if (filters.seniorities.length) {
    parts.push(
      facet(
        "SENIORITY_LEVEL",
        filters.seniorities.map((s) => ({ id: SENIORITY_IDS[s], text: LINKEDIN_SENIORITY_LABELS[s] })),
      ),
    );
    applied.push("Seniority level");
  }

  if (filters.functions.length) {
    parts.push(facet("FUNCTION", filters.functions.map((f) => ({ id: functionId(f), text: f }))));
    applied.push("Function");
  }

  if (filters.titlesInclude.length || filters.titlesExclude.length) {
    parts.push(
      facet("CURRENT_TITLE", [
        ...filters.titlesInclude.map((t) => ({ text: t })),
        ...filters.titlesExclude.map((t) => ({ text: t, excluded: true })),
      ]),
    );
    applied.push("Current job title");
  }

  if (filters.yearsInCurrentPosition.length) {
    parts.push(
      facet(
        "YEARS_IN_CURRENT_POSITION",
        filters.yearsInCurrentPosition.map((b) => ({ id: TENURE_IDS[b], text: LINKEDIN_TENURE_LABELS[b] })),
      ),
    );
    applied.push("Years in current position");
  }

  if (filters.yearsAtCurrentCompany.length) {
    parts.push(
      facet(
        "YEARS_AT_CURRENT_COMPANY",
        filters.yearsAtCurrentCompany.map((b) => ({ id: TENURE_IDS[b], text: LINKEDIN_TENURE_LABELS[b] })),
      ),
    );
    applied.push("Years at current company");
  }

  if (filters.changedJobsPast90Days) {
    parts.push(facet("RECENTLY_CHANGED_JOBS", [{ id: "RPC", text: "Changed jobs" }]));
    applied.push("Changed jobs");
  }

  if (filters.postedOnLinkedinPast30Days) {
    parts.push(facet("POSTED_ON_LINKEDIN", [{ id: "RPOL", text: "Posted on LinkedIn" }]));
    applied.push("Posted on LinkedIn");
  }

  const query: string[] = [];
  if (parts.length) query.push(`filters:List(${parts.join(",")})`);
  if (filters.keywords) {
    query.push(`keywords:${encodeValue(filters.keywords)}`);
    applied.push("Keywords");
  }

  const url = query.length
    ? `${SALES_NAVIGATOR_PEOPLE_SEARCH}?query=(${query.join(",")})`
    : SALES_NAVIGATOR_PEOPLE_SEARCH;

  return { url, applied, notApplied };
}
