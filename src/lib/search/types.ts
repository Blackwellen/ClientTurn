/**
 * Global search shapes and pure helpers. Deliberately free of `server-only`
 * and of any Supabase import so the command palette client component can use
 * these without dragging server-only code into the browser bundle.
 */

export type SearchResultType = "lead" | "booking" | "campaign";

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
};

export type SearchCategoryKey = "leads" | "bookings" | "campaigns";

export type GlobalSearchResult = Record<SearchCategoryKey, SearchCategory>;

export const SEARCH_CATEGORY_KEYS: SearchCategoryKey[] = [
  "leads",
  "bookings",
  "campaigns",
];

export const SEARCH_PER_CATEGORY_LIMIT = 5;

/** The command palette does not query the database below this length. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

export const EMPTY_SEARCH_RESULT: GlobalSearchResult = {
  leads: { items: [], total: 0 },
  bookings: { items: [], total: 0 },
  campaigns: { items: [], total: 0 },
};

/** Matches the leads-list search behaviour: strip characters that would break the `ilike` pattern. */
export function likeTerm(term: string) {
  return `%${term.replace(/[%,()]/g, " ").trim()}%`;
}
