import { formatInZone } from "../dates.ts";

const NUMBER = new Intl.NumberFormat("en-GB");

const MONEY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const MONEY_PRECISE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

const DAY_STAMP: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
};

const CLOCK: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export function formatNumber(value: number | null | undefined): string {
  return NUMBER.format(value ?? 0);
}

export function formatMoney(value: number | null | undefined): string {
  return MONEY.format(value ?? 0);
}

export function formatMoneyPrecise(value: number | null | undefined): string {
  return MONEY_PRECISE.format(value ?? 0);
}

/** "Monday, 14 Apr 2025 · 16:24" — the Overview header stamp. */
export function formatHeaderStamp(value: Date): string {
  return `${formatInZone(value, DAY_STAMP)} · ${formatInZone(value, CLOCK)}`;
}

/*
 * Date and relative-time formatting lives in `@/lib/dates` (formatDate,
 * formatDateTime(v, { year: true }), formatRelative(v, { style: "ago" }),
 * hasRelativePhrase) so the admin console and the app share one implementation.
 */

export function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

/** Whole-percent usage figure for a dense table cell. */
export function formatUsagePercent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/** Signed change for a KPI delta. Null baseline reads as "no baseline". */
export function formatChange(ratio: number | null): string {
  if (ratio === null) return "—";
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${NUMBER.format(Math.round(value))} ms`;
}

export function formatUptime(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

const PROVIDER_LABELS: Record<string, string> = {
  meta: "Meta",
  twilio: "Twilio SMS",
  twilio_sms: "Twilio SMS",
  twilio_whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp",
  whatsapp: "WhatsApp",
  stripe: "Stripe",
  billing: "Billing",
  calendly: "Calendly",
  google_calendar: "Google Calendar",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  resend: "Resend",
  email: "Resend email",
  slack: "Slack",
  hubspot: "HubSpot",
  zoho_crm: "Zoho CRM",
  salesforce: "Salesforce",
  webhook: "Webhook",
  job: "Job",
  sms: "SMS",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? titleise(provider);
}

/**
 * One Action-required line for every unhealthy connection a workspace has,
 * naming each provider. It used to show only the first connection's raw error
 * ("Token has been expired or revoked.") with no provider, so an operator
 * could not tell which of four broken connections it meant, and the top bar
 * counted four items while the Overview listed one.
 */
export function integrationActionDetail(
  rows: { provider_type: string; status: string; last_error_message: string | null }[],
): string {
  const names = [...new Set(rows.map((row) => providerLabel(row.provider_type)))];
  const list =
    names.length <= 1
      ? (names[0] ?? "A connection")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const allDisconnected = rows.every((row) => row.status === "DISCONNECTED");
  const verb = allDisconnected
    ? names.length > 1 ? "are disconnected" : "is disconnected"
    : names.length > 1 ? "need reconnecting" : "needs reconnecting";
  const reason = rows.find((row) => row.last_error_message)?.last_error_message?.trim();
  return reason ? `${list} ${verb}: ${reason}` : `${list} ${verb}`;
}

const JOB_LABELS: Record<string, string> = {
  "lead.process": "Process lead",
  "lead_source.poll": "Sync leads",
  "message.send": "Send message",
  "message.process_inbound": "Inbound message",
  "automation.advance": "Advance follow-up",
  "booking.sync": "Calendar sync",
  "campaign.expand": "Expand campaign",
  "campaign.send": "Campaign send",
  "integration.health_check": "Connection health check",
  "webhook.replay": "Webhook replay",
  "notification.send": "Send email",
  "notification.slack": "Slack notification",
  "notification.slack_digest": "Slack daily digest",
  "slack.interaction": "Slack button click",
  "whatsapp.template_sync": "WhatsApp template sync",
  "usage.aggregate": "Usage aggregation",
  "retention.cleanup": "Retention cleanup",
  "cost.rollup_daily": "Daily cost rollup",
  "cost.rollup_monthly": "Monthly cost rollup",
  "economics.margin_check": "Margin check",
  "crm.push": "CRM sync",
  "crm.pull": "CRM import",
  "reengage.sweep": "Re-engagement sweep",
  "reengage.trigger": "Re-engagement trigger",
  "social.tick": "Social scheduler",
  "social.advance": "Social post step",
  "outreach.tick": "Outreach scheduler",
  "outreach.dispatch": "Outreach send",
  "outreach.optimize": "Outreach optimiser",
  "intent.sweep": "Intent sweep",
  "voice.reconcile": "Voice reconcile",
  "voice.dial": "Voice call",
  "voice.post_call": "Voice post-call",
  "voice.webhook_ingest": "Voice webhook",
  "quote.render_pdf": "Quote PDF",
  "quote.nudge": "Quote reminder",
  "quote.expire": "Quote expiry",
  "event.dispatch": "Domain event dispatch",
  "webhook.dispatch": "Outgoing webhook",
  "email.sender_health": "Sender health check",
  "domain.health_check": "Domain health check",
  "recurring_search.tick": "Saved search refresh",
  "business.analyse": "Business analysis",
  "affiliate.ledger": "Affiliate ledger",
  "billing.daily": "Daily billing check",
  "billing.workspace_deletion": "Workspace deletion",
};

export function jobLabel(type: string): string {
  return JOB_LABELS[type] ?? titleise(type);
}

export function titleise(value: string): string {
  let spaced = value.replace(/[._-]+/g, " ").trim();
  if (!spaced) return value;
  // Enum values arrive upper-case ("WAITING_CUSTOMER", "TRIALING") and used
  // to render as shouted text. Lower-case them first, but leave short
  // acronyms ("SMS", "API") alone.
  if (/^[A-Z0-9 ]+$/.test(spaced) && /[A-Z]{4,}/.test(spaced)) spaced = spaced.toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Domain shown beside a business name. Derived from the stored website URL —
 * never invented when the workspace has not supplied one.
 */
export function domainFromWebsite(website: string | null): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
