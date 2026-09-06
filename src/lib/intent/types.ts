/**
 * Buying-intent categories, monitors and signals (V4 §15, §62).
 *
 * Pure — no `server-only`, no Supabase — so the labels, the signal-source
 * catalogue and the bounds can be used by client components directly.
 *
 * The two rules this module exists to hold:
 *
 *   1. **Intent is bounded.** A category's score contribution is capped, and
 *      the whole intent boost is capped again in `prospects/scoring.ts`. A
 *      fresh signal can lift a good-fit prospect over a threshold; it can never
 *      carry a poor-fit one there on its own.
 *   2. **Intent expires.** A signal only counts while it is inside its category's
 *      freshness window. Nothing here treats an old signal as current.
 */

export type SignalSourceKey =
  | "COMPANY_WEBSITE"
  | "COMPANY_REGISTRY"
  | "TENDER_NOTICE"
  | "PLANNING_DATA"
  | "NEWS_FEED"
  | "JOB_POSTING"
  | "FIRST_PARTY_WEB"
  | "CRM_ACTIVITY"
  | "EMAIL_REPLY"
  | "CUSTOMER_DATASET";

export type SignalSourceDefinition = {
  key: SignalSourceKey;
  label: string;
  description: string;
  /** The official route used, so nobody has to guess whether we scrape. */
  mechanism: string;
  /** True when it needs something connected before it can run. */
  requiresConnection: boolean;
};

/**
 * The permitted signal sources (§15.5).
 *
 * Every entry is an official feed, a public register, or the customer's own
 * data. There is deliberately no "general web crawl": §15.5 requires sources
 * whose terms permit the intended use, and provenance we can record.
 */
export const SIGNAL_SOURCES: Record<SignalSourceKey, SignalSourceDefinition> = {
  COMPANY_WEBSITE: {
    key: "COMPANY_WEBSITE",
    label: "Company website",
    description: "Changes on the company's own site — new services, new locations, new pages.",
    mechanism: "Direct fetch, respecting robots.txt",
    requiresConnection: false,
  },
  COMPANY_REGISTRY: {
    key: "COMPANY_REGISTRY",
    label: "Company registry",
    description: "Filings, incorporations and officer changes from official registers.",
    mechanism: "Companies House and equivalents",
    requiresConnection: false,
  },
  TENDER_NOTICE: {
    key: "TENDER_NOTICE",
    label: "Tenders and procurement",
    description: "Published contract notices that indicate an active buying process.",
    mechanism: "Public procurement notice feeds",
    requiresConnection: false,
  },
  PLANNING_DATA: {
    key: "PLANNING_DATA",
    label: "Planning applications",
    description: "Public planning and building-control records suggesting a project is starting.",
    mechanism: "Local authority open data",
    requiresConnection: false,
  },
  NEWS_FEED: {
    key: "NEWS_FEED",
    label: "News",
    description: "Funding, expansion, acquisition and leadership announcements.",
    mechanism: "Licensed news and search feeds",
    requiresConnection: false,
  },
  JOB_POSTING: {
    key: "JOB_POSTING",
    label: "Job postings",
    description: "Hiring that implies growth or a new capability being built.",
    mechanism: "Feeds whose terms permit this use",
    requiresConnection: false,
  },
  FIRST_PARTY_WEB: {
    key: "FIRST_PARTY_WEB",
    label: "Your own website",
    description: "Visits and form activity on your site — the strongest signal you can get.",
    mechanism: "Your ClientTurn tracking snippet",
    requiresConnection: true,
  },
  CRM_ACTIVITY: {
    key: "CRM_ACTIVITY",
    label: "Connected CRM",
    description: "Activity recorded against a company in the CRM you have connected.",
    mechanism: "Provider API",
    requiresConnection: true,
  },
  EMAIL_REPLY: {
    key: "EMAIL_REPLY",
    label: "Conversation intent",
    description: "Interest expressed in a reply to one of your own messages.",
    mechanism: "Your connected mailbox",
    requiresConnection: true,
  },
  CUSTOMER_DATASET: {
    key: "CUSTOMER_DATASET",
    label: "Your own dataset",
    description: "A list of companies you have identified yourself.",
    mechanism: "Upload",
    requiresConnection: false,
  },
};

/** Starting points offered in the category builder (§15.3). */
export const CATEGORY_TEMPLATES: {
  name: string;
  description: string;
  signalTypes: SignalSourceKey[];
  freshnessDays: number;
  scoreImpact: number;
}[] = [
  {
    name: "Expansion or new location",
    description: "The company is opening somewhere new or growing its footprint.",
    signalTypes: ["NEWS_FEED", "COMPANY_REGISTRY", "COMPANY_WEBSITE"],
    freshnessDays: 90,
    scoreImpact: 10,
  },
  {
    name: "Tender or procurement",
    description: "An active buying process is under way.",
    signalTypes: ["TENDER_NOTICE"],
    freshnessDays: 60,
    scoreImpact: 15,
  },
  {
    name: "New construction or renovation",
    description: "A building project that needs the kind of work you do.",
    signalTypes: ["PLANNING_DATA", "NEWS_FEED"],
    freshnessDays: 120,
    scoreImpact: 12,
  },
  {
    name: "Hiring for a related role",
    description: "Recruitment that implies the need you solve.",
    signalTypes: ["JOB_POSTING"],
    freshnessDays: 45,
    scoreImpact: 8,
  },
  {
    name: "Visited your website",
    description: "Someone from the company looked at your site.",
    signalTypes: ["FIRST_PARTY_WEB"],
    freshnessDays: 30,
    scoreImpact: 15,
  },
  {
    name: "New funding",
    description: "The company has money to spend and is likely to be buying.",
    signalTypes: ["NEWS_FEED", "COMPANY_REGISTRY"],
    freshnessDays: 180,
    scoreImpact: 12,
  },
];

/* -------------------------------------------------------------------- rows */

export type IntentCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  signalTypes: SignalSourceKey[];
  freshnessDays: number;
  scoreImpact: number;
  autoAddToSearch: boolean;
  active: boolean;
  /** Live signals inside the freshness window. */
  liveSignals: number;
  matchedProspects: number;
  monitorCount: number;
  createdAt: string;
};

export type IntentMonitorRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string | null;
  monitorType: "ICP" | "NAMED_COMPANIES" | "FIRST_PARTY";
  cadence: "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
  status: "ACTIVE" | "PAUSED" | "STOPPED" | "PLAN_LIMITED";
  targetCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  eventsLastPeriod: number;
};

export type IntentEventRow = {
  id: string;
  categoryName: string;
  signalType: string;
  source: string;
  sourceUrl: string | null;
  companyName: string | null;
  prospectId: string | null;
  observedAt: string;
  expiresAt: string;
  expired: boolean;
  confidence: number;
  evidenceSummary: string | null;
};

export type IntentOverview = {
  activeCategories: number;
  activeMonitors: number;
  liveSignals: number;
  prospectsWithIntent: number;
  signalsLast7Days: number;
  monitorLimit: number;
  monitorsUsed: number;
};

/* ------------------------------------------------------------------ bounds */

/** §15.4 — a single category cannot dominate the canonical score. */
export const MAX_SCORE_IMPACT = 25;
export const MIN_FRESHNESS_DAYS = 1;
export const MAX_FRESHNESS_DAYS = 730;

export function clampScoreImpact(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_SCORE_IMPACT, Math.round(value)));
}

export function clampFreshness(value: number): number {
  if (!Number.isFinite(value)) return 90;
  return Math.max(MIN_FRESHNESS_DAYS, Math.min(MAX_FRESHNESS_DAYS, Math.round(value)));
}

/* ------------------------------------------------------------ display maps */

const CADENCE_LABELS: Record<IntentMonitorRow["cadence"], string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  FORTNIGHTLY: "Every fortnight",
  MONTHLY: "Every month",
};

export function cadenceLabel(value: IntentMonitorRow["cadence"]): string {
  return CADENCE_LABELS[value] ?? value;
}

const MONITOR_TYPE_LABELS: Record<IntentMonitorRow["monitorType"], string> = {
  ICP: "Everyone matching an ICP",
  NAMED_COMPANIES: "A named list of companies",
  FIRST_PARTY: "Visitors to your own site",
};

export function monitorTypeLabel(value: IntentMonitorRow["monitorType"]): string {
  return MONITOR_TYPE_LABELS[value] ?? value;
}

export function monitorStatusTone(
  status: IntentMonitorRow["status"],
): "success" | "accent" | "warning" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "accent";
  if (status === "PLAN_LIMITED") return "warning";
  return "neutral";
}

export function signalSourceLabel(key: string): string {
  return SIGNAL_SOURCES[key as SignalSourceKey]?.label ?? key.replace(/_/g, " ").toLowerCase();
}

/** How much of its freshness window a signal has left, 0-100. */
export function freshnessPercent(observedAt: string, expiresAt: string, now = new Date()): number {
  const start = new Date(observedAt).getTime();
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const remaining = end - now.getTime();
  return Math.max(0, Math.min(100, Math.round((remaining / (end - start)) * 100)));
}

/**
 * Everything the Intent tab renders.
 *
 * Lives here rather than beside its loader so a client component can import it
 * without pulling `server-only` into the browser graph — the same boundary
 * `lib/prospects` keeps between `types.ts` and `queries.ts`.
 */
export type IntentViewData = {
  overview: IntentOverview;
  categories: IntentCategoryRow[];
  monitors: IntentMonitorRow[];
  events: IntentEventRow[];
  icpProfiles: { id: string; name: string }[];
};
