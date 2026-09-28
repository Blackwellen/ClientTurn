/**
 * The buying-intent catalogue: every intent type ClientTurn knows about, what
 * it suggests a company needs, and the lawful, free source that can evidence
 * it -- or a plain statement that none can.
 *
 * Pure -- no `server-only`, no Supabase, no runtime imports -- so the plan
 * editor, the intent builder, the extractors, the sourcing run and the tests
 * all read one vocabulary.
 *
 * ## The honesty rules this file holds
 *
 *   * **A source evidences exactly what it shows.** A Companies House share
 *     allotment (SH01) shows new shares were issued for value. It does not say
 *     "Series A": only the company's own announcement names a round. So SH01
 *     backs CAPITAL_RAISED, and the named rounds are backed by the company's
 *     own news and press pages alone.
 *   * **No LinkedIn scraping and no paid vendors.** Every source below is the
 *     official register, the company's own public website (including its own
 *     careers pages), the customer's own CRM or list, or Google Places. A type
 *     that only a vendor or a scrape could supply is listed as not available,
 *     with the reason, rather than quietly left out.
 *   * **Corroboration is not detection.** Google Places can confirm a company
 *     has a site somewhere; it cannot date it. It is listed as corroborating
 *     and never makes a type available on its own.
 *
 * Bump `INTENT_CATALOGUE_VERSION` whenever a type is added, removed or its
 * sources change, so a stored plan can tell which catalogue it was built on.
 */

import type { IntentEvidenceKind } from "./intent-evidence.ts";
import type { SignalFeed } from "./signals.ts";

export const INTENT_CATALOGUE_VERSION = "intent-catalogue-1";

/* ------------------------------------------------------------------ groups */

export const INTENT_GROUPS = ["FUNDING", "PEOPLE", "HIRING", "GROWTH", "TECHNOLOGY", "EVENTS"] as const;
export type IntentGroup = (typeof INTENT_GROUPS)[number];

export const INTENT_GROUP_LABELS: Record<IntentGroup, string> = {
  FUNDING: "Funding and ownership",
  PEOPLE: "People and leadership",
  HIRING: "Hiring",
  GROWTH: "Growth and change",
  TECHNOLOGY: "Technology",
  EVENTS: "Events and triggers",
};

/* ----------------------------------------------------------------- sources */

/**
 * The lawful places evidence can come from.
 *
 *   * COMPANIES_HOUSE   the official register (officers, filings, profile).
 *   * COMPANY_WEBSITE   the company's own news, press, blog and about pages.
 *   * COMPANY_CAREERS   the company's own careers and jobs pages.
 *   * CUSTOMER_DATA     the customer's own CRM or list import.
 *   * PUBLIC_TENDERS    UK public-sector tender notices (Contracts Finder):
 *                       evidence about the buying organisation, matched by its
 *                       own web domain.
 *   * GOOGLE_PLACES     a business listing: corroborates a location only.
 */
export const INTENT_SOURCES = [
  "COMPANIES_HOUSE",
  "COMPANY_WEBSITE",
  "COMPANY_CAREERS",
  "CUSTOMER_DATA",
  "GOOGLE_PLACES",
  "PUBLIC_TENDERS",
] as const;
export type IntentSource = (typeof INTENT_SOURCES)[number];

export const INTENT_SOURCE_LABELS: Record<IntentSource, string> = {
  COMPANIES_HOUSE: "Companies House",
  COMPANY_WEBSITE: "Company website",
  COMPANY_CAREERS: "Company careers page",
  CUSTOMER_DATA: "Your CRM or list",
  GOOGLE_PLACES: "Google Places",
  PUBLIC_TENDERS: "Contracts Finder",
};

/**
 * The live feed each source needs. CUSTOMER_DATA needs nothing connected, but
 * it is supplied by the customer rather than detected, so it never makes a
 * type available to a search on its own (see `intentTypeAvailability`).
 */
export const INTENT_SOURCE_FEED: Record<IntentSource, SignalFeed | null> = {
  COMPANIES_HOUSE: "COMPANIES_HOUSE",
  COMPANY_WEBSITE: "COMPANY_WEBSITE",
  COMPANY_CAREERS: "COMPANY_WEBSITE",
  CUSTOMER_DATA: null,
  GOOGLE_PLACES: "PLACES",
  PUBLIC_TENDERS: "PUBLIC_TENDERS",
};

/**
 * How a source relates to a type.
 *
 *   * DETECTED      ClientTurn reads the source and finds the type itself.
 *   * CORROBORATES  supports a type already found, cannot find it alone.
 *   * SUPPLIED      the customer's own data states it; nothing is inferred.
 */
export type SourceRole = "DETECTED" | "CORROBORATES" | "SUPPLIED";

export type IntentTypeSource = {
  source: IntentSource;
  role: SourceRole;
  /** What exactly the source shows. Written for a customer. */
  shows: string;
};

/* ------------------------------------------------------ service archetypes */

/**
 * The kinds of seller each type suggests an opening for. Keys are
 * `sales-library/archetypes.ts` keys (asserted in tests), so the catalogue
 * and the qualification library agree on what an "agency" is.
 */
export type ServiceIndication = { archetypes: string[]; needs: string };

/* ----------------------------------------------------------- role functions */

/** Business functions a role belongs to. Hiring and appointments carry one. */
export const ROLE_FUNCTIONS = [
  "MARKETING",
  "SALES",
  "ENGINEERING",
  "DESIGN",
  "PRODUCT",
  "DATA",
  "FINANCE",
  "PEOPLE",
  "OPERATIONS",
  "CUSTOMER_SUCCESS",
  "LEGAL",
  "IT_SECURITY",
] as const;
export type RoleFunction = (typeof ROLE_FUNCTIONS)[number];

/** Role -> need: what a company hiring or appointing in a function tends to buy. */
export const ROLE_FUNCTION_NEEDS: Record<RoleFunction, { label: string } & ServiceIndication> = {
  MARKETING: {
    label: "Marketing and growth",
    needs: "Agency support while the role is filled, then campaigns, content, SEO and paid media for the new hire to run.",
    archetypes: ["MARKETING_AGENCY", "SEO_AGENCY", "ADVERTISING_AGENCY", "CREATIVE_WEB_STUDIO", "B2B_SAAS"],
  },
  SALES: {
    label: "Sales and business development",
    needs: "Lead generation, CRM and sales tooling, sales training and outsourced SDR capacity.",
    archetypes: ["B2B_SAAS", "MARKETING_AGENCY", "RECRUITMENT", "MANAGEMENT_CONSULTING"],
  },
  ENGINEERING: {
    label: "Engineering and development",
    needs: "Development capacity from a studio or contractors, developer tooling and cloud services.",
    archetypes: ["CREATIVE_WEB_STUDIO", "IT_CONSULTANCY", "B2B_SAAS", "RECRUITMENT", "STAFFING"],
  },
  DESIGN: {
    label: "Design and UX",
    needs: "Design and UX studios, brand work and design tooling.",
    archetypes: ["CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "B2B_SAAS"],
  },
  PRODUCT: {
    label: "Product",
    needs: "Product and UX consultancy, analytics and product tooling.",
    archetypes: ["CREATIVE_WEB_STUDIO", "IT_CONSULTANCY", "B2B_SAAS"],
  },
  DATA: {
    label: "Data and analytics",
    needs: "Analytics consultancy, data platforms and BI tooling.",
    archetypes: ["IT_CONSULTANCY", "B2B_SAAS", "MANAGEMENT_CONSULTING"],
  },
  FINANCE: {
    label: "Finance",
    needs: "Accountancy, bookkeeping, finance software and advisory.",
    archetypes: ["ACCOUNTING", "BOOKKEEPING", "FINANCIAL_ADVISORY", "FINTECH", "B2B_SAAS"],
  },
  PEOPLE: {
    label: "People and HR",
    needs: "Recruitment, HR software, payroll and employment law.",
    archetypes: ["RECRUITMENT", "HR_TECH", "LAW_FIRM", "STAFFING"],
  },
  OPERATIONS: {
    label: "Operations",
    needs: "Operations consultancy, workflow software and outsourced business services.",
    archetypes: ["MANAGEMENT_CONSULTING", "BUSINESS_SERVICES", "B2B_SAAS"],
  },
  CUSTOMER_SUCCESS: {
    label: "Customer success and support",
    needs: "Support and helpdesk tooling, outsourced support and training.",
    archetypes: ["B2B_SAAS", "BUSINESS_SERVICES"],
  },
  LEGAL: {
    label: "Legal and compliance",
    needs: "Legal services, compliance consultancy and contract tooling.",
    archetypes: ["LAW_FIRM", "MANAGEMENT_CONSULTING", "B2B_SAAS"],
  },
  IT_SECURITY: {
    label: "IT and security",
    needs: "Managed IT, cyber security, certifications such as Cyber Essentials and ISO 27001.",
    archetypes: ["MSP", "CYBERSECURITY", "IT_CONSULTANCY"],
  },
};

/* ------------------------------------------------------------------- types */

export const INTENT_TYPE_IDS = [
  // funding
  "SEED_ROUND",
  "SERIES_A",
  "SERIES_B",
  "SERIES_C_PLUS",
  "CAPITAL_RAISED",
  "GRANT_AWARDED",
  "DEBT_FINANCE",
  "IPO_LISTING",
  "ACQUISITION_MERGER",
  "NEW_INVESTOR",
  // people
  "SENIOR_HIRE_C_LEVEL",
  "SENIOR_HIRE_VP",
  "SENIOR_HIRE_HEAD_OF",
  "LEADERSHIP_CHANGE",
  "NEW_DIRECTOR",
  "KEY_DEPARTURE",
  "TEAM_GROWTH",
  "PERSONAL_JOB_CHANGE",
  // hiring
  "HIRING_ROLE",
  "HIRING_SPIKE",
  "FIRST_HIRE_IN_FUNCTION",
  // growth
  "NEW_OFFICE",
  "REGION_EXPANSION",
  "HEADCOUNT_GROWTH",
  "PRODUCT_LAUNCH",
  "REBRAND",
  "WEBSITE_RELAUNCH",
  "AWARD_ACCREDITATION",
  "NEW_PARTNERSHIP",
  // technology
  "TECH_IN_USE",
  "TECH_ADOPTED",
  "TECH_REPLACED",
  "PLATFORM_OUTGROWN",
  "SITE_TECHNICAL_ISSUE",
  "SITE_SPEED_MEASURED",
  // events
  "TENDER_PUBLISHED",
  "REGULATORY_DEADLINE",
  "CONTRACT_RENEWAL_WINDOW",
  "COMPANY_ANNIVERSARY",
  "ACCOUNTS_GROWTH",
  "REGISTERED_OFFICE_CHANGE",
  "NEWLY_INCORPORATED",
  "VISITED_YOUR_WEBSITE",
  "THIRD_PARTY_RESEARCH",
] as const;
export type IntentTypeId = (typeof INTENT_TYPE_IDS)[number];

export type EvidenceStrength = "STRONG" | "MODERATE" | "WEAK";

/** The strength cap each band implies. A website phrase never scores like a filing. */
export const STRENGTH_CAP: Record<EvidenceStrength, number> = {
  STRONG: 0.8,
  MODERATE: 0.6,
  WEAK: 0.4,
};

export type IntentTypeDefinition = {
  id: IntentTypeId;
  group: IntentGroup;
  label: string;
  description: string;
  /** The coarse evidence kind it is recorded under (and filed into a category by). */
  evidenceKind: IntentEvidenceKind;
  indicates: ServiceIndication;
  /** Empty exactly when `notAvailable` is set. */
  sources: IntentTypeSource[];
  /** Why no lawful free source exists. Set exactly when `sources` is empty. */
  notAvailable?: string;
  /** What the evidence does *not* prove. Shown beside the type. */
  caveat?: string;
  strength: EvidenceStrength;
  /**
   * How long the signal stays live after the event. The shorter of this and
   * the category's or plan's own window applies.
   */
  decayDays: number;
  /** True when the type can carry a role function (hiring, appointments). */
  hasRoleFunction?: boolean;
  /** Words that name the type, for matching a customer's category to it. */
  aliases: string[];
};

const FUNDING_BUYERS: ServiceIndication = {
  archetypes: ["MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "RECRUITMENT", "B2B_SAAS", "ACCOUNTING", "LAW_FIRM"],
  needs: "New money to spend: agencies for growth, recruitment for the hiring plan, SaaS tooling, and finance and legal advice.",
};

const WEBSITE_NEWS = (shows: string): IntentTypeSource => ({ source: "COMPANY_WEBSITE", role: "DETECTED", shows });
const CAREERS = (shows: string): IntentTypeSource => ({ source: "COMPANY_CAREERS", role: "DETECTED", shows });
const REGISTER = (shows: string): IntentTypeSource => ({ source: "COMPANIES_HOUSE", role: "DETECTED", shows });
const REGISTER_HINT = (shows: string): IntentTypeSource => ({ source: "COMPANIES_HOUSE", role: "CORROBORATES", shows });
const CUSTOMER = (shows: string): IntentTypeSource => ({ source: "CUSTOMER_DATA", role: "SUPPLIED", shows });
const TENDERS = (shows: string): IntentTypeSource => ({ source: "PUBLIC_TENDERS", role: "DETECTED", shows });

const NAMED_ROUND_CAVEAT =
  "Only the company's own announcement names a round. A share allotment at Companies House shows money went in, not which round it was.";

export const INTENT_CATALOGUE: readonly IntentTypeDefinition[] = [
  /* ------------------------------------------------------------ funding */
  {
    id: "SEED_ROUND",
    group: "FUNDING",
    label: "Pre-seed or seed round",
    description: "The company announced a pre-seed or seed raise.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      WEBSITE_NEWS("A news or press post announcing a pre-seed or seed round, with the amount where stated."),
      REGISTER_HINT("A share allotment (SH01) around the same date. It confirms money went in, not the round."),
    ],
    caveat: NAMED_ROUND_CAVEAT,
    strength: "STRONG",
    decayDays: 180,
    aliases: ["seed round", "pre-seed", "seed funding", "seed"],
  },
  {
    id: "SERIES_A",
    group: "FUNDING",
    label: "Series A",
    description: "The company announced a Series A round.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      WEBSITE_NEWS("A news or press post announcing the Series A, with the amount where stated."),
      REGISTER_HINT("A share allotment (SH01) around the same date. It confirms money went in, not the round."),
    ],
    caveat: NAMED_ROUND_CAVEAT,
    strength: "STRONG",
    decayDays: 180,
    aliases: ["series a"],
  },
  {
    id: "SERIES_B",
    group: "FUNDING",
    label: "Series B",
    description: "The company announced a Series B round.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      WEBSITE_NEWS("A news or press post announcing the Series B, with the amount where stated."),
      REGISTER_HINT("A share allotment (SH01) around the same date. It confirms money went in, not the round."),
    ],
    caveat: NAMED_ROUND_CAVEAT,
    strength: "STRONG",
    decayDays: 180,
    aliases: ["series b"],
  },
  {
    id: "SERIES_C_PLUS",
    group: "FUNDING",
    label: "Series C or later",
    description: "The company announced a Series C, D, E or later round.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      WEBSITE_NEWS("A news or press post announcing a Series C or later round."),
      REGISTER_HINT("A share allotment (SH01) around the same date. It confirms money went in, not the round."),
    ],
    caveat: NAMED_ROUND_CAVEAT,
    strength: "STRONG",
    decayDays: 180,
    aliases: ["series c", "series d", "series e", "growth round"],
  },
  {
    id: "CAPITAL_RAISED",
    group: "FUNDING",
    label: "Raised new capital",
    description: "New shares were issued for value, or the company said it has raised money without naming a round.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      REGISTER("A share allotment (SH01) filed inside the window."),
      WEBSITE_NEWS("\"We've raised £2m\" and similar, where no round is named."),
    ],
    caveat: "An SH01 can also be a small allotment to staff or founders. It says funds were raised, not how much or from whom.",
    strength: "STRONG",
    decayDays: 180,
    aliases: ["raised funds", "new funding", "funding", "raised new capital", "share allotment", "investment"],
  },
  {
    id: "GRANT_AWARDED",
    group: "FUNDING",
    label: "Grant awarded",
    description: "The company announced a grant, such as an Innovate UK award.",
    evidenceKind: "FUNDING",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "IT_CONSULTANCY", "RECRUITMENT", "ACCOUNTING", "B2B_SAAS"],
      needs: "A funded project to deliver: development and design capacity, specialist hires and grant accounting.",
    },
    sources: [WEBSITE_NEWS("A news post announcing a grant award.")],
    strength: "MODERATE",
    decayDays: 180,
    aliases: ["grant", "innovate uk", "grant funding"],
  },
  {
    id: "DEBT_FINANCE",
    group: "FUNDING",
    label: "Debt or revenue-based finance",
    description: "The company took on a loan, credit facility or revenue-based finance.",
    evidenceKind: "FUNDING",
    indicates: {
      archetypes: ["ACCOUNTING", "FINANCIAL_ADVISORY", "MARKETING_AGENCY", "B2B_SAAS"],
      needs: "Growth capital being deployed, often on marketing and stock, and finance advice alongside it.",
    },
    sources: [
      REGISTER("A charge registered against the company (MR01): a lender has taken security."),
      WEBSITE_NEWS("A news post announcing a debt facility or revenue-based financing."),
    ],
    caveat: "A registered charge shows secured borrowing exists. It may be a routine bank facility rather than growth finance.",
    strength: "MODERATE",
    decayDays: 180,
    aliases: ["debt", "loan", "revenue-based finance", "credit facility", "venture debt"],
  },
  {
    id: "IPO_LISTING",
    group: "FUNDING",
    label: "IPO or listing",
    description: "The company listed on a stock exchange or announced its intention to.",
    evidenceKind: "FUNDING",
    indicates: {
      archetypes: ["LAW_FIRM", "ACCOUNTING", "MANAGEMENT_CONSULTING", "MARKETING_AGENCY", "CYBERSECURITY"],
      needs: "Governance, investor relations, compliance and a public-company brand.",
    },
    sources: [WEBSITE_NEWS("A press release announcing admission to AIM, the Main Market or another exchange.")],
    strength: "STRONG",
    decayDays: 365,
    aliases: ["ipo", "listing", "aim", "stock exchange", "flotation"],
  },
  {
    id: "ACQUISITION_MERGER",
    group: "FUNDING",
    label: "Acquisition or merger",
    description: "The company acquired, was acquired by, or merged with another company.",
    evidenceKind: "FUNDING",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "IT_CONSULTANCY", "MSP", "LAW_FIRM", "ACCOUNTING"],
      needs: "Integration work: merged brands and websites, systems consolidation, IT migration and legal.",
    },
    sources: [
      WEBSITE_NEWS("A news post announcing an acquisition or merger."),
      REGISTER("A company notified as a person with significant control (PSC02): a corporate owner now controls it."),
    ],
    caveat: "A new corporate controller at Companies House can also be a group restructure, so it is worded as possible.",
    strength: "STRONG",
    decayDays: 270,
    aliases: ["acquisition", "acquired", "merger", "m&a"],
  },
  {
    id: "NEW_INVESTOR",
    group: "FUNDING",
    label: "New investor",
    description: "The company announced a new investor or backer.",
    evidenceKind: "FUNDING",
    indicates: FUNDING_BUYERS,
    sources: [
      WEBSITE_NEWS("\"Round led by…\", \"welcomes investment from…\" on the company's own news."),
      REGISTER_HINT("A share allotment (SH01) around the same date."),
    ],
    caveat: "The shareholder list is only published annually on the confirmation statement, so a new investor is not read from the register.",
    strength: "MODERATE",
    decayDays: 180,
    aliases: ["new investor", "investor", "backed by"],
  },

  /* ------------------------------------------------------------- people */
  {
    id: "SENIOR_HIRE_C_LEVEL",
    group: "PEOPLE",
    label: "New C-level hire",
    description: "A new chief executive, CTO, CFO, CMO or other C-level officer.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "IT_CONSULTANCY", "MANAGEMENT_CONSULTING", "B2B_SAAS"],
      needs: "New leaders review suppliers and budgets in their first months. The function tells you which ones.",
    },
    sources: [
      WEBSITE_NEWS("\"Welcomes new CTO\", \"appoints … as Chief Marketing Officer\" on the company's own news."),
      REGISTER("A director appointed whose stated occupation is a C-level title. Only the title and date are kept."),
    ],
    strength: "STRONG",
    decayDays: 120,
    hasRoleFunction: true,
    aliases: ["new ceo", "new cto", "new cfo", "new cmo", "c-level hire", "new chief"],
  },
  {
    id: "SENIOR_HIRE_VP",
    group: "PEOPLE",
    label: "New VP",
    description: "A new vice president joined.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "B2B_SAAS", "IT_CONSULTANCY"],
      needs: "A new senior owner of a budget, likely to bring or review suppliers in their function.",
    },
    sources: [WEBSITE_NEWS("\"Joins as VP of Sales\" and similar on the company's own news.")],
    strength: "MODERATE",
    decayDays: 120,
    hasRoleFunction: true,
    aliases: ["new vp", "vice president"],
  },
  {
    id: "SENIOR_HIRE_HEAD_OF",
    group: "PEOPLE",
    label: "New Head of",
    description: "A new head of a function, such as Head of Growth or Head of Engineering.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "SEO_AGENCY", "CREATIVE_WEB_STUDIO", "B2B_SAAS", "RECRUITMENT"],
      needs: "A new function lead building their team and choosing tools and agencies.",
    },
    sources: [WEBSITE_NEWS("\"Welcomes … as Head of Growth\" and similar on the company's own news.")],
    strength: "MODERATE",
    decayDays: 90,
    hasRoleFunction: true,
    aliases: ["new head of", "new head of growth", "new head of marketing", "new head of engineering"],
  },
  {
    id: "LEADERSHIP_CHANGE",
    group: "PEOPLE",
    label: "Leadership change",
    description: "A director left and another was appointed inside the same window.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["MANAGEMENT_CONSULTING", "MARKETING_AGENCY", "ACCOUNTING", "LAW_FIRM"],
      needs: "A board in transition, often re-examining strategy, advisers and suppliers.",
    },
    sources: [REGISTER("A director resignation and a director appointment on the register in the same window.")],
    strength: "STRONG",
    decayDays: 120,
    aliases: ["leadership change", "board change"],
  },
  {
    id: "NEW_DIRECTOR",
    group: "PEOPLE",
    label: "New director appointed",
    description: "A director or LLP member was appointed.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["ACCOUNTING", "LAW_FIRM", "MANAGEMENT_CONSULTING", "MARKETING_AGENCY"],
      needs: "A new decision maker at board level.",
    },
    sources: [REGISTER("An officer appointment on the register. Founding directors are excluded; only the role and date are kept.")],
    strength: "STRONG",
    decayDays: 120,
    aliases: ["new director", "director appointed", "appointment", "leadership"],
  },
  {
    id: "KEY_DEPARTURE",
    group: "PEOPLE",
    label: "Key departure",
    description: "A director, founder or senior leader left.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["RECRUITMENT", "MANAGEMENT_CONSULTING", "STAFFING"],
      needs: "A gap to fill: interim cover, recruitment, and work that person used to do.",
    },
    sources: [
      REGISTER("A director resignation on the register."),
      WEBSITE_NEWS("\"Steps down as CEO\" and similar on the company's own news."),
    ],
    strength: "MODERATE",
    decayDays: 90,
    hasRoleFunction: true,
    aliases: ["departure", "steps down", "resigned", "left the company"],
  },
  {
    id: "TEAM_GROWTH",
    group: "PEOPLE",
    label: "Team growth",
    description: "The company is welcoming several new starters.",
    evidenceKind: "JOB_CHANGE",
    indicates: {
      archetypes: ["HR_TECH", "MSP", "RECRUITMENT", "FACILITIES_MANAGEMENT", "B2B_SAAS"],
      needs: "Onboarding, equipment, IT, HR systems and more space.",
    },
    sources: [WEBSITE_NEWS("\"Welcome to our new starters\" and similar posts on the company's own site.")],
    strength: "WEAK",
    decayDays: 90,
    aliases: ["team growth", "new starters", "new joiners"],
  },
  {
    id: "PERSONAL_JOB_CHANGE",
    group: "PEOPLE",
    label: "A person changed jobs",
    description: "A specific person moved to a new employer.",
    evidenceKind: "JOB_CHANGE",
    indicates: { archetypes: [], needs: "" },
    sources: [],
    notAvailable:
      "Only professional networks know when an individual moves, and ClientTurn does not scrape LinkedIn or buy the data from a vendor. Company-level appointments are offered instead.",
    strength: "WEAK",
    decayDays: 90,
    aliases: ["job change", "changed jobs"],
  },

  /* ------------------------------------------------------------- hiring */
  {
    id: "HIRING_ROLE",
    group: "HIRING",
    label: "Hiring for a specific role",
    description: "The company's own careers page lists a role in a function you serve.",
    evidenceKind: "HIRING",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "RECRUITMENT", "IT_CONSULTANCY", "B2B_SAAS"],
      needs: "The function tells you the need: hiring a marketing manager suggests agency support; a developer suggests a studio or contractors.",
    },
    sources: [CAREERS("A role listed on the company's own careers or jobs page, grouped by function.")],
    strength: "MODERATE",
    decayDays: 45,
    hasRoleFunction: true,
    aliases: ["hiring", "hiring for a related role", "job posting", "vacancy", "recruiting"],
  },
  {
    id: "HIRING_SPIKE",
    group: "HIRING",
    label: "Hiring volume spike",
    description: "Many open roles at once on the company's own careers page.",
    evidenceKind: "HIRING",
    indicates: {
      archetypes: ["RECRUITMENT", "STAFFING", "HR_TECH", "MSP"],
      needs: "Recruitment capacity, onboarding and HR systems, equipment and IT.",
    },
    sources: [CAREERS("Six or more distinct roles listed on the careers page at once.")],
    caveat: "A snapshot, not a trend: it counts what is open now, not a rise since last month.",
    strength: "MODERATE",
    decayDays: 45,
    aliases: ["hiring spike", "hiring a lot", "many vacancies"],
  },
  {
    id: "FIRST_HIRE_IN_FUNCTION",
    group: "HIRING",
    label: "First hire in a function",
    description: "The posting says it is the first, or founding, hire in a function.",
    evidenceKind: "HIRING",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "B2B_SAAS", "ACCOUNTING", "HR_TECH"],
      needs: "A function being built from nothing: agencies and tools to get it started.",
    },
    sources: [CAREERS("\"Our first marketing hire\", \"founding engineer\" and similar on the careers page.")],
    strength: "STRONG",
    decayDays: 60,
    hasRoleFunction: true,
    aliases: ["first hire", "founding hire"],
  },

  /* ------------------------------------------------------------- growth */
  {
    id: "NEW_OFFICE",
    group: "GROWTH",
    label: "New office or relocation",
    description: "The company opened a new office or moved premises.",
    evidenceKind: "EXPANSION",
    indicates: {
      archetypes: ["MSP", "FACILITIES_MANAGEMENT", "TELECOM", "CLEANING", "SECURITY_SERVICES"],
      needs: "Fit-out, IT and connectivity, facilities and local marketing.",
    },
    sources: [
      WEBSITE_NEWS("\"Opened a new office in Leeds\", \"moved to new premises\" on the company's own news."),
      { source: "GOOGLE_PLACES", role: "CORROBORATES", shows: "A business listing at the new address. It cannot say when it opened." },
      REGISTER_HINT("A registered office change (AD01). Often just a new accountant's address."),
    ],
    strength: "MODERATE",
    decayDays: 120,
    aliases: ["new office", "relocation", "moved office", "new premises", "expansion"],
  },
  {
    id: "REGION_EXPANSION",
    group: "GROWTH",
    label: "Expansion into a new region",
    description: "The company announced it is expanding into a new country or region.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "LAW_FIRM", "ACCOUNTING", "RECRUITMENT", "CREATIVE_WEB_STUDIO"],
      needs: "Localised marketing and websites, local hiring, legal and tax advice.",
    },
    sources: [WEBSITE_NEWS("\"Expanding into the US\", \"launching in Europe\" on the company's own news.")],
    strength: "MODERATE",
    decayDays: 180,
    aliases: ["international expansion", "new market", "expanding into"],
  },
  {
    id: "HEADCOUNT_GROWTH",
    group: "GROWTH",
    label: "Headcount growth",
    description: "The company says its team has grown, doubled or reached a new size.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["HR_TECH", "MSP", "RECRUITMENT", "ACCOUNTING", "B2B_SAAS"],
      needs: "Systems and services that scale with people: HR, IT, payroll and space.",
    },
    sources: [
      WEBSITE_NEWS("\"We've grown to 80 people\", \"doubled our team\" on the company's own site."),
      CUSTOMER("An employee count in your own CRM or list that is higher than before."),
    ],
    caveat: "Companies House accounts do not reliably publish headcount for small companies, so the register is not used for this.",
    strength: "MODERATE",
    decayDays: 180,
    aliases: ["headcount growth", "growing team", "doubled our team"],
  },
  {
    id: "PRODUCT_LAUNCH",
    group: "GROWTH",
    label: "New product launch",
    description: "The company launched a new product or service.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "ADVERTISING_AGENCY", "CREATIVE_WEB_STUDIO", "SEO_AGENCY"],
      needs: "Launch marketing, landing pages, PR and paid media.",
    },
    sources: [WEBSITE_NEWS("\"We're excited to launch…\", \"now generally available\" on the company's own news.")],
    strength: "MODERATE",
    decayDays: 90,
    aliases: ["product launch", "launch", "new product"],
  },
  {
    id: "REBRAND",
    group: "GROWTH",
    label: "Rebrand or change of name",
    description: "The company rebranded or changed its name.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "SEO_AGENCY", "LAW_FIRM"],
      needs: "A new website, brand roll-out, SEO migration and trade mark work.",
    },
    sources: [
      WEBSITE_NEWS("\"Our new brand\", \"formerly known as\" on the company's own site."),
      REGISTER("A change of name filed at Companies House (NM01 or a change-of-name certificate)."),
    ],
    strength: "STRONG",
    decayDays: 120,
    aliases: ["rebrand", "new brand", "change of name", "renamed"],
  },
  {
    id: "WEBSITE_RELAUNCH",
    group: "GROWTH",
    label: "Website relaunch",
    description: "The company launched a new or redesigned website.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["SEO_AGENCY", "MARKETING_AGENCY", "CREATIVE_WEB_STUDIO"],
      needs: "Post-launch SEO, content, conversion work and ongoing support.",
    },
    sources: [WEBSITE_NEWS("\"Welcome to our new website\", \"relaunched our site\" on the company's own site.")],
    caveat: "A web studio will usually find a relaunch is a lost opportunity, not a new one; SEO and content sellers find the opposite.",
    strength: "MODERATE",
    decayDays: 90,
    aliases: ["new website", "website relaunch", "redesign"],
  },
  {
    id: "AWARD_ACCREDITATION",
    group: "GROWTH",
    label: "Award or accreditation",
    description: "The company won or was shortlisted for an award, or gained an accreditation such as ISO 27001, Cyber Essentials or B Corp.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "CYBERSECURITY", "MANAGEMENT_CONSULTING"],
      needs: "Momentum to promote, and accreditations that bring audit, security and compliance work.",
    },
    sources: [WEBSITE_NEWS("\"Winner of…\", \"shortlisted for…\", \"achieved ISO 27001\" on the company's own news.")],
    caveat: "\"Award-winning\" on its own is a standing claim, not an event, and is ignored.",
    strength: "WEAK",
    decayDays: 120,
    aliases: ["award", "accreditation", "iso 27001", "cyber essentials", "b corp", "shortlisted"],
  },
  {
    id: "NEW_PARTNERSHIP",
    group: "GROWTH",
    label: "New partnership",
    description: "The company announced a partnership or became a certified partner of a platform.",
    evidenceKind: "GROWTH",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "IT_CONSULTANCY", "B2B_SAAS", "CREATIVE_WEB_STUDIO"],
      needs: "Co-marketing, integration work and partner enablement.",
    },
    sources: [WEBSITE_NEWS("\"Partners with…\", \"announces a partnership\" on the company's own news.")],
    strength: "WEAK",
    decayDays: 120,
    aliases: ["partnership", "partner", "strategic partnership"],
  },

  /* --------------------------------------------------------- technology */
  {
    id: "TECH_IN_USE",
    group: "TECHNOLOGY",
    label: "Uses a technology you target",
    description: "The company's site loads a technology you work with, such as Shopify or HubSpot.",
    evidenceKind: "TECHNOLOGY",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "B2B_SAAS", "IT_CONSULTANCY"],
      needs: "A fit for platform specialists, integrations and competing tools.",
    },
    sources: [WEBSITE_NEWS("A script, asset path or generator tag the vendor's own embed puts on the page.")],
    caveat: "It shows the tool is in use now, not when it was adopted.",
    strength: "MODERATE",
    decayDays: 60,
    aliases: ["technology", "tech stack", "uses", "platform"],
  },
  {
    id: "TECH_ADOPTED",
    group: "TECHNOLOGY",
    label: "Adopted a new tool",
    description: "The company announced it moved to or rolled out a named tool.",
    evidenceKind: "TECHNOLOGY",
    indicates: {
      archetypes: ["IT_CONSULTANCY", "CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "B2B_SAAS"],
      needs: "Implementation, integration, training and the tools around the new one.",
    },
    sources: [
      WEBSITE_NEWS("\"We've moved to HubSpot\", \"now running on Shopify\" on the company's own site."),
      CUSTOMER("A technology field in your own CRM or list."),
    ],
    caveat: "A tool appearing between two visits would need a stored history of each site; announcements are used instead.",
    strength: "MODERATE",
    decayDays: 90,
    aliases: ["adopted", "moved to", "migrated to", "implemented"],
  },
  {
    id: "TECH_REPLACED",
    group: "TECHNOLOGY",
    label: "Removed or replaced a tool",
    description: "The company announced it replaced or moved away from a named tool.",
    evidenceKind: "TECHNOLOGY",
    indicates: {
      archetypes: ["IT_CONSULTANCY", "CREATIVE_WEB_STUDIO", "B2B_SAAS"],
      needs: "A migration in progress: data moves, integrations and a buyer open to alternatives.",
    },
    sources: [WEBSITE_NEWS("\"Migrated from Magento to Shopify\", \"replaced X with Y\" on the company's own site.")],
    strength: "MODERATE",
    decayDays: 90,
    aliases: ["replaced", "migrated from", "moved away from", "switched from"],
  },
  {
    id: "PLATFORM_OUTGROWN",
    group: "TECHNOLOGY",
    label: "Outgrown a platform",
    description: "The company says it has outgrown a platform, or is hiring to re-platform.",
    evidenceKind: "TECHNOLOGY",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "IT_CONSULTANCY", "B2B_SAAS"],
      needs: "A re-platform project: a studio, an integrator and the new platform itself.",
    },
    sources: [
      WEBSITE_NEWS("\"We've outgrown…\", \"re-platforming\" on the company's own site."),
      CAREERS("A role to lead a migration or re-platform on the careers page."),
    ],
    strength: "MODERATE",
    decayDays: 90,
    aliases: ["outgrown", "replatform", "re-platform", "migration"],
  },
  {
    id: "SITE_TECHNICAL_ISSUE",
    group: "TECHNOLOGY",
    label: "Public website issue",
    description: "Problems anyone can see in the company's own page markup: no mobile viewport, insecure scripts, an outdated library or CMS, a stale copyright year.",
    evidenceKind: "TECHNOLOGY",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "SEO_AGENCY", "MSP", "CYBERSECURITY"],
      needs: "A website rebuild, maintenance, security patching or an SEO audit.",
    },
    sources: [WEBSITE_NEWS("Read from the homepage markup the site serves to every visitor.")],
    caveat: "These are markup findings, not a speed test. A stale copyright year is a hint of neglect, not proof.",
    strength: "WEAK",
    decayDays: 60,
    aliases: ["website issue", "outdated website", "technical issue", "old website"],
  },
  {
    id: "SITE_SPEED_MEASURED",
    group: "TECHNOLOGY",
    label: "Measured site speed",
    description: "Core Web Vitals or a load-time measurement for the company's site.",
    evidenceKind: "TECHNOLOGY",
    indicates: { archetypes: [], needs: "" },
    sources: [],
    notAvailable:
      "Measuring speed needs a browser test run per site (for example Lighthouse), which ClientTurn does not run. Visible markup issues are offered instead.",
    strength: "WEAK",
    decayDays: 60,
    aliases: ["site speed", "page speed", "core web vitals"],
  },

  /* ------------------------------------------------------------- events */
  {
    id: "TENDER_PUBLISHED",
    group: "EVENTS",
    label: "Tender or RFP published",
    description: "The organisation invited proposals, quotes or tenders: on its own site, or as a UK public-sector notice on Contracts Finder, with the buyer and the deadline.",
    evidenceKind: "TRIGGER_EVENT",
    indicates: {
      archetypes: ["CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "IT_CONSULTANCY", "MANAGEMENT_CONSULTING"],
      needs: "An active buying process with a deadline.",
    },
    sources: [
      WEBSITE_NEWS("An invitation to tender or request for proposal posted on the company's own site."),
      TENDERS("An open UK public-sector tender from the organisation, mentioning one of your services or category keywords, with its closing date."),
    ],
    caveat: "Public-sector notices are matched to an organisation by its own web domain, so they find councils, NHS bodies, universities and other public buyers rather than private companies. Find a Tender (above-threshold notices) is not read.",
    strength: "STRONG",
    decayDays: 45,
    aliases: ["tender", "rfp", "request for proposal", "procurement", "invitation to tender"],
  },
  {
    id: "REGULATORY_DEADLINE",
    group: "EVENTS",
    label: "Statutory filing deadline",
    description: "The company's next accounts or confirmation statement is due soon, or is overdue.",
    evidenceKind: "TRIGGER_EVENT",
    indicates: {
      archetypes: ["ACCOUNTING", "BOOKKEEPING", "LAW_FIRM"],
      needs: "Accounts preparation, company secretarial work and compliance help.",
    },
    sources: [REGISTER("The next-due dates on the company's register profile.")],
    caveat: "Sector regulations (such as a new compliance rule) are not tied to individual companies in any free source, so only register deadlines are used.",
    strength: "MODERATE",
    decayDays: 60,
    aliases: ["deadline", "accounts due", "overdue accounts", "confirmation statement"],
  },
  {
    id: "CONTRACT_RENEWAL_WINDOW",
    group: "EVENTS",
    label: "Contract renewal window",
    description: "A contract with a current supplier is coming up for renewal.",
    evidenceKind: "TRIGGER_EVENT",
    indicates: {
      archetypes: ["MSP", "B2B_SAAS", "TELECOM", "INSURANCE_BROKER", "MARKETING_AGENCY"],
      needs: "A buyer free to switch supplier.",
    },
    sources: [CUSTOMER("A renewal or contract-end date recorded in your own CRM or list.")],
    caveat: "Nobody publishes their supplier contract dates, so this only comes from what you already know.",
    strength: "STRONG",
    decayDays: 90,
    aliases: ["renewal", "contract end", "renewal window"],
  },
  {
    id: "COMPANY_ANNIVERSARY",
    group: "EVENTS",
    label: "Company anniversary",
    description: "A milestone anniversary of incorporation (1, 5, 10, 15, 20, 25 years and so on) is close.",
    evidenceKind: "TRIGGER_EVENT",
    indicates: {
      archetypes: ["MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "EVENTS"],
      needs: "Anniversary campaigns, events and a refreshed brand.",
    },
    sources: [REGISTER("The incorporation date on the register.")],
    strength: "WEAK",
    decayDays: 60,
    aliases: ["anniversary", "milestone"],
  },
  {
    id: "ACCOUNTS_GROWTH",
    group: "EVENTS",
    label: "Accounts show growth",
    description: "The latest accounts are a larger type than the previous ones (for example micro-entity to small), or the company started trading after being dormant.",
    evidenceKind: "TRIGGER_EVENT",
    indicates: {
      archetypes: ["ACCOUNTING", "FINANCIAL_ADVISORY", "MARKETING_AGENCY", "HR_TECH"],
      needs: "A company crossing size thresholds: more complex accounts, audit, and growing budgets.",
    },
    sources: [REGISTER("The accounts type on the last two accounts filings.")],
    caveat: "Turnover and headcount are not read: many small companies do not publish them. A change of accounts type means a size threshold was crossed, nothing more precise.",
    strength: "MODERATE",
    decayDays: 365,
    aliases: ["accounts growth", "filed accounts", "growing company"],
  },
  {
    id: "REGISTERED_OFFICE_CHANGE",
    group: "EVENTS",
    label: "Change of registered office",
    description: "The registered office address changed (AD01).",
    evidenceKind: "EXPANSION",
    indicates: {
      archetypes: ["ACCOUNTING", "MSP", "FACILITIES_MANAGEMENT"],
      needs: "Possibly a move, possibly a new accountant.",
    },
    sources: [REGISTER("A registered office change (AD01).")],
    caveat: "Often just a new accountant's address, so it counts for less than other register facts.",
    strength: "WEAK",
    decayDays: 90,
    aliases: ["registered office", "office move", "moved registered office"],
  },
  {
    id: "NEWLY_INCORPORATED",
    group: "EVENTS",
    label: "Newly incorporated",
    description: "The company was incorporated recently.",
    evidenceKind: "NEW_COMPANY",
    indicates: {
      archetypes: ["ACCOUNTING", "BOOKKEEPING", "CREATIVE_WEB_STUDIO", "MARKETING_AGENCY", "LAW_FIRM"],
      needs: "Everything a new business sets up: accounts, a website, a brand, insurance and contracts.",
    },
    sources: [REGISTER("The incorporation date on the register.")],
    strength: "STRONG",
    decayDays: 180,
    aliases: ["newly incorporated", "new company", "start-up", "startup", "incorporated"],
  },
  {
    id: "VISITED_YOUR_WEBSITE",
    group: "EVENTS",
    label: "Visited your website",
    description: "Someone from the company visited your own site.",
    evidenceKind: "WEBSITE_MENTION",
    indicates: { archetypes: [], needs: "" },
    sources: [],
    notAvailable:
      "ClientTurn does not track visitors to your website: it would need a tracking script and cookie consent on your site.",
    strength: "WEAK",
    decayDays: 30,
    aliases: ["website visit", "visited our site"],
  },
  {
    id: "THIRD_PARTY_RESEARCH",
    group: "EVENTS",
    label: "Researching a topic elsewhere",
    description: "The company is reading about a topic across other websites.",
    evidenceKind: "WEBSITE_MENTION",
    indicates: { archetypes: [], needs: "" },
    sources: [],
    notAvailable:
      "This comes only from paid intent vendors built on third-party browsing data, which ClientTurn does not use.",
    strength: "WEAK",
    decayDays: 30,
    aliases: ["researching", "bidstream", "third-party intent"],
  },
];

const BY_ID = new Map(INTENT_CATALOGUE.map((entry) => [entry.id, entry]));

export function intentType(id: IntentTypeId): IntentTypeDefinition {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown intent type ${id}`);
  return entry;
}

export function isIntentTypeId(value: unknown): value is IntentTypeId {
  return typeof value === "string" && BY_ID.has(value as IntentTypeId);
}

export function intentTypesInGroup(group: IntentGroup): IntentTypeDefinition[] {
  return INTENT_CATALOGUE.filter((entry) => entry.group === group);
}

/** Types whose evidence is recorded under a coarse kind. */
export function intentTypesForKind(kind: IntentEvidenceKind): IntentTypeId[] {
  return INTENT_CATALOGUE.filter((entry) => entry.evidenceKind === kind && entry.sources.length > 0).map(
    (entry) => entry.id,
  );
}

/**
 * The type a coarse kind means when evidence carries no finer type: what the
 * product recorded before the catalogue existed. Keeps old intent events
 * readable as catalogue types.
 */
export const DEFAULT_TYPE_FOR_KIND: Partial<Record<IntentEvidenceKind, IntentTypeId>> = {
  FUNDING: "CAPITAL_RAISED",
  HIRING: "HIRING_ROLE",
  JOB_CHANGE: "NEW_DIRECTOR",
  NEW_COMPANY: "NEWLY_INCORPORATED",
  EXPANSION: "REGISTERED_OFFICE_CHANGE",
  TECHNOLOGY: "TECH_IN_USE",
};

/** True when a source lets ClientTurn find the type itself. */
export function detectingSources(entry: IntentTypeDefinition): IntentTypeSource[] {
  return entry.sources.filter((source) => source.role === "DETECTED");
}

/* ------------------------------------------------------------ availability */

export type IntentTypeAvailability = {
  available: boolean;
  /** The detecting sources live right now. */
  liveSources: IntentSource[];
  /** Why it cannot run, in the customer's words. Null when it can. */
  reason: string | null;
};

const FEED_NEEDS: Record<string, string> = {
  COMPANIES_HOUSE: "Needs a Companies House key (free from developer.company-information.service.gov.uk).",
  COMPANY_WEBSITE: "Needs the company's website, which every search reads.",
  PLACES: "Needs a Google Places key.",
};

/**
 * Whether a search can find this type with the feeds this workspace has live.
 *
 * Only DETECTED sources count. A type supplied solely by the customer's own
 * data is shown but greyed in a search, because a search cannot find it; a
 * type with no lawful source says so.
 */
export function intentTypeAvailability(
  id: IntentTypeId,
  live: ReadonlySet<SignalFeed>,
): IntentTypeAvailability {
  const entry = intentType(id);
  if (entry.sources.length === 0) {
    return { available: false, liveSources: [], reason: entry.notAvailable ?? "No free, lawful source." };
  }
  const detecting = detectingSources(entry);
  if (detecting.length === 0) {
    return {
      available: false,
      liveSources: [],
      reason: "Only from your own CRM or list import. A search cannot find it for you.",
    };
  }
  const liveSources = detecting
    .filter((source) => {
      const feed = INTENT_SOURCE_FEED[source.source];
      return feed !== null && live.has(feed);
    })
    .map((source) => source.source);
  if (liveSources.length > 0) return { available: true, liveSources, reason: null };
  const feed = INTENT_SOURCE_FEED[detecting[0].source];
  return { available: false, liveSources: [], reason: (feed && FEED_NEEDS[feed]) ?? "Its source is not connected." };
}

/* ------------------------------------------------------------ decay */

/** The window a type's evidence stays live: the shorter of its decay and the caller's. */
export function effectiveWindowDays(id: IntentTypeId | null | undefined, windowDays: number): number {
  if (!id || !BY_ID.has(id)) return windowDays;
  return Math.max(1, Math.min(windowDays, intentType(id).decayDays));
}

export function strengthCap(id: IntentTypeId | null | undefined, fallback: number): number {
  if (!id || !BY_ID.has(id)) return fallback;
  return STRENGTH_CAP[intentType(id).strength];
}

/* ---------------------------------------------------- category matching */

/**
 * The catalogue types a customer's own intent category names.
 *
 * A category collects a type when its name or one of its keywords is the
 * type's label or one of its aliases, compared case-insensitively as whole
 * phrases. The category builder's catalogue picker writes exactly those, so a
 * category started from the catalogue always collects its type.
 */
export function intentTypesForCategory(category: { name: string; keywords: string[] }): IntentTypeId[] {
  const phrases = new Set(
    [category.name, ...category.keywords].map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  return INTENT_CATALOGUE.filter(
    (entry) =>
      entry.sources.length > 0 &&
      (phrases.has(entry.label.toLowerCase()) || entry.aliases.some((alias) => phrases.has(alias))),
  ).map((entry) => entry.id);
}
