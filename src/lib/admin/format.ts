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

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAY_STAMP = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatNumber(value: number | null | undefined): string {
  return NUMBER.format(value ?? 0);
}

export function formatMoney(value: number | null | undefined): string {
  return MONEY.format(value ?? 0);
}

export function formatMoneyPrecise(value: number | null | undefined): string {
  return MONEY_PRECISE.format(value ?? 0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE.format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE_TIME.format(new Date(value));
}

/** "Monday, 14 Apr 2025 · 16:24" — the Overview header stamp. */
export function formatHeaderStamp(value: Date): string {
  return `${DAY_STAMP.format(value)} · ${CLOCK.format(value)}`;
}

/**
 * True when `formatRelative` would produce an actual "N ago" phrase rather
 * than falling back to a date. Callers that pair an absolute date with a
 * relative one use this so they never render "5 Mar 2024 (5 Mar 2024)".
 */
export function hasRelativePhrase(value: string | null | undefined): boolean {
  if (!value) return false;
  const diff = Date.now() - new Date(value).getTime();
  return diff < 30 * 86_400_000;
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "Never";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return formatDate(value);
}

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
  microsoft_ads: "Microsoft Advertising",
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
  "usage.aggregate": "Usage aggregation",
  "retention.cleanup": "Retention cleanup",
  "cost.rollup_daily": "Daily cost rollup",
  "cost.rollup_monthly": "Monthly cost rollup",
  "crm.push": "CRM sync",
};

export function jobLabel(type: string): string {
  return JOB_LABELS[type] ?? titleise(type);
}

export function titleise(value: string): string {
  const spaced = value.replace(/[._-]+/g, " ").trim();
  if (!spaced) return value;
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
