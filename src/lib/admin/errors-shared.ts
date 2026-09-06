/**
 * Error grouping vocabulary, kept free of `server-only` so the fingerprint and
 * severity rules are the same value everywhere — the errors service, the
 * support drawer and any test can all reach them.
 */

import type { ErrorSeverity } from "./types";

/** Normalised operational areas. One error belongs to exactly one. */
export const ERROR_AREAS = [
  "Messaging / SMS",
  "WhatsApp",
  "Billing",
  "Calendly",
  "Google Calendar",
  "Meta",
  "Jobs",
  "Webhook",
  "Database",
  "API",
] as const;

export type ErrorArea = (typeof ERROR_AREAS)[number];

const JOB_TYPE_AREA: Record<string, ErrorArea> = {
  "message.send": "Messaging / SMS",
  "message.process_inbound": "Messaging / SMS",
  "booking.sync": "Calendly",
  "lead_source.poll": "Meta",
  "lead.process": "Jobs",
  "automation.advance": "Jobs",
  "campaign.expand": "Jobs",
  "campaign.send": "Messaging / SMS",
  "integration.health_check": "Jobs",
  "webhook.replay": "Webhook",
  "notification.send": "Messaging / SMS",
  "notification.slack": "Jobs",
  "usage.aggregate": "Jobs",
  "retention.cleanup": "Database",
  "cost.rollup_daily": "Jobs",
  "cost.rollup_monthly": "Jobs",
  "crm.push": "API",
};

const PROVIDER_AREA: Record<string, ErrorArea> = {
  stripe: "Billing",
  meta: "Meta",
  twilio: "Messaging / SMS",
  twilio_sms: "Messaging / SMS",
  twilio_whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp",
  calendly: "Calendly",
  google_calendar: "Google Calendar",
};

export function areaForJobType(type: string): ErrorArea {
  return JOB_TYPE_AREA[type] ?? "Jobs";
}

export function areaForProvider(provider: string): ErrorArea {
  return PROVIDER_AREA[provider] ?? "Webhook";
}

/**
 * Severity is a property of the area and the failure mode, not of a log level
 * we do not have. A deadlock or a billing failure costs the business money;
 * a single delivery retry does not.
 */
const AREA_SEVERITY: Record<ErrorArea, ErrorSeverity> = {
  "Messaging / SMS": "HIGH",
  WhatsApp: "MEDIUM",
  Billing: "MEDIUM",
  Calendly: "HIGH",
  "Google Calendar": "HIGH",
  Meta: "MEDIUM",
  Jobs: "MEDIUM",
  Webhook: "LOW",
  Database: "CRITICAL",
  API: "HIGH",
};

const CRITICAL_SIGNALS =
  /(deadlock|out of memory|connection refused|could not connect|data loss|corrupt|500 internal)/i;
const ESCALATED_SIGNALS = /(exceeded max attempts|dead|unauthori[sz]ed|invalid signature|signature mismatch)/i;

/**
 * Deriving severity from the area, then escalating on the failure text. Errors
 * that exhausted their retries or that indicate a broken trust boundary are
 * raised a level; nothing is ever invented beyond what the record says.
 */
export function severityForArea(
  areaOrJobType: string,
  message?: string | null,
): ErrorSeverity {
  const area = (ERROR_AREAS as readonly string[]).includes(areaOrJobType)
    ? (areaOrJobType as ErrorArea)
    : areaForJobType(areaOrJobType);

  let severity = AREA_SEVERITY[area] ?? "MEDIUM";
  if (message) {
    if (CRITICAL_SIGNALS.test(message)) return "CRITICAL";
    if (ESCALATED_SIGNALS.test(message)) severity = raise(severity);
  }
  return severity;
}

function raise(severity: ErrorSeverity): ErrorSeverity {
  if (severity === "LOW") return "MEDIUM";
  if (severity === "MEDIUM") return "HIGH";
  if (severity === "HIGH") return "CRITICAL";
  return "CRITICAL";
}

/**
 * Strips the varying parts of a failure message — ids, numbers, quoted values,
 * timestamps — so the same underlying fault groups into one row instead of
 * flooding the table with near-identical entries.
 */
export function normaliseMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, "<time>")
    .replace(/["'`][^"'`]{0,80}["'`]/g, "<value>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** FNV-1a. Stable across processes, and no Node-only import. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function fingerprintFor(
  area: string,
  message: string,
  businessId: string | null,
): string {
  return hash(`${area}|${normaliseMessage(message)}|${businessId ?? "platform"}`);
}

const AREA_PREFIX: Record<ErrorArea, string> = {
  "Messaging / SMS": "SMS",
  WhatsApp: "WA",
  Billing: "BILL",
  Calendly: "CAL",
  "Google Calendar": "GCAL",
  Meta: "META",
  Jobs: "JOB",
  Webhook: "WEB",
  Database: "DB",
  API: "API",
};

/**
 * The short operator-facing reference (e.g. JOB-93014). Derived from the
 * fingerprint so it is stable for the life of the group and can be quoted in
 * a support conversation.
 */
export function referenceFor(area: string, fingerprint: string): string {
  const prefix = AREA_PREFIX[area as ErrorArea] ?? "ERR";
  const digits = (parseInt(fingerprint.slice(0, 6), 16) % 100000)
    .toString()
    .padStart(5, "0");
  return `${prefix}-${digits}`;
}
