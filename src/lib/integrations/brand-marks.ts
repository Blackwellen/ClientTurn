import type { ProviderType } from "./catalog";

/**
 * Which file in `public/brands/` carries each provider's mark.
 *
 * Kept here rather than inside the icon component so the mapping can be
 * asserted against the files actually on disk — a missing asset should fail a
 * test run, not render as a broken image in a customer's Settings.
 *
 * See `public/brands/README.md` for provenance. Marks identify their provider
 * on its own connection card and remain the trademark of their owners.
 */
const BRAND_FILE: Record<ProviderType, string> = {
  meta: "meta",
  // svgl carries no Google Ads mark, so the parent Google "G" stands in: it is
  // accurate rather than approximated, and the card names the product.
  google_ads: "google",
  microsoft_ads: "microsoft",
  tiktok_ads: "tiktok",
  linkedin_ads: "linkedin",
  twilio_sms: "twilio",
  twilio_whatsapp: "whatsapp",
  slack: "slack",
  google_calendar: "google-calendar",
  calendly: "calendly",
  hubspot: "hubspot",
  zoho_crm: "zoho",
  salesforce: "salesforce",
  email: "resend",
};

export function brandMarkFile(provider: ProviderType): string | null {
  return BRAND_FILE[provider] ?? null;
}

export function brandMarkSrc(provider: ProviderType): string | null {
  const file = brandMarkFile(provider);
  return file ? `/brands/${file}.svg` : null;
}
