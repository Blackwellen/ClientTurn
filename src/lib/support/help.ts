/**
 * The bundled help index (V4 §23.11).
 *
 * These articles ship with the application so the Help tab is useful on a cold
 * start, before anything has been published to `support_articles`. Anything a
 * platform admin publishes to that table is merged on top and wins on slug, so
 * the database is the editable source and this file is the floor beneath it.
 *
 * Pure data — no `server-only`, no imports — so the popout can render it
 * without a round trip.
 */

export type BundledArticle = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  /** Icon key, resolved to a component by the popout. */
  icon: "rocket" | "users" | "mail" | "calendar" | "settings";
  body: string;
};

export const BUNDLED_ARTICLES: BundledArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started with ClientTurn",
    summary: "Learn the basics and set up your workspace",
    category: "Getting started",
    icon: "rocket",
    body: "Dashboard brings together lead outcomes, bookings and items needing attention. Leads holds your active enquiries. Find Leads keeps sourced prospects separate until you review them. Use Settings to manage your business details, team and connections.\n\nTo invite colleagues, open Settings → Team. An owner or admin can invite people and assign their access level. Viewers can read workspace data; operational changes require the relevant member or admin role.",
  },
  {
    slug: "finding-and-sourcing-leads",
    title: "Finding and sourcing leads",
    summary: "How to find, filter and add prospects",
    category: "Find Leads",
    icon: "users",
    body: "Build and approve a search plan in Find Leads. Open Agents → New agent, choose Sourcing, select the approved plan and set daily and monthly prospect limits. The agent is saved as a draft. Open it and choose Start agent when you are ready.\n\nA discovered email address or phone number is contact data, not permission to send marketing. Review provenance, recipient type and channel eligibility before contacting anyone. Suppression and opt-outs always apply, and sourced prospects stay in Find Leads until you decide they are appropriate to move to Leads.",
  },
  {
    slug: "setting-up-email-outreach",
    title: "Setting up email outreach",
    summary: "Connect your mailbox and start sending",
    category: "Connections",
    icon: "mail",
    body: "Open Settings → Connections and connect Google Workspace, Microsoft 365, or any mailbox over IMAP and SMTP. Once the mailbox is verified, create a sending identity with your display name, reply-to address and postal address.\n\nCheck the Domain health panel before sending at volume. SPF, DKIM and DMARC must all be valid for cold outreach; warm follow-up can send without them, but deliverability will suffer. ClientTurn re-checks sender and mailbox health immediately before every send and pauses sending rather than damaging your domain reputation.",
  },
  {
    slug: "managing-bookings",
    title: "Managing bookings",
    summary: "Integrate your calendar and track appointments",
    category: "Booking",
    icon: "calendar",
    body: "Connect Calendly or Google Calendar in Settings → Connections. Availability always comes from the connected provider — ClientTurn never invents a slot.\n\nUse Follow-Up to configure the sequence, qualification questions, quiet hours and booking behaviour. A lead reply, a booking, an opt-out or a human handover stops automatic follow-up according to the rules you set.",
  },
  {
    slug: "troubleshooting-integrations",
    title: "Troubleshooting integrations",
    summary: "Common issues and how to fix them",
    category: "Connections",
    icon: "settings",
    body: "The connection pill in the top bar shows overall integration health. Open Settings → Connections for the detail: each card shows its status, its last successful sync and, where relevant, the reason it needs attention.\n\nA connection showing 'Action required' usually needs to be reconnected — provider access tokens expire, and permissions can be revoked from the provider's own settings. Use Test on the card to confirm a connection is working before relying on it. If a provider is having a wider incident, it will show on the ClientTurn status page.",
  },
];

/** Grouped view, for the browse-by-category path. */
export const HELP_CATEGORIES = [...new Set(BUNDLED_ARTICLES.map((a) => a.category))].map(
  (category) => ({
    title: category,
    articles: BUNDLED_ARTICLES.filter((article) => article.category === category),
  }),
);

export function bundledArticle(slug: string): BundledArticle | undefined {
  return BUNDLED_ARTICLES.find((article) => article.slug === slug);
}

/** Case-insensitive match across title, summary and body. */
export function searchBundled(query: string): BundledArticle[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return BUNDLED_ARTICLES;
  return BUNDLED_ARTICLES.filter((article) =>
    `${article.title} ${article.summary} ${article.body}`
      .toLowerCase()
      .includes(needle),
  );
}
