/**
 * Business Profile — what ClientTurn believes about the customer's own business
 * (V4 §26, §54).
 *
 * Pure — no `server-only`, no Supabase — so client components can use the
 * labels and helpers directly.
 *
 * The principle this surface exists to serve: **no hidden memory.** Everything
 * the product has concluded about a business is visible here, attributed to
 * where it came from, and editable. A fact the customer has verified or locked
 * can never be silently overwritten by an inference (§54.2).
 */

export type FactSource = "USER" | "WEBSITE" | "INTEGRATION" | "PERFORMANCE" | "AI";

export type MemoryFactRow = {
  id: string;
  factKey: string;
  value: unknown;
  sourceType: FactSource;
  confidence: number;
  verifiedByUser: boolean;
  locked: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
};

export type KnowledgeSourceRow = {
  id: string;
  sourceType: "WEBSITE_PAGE" | "DOCUMENT" | "INTEGRATION" | "MANUAL_NOTE";
  label: string;
  url: string | null;
  status: "PENDING" | "FETCHING" | "READY" | "FAILED" | "EXCLUDED";
  extractSummary: string | null;
  errorMessage: string | null;
  fetchedAt: string | null;
};

export type IcpProfileRow = {
  id: string;
  name: string;
  description: string | null;
  industries: string[];
  locations: string[];
  roles: string[];
  companyFilters: { employeeMin?: number; employeeMax?: number };
  source: "USER" | "AI_PROPOSED" | "PERFORMANCE";
  active: boolean;
  /** Prospects currently attributed to this profile. */
  prospectCount: number;
};

export type ConversionGoalRow = {
  id: string;
  name: string;
  type: ConversionGoalType;
  destinationType: string;
  qualificationRequired: boolean;
  isDefault: boolean;
  active: boolean;
};

export const CONVERSION_GOAL_TYPES = [
  "BOOK_APPOINTMENT",
  "BOOK_SITE_VISIT",
  "BOOK_DEMO",
  "REQUEST_QUOTE",
  "PHONE_CALL",
  "DIRECT_SIGNUP",
  "DIRECT_PURCHASE",
  "HUMAN_HANDOVER",
  "CUSTOM",
] as const;

export type ConversionGoalType = (typeof CONVERSION_GOAL_TYPES)[number];

const GOAL_LABELS: Record<ConversionGoalType, string> = {
  BOOK_APPOINTMENT: "Book an appointment",
  BOOK_SITE_VISIT: "Book a site visit",
  BOOK_DEMO: "Book a demo",
  REQUEST_QUOTE: "Request a quote",
  PHONE_CALL: "Get a phone call",
  DIRECT_SIGNUP: "Sign up",
  DIRECT_PURCHASE: "Buy",
  HUMAN_HANDOVER: "Hand over to a person",
  CUSTOM: "Something else",
};

export function goalLabel(type: ConversionGoalType): string {
  return GOAL_LABELS[type] ?? type;
}

export type BusinessProfileData = {
  profile: {
    websiteUrl: string | null;
    businessType: string | null;
    salesModel: string | null;
    summary: string | null;
    analysisStatus: string;
    pagesAnalysed: number;
    lastAnalysedAt: string | null;
  } | null;
  facts: MemoryFactRow[];
  knowledgeSources: KnowledgeSourceRow[];
  icpProfiles: IcpProfileRow[];
  conversionGoals: ConversionGoalRow[];
  learnings: {
    id: string;
    learningType: string;
    title: string;
    detail: string | null;
    sampleSize: number;
    confidence: number;
    createdAt: string;
  }[];
};

/* ------------------------------------------------------------ display maps */

const SOURCE_LABELS: Record<FactSource, string> = {
  USER: "You told us",
  WEBSITE: "From your website",
  INTEGRATION: "From a connection",
  PERFORMANCE: "Learned from results",
  AI: "Inferred",
};

export function factSourceLabel(source: FactSource): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * A fact the customer stated outranks one we inferred, and the badge says so.
 * "Inferred" is amber deliberately — it is the one a person should check.
 */
export function factSourceTone(
  source: FactSource,
): "success" | "accent" | "warning" | "neutral" {
  if (source === "USER") return "success";
  if (source === "WEBSITE" || source === "INTEGRATION") return "accent";
  if (source === "AI") return "warning";
  return "neutral";
}

/** Turns `services.primary` into "Services · primary" for display. */
export function factKeyLabel(key: string): string {
  return key
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" · ");
}

/** Renders a jsonb fact value as something a person can read. */
export function formatFactValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => formatFactValue(v)).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return formatFactValue(record.value);
    return Object.entries(record)
      .map(([k, v]) => `${k}: ${formatFactValue(v)}`)
      .join(", ");
  }
  return String(value);
}

const ANALYSIS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not analysed yet",
  QUEUED: "Queued",
  RUNNING: "Reading your website…",
  READY: "Up to date",
  PARTIAL: "Partly analysed",
  FAILED: "Analysis failed",
};

export function analysisStatusLabel(status: string): string {
  return ANALYSIS_LABELS[status] ?? status;
}
