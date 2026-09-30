/**
 * System check shapes, the fix-link table and display helpers. No imports at
 * all, so client components (Admin -> Customers' support drawer) can render a
 * report without pulling the rules' dependencies into the browser bundle.
 */

/* ------------------------------------------------------------------ types */

/**
 * READY: working. ATTENTION: something is stopping it, with the fix linked.
 * OFF: off by the workspace's own choice (or plan), which is not a fault.
 * UNKNOWN: the read failed, so we say so rather than guess.
 */
export const CHECK_STATUSES = ["READY", "ATTENTION", "OFF", "UNKNOWN"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export type CheckFix = { href: string; label: string };

export type CheckRow = {
  id: string;
  label: string;
  status: CheckStatus;
  /** One plain-English sentence or two: what is true and what it means. */
  reason: string;
  fix: CheckFix | null;
};

export const ENGINE_IDS = [
  "ai",
  "messaging",
  "voice",
  "booking",
  "sources",
  "find_leads",
  "agents",
  "payments",
  "billing",
  "worker",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_TITLES: Readonly<Record<EngineId, string>> = {
  ai: "AI assistant",
  messaging: "Text replies and follow-up",
  voice: "AI voice calls",
  booking: "Booking",
  sources: "Lead sources",
  find_leads: "Find Leads",
  agents: "Agents",
  payments: "Quotes and payments",
  billing: "Plan and limits",
  worker: "Background processing",
};

export type EngineReport = {
  id: EngineId;
  title: string;
  status: CheckStatus;
  rows: CheckRow[];
};

export type SystemCheckReport = {
  generatedAt: string;
  /** The workspace's timezone: every time in the report reads in it. */
  timezone: string;
  engines: EngineReport[];
  counts: Record<CheckStatus, number>;
};

/* ------------------------------------------------------------ fix targets */

/**
 * Every link the check offers, in one place, so a moved setting is fixed once.
 * Each points at the exact card (an `id` on it) or voice panel.
 */
export const FIX = {
  aiAssistant: { href: "/app/settings?section=workspace#ai-assistant", label: "Open AI assistant settings" },
  aiPermissions: { href: "/app/settings?section=ai-selling#ai-permissions", label: "Open What the AI may do" },
  messaging: { href: "/app/settings?section=workspace#messaging", label: "Open messaging settings" },
  booking: { href: "/app/settings?section=workspace#booking", label: "Open booking settings" },
  connections: { href: "/app/settings?section=connections", label: "Open Connections" },
  mailbox: { href: "/app/settings?section=connections#mailbox", label: "Open mailbox settings" },
  sendingDomains: { href: "/app/settings?section=connections#sending-domains", label: "Open sending domain health" },
  payments: { href: "/app/settings?section=connections#payments", label: "Open payment webhooks" },
  quotes: { href: "/app/settings?section=quotes", label: "Open Quotes & invoices" },
  paymentReview: { href: "/app/settings?section=quotes#payment-review", label: "Review payments" },
  developer: { href: "/app/settings?section=developer", label: "Open Developer settings" },
  billing: { href: "/app/settings?section=billing", label: "Open Billing & Usage" },
  limits: { href: "/app/settings?section=billing#usage-limits", label: "Open usage and limits" },
  credits: { href: "/app/settings?section=billing#message-credits", label: "Top up message credit" },
  voiceOverview: { href: "/app/settings?section=voice&panel=overview", label: "Open voice settings" },
  voiceIdentity: { href: "/app/settings?section=voice&panel=identity", label: "Complete business identity" },
  voiceNumber: { href: "/app/settings?section=voice&panel=number", label: "Open number set-up" },
  voiceHours: { href: "/app/settings?section=voice&panel=hours", label: "Open calling hours" },
  voiceBudget: { href: "/app/settings?section=voice&panel=budget", label: "Add voice minutes" },
  findLeads: { href: "/app/find-leads", label: "Open Find Leads" },
  agents: { href: "/app/agents", label: "Open Agents" },
  followUp: { href: "/app/follow-up", label: "Open Follow-Up" },
  help: { href: "/app/help", label: "Contact support" },
} as const satisfies Record<string, CheckFix>;

export const SYSTEM_CHECK_HREF = "/app/settings?section=system-check";

/** "Tue 29 Sep, 14:05" in the workspace's own timezone. */
export function formatWhen(iso: string | Date, timezone: string): string {
  const at = typeof iso === "string" ? new Date(iso) : iso;
  if (!Number.isFinite(at.getTime())) return "an unknown time";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 16).replace("T", " ");
  }
}

