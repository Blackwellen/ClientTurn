import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fullNameIlike, ilikeContains, orIlike } from "@/lib/supabase/ilike";
import { leadDisplayName } from "@/lib/leads/types";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/types";
import {
  agentStatusLabel,
  agentTypeLabel,
  type AgentStatus,
  type AgentType,
} from "@/lib/agents/types";
import { searchHelp } from "@/lib/help/service";
import { formatDateTime } from "@/lib/dates";
import {
  agentHref,
  bookingHref,
  campaignHref,
  conversationHref,
  emptySearchResult,
  filterNavIndex,
  helpArticleHref,
  leadHref,
  prospectHref,
  SEARCH_PER_CATEGORY_LIMIT,
  type GlobalSearchResult,
  type NavCapability,
  type SearchCategory,
  type SearchCategoryKey,
  type SearchResultItem,
} from "./types";

export * from "./types";

type RawLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
};

type RawBookingRow = {
  id: string;
  status: string;
  starts_at: string | null;
  lead_id: string;
  leads: { first_name: string | null; last_name: string | null; phone: string | null } | null;
};

type RawCampaignRow = { id: string; name: string; status: string; channel: string };

type RawProspectRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role_title: string | null;
  grade: string | null;
};

type RawConversationRow = {
  id: string;
  channel: string;
  counterparty_name: string | null;
  counterparty_handle: string | null;
  is_archived: boolean;
  last_message_at: string | null;
};

type RawAgentRow = { id: string; name: string; agent_type: string; status: string };

/** A PostgREST response: rows, an exact count, and possibly an error. */
type Response<T> = { data: T[] | null; count: number | null; error: unknown };

/**
 * Turns one lookup into a category. A Supabase `{ error }` becomes an
 * errored group rather than an empty one, so the palette can say "couldn't
 * search this" instead of "nothing matched".
 */
function toCategory<T>(
  result: Response<T> | null,
  map: (row: T) => SearchResultItem,
): SearchCategory {
  if (!result) return { items: [], total: 0 };
  if (result.error) return { items: [], total: 0, error: true };
  const items = (result.data ?? []).map(map);
  return { items, total: result.count ?? items.length };
}

function settle<T>(promise: PromiseLike<T>): Promise<T | { data: null; count: null; error: unknown }> {
  return Promise.resolve(promise).catch((error: unknown) => ({ data: null, count: null, error }));
}

export type GlobalSearchOptions = {
  /** Plan capabilities, so gated pages and Find Leads prospects stay hidden. */
  capabilities: Record<NavCapability, boolean>;
};

/**
 * Searches every entity the palette shows, scoped to the caller's business.
 *
 * Uses the normal (RLS-bound) server client — never the admin client — and
 * adds an explicit `business_id` predicate on every tenant table as a second
 * guard. Each lookup is an indexed `ilike` with at most one embedded join and
 * a small limit, so this stays cheap enough to run per keystroke (debounced).
 *
 * Every user-typed value reaches PostgREST through `orIlike`/`ilikeContains`,
 * which escape LIKE wildcards and quote the value so `,` `(` `)` `.` `:`
 * cannot be read as filter syntax.
 */
export async function globalSearch(
  businessId: string,
  term: string,
  options: GlobalSearchOptions,
): Promise<{ results: GlobalSearchResult; failed: SearchCategoryKey[] }> {
  const results = emptySearchResult();
  results.pages = filterNavIndex(term, options.capabilities);

  const contains = ilikeContains(term);
  const leadColumns = orIlike(
    ["first_name", "last_name", "phone", "phone_normalized", "email", "postcode"],
    term,
  );
  const leadFullName = fullNameIlike(term);
  const leadOr = leadColumns && leadFullName ? `${leadColumns},${leadFullName}` : leadColumns;
  const bookingOr = orIlike(["first_name", "last_name", "phone"], term);
  const prospectOr = orIlike(["first_name", "last_name", "email", "role_title"], term);
  const conversationOr = orIlike(["counterparty_name", "counterparty_handle"], term);

  if (!contains || !leadOr || !bookingOr || !prospectOr || !conversationOr) {
    return { results, failed: [] };
  }

  const supabase = await createClient();
  const limit = SEARCH_PER_CATEGORY_LIMIT;

  const [leads, bookings, prospects, conversations, agents, campaigns, help] =
    await Promise.all([
      settle(
        supabase
          .from("leads")
          .select("id, first_name, last_name, phone, email, postcode", { count: "exact" })
          .eq("business_id", businessId)
          .eq("is_test", false)
          .or(leadOr)
          .order("created_at", { ascending: false })
          .limit(limit),
      ),
      settle(
        supabase
          .from("bookings")
          .select("id, status, starts_at, lead_id, leads!inner(first_name,last_name,phone)", {
            count: "exact",
          })
          .eq("business_id", businessId)
          .or(bookingOr, { foreignTable: "leads" })
          .order("starts_at", { ascending: false, nullsFirst: false })
          .limit(limit),
      ),
      // Find Leads is plan-gated; a workspace without it gets no prospect group
      // rather than results that link to a page it cannot open.
      options.capabilities.sourcing
        ? settle(
            supabase
              .from("prospects")
              .select("id, first_name, last_name, email, role_title, grade", { count: "exact" })
              .eq("business_id", businessId)
              .eq("is_test", false)
              // A promoted prospect lives in Leads now, as on the prospects list.
              .is("promoted_to_lead_id", null)
              .or(prospectOr)
              .order("created_at", { ascending: false })
              .limit(limit),
          )
        : Promise.resolve(null),
      settle(
        supabase
          .from("conversations")
          .select(
            "id, channel, counterparty_name, counterparty_handle, is_archived, last_message_at",
            { count: "exact" },
          )
          .eq("business_id", businessId)
          .or(conversationOr)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(limit),
      ),
      settle(
        supabase
          .from("agents")
          .select("id, name, agent_type, status", { count: "exact" })
          .eq("business_id", businessId)
          .ilike("name", contains)
          .order("updated_at", { ascending: false })
          .limit(limit),
      ),
      settle(
        supabase
          .from("campaigns")
          .select("id, name, status, channel", { count: "exact" })
          .eq("business_id", businessId)
          .ilike("name", contains)
          .order("created_at", { ascending: false })
          .limit(limit),
      ),
      // Help articles come from the shared HelpService ranking (in memory over
      // content/help plus published rows), so the palette returns exactly what
      // /app/help and the support popout return for the same query.
      searchHelp(term, limit).then(
        (rows) => ({ data: rows, count: rows.length, error: null }),
        (error: unknown) => ({ data: null, count: null, error }),
      ),
    ]);

  results.leads = toCategory(leads as unknown as Response<RawLeadRow>, (row) => ({
    id: row.id,
    type: "lead",
    title: leadDisplayName(row),
    subtitle: row.email ?? row.phone ?? row.postcode ?? null,
    href: leadHref(row.id),
  }));

  results.bookings = toCategory(bookings as unknown as Response<RawBookingRow>, (row) => ({
    id: row.id,
    type: "booking",
    title: row.leads ? leadDisplayName(row.leads) : "Unknown lead",
    subtitle:
      [
        BOOKING_STATUS_LABEL[row.status as keyof typeof BOOKING_STATUS_LABEL] ?? row.status,
        row.starts_at ? formatDateTime(row.starts_at) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    href: bookingHref(row.lead_id),
  }));

  results.prospects = toCategory(prospects as unknown as Response<RawProspectRow> | null, (row) => ({
    id: row.id,
    type: "prospect",
    title:
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      row.email ||
      "Unnamed prospect",
    subtitle:
      [row.role_title, row.grade ? `Grade ${row.grade}` : null].filter(Boolean).join(" · ") ||
      null,
    href: prospectHref(row.id),
  }));

  results.conversations = toCategory(
    conversations as unknown as Response<RawConversationRow>,
    (row) => ({
      id: row.id,
      type: "conversation",
      title: row.counterparty_name || row.counterparty_handle || "Conversation",
      subtitle:
        [
          row.channel.toUpperCase(),
          row.is_archived ? "Archived" : null,
          row.last_message_at ? formatDateTime(row.last_message_at) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      href: conversationHref(row.id, row.is_archived),
    }),
  );

  results.agents = toCategory(agents as unknown as Response<RawAgentRow>, (row) => ({
    id: row.id,
    type: "agent",
    title: row.name,
    subtitle: `${agentTypeLabel(row.agent_type as AgentType)} · ${agentStatusLabel(
      row.status as AgentStatus,
    )}`,
    href: agentHref(row.id),
  }));

  results.campaigns = toCategory(campaigns as unknown as Response<RawCampaignRow>, (row) => ({
    id: row.id,
    type: "campaign",
    title: row.name,
    subtitle: `${row.status} · ${row.channel.toUpperCase()}`,
    href: campaignHref(row.id),
  }));

  results.help = toCategory(
    help as unknown as Response<{ slug: string; title: string; summary: string }>,
    (row) => ({
      id: row.slug,
      type: "help",
      title: row.title,
      subtitle: row.summary,
      href: helpArticleHref(row.slug),
    }),
  );

  const failed = (Object.keys(results) as SearchCategoryKey[]).filter(
    (key) => results[key].error,
  );
  return { results, failed };
}
