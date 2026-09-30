/**
 * Global search: shapes, link building, the static page index, grouping and
 * recent-search bookkeeping.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports only — so the
 * command palette (a client component) can use it without dragging server
 * code into the browser bundle, and `tests/search.test.ts` can assert every
 * rule here under plain Node. The database half lives in `./queries.ts`.
 */

import { SETTINGS_SECTIONS } from "../settings/types.ts";

/* ------------------------------------------------------------------ shapes */

export type SearchResultType =
  | "page"
  | "lead"
  | "booking"
  | "prospect"
  | "conversation"
  | "agent"
  | "campaign"
  | "help";

export type SearchResultItem = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  href: string;
};

export type SearchCategory = {
  items: SearchResultItem[];
  total: number;
  /** The lookup for this group failed. Distinct from "nothing matched". */
  error?: boolean;
};

export type SearchCategoryKey =
  | "pages"
  | "leads"
  | "bookings"
  | "prospects"
  | "conversations"
  | "agents"
  | "campaigns"
  | "help";

export type GlobalSearchResult = Record<SearchCategoryKey, SearchCategory>;

/** What `/api/search` returns on a 200. */
export type SearchResponse = {
  query: string;
  results: GlobalSearchResult;
  /** Groups whose lookup failed; the rest are real answers. */
  failed: SearchCategoryKey[];
};

/** Display order in the palette. Pages first: "settings" should find Settings. */
export const SEARCH_CATEGORY_KEYS: SearchCategoryKey[] = [
  "pages",
  "leads",
  "bookings",
  "prospects",
  "conversations",
  "agents",
  "campaigns",
  "help",
];

export const SEARCH_CATEGORY_LABEL: Record<SearchCategoryKey, string> = {
  pages: "Pages & settings",
  leads: "Leads",
  bookings: "Bookings",
  prospects: "Prospects",
  conversations: "Inbox",
  agents: "Agents",
  campaigns: "Reactivation campaigns",
  help: "Help articles",
};

export const SEARCH_PER_CATEGORY_LIMIT = 5;

/** The command palette does not query the database below this length. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Mirrors the route's zod cap, so the client never sends what it would refuse. */
export const SEARCH_MAX_QUERY_LENGTH = 120;

export function emptySearchResult(): GlobalSearchResult {
  return {
    pages: { items: [], total: 0 },
    leads: { items: [], total: 0 },
    bookings: { items: [], total: 0 },
    prospects: { items: [], total: 0 },
    conversations: { items: [], total: 0 },
    agents: { items: [], total: 0 },
    campaigns: { items: [], total: 0 },
    help: { items: [], total: 0 },
  };
}

export const EMPTY_SEARCH_RESULT: GlobalSearchResult = emptySearchResult();

/* ------------------------------------------------------------------- links */

const enc = encodeURIComponent;

/** The full lead page (`/app/leads/[id]`); same address as `leadPageHref(id)`. */
export function leadHref(leadId: string): string {
  return `/app/leads/${enc(leadId)}`;
}

/**
 * Where a booking opens. Bookings have no page of their own and the lead page
 * has no booking tab (its tabs are conversation, qualification, scores,
 * attribution, activity, AI, data rights); the booking state and outcome
 * control live on the lead drawer's Summary tab, so that is where it lands.
 */
export function bookingHref(leadId: string): string {
  return `/app/leads?lead=${enc(leadId)}&leadTab=summary`;
}

/** Opens the prospect drawer on the Find Leads prospects view. */
export function prospectHref(prospectId: string): string {
  return `/app/find-leads?view=prospects&prospect=${enc(prospectId)}`;
}

export function agentHref(agentId: string): string {
  return `/app/agents/${enc(agentId)}`;
}

/**
 * Opens the thread in the Inbox. The inbox lists archived and live
 * conversations separately, so an archived thread needs `archive=1` or the
 * `thread` it names would not be in the list it is looked up in.
 */
export function conversationHref(conversationId: string, archived = false): string {
  return `/app/inbox?${archived ? "archive=1&" : ""}thread=${enc(conversationId)}`;
}

export function campaignHref(campaignId: string): string {
  return `/app/reactivation?campaign=${enc(campaignId)}`;
}

/**
 * INTEGRATION POINT (help article URL): the help centre is being rebuilt
 * (`src/lib/help/**`, `content/help/**`) and has no per-article route yet.
 * Until it does, an article opens the in-app Help page with the slug in the
 * query; swap this one function when the article route lands.
 */
export function helpArticleHref(slug: string): string {
  return `/app/help?article=${enc(slug)}`;
}

/**
 * "See all" for a group: the group's own list page with the query applied
 * where that page reads one. Null when there is no list page to go to.
 *
 *  - Leads, Reactivation, Inbox and Find Leads (prospects view) read `?q=`.
 *  - Bookings live in Leads under the Booked quick filter.
 *  - Agents has no search param, so it is the plain list.
 *  - Help: INTEGRATION POINT (help search) — `/app/help` does not read `q`
 *    yet; the param is harmless until the rebuilt help centre does.
 */
export function seeAllHref(key: SearchCategoryKey, term: string): string | null {
  const q = term.trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
  const withQ = (base: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(extra);
    if (q) params.set("q", q);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

  switch (key) {
    case "leads":
      return withQ("/app/leads");
    case "bookings":
      return withQ("/app/leads", { quick: "booked" });
    case "prospects":
      return withQ("/app/find-leads", { view: "prospects" });
    case "conversations":
      return withQ("/app/inbox");
    case "agents":
      return "/app/agents";
    case "campaigns":
      return withQ("/app/reactivation");
    case "help":
      return withQ("/app/help");
    case "pages":
      return null;
  }
}

/* ------------------------------------------------------ static page index */

export type NavCapability = "sourcing" | "analytics";

export type NavIndexEntry = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** Extra words that should find this page ("billing" finds Billing & Usage). */
  keywords: string[];
  /** Hidden unless the workspace's plan includes it — mirrors the sidebar. */
  requires?: NavCapability;
};

/** Extra words that find each Settings section. */
const SETTINGS_KEYWORDS: Record<string, string[]> = {
  workspace: ["business", "hours", "services", "timezone", "quiet hours"],
  connections: ["integrations", "meta", "facebook", "calendly", "google calendar", "twilio", "crm", "hubspot"],
  "business-profile": ["icp", "ideal customer", "goals", "company"],
  "ai-selling": ["ai", "brand", "voice", "budget", "strategy"],
  quotes: ["quote", "catalogue", "products", "pricing", "vat", "e-signature", "deposit", "invoicing"],
  team: ["members", "invite", "users", "roles"],
  security: ["two-factor", "2fa", "mfa", "authenticator", "sessions", "sign out everywhere", "idle timeout", "audit retention"],
  developer: ["api", "api keys", "webhooks", "mcp"],
  "data-controls": ["gdpr", "privacy", "retention", "suppression", "compliance"],
  billing: ["plan", "subscription", "invoices", "usage", "upgrade"],
  "system-check": ["troubleshooting", "not working", "health", "status", "diagnostics", "why"],
};

/**
 * Every page the palette can jump to without a database round trip: the
 * sidebar destinations (same order and gating as `PRIMARY_NAV` in
 * `lib/app/nav.ts`), a few task entry points, and each Settings section
 * (`/app/settings?section=<id>`, from `SETTINGS_SECTIONS`).
 */
export const NAV_INDEX: NavIndexEntry[] = [
  { id: "dashboard", title: "Dashboard", subtitle: "Home", href: "/app", keywords: ["home", "overview", "bookings summary"] },
  { id: "agents", title: "Agents", subtitle: "Destination", href: "/app/agents", keywords: ["ai", "automation", "bots"] },
  { id: "agents-new", title: "Create an agent", subtitle: "Agents", href: "/app/agents/new", keywords: ["new agent", "add agent"] },
  { id: "inbox", title: "Inbox", subtitle: "Destination", href: "/app/inbox", keywords: ["messages", "conversations", "replies", "email", "sms", "whatsapp"] },
  { id: "leads", title: "Leads", subtitle: "Destination", href: "/app/leads", keywords: ["contacts", "pipeline", "bookings"] },
  { id: "leads-import", title: "Import leads", subtitle: "Leads", href: "/app/leads/import", keywords: ["csv", "upload", "import"] },
  { id: "find-leads", title: "Find Leads", subtitle: "Destination", href: "/app/find-leads", keywords: ["prospects", "sourcing", "discover", "outreach"], requires: "sourcing" },
  { id: "follow-up", title: "Follow-Up", subtitle: "Destination", href: "/app/follow-up", keywords: ["sequence", "automations", "cadence"] },
  { id: "qualification", title: "Qualification", subtitle: "Follow-Up", href: "/app/follow-up?view=qualification", keywords: ["questions", "rules", "scoring"] },
  { id: "reactivation", title: "Reactivation", subtitle: "Destination", href: "/app/reactivation", keywords: ["campaigns", "win back", "re-engage"] },
  { id: "reactivation-new", title: "New reactivation campaign", subtitle: "Reactivation", href: "/app/reactivation/new", keywords: ["create campaign"] },
  { id: "analytics", title: "Analytics", subtitle: "Destination", href: "/app/analytics", keywords: ["reports", "metrics", "performance"], requires: "analytics" },
  { id: "settings", title: "Settings", subtitle: "Destination", href: "/app/settings", keywords: ["preferences", "configuration"] },
  ...SETTINGS_SECTIONS.map(
    (section): NavIndexEntry => ({
      id: `settings-${section.id}`,
      title: section.label,
      subtitle: `Settings · ${section.description}`,
      href: `/app/settings?section=${section.id}`,
      keywords: SETTINGS_KEYWORDS[section.id] ?? [],
    }),
  ),
  { id: "help", title: "Help", subtitle: "Guides and answers", href: "/app/help", keywords: ["docs", "support", "how to"] },
  { id: "support", title: "Contact support", subtitle: "Help", href: "/app/support?compose=1", keywords: ["ticket", "support", "contact"] },
];


function normaliseText(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Filters the static index for a query. Every word typed must appear in the
 * title, subtitle or keywords; title-prefix matches rank first, then title
 * matches, then keyword/subtitle-only matches. Pages the plan does not include
 * are dropped, exactly as the sidebar hides them.
 */
export function filterNavIndex(
  term: string,
  capabilities: Record<NavCapability, boolean>,
  limit = SEARCH_PER_CATEGORY_LIMIT,
  index: NavIndexEntry[] = NAV_INDEX,
): { items: SearchResultItem[]; total: number } {
  const words = normaliseText(term).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { items: [], total: 0 };
  const phrase = words.join(" ");

  const ranked = index
    .filter((entry) => !entry.requires || capabilities[entry.requires])
    .map((entry) => {
      const title = normaliseText(entry.title);
      const haystack = normaliseText(
        [entry.title, entry.subtitle, ...entry.keywords].join(" "),
      );
      if (!words.every((word) => haystack.includes(word))) return null;
      const rank = title.startsWith(phrase)
        ? 0
        : title.includes(phrase)
          ? 1
          : words.every((word) => title.includes(word))
            ? 2
            : 3;
      return { entry, rank };
    })
    .filter((row): row is { entry: NavIndexEntry; rank: number } => row !== null)
    .sort((a, b) => a.rank - b.rank);

  return {
    total: ranked.length,
    items: ranked.slice(0, limit).map(({ entry }) => ({
      id: entry.id,
      type: "page",
      title: entry.title,
      subtitle: entry.subtitle,
      href: entry.href,
    })),
  };
}

/* ---------------------------------------------------------------- grouping */

export type SearchGroup = {
  key: SearchCategoryKey;
  label: string;
  items: SearchResultItem[];
  total: number;
  error: boolean;
  seeAllHref: string | null;
};

/**
 * The groups the palette renders, in display order. A group appears when it
 * has results or when its lookup failed (so a failure is visible rather than
 * silently reading as "no matches"). "See all" is offered only when the group
 * has results and a list page to go to.
 */
export function buildSearchGroups(
  results: GlobalSearchResult,
  term: string,
): SearchGroup[] {
  return SEARCH_CATEGORY_KEYS.flatMap((key): SearchGroup[] => {
    const category = results[key];
    if (!category) return [];
    const error = Boolean(category.error);
    if (category.items.length === 0 && !error) return [];
    return [
      {
        key,
        label: SEARCH_CATEGORY_LABEL[key],
        items: category.items,
        total: Math.max(category.total, category.items.length),
        error,
        seeAllHref: category.items.length > 0 ? seeAllHref(key, term) : null,
      },
    ];
  });
}

/** One keyboard-navigable row: a result, or a group's "See all". */
export type SearchOption =
  | { kind: "item"; group: SearchCategoryKey; item: SearchResultItem; href: string }
  | { kind: "see-all"; group: SearchCategoryKey; label: string; href: string };

/** Flattens groups into the order ↑/↓ move through. */
export function flattenSearchOptions(groups: SearchGroup[]): SearchOption[] {
  return groups.flatMap((group): SearchOption[] => [
    ...group.items.map(
      (item): SearchOption => ({ kind: "item", group: group.key, item, href: item.href }),
    ),
    ...(group.seeAllHref
      ? [
          {
            kind: "see-all" as const,
            group: group.key,
            label:
              group.total > group.items.length
                ? `See all ${group.total} ${group.label.toLowerCase()}`
                : `Open ${group.label.toLowerCase()}`,
            href: group.seeAllHref,
          },
        ]
      : []),
  ]);
}

/** Every group that could be searched failed — the palette shows "Search failed". */
export function allGroupsFailed(results: GlobalSearchResult, failed: SearchCategoryKey[]): boolean {
  const searched = SEARCH_CATEGORY_KEYS.filter((key) => key !== "pages");
  return searched.every((key) => failed.includes(key) || results[key]?.error === true);
}

/* --------------------------------------------------------- recent searches */

export const RECENT_SEARCHES_KEY = "ct-recent-searches";
export const RECENT_SEARCHES_CAP = 6;

/** Parses the stored list, tolerating anything a browser might hand back. */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().slice(0, SEARCH_MAX_QUERY_LENGTH))
      .filter((value) => value.length >= SEARCH_MIN_QUERY_LENGTH)
      .slice(0, RECENT_SEARCHES_CAP);
  } catch {
    return [];
  }
}

/** Most recent first, de-duplicated case-insensitively, capped. */
export function addRecentSearch(
  list: string[],
  term: string,
  cap = RECENT_SEARCHES_CAP,
): string[] {
  const value = term.trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
  if (value.length < SEARCH_MIN_QUERY_LENGTH) return list.slice(0, cap);
  const key = value.toLowerCase();
  return [value, ...list.filter((item) => item.toLowerCase() !== key)].slice(0, cap);
}
