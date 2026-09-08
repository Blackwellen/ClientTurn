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
  icon: "rocket" | "users" | "mail" | "calendar" | "settings" | "terminal";
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
    slug: "api-keys",
    title: "API keys: reading your workspace from your own systems",
    summary: "Create a key, choose what it may do, and keep it safe",
    category: "Developer",
    icon: "terminal",
    body: "Open Settings \u2192 Developer \u2192 New key. Choose the permissions the key needs and nothing more \u2014 nothing is selected for you, because what leaves your workspace is your decision. The key is shown once. ClientTurn stores only a fingerprint of it, so if you lose it you create a new one rather than recovering the old.\n\nSend it from your own server as an Authorization header: 'Authorization: Bearer ct_live_\u2026'. Never put a key in a web page or a mobile app \u2014 anyone who can view the page can read the key, and the API deliberately sends no CORS headers so a browser call will not work at all.\n\nA key carries one person's authority, not its own. It records whose access it acts with, and that person's current role is re-read on every request \u2014 so if they are removed from the workspace or moved to a lower role, the key loses that reach immediately, without anyone having to hunt it down. If your integration runs from a fixed address, list it under 'Only allow these addresses' and a stolen key becomes useless from anywhere else.\n\nStart with GET /api/v1/me. It returns the workspace, the key's permissions and the live role behind it, so if a later call is refused you can see which of the three is the reason.",
  },
  {
    slug: "webhooks",
    title: "Webhooks: being told the moment something happens",
    summary: "Receive signed events on your own server",
    category: "Developer",
    icon: "terminal",
    body: "Open Settings \u2192 Developer \u2192 Add endpoint. Give it an https address and choose which events to send. The address must be https and reachable from the public internet: events carry lead details, and a signature proves who sent a request rather than stopping someone reading it.\n\nEvery request carries a 'clientturn-signature' header of the form 't=<unix seconds>,v1=<hex>'. The signature is an HMAC-SHA256 of the timestamp, a full stop, and the raw request body. Verify against the raw body before you parse it \u2014 re-serialising the JSON changes the key order and the signature will fail intermittently, which looks like a network problem and is not. Reject anything older than five minutes, and compare in constant time.\n\nThe signing secret is shown once when you create the endpoint and once if you rotate it. Rotation takes effect immediately with no overlap, so update your server at the same time.\n\nA failed delivery is retried six times over roughly a day, with the gaps growing each time. A 4xx from your server is not retried \u2014 a 404 will not become a 200 in six hours. If an endpoint fails twenty times in a row we switch it off and tell you why, rather than continuing to hammer it. The delivery log under the endpoints shows what was sent, what your server answered and when the next attempt is due. If you cannot expose an endpoint at all, poll GET /api/v1/events for the same information.",
  },
  {
    slug: "connect-an-ai-assistant",
    title: "Connecting an AI assistant (MCP)",
    summary: "Let Claude, Codex or Gemini work your leads safely",
    category: "Developer",
    icon: "terminal",
    body: "ClientTurn is an MCP server, so an AI assistant can work inside your workspace directly. Create an API key in Settings \u2192 Developer, then point the assistant at your MCP endpoint with that key as a bearer header. In Claude Code, for example: 'claude mcp add --transport http clientturn <your site>/api/mcp --header \"Authorization: Bearer ct_live_\u2026\"'.\n\nThe assistant can do what you granted and nothing else. Tools it has no permission for are not even listed to it, so it cannot discover a capability it cannot use. It also cannot outrank you: it acts with the access of the person the key belongs to, and that person's current role is checked on every single call.\n\nAnything with lasting consequences does not run when the assistant asks. Sending a message, launching a campaign, starting an agent, disconnecting a system or archiving a lead all park in your workspace for a person to approve, with a plain-English summary of what was requested and what it would do. The assistant is told clearly that nothing has happened, so it cannot report success. When you approve, the action runs on your authority, once \u2014 approving twice cannot do it twice.\n\nEvery call the assistant makes, and every refusal, is recorded. Revoking the key disconnects it immediately.",
  },
  {
    slug: "ai-agents-setup",
    title: "Setting up AI agents",
    summary: "What agents do, and what they will never do on their own",
    category: "Developer",
    icon: "terminal",
    body: "There are two different things called agents, and it is worth keeping them apart.\n\nThe conversation assistant answers a lead's messages. Configure it in Settings under AI behaviour: its tone, its reply length, which channels it may use, and whether it drafts replies for you to approve or answers on its own. It is off by default in every workspace, and turning AI off turns it off with it.\n\nAgents are background workers you configure and leave running \u2014 sourcing prospects, chasing bookings, re-engaging old leads. Create one in Agents. It is always saved as a draft and never starts by being created, so you can get the setup wrong at no cost. Set its schedule, its daily and monthly limits, its sources, and how much it may do without review. A sourcing agent also needs an approved Find Leads search plan before it can run, because it spends real money on provider lookups every time it does.\n\nAll of this can be done by an AI assistant over MCP too, with one deliberate exception: starting an agent, or running one immediately, always waits for a person. Creating and configuring one is safe because a draft does nothing; setting it loose to spend money on a schedule with nobody watching is not the kind of thing an assistant should be able to decide. Pausing and stopping are never gated \u2014 the safe direction is always available at once.",
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
