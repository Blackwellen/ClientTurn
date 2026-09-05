import "server-only";
import { createClient } from "@/lib/supabase/server";
import { leadDisplayName } from "@/lib/leads/types";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/types";
import { formatDateTime } from "@/lib/dates";
import {
  likeTerm,
  SEARCH_PER_CATEGORY_LIMIT,
  type GlobalSearchResult,
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
  status: string;
};

type RawBookingRow = {
  id: string;
  status: string;
  starts_at: string | null;
  lead_id: string;
  leads: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  } | null;
};

type RawCampaignRow = {
  id: string;
  name: string;
  status: string;
  channel: string;
};

/**
 * Searches leads, bookings and campaigns scoped to the caller's own business.
 * Uses the normal (RLS-bound) server client — never the admin client — and
 * sticks to indexed `ilike` lookups with at most one embedded join, so this
 * stays fast enough to call on every keystroke of the command palette.
 */
export async function globalSearch(
  businessId: string,
  term: string,
): Promise<GlobalSearchResult> {
  const supabase = await createClient();
  const like = likeTerm(term);

  const [leadsResult, bookingsResult, campaignsResult] = await Promise.all([
    supabase
      .from("leads")
      .select("id, first_name, last_name, phone, email, postcode, status", {
        count: "exact",
      })
      .eq("business_id", businessId)
      .eq("is_test", false)
      .or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `phone.ilike.${like}`,
          `phone_normalized.ilike.${like}`,
          `email.ilike.${like}`,
          `postcode.ilike.${like}`,
        ].join(","),
      )
      .order("created_at", { ascending: false })
      .limit(SEARCH_PER_CATEGORY_LIMIT),

    supabase
      .from("bookings")
      .select(
        "id, status, starts_at, lead_id, leads!inner(first_name,last_name,phone)",
        { count: "exact" },
      )
      .eq("business_id", businessId)
      .or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `phone.ilike.${like}`,
        ].join(","),
        { foreignTable: "leads" },
      )
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(SEARCH_PER_CATEGORY_LIMIT),

    supabase
      .from("campaigns")
      .select("id, name, status, channel", { count: "exact" })
      .eq("business_id", businessId)
      .ilike("name", like)
      .order("created_at", { ascending: false })
      .limit(SEARCH_PER_CATEGORY_LIMIT),
  ]);

  const leads = ((leadsResult.data ?? []) as unknown as RawLeadRow[]).map(
    (row): SearchResultItem => ({
      id: row.id,
      type: "lead",
      title: leadDisplayName(row),
      subtitle: row.phone ?? row.email ?? row.postcode ?? null,
      href: `/app/leads?lead=${row.id}`,
    }),
  );

  const bookings = ((bookingsResult.data ?? []) as unknown as RawBookingRow[]).map(
    (row): SearchResultItem => ({
      id: row.id,
      type: "booking",
      title: row.leads ? leadDisplayName(row.leads) : "Unknown lead",
      subtitle:
        [
          BOOKING_STATUS_LABEL[row.status as keyof typeof BOOKING_STATUS_LABEL] ??
            row.status,
          row.starts_at ? formatDateTime(row.starts_at) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      href: `/app/leads?lead=${row.lead_id}&leadTab=booking`,
    }),
  );

  const campaigns = ((campaignsResult.data ?? []) as unknown as RawCampaignRow[]).map(
    (row): SearchResultItem => ({
      id: row.id,
      type: "campaign",
      title: row.name,
      subtitle: `${row.status} · ${row.channel.toUpperCase()}`,
      href: `/app/reactivation?campaign=${row.id}`,
    }),
  );

  return {
    leads: { items: leads, total: leadsResult.count ?? leads.length },
    bookings: { items: bookings, total: bookingsResult.count ?? bookings.length },
    campaigns: { items: campaigns, total: campaignsResult.count ?? campaigns.length },
  };
}
