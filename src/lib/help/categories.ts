/**
 * The help-centre categories (Phase 8.1).
 *
 * This list is the contract `content/help/README.md` documents: an article's
 * `category` frontmatter value must be one of these slugs, and the article
 * must live in the folder of the same name. The order here is the order the
 * index renders them.
 *
 * Pure data — no imports — so the loader, the pages, the popout and the tests
 * all read the same list.
 */

export const HELP_CATEGORY_SLUGS = [
  "getting-started",
  "finding-leads",
  "qualifying",
  "booking-and-sales",
  "reactivation",
  "copilot",
  "ai-agents",
  "voice",
  "settings",
  "integrations",
  "developers",
  "compliance",
  "billing",
  "sales-knowledge",
  "faq",
] as const;

export type HelpCategorySlug = (typeof HELP_CATEGORY_SLUGS)[number];

/** Icon keys, resolved to components by the renderer. */
export type HelpIconKey =
  | "rocket"
  | "radar"
  | "list-checks"
  | "calendar"
  | "repeat"
  | "sparkles"
  | "bot"
  | "phone"
  | "settings"
  | "plug"
  | "terminal"
  | "shield"
  | "credit-card"
  | "graduation-cap"
  | "circle-help";

export type HelpCategory = {
  slug: HelpCategorySlug;
  title: string;
  description: string;
  icon: HelpIconKey;
};

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Set up your workspace, find your way around and go live.",
    icon: "rocket",
  },
  {
    slug: "finding-leads",
    title: "Finding leads",
    description: "Lead sources, prospect search, imports and manual entry.",
    icon: "radar",
  },
  {
    slug: "qualifying",
    title: "Qualifying",
    description: "Questions, rules and how a lead is judged worth booking.",
    icon: "list-checks",
  },
  {
    slug: "booking-and-sales",
    title: "Booking and sales",
    description: "Calendars, bookings, handover and closing the sale.",
    icon: "calendar",
  },
  {
    slug: "reactivation",
    title: "Reactivation",
    description: "Re-engage past enquiries and old customers.",
    icon: "repeat",
  },
  {
    slug: "copilot",
    title: "Copilot",
    description: "Ask questions about your workspace and act on the answers.",
    icon: "sparkles",
  },
  {
    slug: "ai-agents",
    title: "AI agents",
    description: "Background agents, the conversation assistant and their limits.",
    icon: "bot",
  },
  {
    slug: "voice",
    title: "Voice",
    description: "The AI voice agent: setting it up, who it may call and voice minutes.",
    icon: "phone",
  },
  {
    slug: "settings",
    title: "Settings",
    description: "Business profile, team, messaging and workspace controls.",
    icon: "settings",
  },
  {
    slug: "integrations",
    title: "Integrations",
    description: "Connect your CRM, calendar, mailbox and messaging channels.",
    icon: "plug",
  },
  {
    slug: "developers",
    title: "Developers",
    description: "API keys, webhooks and connecting an AI assistant over MCP.",
    icon: "terminal",
  },
  {
    slug: "compliance",
    title: "Compliance",
    description: "Consent, opt-outs, suppression and data rights.",
    icon: "shield",
  },
  {
    slug: "billing",
    title: "Billing",
    description: "Plans, subscriptions, usage and top-up credit.",
    icon: "credit-card",
  },
  {
    slug: "sales-knowledge",
    title: "Sales knowledge",
    description: "Sales methods, industry scoring and evidence-graded technique.",
    icon: "graduation-cap",
  },
  {
    slug: "faq",
    title: "FAQ",
    description: "Short answers to the questions we are asked most.",
    icon: "circle-help",
  },
];

export function isHelpCategory(value: string): value is HelpCategorySlug {
  return (HELP_CATEGORY_SLUGS as readonly string[]).includes(value);
}

export function helpCategory(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((category) => category.slug === slug);
}

/**
 * Maps a free-text `support_articles.category` onto a slug.
 *
 * The database column predates this list and defaults to `OTHER`, so a
 * published override may say `INTEGRATIONS`, `Getting started` or anything
 * else. A value that normalises onto a known slug is used; anything else falls
 * back to `fallback` (the bundled article's own category when overriding one,
 * otherwise the FAQ).
 */
export function normaliseCategory(
  value: string | null | undefined,
  fallback: HelpCategorySlug = "faq",
): HelpCategorySlug {
  const slug = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (isHelpCategory(slug)) return slug;
  const byTitle = HELP_CATEGORIES.find(
    (category) => category.title.toLowerCase() === (value ?? "").trim().toLowerCase(),
  );
  return byTitle?.slug ?? fallback;
}
