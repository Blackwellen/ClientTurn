/**
 * The client-safe half of the public integration showcase.
 *
 * `./integrations` reads `process.env` to decide what the site may claim, so
 * it carries `server-only` and can never be imported from a client component
 * — not even for a type. The shapes and the label vocabulary live here so the
 * grid that renders them can be a client component without dragging the
 * environment lookup into the browser bundle.
 */

export type MarketingAvailability =
  | "native_live"
  | "webhook_bridge_live"
  | "platform_managed"
  | "coming_soon";

/** The exact wording each state is allowed to render as. */
export const AVAILABILITY_LABEL: Record<MarketingAvailability, string> = {
  native_live: "Available",
  webhook_bridge_live: "Connector",
  platform_managed: "Built in",
  coming_soon: "Coming soon",
};

export type ShowcaseConnector = {
  id: string;
  name: string;
  category: string;
  description: string;
  logo: string | null;
  availability: MarketingAvailability;
};

export type ShowcaseProvider = {
  id: string;
  name: string;
  category: string;
  logo: string | null;
  availability: MarketingAvailability;
};

/**
 * The category row, in the approved display order.
 *
 * It spans both halves of the section — the marketplace connectors and the
 * ad, messaging, booking and CRM providers — so every chip has something
 * behind it. A chip that filters to an empty grid is worse than no chip.
 */
export const CATEGORY_ORDER = [
  "All",
  "Lead sources",
  "Communication",
  "Booking",
  "CRM",
  "Automation",
  "Data",
  "Outreach",
] as const;

/** Maps a provider's internal category onto the public vocabulary. */
export function providerCategoryLabel(category: string): string {
  switch (category) {
    case "leads":
      return "Lead sources";
    case "messaging":
    case "email":
      return "Communication";
    case "booking":
      return "Booking";
    case "crm":
      return "CRM";
    default:
      return "Other";
  }
}

/** Only the chips that actually match something, in the fixed order. */
export function activeCategories(
  connectors: ShowcaseConnector[],
  providers: ShowcaseProvider[],
): string[] {
  const present = new Set<string>();
  for (const connector of connectors) present.add(connector.category);
  for (const provider of providers) present.add(provider.category);
  return CATEGORY_ORDER.filter((name) => name === "All" || present.has(name));
}
