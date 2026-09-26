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
      "Runs your approved Find Leads search plan on a schedule, using only the sources you allow. Each company is scored against the plan, a work email is found and verified, and the results wait for review unless you choose otherwise.",
    capabilities: [
      "Runs your approved search plan with the sources you allow",
      "Scores every company against the plan",
      "Finds and verifies a work email address",
      "Never collects phone numbers",
      "Results wait for your review unless you allow otherwise",
    ],
    tabs: ALL_TABS,
    accent: "accent",
  },
  BOOKING: {
    type: "BOOKING",
    label: "Booking agent",
    tagline: "Chases qualified leads that have not booked.",
    description:
      "Finds qualified leads that have gone quiet for a day or more without booking. Set to run automatically, it hands them back to your follow-up sequence; otherwise it lists them for you. Offering times and confirming bookings is done by the conversation assistant and your booking link, not by this agent.",
    capabilities: [
      "Finds qualified leads with no booking and no recent contact",
      "Checks each lead can still be contacted before acting",
      "Restarts follow-up, or lists the lead for you to chase",
      "Never sends a message itself: follow-up's own checks apply",
    ],
    tabs: ["overview", "leads", "queue", "campaign", "activity", "settings"],
    accent: "success",
  },
  REENGAGEMENT: {
    type: "REENGAGEMENT",
    label: "Re-engagement agent",
    tagline: "Recovers value from leads that went quiet.",
    description:
      "Finds leads over 60 days old that never replied or booked and drafts a reactivation campaign for them, by email if a mailbox is connected or SMS if Twilio is. You review and launch the draft in Reactivation.",
    capabilities: [
      "Selects quiet older leads with the Reactivation audience rules",
      "Leaves out opted-out, suppressed and recently contacted leads",
      "Drafts one campaign at a time for you to launch",
      "Never launches or sends a campaign itself",
    ],
    tabs: ["overview", "leads", "queue", "campaign", "activity", "settings"],
    accent: "purple",
  },
  COMBINED: {
    type: "COMBINED",
    label: "Combined agent",
    tagline: "Sourcing, booking and re-engagement in one.",
    description:
      "Each run does all three jobs in turn: runs your search plan, chases qualified leads that have not booked, and drafts a re-engagement campaign for quiet leads. One set of limits and one approval setting cover all of it.",
    capabilities: [
      "Everything a sourcing agent does",
      "Everything a booking agent does",
      "Everything a re-engagement agent does",
      "One set of daily and monthly limits",
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
      "Finds businesses by category and area, then reads each company from its own website and Companies House. Google's own listing details (name, address, phone) are not kept, under Google's terms.",
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
    // Not selectable: no sourcing provider implements it yet, and offering a
    // source that searches nothing would be a promise the run cannot keep.
    types: [],
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
    // Not an agent source. These bring leads in on their own once connected,
    // whatever agents exist; a sourcing run never reads them, so an agent
    // cannot be "switched to" them.
    types: [],
    isDiscovery: false,
  },
  LINKEDIN_ADS: {
    key: "LINKEDIN_ADS",
    label: "LinkedIn Lead Gen Forms",
    description:
      "Brings in people who submitted a lead form on your own LinkedIn ads. LinkedIn does not permit searching members for prospecting, so this is inbound only.",
    mechanism: "LinkedIn Marketing API, against your own ad account",
    requires: "Connect LinkedIn Ads in Settings → Connections",
    // Not an agent source. These bring leads in on their own once connected,
    // whatever agents exist; a sourcing run never reads them, so an agent
    // cannot be "switched to" them.
    types: [],
    isDiscovery: false,
  },
  CUSTOMER_IMPORT: {
    key: "CUSTOMER_IMPORT",
    label: "Your own list",
    description:
      "Works through a list you uploaded. Rows are still classified and checked before anything is contacted.",
    mechanism: "CSV or XLSX import",
    requires: null,
    // Not an agent source. These bring leads in on their own once connected,
    // whatever agents exist; a sourcing run never reads them, so an agent
    // cannot be "switched to" them.
    types: [],
    isDiscovery: false,
  },
  CRM_SYNC: {
    key: "CRM_SYNC",
    label: "Connected CRM",
    description: "Reads companies and contacts from the CRM you have connected.",
    mechanism: "Provider API",
    requires: "Connect a CRM in Settings → Connections",
    // Not an agent source. These bring leads in on their own once connected,
    // whatever agents exist; a sourcing run never reads them, so an agent
    // cannot be "switched to" them.
    types: [],
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
    "Every prospect waits for you to approve it in Find Leads, and stalled bookings are listed for you rather than chased. Safest, and slowest.",
  REVIEW_NEW:
    "Prospects at companies already in your workspace go straight to your active acquisition campaign; a company seen for the first time waits for your review. Needs a verified sender and an active campaign, otherwise everything waits for review. Stalled bookings are listed for you.",
  AUTO: "Prospects that match your approved plan go straight to your active acquisition campaign (needs a verified sender and an active campaign), and stalled qualified leads are handed back to follow-up. Every message is still checked before it sends. Re-engagement campaigns are always left as drafts for you to launch.",
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
 * Whether an agent has everything it needs to start.
 *
 * Checked by the start and run-now operations before anything runs, and shown
 * on the agent's Settings tab. Only sourcing needs sources: booking and
 * re-engagement work the leads already in the workspace. The approved search
 * plan is checked separately, against the database, when the agent starts.
 */
export function readinessProblems(agent: {
  agentType: AgentType;
  enabledSources: SourceKey[];
}): string[] {
  const problems: string[] = [];
  const sources = agent.agentType === "SOURCING" || agent.agentType === "COMBINED";
  if (!sources) return problems;

  const usable = agent.enabledSources.filter((key) =>
    SOURCE_DEFINITIONS[key]?.types.includes(agent.agentType),
  );
  if (usable.length === 0) {
    problems.push("No sources are switched on. Choose at least one in the agent's settings.");
  } else if (!usable.some((key) => key === "GOOGLE_PLACES" || key === "DATA_PROVIDER")) {
    problems.push(
      "No source can find new companies. Switch on Google Places or Business contact data.",
    );
  }
  return problems;
}
