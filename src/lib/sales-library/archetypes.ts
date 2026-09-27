/**
 * Business archetypes (design doc 04 §1, brief §§4–6, 17).
 *
 * An archetype describes the *workspace* (the seller): what kind of business it
 * is, how it usually sells, who decides on its buyers' side, and how its leads
 * should be scored and qualified. It is chosen from the business's UK SIC 2026
 * code (or its SIC 2007 register code mapped through migration 0120), from what
 * the customer types, or from its website — see classify.ts.
 *
 * Depth. ClientTurn's ICP is UK B2B: agencies, web and design studios, SaaS,
 * ecommerce and professional services (CLAUDE.md resolved conflict 5). Those
 * archetypes are `DEEP`: their scoring profiles and question wording are tuned
 * individually. The rest are `STANDARD`: sensible family defaults, good enough
 * to run on and meant to be refined as real customers arrive.
 *
 * Every SIC prefix below is a real UK SIC 2026 code present in
 * 0120_industry_taxonomy.sql; tests/sales-library.test.ts enforces it. Where
 * SIC cannot separate two archetypes (SIC 2026 has no "online retail" class, so
 * a shop and an ecommerce brand share division 47), both list the code and
 * classification treats the result as ambiguous rather than guessing.
 *
 * Pure module.
 */

import { resolveQualification } from "./qualification-dimensions.ts";
import { MOTIONS } from "./motions.ts";
import type {
  Archetype,
  QualificationProfile,
  ArchetypeGroup,
  DealSizeBand,
  ObjectionKey,
  QualificationDimension,
  QualificationSpec,
  SalesMotion,
  ScoringProfile,
} from "./types.ts";

/* --------------------------------------------------------- scoring profiles */

/**
 * Weights are FIT, INTENT, NEED, COMMERCIAL, DECISION_ACCESS, TIMING,
 * ENGAGEMENT and always total 100. The brief's §17 examples drive the four
 * named shapes (SaaS, MSP, local trade/roofing, agency); the others follow the
 * same reasoning for their family.
 */
function profile(
  key: string,
  w: [number, number, number, number, number, number, number],
  fitSignals: ScoringProfile["fitSignals"],
  rationale: string,
): ScoringProfile {
  return {
    key,
    weights: {
      FIT: w[0],
      INTENT: w[1],
      NEED: w[2],
      COMMERCIAL: w[3],
      DECISION_ACCESS: w[4],
      TIMING: w[5],
      ENGAGEMENT: w[6],
    },
    fitSignals,
    rationale,
  };
}

export const SCORING_PROFILES = {
  DEFAULT_B2B: profile(
    "DEFAULT_B2B",
    [30, 20, 15, 10, 10, 10, 5],
    ["industry_match", "company_size_match", "geography_match", "incorporated"],
    "The design-doc default: fit first, then intent, then need.",
  ),
  SAAS_B2B: profile(
    "SAAS_B2B",
    [30, 20, 15, 10, 10, 5, 10],
    ["company_size_match", "tech_stack_match", "industry_match", "growth_signal"],
    "Brief §17 SaaS example: company size and stack decide fit; engagement matters more than timing because evaluations are self-paced.",
  ),
  SAAS_PLG: profile(
    "SAAS_PLG",
    [25, 20, 15, 5, 5, 5, 25],
    ["company_size_match", "tech_stack_match", "website_present"],
    "Product-led: what the account does in the product outweighs who they are on paper.",
  ),
  SAAS_ENTERPRISE: profile(
    "SAAS_ENTERPRISE",
    [25, 10, 15, 15, 20, 10, 5],
    ["company_size_match", "revenue_band_match", "industry_match", "tech_stack_match"],
    "Enterprise deals are won or lost on access to the people who decide.",
  ),
  MSP: profile(
    "MSP",
    [30, 10, 20, 10, 10, 15, 5],
    ["company_size_match", "geography_match", "industry_match", "incorporated"],
    "Brief §17 MSP example: headcount and on-site reach define fit; pain with the current provider and contract renewal timing drive the deal.",
  ),
  AGENCY: profile(
    "AGENCY",
    [30, 10, 20, 15, 10, 10, 5],
    ["company_size_match", "growth_signal", "revenue_band_match", "industry_match"],
    "Brief §17 agency example: a retainer needs a client big enough to pay for it and a real growth problem to solve.",
  ),
  STUDIO: profile(
    "STUDIO",
    [25, 15, 20, 15, 10, 10, 5],
    ["company_size_match", "industry_match", "website_present", "growth_signal"],
    "Project work: the brief and the budget matter as much as the company.",
  ),
  PROFESSIONAL: profile(
    "PROFESSIONAL",
    [30, 10, 20, 10, 10, 15, 5],
    ["company_size_match", "industry_match", "geography_match", "incorporated"],
    "Advisory work is recurring; fit and a live need (year end, a dispute, a deadline) dominate.",
  ),
  RECRUITMENT: profile(
    "RECRUITMENT",
    [25, 10, 25, 15, 10, 10, 5],
    ["company_size_match", "industry_match", "growth_signal"],
    "An open role is the need; a hiring company is the fit.",
  ),
  LOCAL_TRADE: profile(
    "LOCAL_TRADE",
    [20, 5, 25, 10, 10, 25, 5],
    ["service_match", "geography_match", "property_type_match"],
    "Brief §17 roofing example: in the service area, the right kind of job, and needed soon.",
  ),
  COMMERCIAL_SERVICES: profile(
    "COMMERCIAL_SERVICES",
    [30, 10, 20, 15, 10, 10, 5],
    ["geography_match", "company_size_match", "service_match", "incorporated"],
    "Contracted site services: sites in reach, of a size worth servicing.",
  ),
  PROPERTY: profile(
    "PROPERTY",
    [20, 15, 20, 15, 10, 15, 5],
    ["geography_match", "property_type_match", "service_match"],
    "Instructions depend on the property and the area as much as on the person.",
  ),
  HIGH_TICKET_B2C: profile(
    "HIGH_TICKET_B2C",
    [15, 15, 25, 15, 10, 15, 5],
    ["service_match", "geography_match"],
    "Suitability and the reason for enquiring outweigh any demographic fit (which is never used).",
  ),
  ECOMMERCE: profile(
    "ECOMMERCE",
    [15, 35, 10, 15, 5, 5, 15],
    ["service_match", "geography_match"],
    "Buying signals and engagement predict a checkout far better than profile data.",
  ),
  CONSUMER_LOCAL: profile(
    "CONSUMER_LOCAL",
    [15, 30, 15, 10, 5, 15, 10],
    ["geography_match", "service_match"],
    "A booking is about proximity, intent and a date.",
  ),
  INDUSTRIAL: profile(
    "INDUSTRIAL",
    [30, 5, 15, 20, 15, 10, 5],
    ["industry_match", "company_size_match", "geography_match", "incorporated"],
    "Trade accounts: volume and the buyer's role decide the value.",
  ),
  ORGANISATION: profile(
    "ORGANISATION",
    [20, 20, 15, 10, 10, 10, 15],
    ["geography_match", "industry_match"],
    "Memberships and supporters: interest and engagement carry the most signal.",
  ),
} satisfies Record<string, ScoringProfile>;

/* ------------------------------------------------------ objection sets */

const B2B_OBJECTIONS: ObjectionKey[] = [
  "PRICE", "BUDGET", "TIMING", "EXISTING_PROVIDER", "AUTHORITY", "SEND_INFORMATION", "TOO_BUSY",
];
const SAAS_OBJECTIONS: ObjectionKey[] = [
  "PRICE", "COMPETITOR", "EXISTING_PROVIDER", "IMPLEMENTATION", "SWITCHING_COST", "SECURITY",
  "FEATURE", "INTERNAL_BUILD", "AUTHORITY",
];
const ENTERPRISE_OBJECTIONS: ObjectionKey[] = [
  "SECURITY", "COMPLIANCE", "PROCUREMENT", "CONTRACT", "AUTHORITY", "RISK", "IMPLEMENTATION",
  "INTERNAL_BUILD",
];
const AGENCY_OBJECTIONS: ObjectionKey[] = [
  "PRICE", "BUDGET", "TRUST", "EXISTING_PROVIDER", "INTERNAL_BUILD", "RISK", "TIMING", "SEND_INFORMATION",
];
const PROFESSIONAL_OBJECTIONS: ObjectionKey[] = [
  "PRICE", "EXISTING_PROVIDER", "SWITCHING_COST", "TRUST", "TIMING", "COMPLIANCE",
];
const TRADE_OBJECTIONS: ObjectionKey[] = ["PRICE", "TIMING", "TRUST", "CALL_LATER", "COMPETITOR"];
const CONSUMER_OBJECTIONS: ObjectionKey[] = ["PRICE", "TIMING", "TRUST", "NOT_INTERESTED", "CALL_LATER"];
const ECOMMERCE_OBJECTIONS: ObjectionKey[] = ["PRICE", "TRUST", "FEATURE", "TIMING", "COMPETITOR"];
const INDUSTRIAL_OBJECTIONS: ObjectionKey[] = [
  "PRICE", "EXISTING_PROVIDER", "SWITCHING_COST", "PROCUREMENT", "CONTRACT", "AUTHORITY",
];

/* ------------------------------------------------------------- builder */

type ArchetypeInput = {
  key: string;
  name: string;
  group: ArchetypeGroup;
  sic: string[];
  aliases: string[];
  motions: SalesMotion[];
  deal: DealSizeBand;
  roles: string[];
  profile: ScoringProfile;
  objections: ObjectionKey[];
  qualification?: QualificationSpec[];
  deep?: boolean;
};

function archetype(input: ArchetypeInput): Archetype {
  const primary = input.motions[0];
  return {
    key: input.key,
    name: input.name,
    group: input.group,
    sic2026Prefixes: input.sic,
    aliases: input.aliases.map((alias) => alias.toLowerCase()),
    defaultMotions: input.motions,
    dealSizeBand: input.deal,
    decisionMakerRoles: input.roles,
    scoringProfile: input.profile,
    qualification: resolveQualification(input.qualification ?? MOTIONS[primary].qualificationDimensions),
    commonObjections: input.objections,
    depth: input.deep ? "DEEP" : "STANDARD",
  };
}

const P = SCORING_PROFILES;

/* ------------------------------------------------------------ the library */

export const ARCHETYPES: Archetype[] = [
  /* ---------------------------------------------------------- software */
  archetype({
    key: "B2B_SAAS",
    name: "B2B SaaS",
    group: "SOFTWARE",
    sic: ["62.12", "62.13", "58.29"],
    aliases: ["b2b saas", "saas", "software as a service", "business software", "saas platform", "vertical saas"],
    motions: ["BOOK_MEETING_B2B", "SAAS_SELF_SERVE", "ENTERPRISE"],
    deal: "MID",
    roles: ["Founder", "CEO", "Head of Operations", "Head of Sales", "CTO", "Department head"],
    profile: P.SAAS_B2B,
    objections: SAAS_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "USE_CASE", question: "What would you mainly want the platform to handle for you?" },
      { key: "TEAM_SIZE", question: "How many people on your team would be using it?" },
      { key: "CURRENT_SOLUTION", question: "What are you using for this today, if anything?" },
      "TIMING",
      "AUTHORITY",
      "BUDGET",
      { key: "TECHNICAL_REQUIREMENTS", question: "Does it need to connect to any tools you already use?" },
    ],
  }),
  archetype({
    key: "B2C_SAAS",
    name: "Consumer SaaS / app",
    group: "SOFTWARE",
    sic: ["62.13", "58.29"],
    aliases: ["consumer app", "b2c saas", "mobile app", "subscription app"],
    motions: ["SAAS_SELF_SERVE"],
    deal: "MICRO",
    roles: ["The individual subscriber"],
    profile: P.SAAS_PLG,
    objections: ["PRICE", "FEATURE", "TRUST", "COMPETITOR", "NOT_INTERESTED"],
  }),
  archetype({
    key: "PLG_SAAS",
    name: "Product-led SaaS",
    group: "SOFTWARE",
    sic: ["62.13", "58.29", "62.12"],
    aliases: ["product-led", "plg", "freemium software", "self-serve software", "free trial software"],
    motions: ["SAAS_SELF_SERVE", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Team lead", "Founder", "Head of Operations", "End user champion"],
    profile: P.SAAS_PLG,
    objections: SAAS_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "USE_CASE", question: "What are you hoping to get done with it first?" },
      { key: "TEAM_SIZE", question: "Is this just for you, or for a team?" },
      "CURRENT_SOLUTION",
      { key: "TECHNICAL_REQUIREMENTS", question: "Is there anything it would need to plug into?" },
    ],
  }),
  archetype({
    key: "ENTERPRISE_SAAS",
    name: "Enterprise SaaS",
    group: "SOFTWARE",
    sic: ["62.12", "62.13", "63.10/1"],
    aliases: ["enterprise software", "enterprise saas", "enterprise platform"],
    motions: ["ENTERPRISE", "BOOK_MEETING_B2B"],
    deal: "ENTERPRISE",
    roles: ["CIO", "CTO", "COO", "VP / Director of the function", "Procurement", "Information security"],
    profile: P.SAAS_ENTERPRISE,
    objections: ENTERPRISE_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's the business problem you're trying to solve with this?" },
      "SUCCESS_METRICS",
      "STAKEHOLDERS",
      "DECISION_PROCESS",
      "COMPLIANCE_REQUIREMENTS",
      "TIMING",
      "BUDGET",
      { key: "TECHNICAL_REQUIREMENTS", question: "Which systems would it need to integrate with?" },
      "IMPLEMENTATION_READINESS",
    ],
  }),
  archetype({
    key: "FINTECH",
    name: "Fintech",
    group: "SOFTWARE",
    sic: ["62.12/5", "66.19/1", "66.12/2"],
    aliases: ["fintech", "payments platform", "financial technology", "open banking"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["CFO", "Finance Director", "Head of Payments", "CTO"],
    profile: P.SAAS_B2B,
    objections: [...SAAS_OBJECTIONS, "COMPLIANCE"],
  }),
  archetype({
    key: "HR_TECH",
    name: "HR tech",
    group: "SOFTWARE",
    sic: ["62.12/9", "62.13/9"],
    aliases: ["hr software", "hr tech", "payroll software", "hris", "people platform"],
    motions: ["BOOK_MEETING_B2B", "SAAS_SELF_SERVE"],
    deal: "MID",
    roles: ["HR Director", "Head of People", "Operations Director", "Finance Director"],
    profile: P.SAAS_B2B,
    objections: SAAS_OBJECTIONS,
  }),

  /* ------------------------------------------------------- IT & telecom */
  archetype({
    key: "MSP",
    name: "Managed service provider (IT)",
    group: "IT_TELECOM",
    sic: ["62.20/9", "62.90"],
    aliases: ["msp", "managed it", "managed service provider", "it support", "outsourced it", "it services"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["Managing Director", "Operations Director", "Office Manager", "Finance Director", "Head of IT"],
    profile: P.MSP,
    objections: ["EXISTING_PROVIDER", "SWITCHING_COST", "PRICE", "SECURITY", "CONTRACT", "TRUST"],
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's not working with your IT at the moment?" },
      { key: "COMPANY_SIZE", question: "How many staff and devices would we be looking after?" },
      { key: "USE_CASE", question: "Is it day-to-day support you need, a specific project, or both?" },
      { key: "CURRENT_SOLUTION", question: "Who looks after your IT today?" },
      { key: "TIMING", question: "When does your current arrangement come up for renewal?" },
      "AUTHORITY",
      { key: "DISSATISFACTION", question: "How has your current IT support been for you?" },
    ],
  }),
  archetype({
    key: "IT_CONSULTANCY",
    name: "IT consultancy",
    group: "IT_TELECOM",
    sic: ["62.20/1"],
    aliases: ["it consultancy", "it consultant", "technology consultancy", "digital transformation"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["CTO", "CIO", "Operations Director", "Managing Director"],
    profile: P.PROFESSIONAL,
    objections: [...B2B_OBJECTIONS, "INTERNAL_BUILD", "RISK"],
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's the technology problem you're trying to solve?" },
      "PROJECT_SCOPE",
      "USE_CASE",
      "TIMING",
      "AUTHORITY",
      "BUDGET",
    ],
  }),
  archetype({
    key: "CYBERSECURITY",
    name: "Cybersecurity",
    group: "IT_TELECOM",
    sic: ["62.20/1", "62.20/9", "62.90"],
    aliases: ["cybersecurity", "cyber security", "penetration testing", "pen testing", "cyber essentials", "soc"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["CISO", "Head of IT", "CTO", "Managing Director", "Compliance lead"],
    profile: P.MSP,
    objections: ["PRICE", "EXISTING_PROVIDER", "COMPLIANCE", "SECURITY", "RISK", "AUTHORITY"],
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's prompted you to look at security now: an audit, an incident, or a client requirement?" },
      "COMPLIANCE_REQUIREMENTS",
      "COMPANY_SIZE",
      "USE_CASE",
      "TIMING",
      "AUTHORITY",
    ],
  }),
  archetype({
    key: "TELECOM",
    name: "Telecoms provider / reseller",
    group: "IT_TELECOM",
    sic: ["61"],
    aliases: ["telecoms", "telecom", "business broadband", "voip", "phone systems", "connectivity"],
    motions: ["DIRECT_B2B", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Office Manager", "Operations Director", "Managing Director", "Head of IT"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["EXISTING_PROVIDER", "CONTRACT", "PRICE", "SWITCHING_COST", "TIMING"],
  }),

  /* ------------------------------------------------ marketing & creative */
  archetype({
    key: "MARKETING_AGENCY",
    name: "Marketing agency",
    group: "MARKETING_CREATIVE",
    sic: ["73.11", "70.20/3", "73.30"],
    aliases: ["marketing agency", "digital marketing agency", "digital agency", "growth agency", "performance marketing", "social media agency", "pr agency"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "MID",
    roles: ["Founder", "CEO", "Marketing Director", "Head of Marketing", "Head of Growth"],
    profile: P.AGENCY,
    objections: AGENCY_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's the main growth goal you want help with?" },
      { key: "CURRENT_SOLUTION", question: "Who's doing your marketing today: in-house, another agency, or nobody yet?" },
      { key: "USE_CASE", question: "Which channels matter most to you right now?" },
      { key: "TIMING", question: "When would you want someone to start?" },
      { key: "BUDGET", question: "Is there a monthly budget you're working to?" },
      "AUTHORITY",
      { key: "OUTCOME", question: "What result would make this worthwhile for you?" },
    ],
  }),
  archetype({
    key: "ADVERTISING_AGENCY",
    name: "Advertising agency",
    group: "MARKETING_CREATIVE",
    sic: ["73.11", "73.12"],
    aliases: ["advertising agency", "ad agency", "media buying", "ppc agency", "paid social agency", "creative agency"],
    motions: ["BOOK_MEETING_B2B"],
    deal: "MID",
    roles: ["Marketing Director", "Brand Director", "Head of Marketing", "CEO"],
    profile: P.AGENCY,
    objections: AGENCY_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What do you need the advertising to achieve?" },
      { key: "USE_CASE", question: "Which channels are you running ads on, or planning to?" },
      { key: "CURRENT_SOLUTION", question: "Who manages your ads at the moment?" },
      { key: "BUDGET", question: "Roughly what's your monthly ad spend?" },
      "TIMING",
      "AUTHORITY",
    ],
  }),
  archetype({
    key: "SEO_AGENCY",
    name: "SEO agency",
    group: "MARKETING_CREATIVE",
    sic: ["73.11"],
    aliases: ["seo agency", "seo", "search engine optimisation", "search engine optimization", "content marketing agency"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["Founder", "Marketing Manager", "Head of Marketing", "Ecommerce Manager"],
    profile: P.AGENCY,
    objections: AGENCY_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's happening with your search traffic that made you get in touch?" },
      { key: "USE_CASE", question: "Is it local, national or ecommerce search you want to grow?" },
      { key: "CURRENT_SOLUTION", question: "Has anyone worked on your SEO before?" },
      "TIMING",
      { key: "BUDGET", question: "Is there a monthly budget you're working to?" },
      "AUTHORITY",
    ],
  }),
  archetype({
    key: "CREATIVE_WEB_STUDIO",
    name: "Web / design studio",
    group: "MARKETING_CREATIVE",
    sic: ["74.12", "62.13/9", "62.90"],
    aliases: ["web design", "web designer", "web development", "web developer", "web studio", "design studio", "branding agency", "ux agency", "shopify agency", "wordpress developer"],
    motions: ["DIRECT_B2B", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Founder", "Managing Director", "Marketing Manager", "Head of Digital"],
    profile: P.STUDIO,
    objections: ["PRICE", "BUDGET", "TIMING", "TRUST", "INTERNAL_BUILD", "SEND_INFORMATION"],
    deep: true,
    qualification: [
      { key: "PROJECT_SCOPE", question: "What does the project involve: a new site, a redesign, or something else?" },
      { key: "PROBLEM", question: "What isn't your current site doing for you?" },
      { key: "TIMING", question: "Is there a launch date you're working towards?" },
      { key: "BUDGET", question: "Do you have a budget range in mind for the build?" },
      "AUTHORITY",
      { key: "TECHNICAL_REQUIREMENTS", question: "Is there a platform you'd want it built on, or are you open?" },
    ],
  }),
  archetype({
    key: "MEDIA",
    name: "Media / publishing",
    group: "MARKETING_CREATIVE",
    sic: ["58.1", "59", "60"],
    aliases: ["publisher", "media company", "video production", "podcast production", "film production"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["Marketing Director", "Brand Manager", "Head of Content"],
    profile: P.STUDIO,
    objections: ["PRICE", "BUDGET", "TIMING", "SEND_INFORMATION"],
  }),

  /* ---------------------------------------------- professional services */
  archetype({
    key: "ACCOUNTING",
    name: "Accountancy practice",
    group: "PROFESSIONAL_SERVICES",
    sic: ["69.20/1", "69.20/3"],
    aliases: ["accountant", "accountants", "accountancy", "chartered accountants", "tax advisor", "tax adviser"],
    motions: ["BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Business owner", "Managing Director", "Finance Director"],
    profile: P.PROFESSIONAL,
    objections: PROFESSIONAL_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "SERVICE_NEEDED", question: "Which do you need help with: accounts, tax, payroll, or advisory?" },
      { key: "COMPANY_SIZE", question: "Roughly what's the annual turnover and headcount?" },
      { key: "CURRENT_SOLUTION", question: "Do you have an accountant at the moment?" },
      { key: "USE_CASE", question: "Is there a particular deadline or issue driving this?" },
      "TIMING",
      { key: "DISSATISFACTION", question: "Is anything prompting a change from how it's handled now?" },
    ],
  }),
  archetype({
    key: "BOOKKEEPING",
    name: "Bookkeeping",
    group: "PROFESSIONAL_SERVICES",
    sic: ["69.20/2"],
    aliases: ["bookkeeper", "bookkeeping", "payroll bureau"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["Business owner", "Office Manager", "Finance Manager"],
    profile: P.PROFESSIONAL,
    objections: PROFESSIONAL_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "USE_CASE", question: "Which software do you keep your books in, if any?" },
      { key: "VOLUME", question: "Roughly how many transactions a month are we talking about?" },
      "CURRENT_SOLUTION",
      "TIMING",
    ],
  }),
  archetype({
    key: "LAW_FIRM",
    name: "Law firm",
    group: "PROFESSIONAL_SERVICES",
    sic: ["69.10"],
    aliases: ["solicitor", "solicitors", "law firm", "lawyer", "legal services", "barrister"],
    motions: ["BOOK_MEETING_B2B", "HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["Managing Director", "General Counsel", "Business owner", "HR Director"],
    profile: P.PROFESSIONAL,
    objections: PROFESSIONAL_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "USE_CASE", question: "Which area of law is this about?" },
      { key: "TIMING", question: "Is there a deadline or a date we should know about?" },
      "PROBLEM",
      "AUTHORITY",
    ],
  }),
  archetype({
    key: "MANAGEMENT_CONSULTING",
    name: "Management consultancy",
    group: "PROFESSIONAL_SERVICES",
    sic: ["70.20"],
    aliases: ["management consultancy", "management consultant", "consultancy", "strategy consultancy", "business consultant", "operations consultancy"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["CEO", "Managing Director", "COO", "Department head"],
    profile: P.PROFESSIONAL,
    objections: [...B2B_OBJECTIONS, "TRUST", "INTERNAL_BUILD"],
    deep: true,
    qualification: [
      { key: "PROBLEM", question: "What's the challenge you'd want help with?" },
      "SUCCESS_METRICS",
      "PROJECT_SCOPE",
      "TIMING",
      "AUTHORITY",
      "BUDGET",
    ],
  }),
  archetype({
    key: "ARCHITECTURE",
    name: "Architecture practice",
    group: "PROFESSIONAL_SERVICES",
    sic: ["71.11"],
    aliases: ["architect", "architects", "architectural practice", "planning consultant"],
    motions: ["DIRECT_B2B", "HIGH_TICKET_B2C"],
    deal: "MID",
    roles: ["Property owner", "Developer", "Project Director"],
    profile: P.PROFESSIONAL,
    objections: ["PRICE", "TIMING", "TRUST", "BUDGET"],
    qualification: ["PROJECT_SCOPE", "LOCATION", "TIMING", "BUDGET"],
  }),
  archetype({
    key: "ENGINEERING_CONSULTANCY",
    name: "Engineering consultancy",
    group: "PROFESSIONAL_SERVICES",
    sic: ["71.12", "74.99/2"],
    aliases: ["engineering consultancy", "structural engineer", "civil engineering consultant", "quantity surveyor"],
    motions: ["DIRECT_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["Project Director", "Developer", "Operations Director"],
    profile: P.PROFESSIONAL,
    objections: ["PRICE", "TIMING", "PROCUREMENT", "CONTRACT"],
    qualification: ["PROJECT_SCOPE", "TIMING", "LOCATION", "AUTHORITY"],
  }),
  archetype({
    key: "BUSINESS_SERVICES",
    name: "Business services",
    group: "PROFESSIONAL_SERVICES",
    sic: ["82.10", "82.20", "82.99", "74.30"],
    aliases: ["virtual assistant", "outsourcing", "call centre", "translation services", "business support"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["Operations Director", "Office Manager", "Managing Director"],
    profile: P.DEFAULT_B2B,
    objections: B2B_OBJECTIONS,
  }),

  /* --------------------------------------------------- people services */
  archetype({
    key: "RECRUITMENT",
    name: "Recruitment agency",
    group: "PEOPLE_SERVICES",
    sic: ["78.10"],
    aliases: ["recruitment agency", "recruiter", "recruitment consultancy", "headhunter", "executive search", "talent acquisition"],
    motions: ["BOOK_MEETING_B2B"],
    deal: "MID",
    roles: ["Hiring manager", "HR Director", "Head of Talent", "Founder"],
    profile: P.RECRUITMENT,
    objections: ["PRICE", "EXISTING_PROVIDER", "INTERNAL_BUILD", "TIMING", "TRUST"],
    deep: true,
    qualification: [
      { key: "HIRING_NEED", question: "Which roles are you looking to fill?" },
      { key: "USE_CASE", question: "Is it one hire or several over the coming months?" },
      { key: "TIMING", question: "When do you need the first person in seat?" },
      { key: "CURRENT_SOLUTION", question: "Are you recruiting in-house or with other agencies at the moment?" },
      "AUTHORITY",
    ],
  }),
  archetype({
    key: "STAFFING",
    name: "Staffing / temp agency",
    group: "PEOPLE_SERVICES",
    sic: ["78.20"],
    aliases: ["staffing agency", "temp agency", "temporary staff", "labour supply", "contract staffing"],
    motions: ["BOOK_MEETING_B2B", "DIRECT_B2B"],
    deal: "MID",
    roles: ["Operations Manager", "Site Manager", "HR Manager"],
    profile: P.RECRUITMENT,
    objections: ["PRICE", "EXISTING_PROVIDER", "CONTRACT", "TIMING"],
    qualification: ["HIRING_NEED", "VOLUME", "LOCATION", "TIMING", "USE_CASE"],
  }),

  /* ------------------------------------------------ finance & insurance */
  archetype({
    key: "FINANCIAL_ADVISORY",
    name: "Financial advisory",
    group: "FINANCE_INSURANCE",
    sic: ["66.19/9", "70.20/2", "66.30"],
    aliases: ["financial adviser", "financial advisor", "ifa", "wealth management", "financial planning"],
    motions: ["HIGH_TICKET_B2C", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["The client", "Business owner", "Finance Director"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["TRUST", "PRICE", "EXISTING_PROVIDER", "COMPLIANCE", "TIMING"],
  }),
  archetype({
    key: "INSURANCE_BROKER",
    name: "Insurance broker",
    group: "FINANCE_INSURANCE",
    sic: ["66.22"],
    aliases: ["insurance broker", "business insurance", "commercial insurance", "insurance agent"],
    motions: ["DIRECT_B2B", "HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["Business owner", "Finance Director", "Operations Director"],
    profile: P.PROFESSIONAL,
    objections: ["PRICE", "EXISTING_PROVIDER", "TIMING", "CONTRACT"],
    qualification: ["USE_CASE", "TIMING", "CURRENT_SOLUTION", "PROJECT_SCOPE"],
  }),
  archetype({
    key: "MORTGAGE_BROKER",
    name: "Mortgage broker",
    group: "FINANCE_INSURANCE",
    sic: ["66.19/9"],
    aliases: ["mortgage broker", "mortgage adviser", "mortgage advisor", "remortgage"],
    motions: ["HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["The applicant"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["TRUST", "TIMING", "PRICE", "EXISTING_PROVIDER"],
  }),

  /* ----------------------------------------------------------- property */
  archetype({
    key: "PROPERTY_MANAGEMENT",
    name: "Property management",
    group: "PROPERTY",
    sic: ["68.32"],
    aliases: ["property management", "block management", "property manager", "managing agent"],
    motions: ["BOOK_MEETING_B2B", "LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Landlord", "Portfolio owner", "Residents' association chair"],
    profile: P.PROPERTY,
    objections: ["PRICE", "EXISTING_PROVIDER", "SWITCHING_COST", "CONTRACT", "TRUST"],
    qualification: ["PROPERTY_TYPE", "VOLUME", "LOCATION", "CURRENT_SOLUTION", "TIMING"],
  }),
  archetype({
    key: "ESTATE_AGENCY",
    name: "Estate agency",
    group: "PROPERTY",
    sic: ["68.31"],
    aliases: ["estate agent", "estate agency", "property valuation", "sell my house"],
    motions: ["LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Vendor", "Homeowner"],
    profile: P.PROPERTY,
    objections: ["PRICE", "EXISTING_PROVIDER", "TIMING", "TRUST"],
    qualification: [
      { key: "SERVICE_NEEDED", question: "Are you looking to sell, let, or just get a valuation?" },
      "LOCATION",
      "PROPERTY_TYPE",
      "TIMING",
    ],
  }),
  archetype({
    key: "LETTINGS",
    name: "Lettings agency",
    group: "PROPERTY",
    sic: ["68.31", "68.32", "68.20/2"],
    aliases: ["letting agent", "lettings agency", "lettings", "landlord services"],
    motions: ["LOCAL_SERVICE", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Landlord", "Portfolio owner"],
    profile: P.PROPERTY,
    objections: ["PRICE", "EXISTING_PROVIDER", "SWITCHING_COST", "TRUST"],
    qualification: [
      { key: "SERVICE_NEEDED", question: "Are you after full management, or tenant-find only?" },
      "LOCATION",
      "PROPERTY_TYPE",
      "TIMING",
      "VOLUME",
    ],
  }),
  archetype({
    key: "REAL_ESTATE_DEVELOPER",
    name: "Property developer",
    group: "PROPERTY",
    sic: ["68.12", "68.11"],
    aliases: ["property developer", "housebuilder", "real estate developer", "property development"],
    motions: ["DIRECT_B2B", "HIGH_TICKET_B2C"],
    deal: "LARGE",
    roles: ["Buyer", "Investor", "Land owner"],
    profile: P.PROPERTY,
    objections: ["PRICE", "TIMING", "RISK", "TRUST"],
  }),

  /* ------------------------------------------------ construction & trades */
  archetype({
    key: "CONSTRUCTION_CONTRACTOR",
    name: "Construction contractor",
    group: "CONSTRUCTION_TRADES",
    sic: ["41", "42"],
    aliases: ["building contractor", "main contractor", "builder", "construction company", "civil engineering contractor"],
    motions: ["DIRECT_B2B", "LOCAL_SERVICE"],
    deal: "LARGE",
    roles: ["Developer", "Property owner", "Project Manager", "Procurement"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["PRICE", "TIMING", "PROCUREMENT", "CONTRACT", "TRUST"],
    qualification: ["PROJECT_SCOPE", "LOCATION", "TIMING", "BUDGET", "AUTHORITY"],
  }),
  archetype({
    key: "SUBCONTRACTOR",
    name: "Specialist subcontractor",
    group: "CONSTRUCTION_TRADES",
    sic: ["43"],
    aliases: ["subcontractor", "specialist contractor", "groundworks", "scaffolding", "plastering", "bricklayer"],
    motions: ["DIRECT_B2B", "LOCAL_SERVICE"],
    deal: "MID",
    roles: ["Main contractor", "Site Manager", "Quantity surveyor"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["PRICE", "TIMING", "CONTRACT", "EXISTING_PROVIDER"],
    qualification: ["PROJECT_SCOPE", "LOCATION", "TIMING", "VOLUME"],
  }),
  archetype({
    key: "PLUMBER",
    name: "Plumber",
    group: "CONSTRUCTION_TRADES",
    sic: ["43.22/9"],
    aliases: ["plumber", "plumbing", "bathroom fitter", "leak repair"],
    motions: ["LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Homeowner", "Landlord", "Facilities manager"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
    qualification: [
      { key: "SERVICE_NEEDED", question: "What do you need doing?" },
      "LOCATION",
      { key: "TIMING", question: "How soon do you need someone?" },
      "PROPERTY_TYPE",
    ],
  }),
  archetype({
    key: "ELECTRICIAN",
    name: "Electrician",
    group: "CONSTRUCTION_TRADES",
    sic: ["43.21"],
    aliases: ["electrician", "electrical contractor", "rewiring", "ev charger installer", "solar installer"],
    motions: ["LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Homeowner", "Landlord", "Facilities manager"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
    qualification: [
      { key: "SERVICE_NEEDED", question: "What electrical work do you need?" },
      "LOCATION",
      "TIMING",
      "PROPERTY_TYPE",
    ],
  }),
  archetype({
    key: "ROOFER",
    name: "Roofer",
    group: "CONSTRUCTION_TRADES",
    sic: ["43.41"],
    aliases: ["roofer", "roofing", "roof repair", "flat roofing"],
    motions: ["LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Homeowner", "Landlord", "Facilities manager"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
    qualification: [
      { key: "SERVICE_NEEDED", question: "Is it a repair, a replacement, or something else?" },
      "LOCATION",
      { key: "TIMING", question: "Is it leaking now, or something you're planning ahead for?" },
      "PROPERTY_TYPE",
    ],
  }),
  archetype({
    key: "HVAC",
    name: "Heating, ventilation & air conditioning",
    group: "CONSTRUCTION_TRADES",
    sic: ["43.22"],
    aliases: ["hvac", "heating engineer", "boiler installer", "air conditioning", "heat pump installer", "gas engineer"],
    motions: ["LOCAL_SERVICE", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["Homeowner", "Facilities manager", "Landlord"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
  }),
  archetype({
    key: "LANDSCAPER",
    name: "Landscaper",
    group: "CONSTRUCTION_TRADES",
    sic: ["81.30"],
    aliases: ["landscaper", "landscaping", "garden design", "gardener", "grounds maintenance"],
    motions: ["LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Homeowner", "Facilities manager"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
  }),

  /* ---------------------------------------------------------- facilities */
  archetype({
    key: "CLEANING",
    name: "Cleaning company",
    group: "FACILITIES",
    sic: ["81.21", "81.22", "81.23/9"],
    aliases: ["cleaning company", "commercial cleaning", "office cleaning", "window cleaning", "cleaners"],
    motions: ["DIRECT_B2B", "LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Office Manager", "Facilities Manager", "Operations Manager"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["PRICE", "EXISTING_PROVIDER", "CONTRACT", "TRUST"],
    qualification: ["SERVICE_NEEDED", "LOCATION", "VOLUME", "TIMING"],
  }),
  archetype({
    key: "FACILITIES_MANAGEMENT",
    name: "Facilities management",
    group: "FACILITIES",
    sic: ["81.10"],
    aliases: ["facilities management", "fm provider", "building services"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["Facilities Director", "Operations Director", "Procurement"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["PRICE", "EXISTING_PROVIDER", "PROCUREMENT", "CONTRACT", "SWITCHING_COST"],
  }),
  archetype({
    key: "PEST_CONTROL",
    name: "Pest control",
    group: "FACILITIES",
    sic: ["81.23/1"],
    aliases: ["pest control", "exterminator", "rodent control"],
    motions: ["LOCAL_SERVICE", "DIRECT_B2B"],
    deal: "MICRO",
    roles: ["Homeowner", "Facilities manager", "Restaurant manager"],
    profile: P.LOCAL_TRADE,
    objections: TRADE_OBJECTIONS,
  }),
  archetype({
    key: "SECURITY_SERVICES",
    name: "Security services",
    group: "FACILITIES",
    sic: ["80.01/2", "80.09"],
    aliases: ["security company", "security guards", "manned guarding", "alarm installer", "cctv installer"],
    motions: ["DIRECT_B2B", "LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Facilities Manager", "Site Manager", "Business owner"],
    profile: P.COMMERCIAL_SERVICES,
    objections: ["PRICE", "EXISTING_PROVIDER", "CONTRACT", "TRUST"],
  }),

  /* ---------------------------------------------------------- automotive */
  archetype({
    key: "AUTOMOTIVE_SERVICES",
    name: "Garage / automotive services",
    group: "AUTOMOTIVE",
    sic: ["95.31", "95.32"],
    aliases: ["garage", "mechanic", "mot centre", "car servicing", "body shop"],
    motions: ["LOCAL_SERVICE"],
    deal: "MICRO",
    roles: ["Vehicle owner", "Fleet manager"],
    profile: P.CONSUMER_LOCAL,
    objections: CONSUMER_OBJECTIONS,
  }),
  archetype({
    key: "DEALERSHIP",
    name: "Vehicle dealership",
    group: "AUTOMOTIVE",
    sic: ["47.81", "47.82", "47.83", "47.85"],
    aliases: ["car dealership", "car dealer", "van dealer", "motorcycle dealer", "used cars"],
    motions: ["HIGH_TICKET_B2C", "DIRECT_B2B"],
    deal: "MID",
    roles: ["Buyer", "Fleet manager"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "COMPETITOR", "TIMING", "TRUST"],
    qualification: ["PRODUCT_INTEREST", "TIMING", "BUDGET", "SUITABILITY"],
  }),

  /* ----------------------------------------------------------- logistics */
  archetype({
    key: "LOGISTICS",
    name: "Logistics / 3PL",
    group: "LOGISTICS",
    sic: ["52.25", "52.10", "52.24"],
    aliases: ["logistics", "3pl", "fulfilment", "fulfillment", "warehousing"],
    motions: ["BOOK_MEETING_B2B", "ENTERPRISE"],
    deal: "MID",
    roles: ["Operations Director", "Supply Chain Manager", "Ecommerce Director"],
    profile: P.INDUSTRIAL,
    objections: INDUSTRIAL_OBJECTIONS,
    qualification: ["VOLUME", "USE_CASE", "CURRENT_SOLUTION", "TIMING", "AUTHORITY"],
  }),
  archetype({
    key: "FREIGHT",
    name: "Freight / haulage",
    group: "LOGISTICS",
    sic: ["49.41", "49.20", "52.31", "50.20", "51.21"],
    aliases: ["haulage", "freight forwarder", "freight", "road haulage", "shipping agent"],
    motions: ["DIRECT_B2B"],
    deal: "MID",
    roles: ["Logistics Manager", "Operations Director", "Procurement"],
    profile: P.INDUSTRIAL,
    objections: INDUSTRIAL_OBJECTIONS,
    qualification: ["VOLUME", "LOCATION", "TIMING", "CURRENT_SOLUTION"],
  }),
  archetype({
    key: "COURIER",
    name: "Courier",
    group: "LOGISTICS",
    sic: ["53.20"],
    aliases: ["courier", "same day courier", "parcel delivery", "delivery service"],
    motions: ["DIRECT_B2B", "ECOMMERCE_DIRECT"],
    deal: "SMALL",
    roles: ["Office Manager", "Ecommerce Manager", "Operations Manager"],
    profile: P.INDUSTRIAL,
    objections: ["PRICE", "EXISTING_PROVIDER", "TRUST"],
    qualification: ["VOLUME", "LOCATION", "TIMING"],
  }),

  /* -------------------------------------------------- industrial & trade */
  archetype({
    key: "MANUFACTURING",
    name: "Manufacturer",
    group: "INDUSTRIAL_TRADE",
    sic: [
      "10", "11", "13", "14", "15", "16", "17", "18", "20", "21", "22", "23", "24", "25",
      "26", "27", "28", "29", "30", "31", "32", "33",
    ],
    aliases: ["manufacturer", "manufacturing", "factory", "fabrication", "contract manufacturer"],
    motions: ["DIRECT_B2B", "ENTERPRISE"],
    deal: "LARGE",
    roles: ["Procurement Manager", "Operations Director", "Engineering Manager", "Managing Director"],
    profile: P.INDUSTRIAL,
    objections: INDUSTRIAL_OBJECTIONS,
    qualification: ["PROJECT_SCOPE", "VOLUME", "TIMING", "AUTHORITY", "CURRENT_SOLUTION"],
  }),
  archetype({
    key: "WHOLESALER",
    name: "Wholesaler",
    group: "INDUSTRIAL_TRADE",
    sic: ["46.2", "46.3", "46.4", "46.5", "46.6", "46.7", "46.8", "46.9"],
    aliases: ["wholesaler", "wholesale", "cash and carry", "trade supplier"],
    motions: ["DIRECT_B2B"],
    deal: "MID",
    roles: ["Buyer", "Purchasing Manager", "Store owner"],
    profile: P.INDUSTRIAL,
    objections: INDUSTRIAL_OBJECTIONS,
    qualification: ["PRODUCT_INTEREST", "VOLUME", "TIMING", "CURRENT_SOLUTION"],
  }),
  archetype({
    key: "DISTRIBUTOR",
    name: "Distributor",
    group: "INDUSTRIAL_TRADE",
    sic: ["46.1", "46.5", "46.6"],
    aliases: ["distributor", "distribution company", "sales agent", "reseller"],
    motions: ["DIRECT_B2B", "BOOK_MEETING_B2B"],
    deal: "MID",
    roles: ["Buyer", "Purchasing Manager", "Operations Director"],
    profile: P.INDUSTRIAL,
    objections: INDUSTRIAL_OBJECTIONS,
    qualification: ["PRODUCT_INTEREST", "VOLUME", "TIMING", "AUTHORITY"],
  }),

  /* ------------------------------------------------- retail & ecommerce */
  archetype({
    key: "RETAILER",
    name: "Retailer",
    group: "RETAIL_ECOMMERCE",
    sic: ["47.1", "47.2", "47.4", "47.5", "47.6", "47.7"],
    aliases: ["retailer", "shop", "retail store", "boutique"],
    motions: ["ECOMMERCE_DIRECT", "LOCAL_SERVICE"],
    deal: "MICRO",
    roles: ["The shopper"],
    profile: P.ECOMMERCE,
    objections: ECOMMERCE_OBJECTIONS,
  }),
  archetype({
    key: "ECOMMERCE",
    name: "Ecommerce brand",
    group: "RETAIL_ECOMMERCE",
    sic: ["47.1", "47.2", "47.4", "47.5", "47.6", "47.7"],
    aliases: ["ecommerce", "e-commerce", "online shop", "online store", "dtc brand", "direct to consumer", "shopify store"],
    motions: ["ECOMMERCE_DIRECT", "DIRECT_B2B"],
    deal: "MICRO",
    roles: ["The shopper", "Trade buyer"],
    profile: P.ECOMMERCE,
    objections: ECOMMERCE_OBJECTIONS,
    deep: true,
    qualification: [
      { key: "PRODUCT_INTEREST", question: "Which product were you looking at?" },
      { key: "USE_CASE", question: "What are you hoping it will do for you?" },
      { key: "VOLUME", question: "Is this for yourself, or are you buying in quantity?" },
      "TIMING",
    ],
  }),
  archetype({
    key: "SUBSCRIPTION_ECOMMERCE",
    name: "Subscription ecommerce",
    group: "RETAIL_ECOMMERCE",
    sic: ["47.1", "47.2", "47.7"],
    aliases: ["subscription box", "subscription ecommerce", "subscribe and save", "membership box"],
    motions: ["ECOMMERCE_DIRECT"],
    deal: "MICRO",
    roles: ["The subscriber"],
    profile: P.ECOMMERCE,
    objections: ["PRICE", "TRUST", "CONTRACT", "TIMING"],
    deep: true,
    qualification: [
      { key: "PRODUCT_INTEREST", question: "Which plan caught your eye?" },
      { key: "USE_CASE", question: "Is it for you, or a gift?" },
      "TIMING",
    ],
  }),
  archetype({
    key: "MARKETPLACE",
    name: "Marketplace / platform",
    group: "RETAIL_ECOMMERCE",
    sic: ["47.91", "47.92", "55.40", "56.40", "85.61", "86.97", "96.40", "82.40", "77.5"],
    aliases: ["marketplace", "online marketplace", "booking platform", "two-sided platform"],
    motions: ["SAAS_SELF_SERVE", "BOOK_MEETING_B2B"],
    deal: "MICRO",
    roles: ["Supplier / seller", "Buyer"],
    profile: P.SAAS_PLG,
    objections: ["PRICE", "TRUST", "COMPETITOR", "FEATURE"],
  }),

  /* ------------------------------------------------ hospitality & events */
  archetype({
    key: "HOSPITALITY",
    name: "Hospitality venue",
    group: "HOSPITALITY_EVENTS",
    sic: ["56.30", "55.20", "55.30"],
    aliases: ["pub", "bar", "holiday let", "glamping", "hospitality venue", "wedding venue"],
    motions: ["LOCAL_SERVICE", "HIGH_TICKET_B2C"],
    deal: "MICRO",
    roles: ["The guest", "Event organiser"],
    profile: P.CONSUMER_LOCAL,
    objections: CONSUMER_OBJECTIONS,
    qualification: ["SERVICE_NEEDED", "TIMING", "VOLUME", "BUDGET"],
  }),
  archetype({
    key: "HOTEL",
    name: "Hotel",
    group: "HOSPITALITY_EVENTS",
    sic: ["55.10"],
    aliases: ["hotel", "boutique hotel", "b&b", "guest house"],
    motions: ["LOCAL_SERVICE", "DIRECT_B2B"],
    deal: "SMALL",
    roles: ["The guest", "Corporate travel booker", "Event organiser"],
    profile: P.CONSUMER_LOCAL,
    objections: CONSUMER_OBJECTIONS,
    qualification: ["SERVICE_NEEDED", "TIMING", "VOLUME"],
  }),
  archetype({
    key: "RESTAURANT",
    name: "Restaurant",
    group: "HOSPITALITY_EVENTS",
    sic: ["56.11", "56.12"],
    aliases: ["restaurant", "cafe", "takeaway", "street food"],
    motions: ["LOCAL_SERVICE"],
    deal: "MICRO",
    roles: ["The diner", "Event organiser"],
    profile: P.CONSUMER_LOCAL,
    objections: CONSUMER_OBJECTIONS,
    qualification: ["SERVICE_NEEDED", "TIMING", "VOLUME"],
  }),
  archetype({
    key: "CATERING",
    name: "Catering",
    group: "HOSPITALITY_EVENTS",
    sic: ["56.21", "56.22"],
    aliases: ["caterer", "catering", "event catering", "contract catering"],
    motions: ["DIRECT_B2B", "LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["Event organiser", "Office Manager", "Facilities Manager"],
    profile: P.CONSUMER_LOCAL,
    objections: ["PRICE", "TIMING", "TRUST", "EXISTING_PROVIDER"],
    qualification: ["SERVICE_NEEDED", "TIMING", "VOLUME", "LOCATION", "BUDGET"],
  }),
  archetype({
    key: "EVENTS",
    name: "Events",
    group: "HOSPITALITY_EVENTS",
    sic: ["82.30", "93.19/2"],
    aliases: ["event management", "event planner", "conference organiser", "exhibition organiser", "wedding planner"],
    motions: ["DIRECT_B2B", "HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["Event organiser", "Marketing Manager", "PA / EA"],
    profile: P.CONSUMER_LOCAL,
    objections: ["PRICE", "BUDGET", "TIMING", "TRUST"],
    qualification: ["PROJECT_SCOPE", "TIMING", "VOLUME", "BUDGET"],
  }),

  /* ----------------------------------------------- education & coaching */
  archetype({
    key: "EDUCATION_TRAINING",
    name: "Education / training provider",
    group: "EDUCATION_COACHING",
    sic: ["85.5", "85.32", "85.33", "85.69"],
    aliases: ["training provider", "training company", "online course", "tutor", "tutoring", "corporate training"],
    motions: ["DIRECT_B2B", "HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["L&D Manager", "HR Manager", "The learner"],
    profile: P.DEFAULT_B2B,
    objections: ["PRICE", "TIMING", "TRUST", "TOO_BUSY"],
    qualification: ["USE_CASE", "VOLUME", "TIMING", "BUDGET"],
  }),
  archetype({
    key: "COACHING",
    name: "Coaching",
    group: "EDUCATION_COACHING",
    sic: ["85.59", "70.20/9", "96.99"],
    aliases: ["coach", "business coach", "executive coach", "life coach", "coaching"],
    motions: ["HIGH_TICKET_B2C", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["The client", "HR Director"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "TRUST", "TIMING", "TOO_BUSY"],
  }),

  /* ------------------------------------------------- health & wellbeing */
  archetype({
    key: "HEALTHCARE_CLINIC",
    name: "Private clinic",
    group: "HEALTH_WELLBEING",
    sic: ["86.21", "86.22", "86.93", "86.95"],
    aliases: ["private clinic", "physiotherapy", "physio", "private gp", "therapist", "counselling"],
    motions: ["HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["The patient"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "TRUST", "TIMING"],
  }),
  archetype({
    key: "DENTAL",
    name: "Dental practice",
    group: "HEALTH_WELLBEING",
    sic: ["86.23"],
    aliases: ["dentist", "dental practice", "orthodontist", "dental implants", "invisalign"],
    motions: ["HIGH_TICKET_B2C"],
    deal: "SMALL",
    roles: ["The patient"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "TRUST", "TIMING", "RISK"],
  }),
  archetype({
    key: "AESTHETICS",
    name: "Aesthetics clinic",
    group: "HEALTH_WELLBEING",
    sic: ["96.22", "96.23"],
    aliases: ["aesthetics clinic", "aesthetics", "beauty clinic", "skin clinic", "salon", "spa"],
    motions: ["HIGH_TICKET_B2C", "LOCAL_SERVICE"],
    deal: "SMALL",
    roles: ["The client"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "TRUST", "RISK", "TIMING"],
  }),
  archetype({
    key: "FITNESS",
    name: "Gym / fitness",
    group: "HEALTH_WELLBEING",
    sic: ["93.13", "85.51"],
    aliases: ["gym", "personal trainer", "fitness studio", "pilates studio", "yoga studio"],
    motions: ["LOCAL_SERVICE", "HIGH_TICKET_B2C"],
    deal: "MICRO",
    roles: ["The member"],
    profile: P.CONSUMER_LOCAL,
    objections: CONSUMER_OBJECTIONS,
    qualification: ["USE_CASE", "LOCATION", "TIMING"],
  }),
  archetype({
    key: "CARE_PROVIDER",
    name: "Care provider",
    group: "HEALTH_WELLBEING",
    sic: ["87", "88.10"],
    aliases: ["care home", "home care", "domiciliary care", "care provider", "nursing home"],
    motions: ["HIGH_TICKET_B2C"],
    deal: "MID",
    roles: ["Family member", "Case manager"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "TRUST", "TIMING", "AUTHORITY"],
  }),

  /* -------------------------------------------------------- organisations */
  archetype({
    key: "MEMBERSHIP",
    name: "Membership organisation",
    group: "ORGANISATIONS",
    sic: ["94.11", "94.12", "94.99", "93.12"],
    aliases: ["membership organisation", "trade association", "professional body", "sports club", "members club"],
    motions: ["SAAS_SELF_SERVE", "BOOK_MEETING_B2B"],
    deal: "MICRO",
    roles: ["The member", "Membership secretary"],
    profile: P.ORGANISATION,
    objections: ["PRICE", "NO_NEED", "TIMING"],
  }),
  archetype({
    key: "NONPROFIT",
    name: "Charity / non-profit",
    group: "ORGANISATIONS",
    sic: ["94.99", "88.99"],
    aliases: ["charity", "non-profit", "nonprofit", "social enterprise", "cic"],
    motions: ["BOOK_MEETING_B2B", "SAAS_SELF_SERVE"],
    deal: "MICRO",
    roles: ["Supporter", "Partnerships lead", "Trustee"],
    profile: P.ORGANISATION,
    objections: ["BUDGET", "AUTHORITY", "TIMING"],
  }),

  /* ------------------------------------------------ forms, not activities */
  archetype({
    key: "FREELANCER",
    name: "Freelancer / independent",
    group: "OTHER",
    sic: [],
    aliases: ["freelancer", "freelance", "independent consultant", "contractor"],
    motions: ["DIRECT_B2B", "BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Business owner", "Hiring manager"],
    profile: P.STUDIO,
    objections: ["PRICE", "TRUST", "TIMING", "BUDGET"],
  }),
  archetype({
    key: "FRANCHISE",
    name: "Franchise",
    group: "OTHER",
    sic: [],
    aliases: ["franchise", "franchisor", "franchise opportunity"],
    motions: ["HIGH_TICKET_B2C", "BOOK_MEETING_B2B"],
    deal: "MID",
    roles: ["Prospective franchisee"],
    profile: P.HIGH_TICKET_B2C,
    objections: ["PRICE", "RISK", "TRUST", "TIMING"],
  }),
  archetype({
    key: "OTHER",
    name: "Other",
    group: "OTHER",
    sic: [],
    aliases: [],
    motions: ["BOOK_MEETING_B2B"],
    deal: "SMALL",
    roles: ["Business owner"],
    profile: P.DEFAULT_B2B,
    objections: B2B_OBJECTIONS,
  }),
];

const BY_KEY = new Map(ARCHETYPES.map((entry) => [entry.key, entry]));

export const FALLBACK_ARCHETYPE_KEY = "OTHER";

export function archetypeFor(key: string | null | undefined): Archetype | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * The questions for one archetype running one motion: the archetype's own
 * (worded for it, in its order) followed by any dimension the motion needs that
 * the archetype did not list. That guarantees the motion's decision threshold
 * is always reachable (tested), whichever motion the workspace picked.
 */
export function qualificationPlan(archetype: Archetype, motion: SalesMotion): QualificationDimension[] {
  const own = archetype.qualification;
  const present = new Set(own.map((dimension) => dimension.key));
  const threshold = MOTIONS[motion].decisionThreshold;
  const needed = [
    ...MOTIONS[motion].qualificationDimensions,
    ...threshold.allOf,
    ...threshold.anyOf.slice(0, 1),
  ];
  const extra: QualificationSpec[] = [];
  for (const key of needed) {
    if (!present.has(key)) {
      present.add(key);
      extra.push(key);
    }
  }
  return [...own, ...resolveQualification(extra)];
}

/* ------------------------------------------------ qualification profiles */

type ProfileInput = Omit<QualificationProfile, "archetypeKey" | "disqualifierHints" | "incumbentTerms" | "neverAsk" | "gatingDimensions"> &
  Partial<Pick<QualificationProfile, "disqualifierHints" | "incumbentTerms" | "neverAsk" | "gatingDimensions">>;

function qp(archetypeKey: string, input: ProfileInput): QualificationProfile {
  return {
    archetypeKey,
    neverAsk: [],
    gatingDimensions: [],
    incumbentTerms: [],
    disqualifierHints: [],
    ...input,
  };
}

/**
 * Complete profiles for the supported business types (08 §B.7), B2B first
 * (CLAUDE.md resolved conflict 5): SaaS, MSP and IT, agencies, web and design
 * studios, professional services (accountants first), ecommerce. The roofer
 * profile is kept as the LOCAL_SERVICE reference fixture: service, location,
 * timing and property, and never authority, stakeholders or budget before a
 * quote.
 *
 * Every disqualifier hint is a REVIEW trigger (a person decides), never an
 * automatic disqualification: disqualifying on library defaults would be
 * automated profiling the workspace never chose (design §D3).
 */
export const QUALIFICATION_PROFILES: Record<string, QualificationProfile> = Object.fromEntries(
  [
    // ------------------------------------------------------------ software
    qp("B2B_SAAS", {
      customerType: "B2B",
      pricingModel: "SUBSCRIPTION",
      billing: "RECURRING",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["USE_CASE"],
      gatingDimensions: ["TEAM_SIZE"],
      incumbentTerms: ["tool", "platform", "software", "system", "spreadsheet"],
      targetStaff: { min: 5 },
    }),
    qp("PLG_SAAS", {
      customerType: "B2B",
      pricingModel: "SUBSCRIPTION",
      billing: "RECURRING",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["USE_CASE"],
      neverAsk: ["BUDGET", "STAKEHOLDERS", "DECISION_PROCESS", "AUTHORITY"],
      incumbentTerms: ["tool", "app", "software", "spreadsheet"],
    }),
    qp("ENTERPRISE_SAAS", {
      customerType: "B2B",
      pricingModel: "SUBSCRIPTION",
      billing: "RECURRING",
      cycleComplexity: "COMPLEX",
      requiredDimensions: ["PROBLEM", "STAKEHOLDERS"],
      gatingDimensions: ["COMPANY_SIZE"],
      incumbentTerms: ["vendor", "platform", "system", "incumbent"],
      disqualifierHints: [{ dimension: "COMPANY_SIZE", op: "lt", value: 50, reason: "Below the enterprise size this offer is built for." }],
      targetStaff: { min: 250 },
    }),
    // ------------------------------------------------------------ IT
    qp("MSP", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["COMPANY_SIZE"],
      gatingDimensions: ["COMPANY_SIZE"],
      incumbentTerms: ["it provider", "it support", "it company", "msp", "it guy", "it person", "support company"],
      disqualifierHints: [{ dimension: "COMPANY_SIZE", op: "lt", value: 5, reason: "Fewer staff than managed support is priced for." }],
      targetStaff: { min: 5, max: 250 },
    }),
    qp("IT_CONSULTANCY", {
      customerType: "B2B",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["PROBLEM"],
      incumbentTerms: ["consultant", "it provider", "in-house it", "partner"],
    }),
    qp("CYBERSECURITY", {
      customerType: "B2B",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["PROBLEM"],
      gatingDimensions: ["COMPANY_SIZE"],
      incumbentTerms: ["security provider", "it provider", "msp", "soc"],
    }),
    // ------------------------------------------------------------ agencies
    qp("MARKETING_AGENCY", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["PROBLEM"],
      incumbentTerms: ["agency", "freelancer", "marketer", "in-house", "consultant"],
    }),
    qp("ADVERTISING_AGENCY", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["PROBLEM"],
      incumbentTerms: ["agency", "freelancer", "in-house", "media buyer"],
    }),
    qp("SEO_AGENCY", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["PROBLEM"],
      incumbentTerms: ["seo agency", "agency", "freelancer", "in-house"],
    }),
    qp("CREATIVE_WEB_STUDIO", {
      customerType: "B2B",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["PROJECT_SCOPE"],
      gatingDimensions: ["PROJECT_SCOPE"],
      incumbentTerms: ["web designer", "developer", "agency", "freelancer", "studio"],
    }),
    // --------------------------------------------- professional services
    qp("ACCOUNTING", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["SERVICE_NEEDED"],
      neverAsk: ["STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS"],
      incumbentTerms: ["accountant", "accountants", "bookkeeper", "tax adviser", "tax advisor"],
    }),
    qp("BOOKKEEPING", {
      customerType: "B2B",
      pricingModel: "RETAINER",
      billing: "RECURRING",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["USE_CASE"],
      neverAsk: ["STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS"],
      incumbentTerms: ["bookkeeper", "accountant"],
    }),
    qp("LAW_FIRM", {
      customerType: "BOTH",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "CONSIDERED",
      requiredDimensions: ["USE_CASE"],
      incumbentTerms: ["solicitor", "solicitors", "lawyer", "law firm"],
    }),
    qp("MANAGEMENT_CONSULTING", {
      customerType: "B2B",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "COMPLEX",
      requiredDimensions: ["PROBLEM"],
      incumbentTerms: ["consultant", "consultancy", "adviser", "advisor"],
    }),
    qp("RECRUITMENT", {
      customerType: "B2B",
      pricingModel: "FROM",
      billing: "ONE_OFF",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["HIRING_NEED"],
      incumbentTerms: ["recruiter", "agency", "agencies", "in-house"],
    }),
    // ------------------------------------------------------------ ecommerce
    qp("ECOMMERCE", {
      customerType: "B2C",
      pricingModel: "FIXED",
      billing: "ONE_OFF",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["PRODUCT_INTEREST"],
      neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET", "COMPANY_SIZE"],
      incumbentTerms: ["brand", "shop", "supplier"],
    }),
    qp("SUBSCRIPTION_ECOMMERCE", {
      customerType: "B2C",
      pricingModel: "SUBSCRIPTION",
      billing: "RECURRING",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["PRODUCT_INTEREST"],
      neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET", "COMPANY_SIZE"],
      incumbentTerms: ["subscription", "brand", "box"],
    }),
    // ------------------------------------------------ local service fixture
    qp("ROOFER", {
      customerType: "BOTH",
      pricingModel: "QUOTE",
      billing: "ONE_OFF",
      cycleComplexity: "SIMPLE",
      requiredDimensions: ["SERVICE_NEEDED", "LOCATION"],
      neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET", "COMPANY_SIZE", "TEAM_SIZE"],
      gatingDimensions: ["LOCATION"],
      incumbentTerms: ["roofer", "builder"],
    }),
  ].map((entry) => [entry.archetypeKey, entry]),
);

/** Family defaults by motion, for archetypes without a hand-written profile. */
const MOTION_PROFILE_DEFAULTS: Record<SalesMotion, ProfileInput> = {
  BOOK_MEETING_B2B: { customerType: "B2B", pricingModel: "QUOTE", billing: "RECURRING", cycleComplexity: "CONSIDERED", requiredDimensions: [] },
  DIRECT_B2B: { customerType: "B2B", pricingModel: "QUOTE", billing: "ONE_OFF", cycleComplexity: "SIMPLE", requiredDimensions: [] },
  LOCAL_SERVICE: {
    customerType: "BOTH",
    pricingModel: "QUOTE",
    billing: "ONE_OFF",
    cycleComplexity: "SIMPLE",
    requiredDimensions: [],
    neverAsk: ["AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "BUDGET"],
    gatingDimensions: ["LOCATION"],
  },
  HIGH_TICKET_B2C: { customerType: "B2C", pricingModel: "QUOTE", billing: "ONE_OFF", cycleComplexity: "CONSIDERED", requiredDimensions: [] },
  ECOMMERCE_DIRECT: { customerType: "B2C", pricingModel: "FIXED", billing: "ONE_OFF", cycleComplexity: "SIMPLE", requiredDimensions: [] },
  SAAS_SELF_SERVE: { customerType: "B2B", pricingModel: "SUBSCRIPTION", billing: "RECURRING", cycleComplexity: "SIMPLE", requiredDimensions: [] },
  ENTERPRISE: { customerType: "B2B", pricingModel: "QUOTE", billing: "RECURRING", cycleComplexity: "COMPLEX", requiredDimensions: [] },
};

/**
 * The archetype's qualification profile: its hand-written one, or the family
 * default of its primary motion. Never null: an unknown archetype gets the
 * BOOK_MEETING_B2B default (the ICP's commonest motion).
 */
export function qualificationProfileFor(archetype: Archetype | null): QualificationProfile {
  if (archetype && QUALIFICATION_PROFILES[archetype.key]) return QUALIFICATION_PROFILES[archetype.key];
  const motion = archetype?.defaultMotions[0] ?? "BOOK_MEETING_B2B";
  return qp(archetype?.key ?? FALLBACK_ARCHETYPE_KEY, MOTION_PROFILE_DEFAULTS[motion]);
}
