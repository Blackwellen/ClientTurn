/**
 * Demo content for the public Find Leads page.
 *
 * Every list here that has a counterpart inside the product is *derived* from
 * the product module rather than retyped, so the marketing page cannot drift
 * away from what the software actually does. Adding a sourcing stage, changing
 * a score weight or renaming a wizard step changes this page automatically —
 * and `tests/find-leads-public-page.test.ts` fails if a hand-written label
 * stops matching its source of truth.
 *
 * The people and companies below are invented. They are interface
 * demonstrations, and the page says so on the surface where they appear.
 */

/* Relative rather than `@/` on purpose: this module is covered by
   `tests/find-leads-public-page.test.ts`, which runs under bare `node --test`
   where the TypeScript path alias does not resolve. Every other unit-tested
   pure module in the repo follows the same rule. */
import { STAGES, type StageStatus } from "../../../lib/find-leads/stages.ts";
import { DEFAULT_WEIGHTS } from "../../../lib/prospects/scoring.ts";
import {
  scoreFactorLabel,
  type Grade,
  type ScoreFactorKey,
} from "../../../lib/prospects/types.ts";
import { WIZARD_STEPS } from "../../../lib/outreach/campaign-draft.ts";

/* ------------------------------------------------------------------- hero */

export const HERO_PROMPT_CHIPS = [
  "Ecommerce brands in Manchester",
  "Shopify stores with 10–200 staff",
  "DTC brands hiring ecommerce roles",
  "SaaS companies after a funding round",
  "Professional services firms in the North West",
  "Multi-brand online retailers",
] as const;

export const HERO_REQUEST =
  "Find ecommerce brands within 40 miles of Manchester with 10–200 staff that may need a Shopify rebuild or site redesign.";

export const HERO_GREETING = "Hi — tell me about the customers you want to find.";

export const HERO_GREETING_SUPPORT =
  "I can turn your description into a structured search plan you can review before sourcing starts.";

export const HERO_REPLY =
  "I've created a draft search plan based on your request. Review the targeting, exclusions and budget before sourcing starts.";

/** The plan summary the hero reply expands into. Mirrors `planSummaryLines`. */
export const HERO_PLAN: { label: string; value: string[] }[] = [
  { label: "Industry", value: ["Ecommerce / online retail"] },
  { label: "Location", value: ["Manchester + 40 mile radius"] },
  { label: "Company", value: ["10–200 employees", "Own online store"] },
  {
    label: "Decision makers",
    value: ["Head of Ecommerce", "Marketing Director", "Founder"],
  },
  { label: "Intent", value: ["Replatforming", "Site redesign", "Ecommerce hiring"] },
  {
    label: "Exclusions",
    value: ["Existing customers", "Competitors", "Suppressed contacts"],
  },
  { label: "Target", value: ["100 verified prospects"] },
  { label: "Review mode", value: ["Human review before outreach"] },
];

export const ACQUISITION_PROFILE: { label: string; value: string[] }[] = [
  { label: "Business type", value: ["Web design & development studio"] },
  {
    label: "Services",
    value: ["Shopify builds", "Site redesigns", "Conversion optimisation"],
  },
  { label: "Locations", value: ["Manchester", "Leeds", "Liverpool"] },
  {
    label: "Target customers",
    value: ["Ecommerce brands", "DTC founders", "Online retailers"],
  },
  { label: "Conversion goal", value: ["Discovery calls and proposals"] },
];

export const PREVIOUS_SEARCHES = [
  {
    title: "Ecommerce brands — Manchester",
    meta: "Draft plan",
    age: "2 days ago",
  },
  {
    title: "DTC founders — North West",
    meta: "Plan reviewed",
    age: "5 days ago",
  },
  { title: "SaaS companies — Leeds", meta: "Draft plan", age: "1 week ago" },
  {
    title: "Professional services — Liverpool",
    meta: "Plan reviewed",
    age: "1 week ago",
  },
  {
    title: "Multi-brand retail — Yorkshire",
    meta: "Draft plan",
    age: "2 weeks ago",
  },
] as const;

export const HERO_STEPS = [
  {
    title: "Describe",
    body: "Tell ClientTurn who you want to reach in plain English.",
  },
  {
    title: "Review plan",
    body: "Check the structured search, targeting and limits.",
  },
  {
    title: "Source",
    body: "Prospects are found from public company sources and checked before use.",
  },
  {
    title: "Review & action",
    body: "Approve the right prospects, then start controlled outreach.",
  },
] as const;

/* -------------------------------------------------------- business learning */

export const ANALYSIS_STEPS = [
  "Reading website",
  "Extracting services",
  "Identifying locations",
  "Understanding target customers",
  "Reviewing proof points",
] as const;

export const LEARNED_PROFILE: { label: string; value: string[] }[] = [
  { label: "Business", value: ["Web design & development studio"] },
  {
    label: "Services",
    value: ["Shopify builds", "Site redesigns", "Conversion optimisation"],
  },
  { label: "Territories", value: ["Manchester", "North West", "Remote UK"] },
  {
    label: "Target customers",
    value: ["Ecommerce brands", "Online retailers"],
  },
  { label: "Conversion goal", value: ["Discovery call / proposal"] },
];

/**
 * The four knowledge sources the Business Profile attributes facts to —
 * `FactSource` minus `AI`, which is an inference route rather than a source a
 * customer can point at.
 */
export const KNOWLEDGE_SOURCES = [
  {
    title: "Website",
    body: "Pages fetched from your own site, respecting robots.txt.",
  },
  {
    title: "Customer-entered information",
    body: "What you tell ClientTurn directly, and can edit at any time.",
  },
  {
    title: "Connected systems",
    body: "Facts read from the tools you have connected yourself.",
  },
  {
    title: "Performance history",
    body: "What your own results have shown about who converts.",
  },
] as const;

/* --------------------------------------------------------------- run stages */

export type DemoStage = {
  number: number;
  title: string;
  description: string;
  status: StageStatus;
  /** Records handled, where the stage reports a count. */
  count: number | null;
  duration: string | null;
};

/**
 * The twelve stages, four of them advanced, taken straight from `STAGES` so
 * the customer-facing vocabulary on this page is the product's own.
 */
export const DEMO_STAGES: DemoStage[] = STAGES.map((stage) => {
  const progress: Record<
    number,
    Pick<DemoStage, "status" | "count" | "duration">
  > = {
    1: { status: "COMPLETED", count: null, duration: "4s" },
    2: { status: "COMPLETED", count: null, duration: "7s" },
    3: { status: "COMPLETED", count: 3240, duration: "24s" },
    4: { status: "RUNNING", count: 1842, duration: "38s" },
  };
  return {
    number: stage.number,
    title: stage.title,
    description: stage.description,
    ...(progress[stage.number] ?? {
      status: "PENDING" as StageStatus,
      count: null,
      duration: null,
    }),
  };
});

/** Stage 3 of 12 terminal, which is the figure `progressPercent` would give. */
export const RUN_PROGRESS_PERCENT = 25;

export const RUN_TILES = [
  { value: "12", label: "Search stages" },
  { value: "3,240", label: "Prospects found" },
  { value: "1,187", label: "Verified contacts" },
  { value: "£12.46", label: "Run budget" },
] as const;

/** Counter labels come from `COUNTER_DEFINITIONS`; the figures are illustrative. */
export const RUN_COUNTERS = {
  companiesFound: 3240,
  contactsFound: 1842,
  emailsDiscovered: 1361,
  verified: 1187,
  duplicates: 214,
  suppressed: 38,
  reviewRequired: 46,
  ready: 889,
} as const;

export const RUN_CONTROLS = ["Pause", "Resume", "Stop"] as const;

/* ------------------------------------------------------------- prospects */

export type DemoProspect = {
  company: string;
  /** Size and sector, shown under the company name. */
  companyMeta: string;
  initials: string;
  contact: string;
  role: string;
  fit: number;
  grade: Grade;
  intent: "High" | "Medium" | "Low" | "None";
  location: string;
  verification: "Verified" | "Pending";
  eligibility: "Eligible" | "Review";
  campaign: string | null;
  outreach: "Ready" | "Not contacted" | "In outreach" | "Replied";
  lastActivity: string;
};

export const DEMO_PROSPECTS: DemoProspect[] = [
  {
    company: "Loomwell Goods",
    companyMeta: "11–50 · DTC homeware",
    initials: "LG",
    contact: "Hannah Carter",
    role: "Head of Ecommerce",
    fit: 92,
    grade: "A",
    intent: "High",
    location: "Manchester",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: "North West ecommerce — Q4",
    outreach: "Ready",
    lastActivity: "Sourced 2 hours ago",
  },
  {
    company: "Parcel & Pine",
    companyMeta: "10–25 · Online retail",
    initials: "PP",
    contact: "Sophie Williams",
    role: "Ecommerce Manager",
    fit: 88,
    grade: "A",
    intent: "Medium",
    location: "Salford",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: "North West ecommerce — Q4",
    outreach: "Ready",
    lastActivity: "Sourced 2 hours ago",
  },
  {
    company: "Tidewater Supply Co.",
    companyMeta: "50–200 · B2B ecommerce",
    initials: "TS",
    contact: "Tom Bradley",
    role: "Director",
    fit: 84,
    grade: "B",
    intent: "Medium",
    location: "Stockport",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: "North West ecommerce — Q4",
    outreach: "In outreach",
    lastActivity: "Email sent 1 day ago",
  },
  {
    company: "Copperleaf Apparel",
    companyMeta: "11–50 · Fashion ecommerce",
    initials: "CA",
    contact: "Rachel King",
    role: "Head of Digital",
    fit: 82,
    grade: "B",
    intent: "Medium",
    location: "Leeds",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: "North West ecommerce — Q4",
    outreach: "Replied",
    lastActivity: "Replied 4 hours ago",
  },
  {
    company: "Hollins & Hart",
    companyMeta: "50–200 · Multi-brand retail",
    initials: "HH",
    contact: "Mark Stevens",
    role: "Digital Director",
    fit: 79,
    grade: "B",
    intent: "High",
    location: "Liverpool",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: null,
    outreach: "Ready",
    lastActivity: "Sourced 4 hours ago",
  },
  {
    company: "Fernway Pet Co.",
    companyMeta: "5–20 · DTC pet supplies",
    initials: "FP",
    contact: "Daniel Brooks",
    role: "Founder",
    fit: 78,
    grade: "B",
    intent: "None",
    location: "Chester",
    verification: "Verified",
    eligibility: "Review",
    campaign: null,
    outreach: "Not contacted",
    lastActivity: "Sourced 3 hours ago",
  },
  {
    company: "Marlow & Finch",
    companyMeta: "10–50 · Homeware brand",
    initials: "MF",
    contact: "James Holloway",
    role: "Marketing Director",
    fit: 76,
    grade: "B",
    intent: "Medium",
    location: "Warrington",
    verification: "Pending",
    eligibility: "Review",
    campaign: null,
    outreach: "Not contacted",
    lastActivity: "Sourced 5 hours ago",
  },
  {
    company: "Brightside Nutrition",
    companyMeta: "5–25 · Health & wellness DTC",
    initials: "BN",
    contact: "Oliver Grant",
    role: "Director",
    fit: 74,
    grade: "B",
    intent: "Low",
    location: "Bolton",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: null,
    outreach: "Ready",
    lastActivity: "Sourced 5 hours ago",
  },
  {
    company: "Kiln & Co.",
    companyMeta: "10–50 · Ceramics ecommerce",
    initials: "KC",
    contact: "Emily Rogers",
    role: "Operations Director",
    fit: 72,
    grade: "B",
    intent: "Medium",
    location: "Preston",
    verification: "Verified",
    eligibility: "Eligible",
    campaign: null,
    outreach: "Ready",
    lastActivity: "Sourced 6 hours ago",
  },
  {
    company: "Northfield Outdoor",
    companyMeta: "11–50 · Outdoor retail",
    initials: "NO",
    contact: "Sophie Allen",
    role: "Office Manager",
    fit: 68,
    grade: "C",
    intent: "Low",
    location: "Sheffield",
    verification: "Verified",
    eligibility: "Review",
    campaign: null,
    outreach: "Not contacted",
    lastActivity: "Sourced 6 hours ago",
  },
];

/** The quick filters the real Prospects toolbar offers (§13). */
export const PROSPECT_FILTERS = [
  { label: "All", count: 1187 },
  { label: "A Grade", count: 412 },
  { label: "Intent", count: 268 },
  { label: "Ready", count: 889 },
  { label: "Contacted", count: 147 },
  { label: "Replied", count: 23 },
  { label: "Review", count: 46 },
] as const;

export const PROSPECT_ACTIONS = [
  "Open prospect",
  "Approve for outreach",
  "Suppress",
  "Promote to lead",
] as const;

/* --------------------------------------------------------------- scoring */

export type DemoFactor = {
  factor: ScoreFactorKey;
  label: string;
  /** Percentage weight, read from `DEFAULT_WEIGHTS`. */
  weightPercent: number;
  /** Points earned out of the factor's own weighted maximum. */
  earned: number;
  max: number;
  sentence: string;
  evidence: string;
  source: string;
  freshness: string;
  confidence: "High" | "Medium" | "Low";
};

const FACTOR_DETAIL: Record<
  ScoreFactorKey,
  {
    share: number;
    sentence: string;
    evidence: string;
    source: string;
    freshness: string;
    confidence: DemoFactor["confidence"];
  }
> = {
  ICP_FIT: {
    share: 0.97,
    sentence: "Matches your target industry, size and services.",
    evidence: "Online retailer, 11–50 employees, own Shopify store",
    source: "Companies House and company website",
    freshness: "6 days",
    confidence: "High",
  },
  ROLE_AUTHORITY: {
    share: 0.9,
    sentence: "Head of Ecommerce — a decision-making role.",
    evidence: "Role title classified as a decision maker",
    source: "Company website team page",
    freshness: "6 days",
    confidence: "High",
  },
  GEOGRAPHY: {
    share: 1,
    sentence: "Inside your target area (Manchester, 3 miles).",
    evidence: "Registered address within the plan's radius",
    source: "Plan location resolver",
    freshness: "Today",
    confidence: "High",
  },
  NEED: {
    share: 0.93,
    sentence: "Recent activity suggests a site rebuild is being planned.",
    evidence: "Job posting for a Shopify developer",
    source: "Public job listing",
    freshness: "2 days",
    confidence: "High",
  },
  INTENT: {
    share: 0.7,
    sentence: "One live signal inside its freshness window.",
    evidence: "New job posting — Shopify developer, Manchester",
    source: "Permitted public job source",
    freshness: "2 days",
    confidence: "High",
  },
  DATA_QUALITY: {
    share: 0.9,
    sentence: "Verified work email, recently re-checked.",
    evidence: "Deliverability check passed above the configured threshold",
    source: "Verification provider",
    freshness: "3 days",
    confidence: "High",
  },
};

/**
 * Six factors, each shown against its real weight. The points are computed
 * from the weights rather than typed in, so the column always adds up and the
 * headline score is arithmetic rather than decoration.
 */
export const DEMO_FACTORS: DemoFactor[] = (
  Object.keys(DEFAULT_WEIGHTS) as ScoreFactorKey[]
).map((factor) => {
  const detail = FACTOR_DETAIL[factor];
  const max = Math.round(DEFAULT_WEIGHTS[factor] * 100);
  return {
    factor,
    label: scoreFactorLabel(factor),
    weightPercent: max,
    max,
    earned: Math.round(max * detail.share),
    sentence: detail.sentence,
    evidence: detail.evidence,
    source: detail.source,
    freshness: detail.freshness,
    confidence: detail.confidence,
  };
});

export const DEMO_SCORE = DEMO_FACTORS.reduce((total, f) => total + f.earned, 0);

export const SCORE_SUBJECT = {
  company: "Loomwell Goods",
  initials: "LG",
  meta: "11–50 employees · DTC homeware",
  location: "Manchester, UK",
  contact: "Hannah Carter",
  role: "Head of Ecommerce",
} as const;

export const SCORE_POSITIVES = [
  "Target industry match",
  "Decision-making role",
  "Inside target area",
  "Verified work email",
  "Recent replatforming signal",
] as const;

export const SCORE_CONCERNS = [
  "Company size slightly below your preferred range",
] as const;

export const EVIDENCE_ROWS = [
  { label: "Company website", value: "loomwellgoods.example" },
  { label: "Job posting", value: "Shopify developer · 2 days ago" },
  { label: "Tech stack", value: "Shopify · detected on site" },
  { label: "Data last verified", value: "3 days ago" },
] as const;

/* ---------------------------------------------------------------- intent */

export const INTENT_EVENTS = [
  {
    title: "Ecommerce role advertised",
    detail: "Shopify developer, DTC homeware brand, Manchester",
    strength: "High" as const,
    age: "2 hours ago",
  },
  {
    title: "New Head of Digital appointed",
    detail: "Leadership change at a multi-brand retailer",
    strength: "High" as const,
    age: "1 day ago",
  },
  {
    title: "Company expansion announcement",
    detail: "Second brand launched online",
    strength: "Medium" as const,
    age: "2 days ago",
  },
  {
    title: "Website engagement",
    detail: "Two visits to your Shopify rebuild page",
    strength: "Medium" as const,
    age: "3 days ago",
  },
  {
    title: "Funding round announced",
    detail: "Growth investment into a DTC brand",
    strength: "Medium" as const,
    age: "3 days ago",
  },
] as const;

export const INTENT_FILTERS = [
  { label: "All signals", count: 42 },
  { label: "High intent", count: 12 },
  { label: "New this week", count: 18 },
  { label: "Saved", count: 6 },
] as const;

/* -------------------------------------------------------------- campaigns */

/**
 * A one-line version of each conversion goal.
 *
 * The wizard's own `description` is written for a full-width form and
 * runs to eight lines in a third-width card. The value is the same
 * promise, said shorter; the label itself still comes from the product.
 */
export const GOAL_BLURBS: Record<string, string> = {
  BOOK_APPOINTMENT: "Get a discovery call in the diary.",
  REQUEST_QUOTE: "Invite a prospect to ask for a proposal.",
  PHONE_CALL: "Get a call booked with the decision maker.",
};

/** The six wizard steps, read from the wizard's own definition. */
export const CAMPAIGN_STEPS = WIZARD_STEPS.map((step, index) => ({
  number: index + 1,
  label: step.label,
  description: step.description,
}));

export const CAMPAIGN_SEQUENCE = [
  {
    day: "Day 0",
    channel: "Email",
    subject: "Your store rebuild",
  },
  { day: "Day 3", channel: "Email", subject: "A quick question" },
  {
    day: "Day 7",
    channel: "Email",
    subject: "Two recent Shopify rebuilds",
  },
  { day: "Day 14", channel: "Email", subject: "Final follow up" },
] as const;

export const CAMPAIGN_LIMITS = [
  { label: "Prospects per run", value: "100" },
  { label: "Daily contacts", value: "40" },
  { label: "Monthly contacts", value: "800" },
  { label: "Communication allowance", value: "Within your plan" },
  { label: "At the allowance", value: "Stops, no overage" },
  { label: "Auto Optimize", value: "On" },
  { label: "Review mode", value: "Human review" },
] as const;

export const CAMPAIGN_CHECKS = [
  "Sender health checked",
  "Suppression checked",
  "Contactability checked",
  "Campaign limits checked",
  "Provider availability checked",
] as const;

/* -------------------------------------------------------------- promotion */

export const PROMOTION_CONVERSATION = [
  {
    author: "You",
    initials: "CT",
    when: "Tue 14 Oct, 10:24",
    body: "Hi Hannah — I saw Loomwell is hiring a Shopify developer and wanted to introduce our studio. We rebuild Shopify stores for homeware brands.",
    outbound: true,
  },
  {
    author: "Hannah Carter",
    initials: "LG",
    when: "Tue 14 Oct, 11:03",
    body: "Good timing, we're weighing up a rebuild before peak season. Could you send some examples?",
    outbound: false,
  },
  {
    author: "You",
    initials: "CT",
    when: "Tue 14 Oct, 11:15",
    body: "Of course. I've attached two recent Shopify rebuilds — would a 30-minute call next week suit?",
    outbound: true,
  },
] as const;

export const LEAD_READY_ACTIONS = ["Qualify", "Follow-Up", "Book"] as const;

/* -------------------------------------------------------------- analytics */

export const FUNNEL_STEPS = [
  { label: "Found", value: 3240 },
  { label: "Verified", value: 1187 },
  { label: "Contacted", value: 820 },
  { label: "Replied", value: 96 },
  { label: "Leads", value: 61 },
  { label: "Qualified", value: 38 },
  { label: "Converted", value: 14 },
] as const;

export const ANALYTICS_METRICS = [
  { label: "Sourcing runs", value: "18" },
  { label: "Prospects found", value: "3,240" },
  { label: "Verified prospects", value: "1,187" },
  { label: "Cost per verified prospect", value: "£0.19" },
  { label: "A / B grade share", value: "62%" },
  { label: "Intent matches", value: "268" },
  { label: "Replies", value: "96" },
  { label: "Prospect → Lead", value: "61" },
] as const;

export const PROVIDER_ROWS = [
  { label: "Company discovery", detail: "Business listings and Companies House", share: 46 },
  { label: "Contact discovery", detail: "Company websites", share: 27 },
  { label: "Email origin", detail: "Recorded for every address", share: 18 },
  { label: "Intent signals", detail: "Permitted public sources", share: 9 },
] as const;

/* ----------------------------------------------------------- integrations */

/**
 * Integration reach, classified honestly. Everything below is reachable only
 * through the app/webhook connector today — labelling any of it as native
 * two-way sync would be a claim the product cannot keep.
 */
export const INTEGRATION_ROWS = [
  "Zapier",
  "Webhooks",
  "Pipedrive",
] as const;

/* ------------------------------------------------------------ final flow */

export const CLOSING_FLOW = [
  "Describe",
  "Search",
  "Verify",
  "Engage",
  "Lead",
] as const;
