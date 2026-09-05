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
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
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

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "Never";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 0) return "Just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    meta: "Meta Lead Ads",
    twilio: "Twilio",
    stripe: "Stripe",
    calendly: "Calendly",
    google_calendar: "Google Calendar",
    resend: "Resend",
    whatsapp: "WhatsApp",
  };
  return map[provider] ?? provider.replace(/_/g, " ");
}
