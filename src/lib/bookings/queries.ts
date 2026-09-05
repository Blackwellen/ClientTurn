import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers, leadDisplayName } from "@/lib/leads/queries";
import type { WorkspaceMember } from "@/lib/leads/types";
import {
  monthBounds,
  type BookingDestination,
  type BookingFilters,
  type BookingListRow,
  type BookingMetrics,
  type BookingStatus,
} from "./types";

export * from "./types";

const SELECT = `
  id, lead_id, service_id, provider, external_event_id, booking_url,
  reschedule_url, cancel_url, starts_at, ends_at, location, assigned_user_id,
  status, notes, created_at,
  leads ( id, first_name, last_name, phone ),
  services ( id, name )
`;

type RawBooking = {
  id: string;
  lead_id: string;
  provider: string;
  booking_url: string | null;
  reschedule_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  assigned_user_id: string | null;
  status: string;
  created_at: string;
  leads: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  } | null;
  services: { id: string; name: string } | null;
};

function toRow(
  raw: RawBooking,
  members: Map<string, WorkspaceMember>,
): BookingListRow {
  return {
    id: raw.id,
    leadId: raw.lead_id,
    leadName: raw.leads
      ? leadDisplayName(raw.leads)
      : "Unknown lead",
    leadPhone: raw.leads?.phone ?? null,
    serviceName: raw.services?.name ?? null,
    provider: raw.provider,
    status: raw.status as BookingStatus,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    location: raw.location,
    bookingUrl: raw.booking_url,
    rescheduleUrl: raw.reschedule_url,
    assignedUserId: raw.assigned_user_id,
    assigneeName: raw.assigned_user_id
      ? (members.get(raw.assigned_user_id)?.name ?? "Unknown user")
      : null,
    createdAt: raw.created_at,
  };
}

export async function listBookings(
  businessId: string,
  filters: BookingFilters,
  timezone: string,
) {
  const supabase = await createClient();
  const members = await getWorkspaceMembers(businessId);
  const byId = new Map(members.map((member) => [member.userId, member]));

  const calendar = filters.view === "calendar";
  const now = new Date().toISOString();

  let query = supabase
    .from("bookings")
    .select(SELECT, { count: "exact" })
    .eq("business_id", businessId);

  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.service) query = query.eq("service_id", filters.service);
  if (filters.assignee === "unassigned") {
    query = query.is("assigned_user_id", null);
  } else if (filters.assignee) {
    query = query.eq("assigned_user_id", filters.assignee);
  }

  if (calendar) {
    const month = filters.month ?? monthKeyNow(timezone);
    const bounds = monthBounds(month);
    query = query
      .gte("starts_at", bounds.from)
      .lt("starts_at", bounds.to)
      .order("starts_at", { ascending: true })
      .limit(500);
  } else {
    if (filters.from) query = query.gte("starts_at", `${filters.from}T00:00:00Z`);
    if (filters.to) {
      const to = new Date(new Date(`${filters.to}T00:00:00Z`).getTime() + 864e5);
      query = query.lt("starts_at", to.toISOString());
    }

    if (filters.tab === "upcoming") {
      query = query.gte("starts_at", now).order("starts_at", { ascending: true });
    } else if (filters.tab === "past") {
      query = query.lt("starts_at", now).order("starts_at", { ascending: false });
    } else {
      query = query.order("starts_at", { ascending: false, nullsFirst: false });
    }

    const from = (filters.page - 1) * filters.pageSize;
    query = query.range(from, from + filters.pageSize - 1);
  }

  const { data, count } = await query;

  return {
    rows: ((data ?? []) as unknown as RawBooking[]).map((raw) =>
      toRow(raw, byId),
    ),
    total: count ?? 0,
  };
}

function monthKeyNow(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  return parts.slice(0, 7);
}

export async function getBookingMetrics(
  businessId: string,
): Promise<BookingMetrics> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [upcoming, completed, cancelled, noShow] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "scheduled")
      .gte("starts_at", now),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "completed"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "cancelled"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "no_show"),
  ]);

  return {
    upcoming: upcoming.count ?? 0,
    completed: completed.count ?? 0,
    cancelled: cancelled.count ?? 0,
    noShow: noShow.count ?? 0,
  };
}

export async function getBookingFilterOptions(businessId: string) {
  const supabase = await createClient();
  const [services, members] = await Promise.all([
    supabase
      .from("services")
      .select("id, name")
      .eq("business_id", businessId)
      .order("position"),
    getWorkspaceMembers(businessId),
  ]);

  return {
    services: (services.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    members,
  };
}

/**
 * A booking destination is what turns a qualified lead into a booking. Without
 * one, nothing can land on this page.
 */
export async function getBookingDestination(
  businessId: string,
): Promise<BookingDestination> {
  const supabase = await createClient();

  const [settings, integrations] = await Promise.all([
    supabase
      .from("business_settings")
      .select("booking_mode")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("integrations")
      .select("provider_type, status")
      .eq("business_id", businessId)
      .in("provider_type", ["calendly", "google_calendar"]),
  ]);

  const mode = settings.data?.booking_mode ?? "handover";

  if (mode === "handover") {
    return {
      mode,
      configured: true,
      label:
        "Human handover — qualified leads are flagged for the team instead of being booked automatically.",
    };
  }

  const integration = (integrations.data ?? []).find(
    (row) => row.provider_type === mode,
  );

  return {
    mode,
    configured: Boolean(
      integration &&
        ["HEALTHY", "DEGRADED", "TESTING"].includes(integration.status),
    ),
    label:
      mode === "calendly"
        ? "Calendly"
        : mode === "google_calendar"
          ? "Google Calendar"
          : mode,
  };
}
