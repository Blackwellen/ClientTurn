/**
 * Admin -> Support: the shapes and labels (V4 section 39).
 *
 * Pure - no `server-only`, no Supabase - because the queue view is a client
 * component and must not pull the service-role client into the browser graph.
 */

export const SUPPORT_QUEUES = ["inbox", "open", "waiting", "resolved"] as const;
export type SupportQueue = (typeof SUPPORT_QUEUES)[number];

export const QUEUE_LABELS: Record<SupportQueue, string> = {
  inbox: "Inbox",
  open: "Open",
  waiting: "Waiting",
  resolved: "Resolved",
};

/** Which ticket statuses each queue shows. "Inbox" is everything unresolved. */
export const QUEUE_STATUSES: Record<SupportQueue, string[]> = {
  inbox: ["OPEN", "WAITING_CUSTOMER", "WAITING_INTERNAL"],
  open: ["OPEN"],
  waiting: ["WAITING_CUSTOMER", "WAITING_INTERNAL"],
  resolved: ["RESOLVED", "CLOSED"],
};

export type TicketRow = {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  priority: string;
  category: string;
  source: string;
  businessId: string | null;
  businessName: string | null;
  requesterEmail: string | null;
  assignedAdminId: string | null;
  messageCount: number;
  lastCustomerMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when the customer spoke last, so the queue can show who owes a reply. */
  awaitingUs: boolean;
};

export type TicketDetail = {
  ticket: TicketRow;
  messages: {
    id: string;
    direction: string;
    authorName: string | null;
    body: string;
    channel: string;
    createdAt: string;
  }[];
  notes: {
    id: string;
    body: string;
    isAiDraft: boolean;
    createdAt: string;
  }[];
  /** Context an operator needs before replying, without leaving the page. */
  customer: {
    plan: string | null;
    status: string | null;
    memberCount: number;
    openJobFailures: number;
    integrationProblems: string[];
  } | null;
};

export type SupportData = {
  queue: SupportQueue;
  counts: Record<SupportQueue, number>;
  tickets: TicketRow[];
  detail: TicketDetail | null;
};

export function parseQueue(value: unknown): SupportQueue {
  return typeof value === "string" && SUPPORT_QUEUES.includes(value as SupportQueue)
    ? (value as SupportQueue)
    : "inbox";
}
