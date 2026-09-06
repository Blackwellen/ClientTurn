/**
 * Support shapes and pure helpers (V4 §23).
 *
 * No `server-only` and no Supabase import, so the popout can use these
 * directly. Server reads and writes live in `service.ts` and `actions.ts`.
 */

import { z } from "zod";

/* -------------------------------------------------------------- categories */

export const TICKET_CATEGORIES = [
  { value: "BILLING", label: "Billing" },
  { value: "INTEGRATION", label: "Integration" },
  { value: "LEAD_MESSAGE", label: "Lead/Message" },
  { value: "SOURCING", label: "Sourcing" },
  { value: "ACCOUNT", label: "Account" },
  { value: "OTHER", label: "Other" },
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = TICKET_CATEGORIES.map((c) => c.value) as [
  TicketCategory,
  ...TicketCategory[],
];

export function categoryLabel(value: string): string {
  return TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}

/* ------------------------------------------------------------------ status */

/**
 * The customer-facing status vocabulary.
 *
 * The database stores `WAITING_CUSTOMER` / `WAITING_INTERNAL`; §23.5 asks for
 * `WAITING_ON_CUSTOMER` / `WAITING_ON_SUPPORT`. Rather than migrate a live
 * check constraint, the mapping lives here — one place, both directions.
 */
export const TICKET_STATUS_META: Record<
  string,
  { label: string; tone: "info" | "warning" | "success" | "neutral" }
> = {
  OPEN: { label: "Open", tone: "info" },
  WAITING_INTERNAL: { label: "Waiting on support", tone: "info" },
  WAITING_CUSTOMER: { label: "Waiting on you", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export function statusLabel(value: string): string {
  return TICKET_STATUS_META[value]?.label ?? "Open";
}

export function statusTone(value: string) {
  return TICKET_STATUS_META[value]?.tone ?? "neutral";
}

/** A ticket the customer still has to answer is the one worth surfacing. */
export function awaitsCustomer(status: string): boolean {
  return status === "WAITING_CUSTOMER";
}

/* ------------------------------------------------------------ attachments */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "text/x-log",
] as const;

export const ATTACHMENT_HINT = "Max 10MB per file. Allowed types: PNG, JPG, PDF, TXT, CSV, LOG";

/**
 * Extension is checked as well as MIME type: a browser reports `text/plain`
 * for a `.log` and `application/octet-stream` for plenty of harmless files,
 * so neither signal alone is sufficient.
 */
const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "pdf", "txt", "csv", "log"];

export function attachmentError(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return "That file is larger than 10MB.";
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return "That file type is not supported. Use PNG, JPG, PDF, TXT, CSV or LOG.";
  }
  if (
    file.type &&
    !(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type) &&
    file.type !== "application/octet-stream"
  ) {
    return "That file type is not supported. Use PNG, JPG, PDF, TXT, CSV or LOG.";
  }
  return null;
}

/* --------------------------------------------------------------- context */

/**
 * The diagnostic context a customer may choose to attach (V4 §23.9).
 *
 * The allow-list is the security boundary. Only these keys are ever collected,
 * they are all non-identifying operational facts, and there is no field for
 * message bodies, tokens, credentials or provider responses — so no future
 * caller can widen it by passing extra keys.
 */
export const supportContextSchema = z
  .object({
    /** The route the ticket was raised from, path only — never the query. */
    route: z.string().trim().max(200).optional(),
    appVersion: z.string().trim().max(60).optional(),
    /** Browser and platform, as reported. Not a fingerprint. */
    userAgent: z.string().trim().max(300).optional(),
    viewport: z.string().trim().max(30).optional(),
    timezone: z.string().trim().max(60).optional(),
    /** Correlation id so support can find the matching server-side trace. */
    correlationId: z.string().trim().max(64).optional(),
  })
  .strict();

export type SupportContext = z.infer<typeof supportContextSchema>;

/** Collected in the browser, from the browser. Nothing is read from storage. */
export function collectContext(route: string): SupportContext {
  const path = route.split("?")[0].slice(0, 200);
  return {
    route: path,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? undefined,
    userAgent:
      typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 300),
    viewport:
      typeof window === "undefined"
        ? undefined
        : `${window.innerWidth}x${window.innerHeight}`,
    timezone:
      typeof Intl === "undefined"
        ? undefined
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/* ---------------------------------------------------------------- schemas */

export const MAX_SUBJECT_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 5000;

export const newTicketSchema = z.object({
  category: z.enum(CATEGORY_VALUES),
  subject: z
    .string()
    .trim()
    .min(4, "Give your issue a short summary.")
    .max(MAX_SUBJECT_LENGTH),
  description: z
    .string()
    .trim()
    .min(10, "Tell us a little more so we can help.")
    .max(MAX_DESCRIPTION_LENGTH),
  includeContext: z.boolean(),
  context: supportContextSchema.optional(),
  /** Storage keys of files already uploaded through the signed-URL flow. */
  attachmentKeys: z.array(z.string().trim().max(300)).max(3).default([]),
});

export type NewTicketInput = z.infer<typeof newTicketSchema>;

export const replySchema = z.object({
  ticketId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(2, "Write a message before sending.")
    .max(MAX_DESCRIPTION_LENGTH),
  attachmentKeys: z.array(z.string().trim().max(300)).max(3).default([]),
});

/* ------------------------------------------------------------------ views */

export type TicketSummary = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  updatedAt: string;
  /** Whether support has replied since the customer last wrote. */
  unread: boolean;
};

export type TicketMessage = {
  id: string;
  /** INBOUND is from the customer. */
  direction: "INBOUND" | "OUTBOUND";
  authorName: string | null;
  body: string;
  createdAt: string;
  attachments: { id: string; filename: string; sizeBytes: number }[];
};

export type TicketDetail = TicketSummary & {
  messages: TicketMessage[];
};
