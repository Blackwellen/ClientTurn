import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_STATUSES, type LeadFilters } from "./filters";
import { sourceLabel } from "./types";
import { gravatarUrl } from "./avatar";
import type {
  BookingRow,
  LeadCapabilities,
  LeadQuickCounts,
  ConversationMessage,
  FilterOptions,
  LeadDetail,
  LeadHeaderMetrics,
  LeadListRow,
  QualificationRow,
  TimelineEvent,
  WorkspaceMember,
} from "./types";

export * from "./types";

/**
 * Teammate names are not readable under the self-only profiles policy, so this
 * uses the service role but is hard-scoped to the caller's own workspace and
 * returns nothing beyond display identity.
 */
export const getWorkspaceMembers = cache(
  async (businessId: string): Promise<WorkspaceMember[]> => {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("business_members")
      .select("user_id, role")
      .eq("business_id", businessId)
      .eq("status", "active");

    const ids = (members ?? []).map((m) => m.user_id);
    if (ids.length === 0) return [];

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("id", ids);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (members ?? []).map((member) => {
      const profile = byId.get(member.user_id);
      const name =
        [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
        profile?.email ||
        "Unknown user";
      return {
        userId: member.user_id,
        name,
        email: profile?.email ?? "",
        role: member.role,
      };
    });
  },
);

const LIST_SELECT = `
  id, first_name, last_name, phone, email, postcode, status, qualification_state,
  needs_attention, attention_reason, automation_active, human_takeover, opted_out,
  assigned_user_id, created_at, last_contact_at, first_contacted_at, first_replied_at,
  booked_at, won_at, lost_at,
  services ( id, name, average_value ),
  lead_sources ( id, provider, source_name, form_name, campaign_name, campaign_id,
                 ad_name, adset_name, page_name )
`;

/** Sentinel for an `in` filter that must match nothing. */
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function rangeBounds(filters: LeadFilters) {
  if (filters.range === "all") return null;
  if (filters.range === "custom") {
    if (!filters.from || !filters.to) return null;
    const from = new Date(`${filters.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 864e5);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return { from, to };
  }
  const days = filters.range === "7d" ? 7 : filters.range === "90d" ? 90 : 30;
  const to = new Date();
  return { from: new Date(to.getTime() - days * 864e5), to };
}

/* ------------------------------------------------------- filter application

   Quick filters and advanced filters are applied through these two helpers so
   the list query and the count query can never drift apart — a count that
   disagrees with the rows underneath it is worse than no count at all.
   ------------------------------------------------------------------------- */

/**
 * Every leads query — the list and each quick-filter count — starts here, so
 * the filter helpers below have one concrete builder type to work against and
 * a count can never be computed over a different base set than the rows.
 */
function baseLeadQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  select: string,
  options?: { count?: "exact"; head?: boolean },
) {
  return supabase
    .from("leads")
    .select(select, options)
    .eq("business_id", businessId)
    .eq("is_test", false);
}

type LeadsQuery = ReturnType<typeof baseLeadQuery>;

function applyQuickFilter(query: LeadsQuery, quick: LeadFilters["quick"]): LeadsQuery {
  switch (quick) {
    case "active":
      return query.in("status", ACTIVE_STATUSES);
    case "attention":
      return query.eq("needs_attention", true);
    case "qualified":
      return query.eq("status", "QUALIFIED");
    case "booked":
      return query.eq("status", "BOOKED");
    default:
      return query;
  }
}

/**
 * Resolves `form` / `campaign` to the source ids they cover. Done once, up
 * front, because a PostgREST builder is itself thenable — awaiting anything
 * that returns one would execute the query instead of extending it.
 *
 * Returns `null` when neither filter is set, and `[]` when they match no
 * source at all (which must match no leads, not every lead).
 */
async function resolveSourceIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  filters: LeadFilters,
): Promise<string[] | null> {
  if (!filters.campaign && !filters.form) return null;

  let sourceQuery = supabase
    .from("lead_sources")
    .select("id")
    .eq("business_id", businessId);
  if (filters.campaign) sourceQuery = sourceQuery.eq("campaign_id", filters.campaign);
  if (filters.form) sourceQuery = sourceQuery.eq("form_name", filters.form);

  const { data } = await sourceQuery;
  return (data ?? []).map((row) => row.id);
}

function applyAdvancedFilters(
  query: LeadsQuery,
  filters: LeadFilters,
  sourceIds: string[] | null,
): LeadsQuery {
  let next = query;

  if (filters.status?.length) next = next.in("status", filters.status);
  if (filters.service?.length) next = next.in("service_id", filters.service);
  if (filters.source?.length) next = next.in("source_id", filters.source);
  if (filters.attention) next = next.eq("needs_attention", true);

  if (filters.assignee) {
    next =
      filters.assignee === "unassigned"
        ? next.is("assigned_user_id", null)
        : next.eq("assigned_user_id", filters.assignee);
  }

  if (sourceIds) {
    next = next.in("source_id", sourceIds.length > 0 ? sourceIds : [ZERO_UUID]);
  }

  const bounds = rangeBounds(filters);
  if (bounds) {
    next = next
      .gte("created_at", bounds.from.toISOString())
      .lt("created_at", bounds.to.toISOString());
  }

  if (filters.q) {
    // PostgREST `or` is comma-delimited, so those characters are stripped
    // rather than escaped — the search term is a filter, not a query language.
    const term = filters.q.replace(/[%,()]/g, " ").trim();
    if (term) {
      const like = `%${term}%`;
      next = next.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `phone.ilike.${like}`,
          `phone_normalized.ilike.${like}`,
          `email.ilike.${like}`,
          `postcode.ilike.${like}`,
        ].join(","),
      );
    }
  }

  return next;
}

export async function listLeads(businessId: string, filters: LeadFilters) {
  const supabase = await createClient();

  const sourceIds = await resolveSourceIds(supabase, businessId, filters);

  let query = baseLeadQuery(supabase, businessId, LIST_SELECT, { count: "exact" });
  query = applyQuickFilter(query, filters.quick);
  query = applyAdvancedFilters(query, filters, sourceIds);

  const offset = (filters.page - 1) * filters.pageSize;
  const { data, count, error } = await query
    .order(filters.sort, { ascending: filters.dir === "asc", nullsFirst: false })
    .range(offset, offset + filters.pageSize - 1);

  if (error) throw error;

  const rows = (data ?? []) as unknown as LeadListRow[];

  return {
    // Card view renders an avatar per lead; computing the Gravatar hash here
    // keeps the email address and hashing logic server-side.
    rows: rows.map((row) => ({ ...row, avatarUrl: gravatarUrl(row.email) })),
    total: count ?? 0,
  };
}

export async function getLeadHeaderMetrics(
  businessId: string,
): Promise<LeadHeaderMetrics> {
  const supabase = await createClient();

  const [countResult, sample] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_test", false),
    supabase
      .from("leads")
      .select("created_at, first_contacted_at, first_replied_at")
      .eq("business_id", businessId)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const rows = sample.data ?? [];
  const contacted = rows.filter((row) => row.first_contacted_at);
  const replied = rows.filter((row) => row.first_replied_at);

  const latencies = contacted
    .map(
      (row) =>
        (new Date(row.first_contacted_at as string).getTime() -
          new Date(row.created_at).getTime()) /
        1000,
    )
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);

  return {
    total: countResult.count ?? 0,
    replyRate: contacted.length === 0 ? 0 : (replied.length / contacted.length) * 100,
    averageFirstResponseSeconds:
      latencies.length === 0
        ? null
        : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
  };
}

/* -------------------------------------------------------------- quick counts

   Counts respect search, date range and the advanced filters, but NOT the
   selected quick filter — otherwise selecting "Booked" would zero out every
   other chip and the user could never see what else is waiting.
   -------------------------------------------------------------------------- */

export async function getLeadQuickCounts(
  businessId: string,
  filters: LeadFilters,
): Promise<LeadQuickCounts> {
  const supabase = await createClient();

  const sourceIds = await resolveSourceIds(supabase, businessId, filters);

  const scoped = async (quick: LeadFilters["quick"]) => {
    const base = baseLeadQuery(supabase, businessId, "id", {
      count: "exact",
      head: true,
    });
    const { count } = await applyAdvancedFilters(
      applyQuickFilter(base, quick),
      filters,
      sourceIds,
    );
    return count ?? 0;
  };

  const [all, active, attention, qualified, booked] = await Promise.all([
    scoped("all"),
    scoped("active"),
    scoped("attention"),
    scoped("qualified"),
    scoped("booked"),
  ]);

  return { all, active, attention, qualified, booked };
}

/* ------------------------------------------------------------- capabilities */

/**
 * Resolves what the workspace can actually do, so manual actions can be
 * disabled with a reason instead of failing after the click. Read-only and
 * cached per request.
 */
export const getLeadCapabilities = cache(
  async (businessId: string): Promise<LeadCapabilities> => {
    const supabase = await createClient();

    const [{ data: settings }, { data: integrations }] = await Promise.all([
      supabase
        .from("business_settings")
        .select("booking_mode, booking_url, default_channel")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", businessId),
    ]);

    const connected = new Set(
      (integrations ?? [])
        .filter((row) => row.status === "HEALTHY" || row.status === "DEGRADED")
        .map((row) => row.provider_type),
    );

    const bookingProvider = settings?.booking_mode;
    const booking = Boolean(
      settings?.booking_url ||
        (bookingProvider && connected.has(bookingProvider)),
    );

    return {
      // Exactly the two send paths that exist (see lib/integrations/catalog).
      sms: connected.has("twilio_sms"),
      whatsapp: connected.has("twilio_whatsapp"),
      booking,
      bookingSetupHref: "/app/settings?section=connections",
      messagingSetupHref: "/app/settings?section=connections",
    };
  },
);

export const getFilterOptions = cache(
  async (businessId: string): Promise<FilterOptions> => {
    const supabase = await createClient();

    const [servicesResult, sourcesResult, members] = await Promise.all([
      supabase
        .from("services")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("position"),
      supabase
        .from("lead_sources")
        .select("id, provider, source_name, form_name, campaign_name, campaign_id")
        .eq("business_id", businessId)
        .limit(200),
      getWorkspaceMembers(businessId),
    ]);

    const sources = (sourcesResult.data ?? []).map((row) => ({
      id: row.id,
      label:
        row.form_name ?? row.source_name ?? row.campaign_name ?? row.provider,
    }));

    // Forms and campaigns are keyed by their own identifier, not the source
    // row, because several sources can share one Meta form or campaign.
    const formSet = new Set<string>();
    const campaignMap = new Map<string, string>();
    for (const row of sourcesResult.data ?? []) {
      if (row.form_name) formSet.add(row.form_name);
      if (row.campaign_id && row.campaign_name) {
        campaignMap.set(row.campaign_id, row.campaign_name);
      }
    }

    return {
      services: servicesResult.data ?? [],
      sources,
      forms: [...formSet].sort().map((label) => ({ id: label, label })),
      campaigns: [...campaignMap].map(([id, label]) => ({ id, label })),
      members,
    };
  },
);

/* ------------------------------------------------------------- lead detail */

export async function getLeadDetail(
  businessId: string,
  leadId: string,
): Promise<LeadDetail | null> {
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select(
      `${LIST_SELECT}, notes, qualification_reason, qualified_at, external_id`,
    )
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return null;

  const [messagesResult, answersResult, questionsResult, bookingsResult, members] =
    await Promise.all([
      supabase
        .from("messages")
        .select(
          "id, direction, channel, body, status, origin, error_message, created_at, sent_at, delivered_at, received_at, failed_at",
        )
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("qualification_answers")
        .select("question_id, answer_text, answer_value, evaluation, answered_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId),
      supabase
        .from("qualification_questions")
        .select("id, question_text, position, required, active")
        .eq("business_id", businessId)
        .order("position"),
      supabase
        .from("bookings")
        .select(
          "id, status, provider, booking_url, reschedule_url, starts_at, ends_at, location, external_event_id, created_at",
        )
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      getWorkspaceMembers(businessId),
    ]);

  const answers = new Map(
    (answersResult.data ?? []).map((row) => [row.question_id, row]),
  );

  const qualification: QualificationRow[] = (questionsResult.data ?? [])
    .filter((question) => question.active || answers.has(question.id))
    .map((question) => {
      const answer = answers.get(question.id);
      return {
        questionId: question.id,
        question: question.question_text,
        answer: answer?.answer_text ?? answer?.answer_value ?? null,
        evaluation: answer?.evaluation ?? "not_evaluated",
        answeredAt: answer?.answered_at ?? null,
        required: question.required,
      };
    });

  const typedLead = lead as unknown as LeadDetail["lead"];
  const messages = (messagesResult.data ?? []) as ConversationMessage[];
  const bookings = (bookingsResult.data ?? []) as BookingRow[];

  return {
    lead: typedLead,
    assignee:
      members.find((member) => member.userId === typedLead.assigned_user_id) ??
      null,
    members,
    messages,
    qualification,
    bookings,
    timeline: buildTimeline(typedLead, messages, qualification, bookings),
  };
}

function buildTimeline(
  lead: LeadDetail["lead"],
  messages: ConversationMessage[],
  qualification: QualificationRow[],
  bookings: BookingRow[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (
    at: string | null,
    label: string,
    tone: TimelineEvent["tone"] = "neutral",
    detail?: string,
  ) => {
    if (!at) return;
    events.push({ id: `${label}-${at}`, at, label, tone, detail });
  };

  push(lead.created_at, "Lead created", "accent", sourceLabel(lead.lead_sources));

  const outbound = messages.filter((m) => m.direction === "outbound");
  if (outbound[0]) {
    push(
      outbound[0].sent_at ?? outbound[0].created_at,
      "First message sent",
      "accent",
      outbound[0].channel.toUpperCase(),
    );
  }
  for (const message of outbound.slice(1)) {
    push(
      message.sent_at ?? message.created_at,
      message.status === "FAILED" ? "Follow-up failed" : "Follow-up sent",
      message.status === "FAILED" ? "danger" : "neutral",
      message.channel.toUpperCase(),
    );
  }

  const inbound = messages.filter((m) => m.direction === "inbound");
  if (inbound[0]) {
    push(inbound[0].received_at ?? inbound[0].created_at, "Lead replied", "success");
  }

  for (const row of qualification) {
    if (!row.answeredAt) continue;
    push(row.answeredAt, "Question answered", "neutral", row.question);
  }

  push(lead.qualified_at, "Qualified", "success");
  if (lead.human_takeover) push(lead.last_contact_at, "Handed to a person", "warning");
  for (const booking of bookings) {
    push(booking.starts_at ?? booking.created_at, "Booking created", "success", booking.provider);
  }
  push(lead.won_at, "Marked won", "success");
  push(lead.lost_at, "Marked lost", "neutral");
  if (lead.opted_out) push(lead.last_contact_at, "Opted out", "danger");

  return events.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}
