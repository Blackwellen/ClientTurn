/**
 * Agents — shared vocabulary.
 *
 * NOT to be confused with `lib/agent` (singular), which is the conversational
 * runtime that answers one lead's messages. This module is the customer-facing
 * Agent: a configured background worker with a type, sources, a schedule and a
 * queue, which a customer switches on and leaves running.
 *
 * Pure — no `server-only`, no Supabase — so client components can import the
 * labels, tones and source catalogue without pulling the service-role client
 * into the browser bundle.
 */

export const AGENT_TYPES = ["SOURCING", "BOOKING", "REENGAGEMENT", "COMBINED"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "STOPPED",
  "NEEDS_ATTENTION",
  "ERROR",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type Autonomy = "REVIEW_ALL" | "REVIEW_NEW" | "AUTO";
export type Cadence = "MANUAL" | "HOURLY" | "DAILY" | "WEEKLY";

export type QueueItemType =
  | "DISCOVER"
  | "ENRICH_EMAIL"
  | "ENRICH_PHONE"
  | "VERIFY"
  | "REVIEW"
  | "PROMOTE"
  | "OUTREACH"
  | "BOOKING"
  | "REENGAGE";

export type QueueStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "DONE"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED"
  | "SKIPPED";

/* -------------------------------------------------------------- agent types */

export type AgentTypeDefinition = {
  type: AgentType;
  label: string;
  /** One line, in the customer's words, not ours. */
  tagline: string;
  description: string;
  /** What this agent is allowed to do, shown on the card and in the wizard. */
  capabilities: string[];
  /** Which detail tabs are meaningful for this type. */
  tabs: AgentTab[];
  accent: "accent" | "info" | "purple" | "success";
};

export type AgentTab =
  | "overview"
  | "leads"
  | "queue"
  | "sources"
  | "campaign"
  | "activity"
  | "settings";

export const ALL_TABS: AgentTab[] = [
  "overview",
  "leads",
  "queue",
  "sources",
  "campaign",
  "activity",
  "settings",
];

export const AGENT_TYPE_DEFINITIONS: Record<AgentType, AgentTypeDefinition> = {
  SOURCING: {
    type: "SOURCING",
    label: "Sourcing agent",
    tagline: "Finds new businesses that fit what you sell.",
    description:
      "Searches the sources you allow, checks each company against your ideal customer profile, finds and verifies a contact, then hands the ones you approve to Leads.",
    capabilities: [
      "Searches permitted sources for matching companies",
      "Scores every company against your ideal customer profile",
      "Finds and verifies a work email address",
      "Optionally looks up a business phone number",
      "Moves approved prospects into Leads",
    ],
    tabs: ALL_TABS,
    accent: "accent",
  },
  BOOKING: {
    type: "BOOKING",
    label: "Booking agent",
    tagline: "Turns replies into appointments.",
    description:
      "Watches for replies on leads that are ready to book, offers the times your calendar actually has, and confirms the appointment without anyone typing it out.",
    capabilities: [
      "Watches qualified leads for booking intent",
      "Offers live availability from your calendar",
      "Confirms and records the appointment",
      "Hands over to a person when the lead asks",
    ],
    tabs: ["overview", "leads", "queue", "campaign", "activity", "settings"],
    accent: "success",
  },
  REENGAGEMENT: {
    type: "REENGAGEMENT",
    label: "Re-engagement agent",
    tagline: "Recovers value from leads that went quiet.",
    description:
      "Works through older leads that never converted, respects every stop condition, and re-opens the ones worth another conversation.",
    capabilities: [
      "Selects eligible older leads on your criteria",
      "Respects opt-outs, suppression and quiet hours",
      "Re-opens conversations that get a reply",
      "Stops the moment someone asks it to",
    ],
    tabs: ["overview", "leads", "queue", "campaign", "activity", "settings"],
    accent: "purple",
  },
  COMBINED: {
    type: "COMBINED",
    label: "Combined agent",
    tagline: "Sourcing, booking and re-engagement in one.",
    description:
      "Runs the whole loop: finds new prospects, converts the ones that reply, books them in, and comes back to the ones that went quiet. One set of limits covers all of it.",
    capabilities: [
      "Everything a sourcing agent does",
      "Everything a booking agent does",
      "Everything a re-engagement agent does",
      "One shared budget and one set of caps",
    ],
    tabs: ALL_TABS,
    accent: "info",
  },
};

export function agentTypeLabel(type: AgentType): string {
  return AGENT_TYPE_DEFINITIONS[type]?.label ?? "Agent";
}

export function tabsForType(type: AgentType): AgentTab[] {
  return AGENT_TYPE_DEFINITIONS[type]?.tabs ?? ALL_TABS;
}

export const TAB_LABELS: Record<AgentTab, string> = {
  overview: "Overview",
  leads: "Leads",
  queue: "Queue",
  sources: "Sources",
  campaign: "Campaign",
  activity: "Activity",
  settings: "Settings",
};

/* ----------------------------------------------------------------- sources */

export type SourceKey =
  | "GOOGLE_PLACES"
  | "GOOGLE_SEARCH"
  | "COMPANY_REGISTRY"
  | "WEBSITE"
  | "META_LEAD_ADS"
  | "LINKEDIN_ADS"
  | "DATA_PROVIDER"
  | "CUSTOMER_IMPORT"
  | "CRM_SYNC";

export type SourceStatus =
  | "AVAILABLE"
  | "REQUIRES_SETUP"
  | "UNAVAILABLE"
  | "ERROR"
  | "RATE_LIMITED";

export type SourceDefinition = {
  key: SourceKey;
  label: string;
  /** What it actually returns, in plain words. */
  description: string;
  /** The official route used. Named so nobody has to guess whether we scrape. */
  mechanism: string;
  /** What the customer must connect or provide before it can run. */
  requires: string | null;
  /** Which agent types can use it. */
  types: AgentType[];
  /** Produces new companies/contacts, rather than reading the customer's own. */
  isDiscovery: boolean;
};

/**
 * The source catalogue.
 *
 * Every entry names an official API, a licensed feed, or the customer's own
 * data. There is deliberately no entry for scraping a social network's search
 * or messaging surface: V4 §113/§114 forbid it, most platforms' terms forbid
 * it, and an adapter that cannot be built lawfully does not get a row here just
 * because it would look good in the UI.
 *
 * In particular: LinkedIn appears only as LINKEDIN_ADS — inbound leads from the
 * workspace's own advertising account. LinkedIn has no API that permits
 * searching members for prospecting, so there is no LinkedIn discovery source.
 */
export const SOURCE_DEFINITIONS: Record<SourceKey, SourceDefinition> = {
  GOOGLE_PLACES: {
    key: "GOOGLE_PLACES",
    label: "Google Places",
    description:
      "Finds local businesses by category and area, with address, website and phone where the listing publishes them.",
    mechanism: "Google Places API",
    requires: null,
    types: ["SOURCING", "COMBINED"],
    isDiscovery: true,
  },
  GOOGLE_SEARCH: {
    key: "GOOGLE_SEARCH",
    label: "Google Search",
    description:
      "Finds company websites matching your industry and location terms, for companies that have no local listing.",
    mechanism: "Google Programmable Search API",
    requires: null,
    types: ["SOURCING", "COMBINED"],
    isDiscovery: true,
  },
  COMPANY_REGISTRY: {
    key: "COMPANY_REGISTRY",
    label: "Company registry",
    description:
      "Confirms a company is real and trading, and adds its registered details and filing history.",
    mechanism: "Companies House and equivalent official registers",
    requires: null,
    types: ["SOURCING", "COMBINED"],
    isDiscovery: false,
  },
  WEBSITE: {
    key: "WEBSITE",
    label: "Company website",
    description:
      "Reads the company's own public site to understand what it does and find a published contact address.",
    mechanism: "Direct fetch, respecting robots.txt and rate limits",
    requires: null,
    types: ["SOURCING", "COMBINED"],
    isDiscovery: false,
  },
  DATA_PROVIDER: {
    key: "DATA_PROVIDER",
    label: "Business contact data",
    description:
      "Licensed B2B data for finding and verifying a named decision maker at a company you have already matched.",
    mechanism: "Licensed data provider",
    requires: null,
    types: ["SOURCING", "COMBINED"],
    isDiscovery: false,
  },
  META_LEAD_ADS: {
    key: "META_LEAD_ADS",
    label: "Meta Lead Ads",
    description:
      "Brings in people who submitted a lead form on your own Facebook or Instagram ads. These are inbound enquiries, not cold prospects.",
    mechanism: "Meta Marketing API, against your own ad account",
    requires: "Connect Meta in Settings → Connections",
    types: ["SOURCING", "COMBINED", "BOOKING"],
    isDiscovery: false,
  },
  LINKEDIN_ADS: {
    key: "LINKEDIN_ADS",
    label: "LinkedIn Lead Gen Forms",
    description:
      "Brings in people who submitted a lead form on your own LinkedIn ads. LinkedIn does not permit searching members for prospecting, so this is inbound only.",
    mechanism: "LinkedIn Marketing API, against your own ad account",
    requires: "Connect LinkedIn Ads in Settings → Connections",
    types: ["SOURCING", "COMBINED", "BOOKING"],
    isDiscovery: false,
  },
  CUSTOMER_IMPORT: {
    key: "CUSTOMER_IMPORT",
    label: "Your own list",
    description:
      "Works through a list you uploaded. Rows are still classified and checked before anything is contacted.",
    mechanism: "CSV or XLSX import",
    requires: null,
    types: ["SOURCING", "REENGAGEMENT", "COMBINED"],
    isDiscovery: false,
  },
  CRM_SYNC: {
    key: "CRM_SYNC",
    label: "Connected CRM",
    description: "Reads companies and contacts from the CRM you have connected.",
    mechanism: "Provider API",
    requires: "Connect a CRM in Settings → Connections",
    types: ["SOURCING", "REENGAGEMENT", "COMBINED"],
    isDiscovery: false,
  },
};

export function sourcesForType(type: AgentType): SourceDefinition[] {
  return Object.values(SOURCE_DEFINITIONS).filter((s) => s.types.includes(type));
}

/* -------------------------------------------------------------------- rows */

export type AgentSourceRow = {
  id: string;
  sourceKey: SourceKey;
  enabled: boolean;
  status: SourceStatus;
  statusDetail: string | null;
  lastRunAt: string | null;
  prospectsFound: number;
  errorMessage: string | null;
};

export type AgentListRow = {
  id: string;
  name: string;
  description: string | null;
  agentType: AgentType;
  status: AgentStatus;
  statusReason: string | null;
  autonomy: Autonomy;
  cadence: Cadence;
  minimumGrade: string;
  enrichEmail: boolean;
  enrichPhone: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  totalProspects: number;
  totalLeads: number;
  totalConversions: number;
  pendingReviewCount: number;
  /** Live counts from `agent_summaries`. */
  queued: number;
  blocked: number;
  failed: number;
  prospects7d: number;
  leads7d: number;
  enabledSources: SourceKey[];
  createdAt: string;
  updatedAt: string;
};

export type AgentQueueRow = {
  id: string;
  itemType: QueueItemType;
  status: QueueStatus;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  priority: number;
  attempts: number;
  blockedReason: string | null;
  errorMessage: string | null;
  scheduledFor: string;
  completedAt: string | null;
  createdAt: string;
};

export type AgentActivityRow = {
  id: string;
  eventType: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  detail: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
};

/* ------------------------------------------------------------ display maps */

const STATUS_LABELS: Record<AgentStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Running",
  PAUSED: "Paused",
  STOPPED: "Stopped",
  NEEDS_ATTENTION: "Needs attention",
  ERROR: "Error",
};

export function agentStatusLabel(status: AgentStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** One mapping for agent status tone, so it cannot drift between the card grid
 *  and the detail header. */
export function agentStatusTone(
  status: AgentStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PAUSED":
      return "accent";
    case "NEEDS_ATTENTION":
      return "warning";
    case "ERROR":
      return "danger";
    default:
      return "neutral";
  }
}

const AUTONOMY_LABELS: Record<Autonomy, string> = {
  REVIEW_ALL: "Review everything",
  REVIEW_NEW: "Review new companies only",
  AUTO: "Run automatically",
};

export function autonomyLabel(value: Autonomy): string {
  return AUTONOMY_LABELS[value] ?? value;
}

const AUTONOMY_DESCRIPTIONS: Record<Autonomy, string> = {
  REVIEW_ALL:
    "Every prospect waits for you to approve it before anything else happens. Safest, and slowest.",
  REVIEW_NEW:
    "You approve the first prospect at a company; others at the same company follow automatically.",
  AUTO: "Prospects that clear your grade and the contact rules proceed without a per-record click.",
};

export function autonomyDescription(value: Autonomy): string {
  return AUTONOMY_DESCRIPTIONS[value] ?? "";
}

const CADENCE_LABELS: Record<Cadence, string> = {
  MANUAL: "Only when I run it",
  HOURLY: "Every hour",
  DAILY: "Once a day",
  WEEKLY: "Once a week",
};

export function cadenceLabel(value: Cadence): string {
  return CADENCE_LABELS[value] ?? value;
}

const QUEUE_TYPE_LABELS: Record<QueueItemType, string> = {
  DISCOVER: "Find companies",
  ENRICH_EMAIL: "Find email",
  ENRICH_PHONE: "Find phone",
  VERIFY: "Verify email",
  REVIEW: "Waiting for review",
  PROMOTE: "Move to Leads",
  OUTREACH: "Send outreach",
  BOOKING: "Book appointment",
  REENGAGE: "Re-engage",
};

export function queueTypeLabel(value: QueueItemType): string {
  return QUEUE_TYPE_LABELS[value] ?? value;
}

export function queueStatusTone(
  status: QueueStatus,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "DONE":
      return "success";
    case "IN_PROGRESS":
      return "accent";
    case "BLOCKED":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

export function severityTone(
  severity: AgentActivityRow["severity"],
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (severity) {
    case "SUCCESS":
      return "success";
    case "WARNING":
      return "warning";
    case "ERROR":
      return "danger";
    default:
      return "neutral";
  }
}

export function sourceStatusTone(
  status: SourceStatus,
): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "AVAILABLE":
      return "success";
    case "REQUIRES_SETUP":
    case "RATE_LIMITED":
      return "warning";
    case "ERROR":
    case "UNAVAILABLE":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Whether an agent has everything it needs to leave DRAFT.
 *
 * Deliberately strict: an agent with no enabled discovery source would run,
 * find nothing, and look broken. Better to refuse to start it and say why.
 */
export function readinessProblems(agent: {
  agentType: AgentType;
  enabledSources: SourceKey[];
  icpProfileId?: string | null;
  conversionGoalId?: string | null;
}): string[] {
  const problems: string[] = [];
  const needsDiscovery = agent.agentType === "SOURCING" || agent.agentType === "COMBINED";

  if (agent.enabledSources.length === 0) {
    problems.push("No sources are switched on.");
  } else if (needsDiscovery) {
    const hasDiscovery = agent.enabledSources.some(
      (key) => SOURCE_DEFINITIONS[key]?.isDiscovery,
    );
    if (!hasDiscovery) {
      problems.push(
        "No source can find new companies. Switch on Google Places or Google Search.",
      );
    }
  }

  if (needsDiscovery && !agent.icpProfileId) {
    problems.push("No ideal customer profile is selected, so nothing can be scored.");
  }

  if (!agent.conversionGoalId) {
    problems.push("No conversion goal is set, so the agent does not know what success looks like.");
  }

  return problems;
}
