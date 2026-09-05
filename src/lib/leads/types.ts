/**
 * Lead shapes and pure display helpers. Deliberately free of `server-only` and
 * of any Supabase import so client components can use these without dragging
 * the service-role client into the browser bundle.
 */

export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type LeadSourceRef = {
  id: string;
  provider: string;
  source_name: string | null;
  form_name: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  ad_name: string | null;
  adset_name: string | null;
  page_name: string | null;
};

export type LeadListRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  status: string;
  qualification_state: string;
  needs_attention: boolean;
  attention_reason: string | null;
  automation_active: boolean;
  human_takeover: boolean;
  opted_out: boolean;
  assigned_user_id: string | null;
  created_at: string;
  last_contact_at: string | null;
  first_contacted_at: string | null;
  first_replied_at: string | null;
  booked_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  services: { id: string; name: string; average_value: number | null } | null;
  lead_sources: LeadSourceRef | null;
  /**
   * Computed server-side (see `lib/leads/avatar.ts`), never a database
   * column. Null when the lead has no email or the list query doesn't
   * populate it.
   */
  avatarUrl?: string | null;
};

export type ConversationMessage = {
  id: string;
  direction: string;
  channel: string;
  body: string;
  status: string;
  origin: string;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  failed_at: string | null;
};

export type QualificationRow = {
  questionId: string;
  question: string;
  answer: string | null;
  evaluation: string;
  answeredAt: string | null;
  required: boolean;
};

export type BookingRow = {
  id: string;
  status: string;
  provider: string;
  booking_url: string | null;
  reschedule_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  external_event_id: string | null;
  created_at: string;
};

export type TimelineEvent = {
  id: string;
  at: string;
  label: string;
  detail?: string;
  tone: "neutral" | "accent" | "success" | "warning" | "danger";
};

export type LeadDetail = {
  lead: LeadListRow & {
    notes: string | null;
    qualification_reason: unknown;
    qualified_at: string | null;
    external_id: string | null;
  };
  assignee: WorkspaceMember | null;
  members: WorkspaceMember[];
  messages: ConversationMessage[];
  qualification: QualificationRow[];
  bookings: BookingRow[];
  timeline: TimelineEvent[];
};

/** Per-quick-filter counts shown on the chips / summary cards. Real query
 *  results scoped to the workspace; a filter with no leads shows 0. */
export type LeadQuickCounts = {
  all: number;
  active: number;
  attention: number;
  qualified: number;
  booked: number;
};

/**
 * What this workspace can actually do right now. Manual actions are disabled
 * (with a reason) rather than hidden when the underlying channel or
 * integration is not configured, so the user learns what to set up.
 */
export type LeadCapabilities = {
  sms: boolean;
  whatsapp: boolean;
  booking: boolean;
  bookingSetupHref: string;
  messagingSetupHref: string;
};

export type LeadHeaderMetrics = {
  total: number;
  replyRate: number;
  averageFirstResponseSeconds: number | null;
};

export type FilterOptions = {
  services: { id: string; name: string }[];
  sources: { id: string; label: string }[];
  forms: { id: string; label: string }[];
  campaigns: { id: string; label: string }[];
  members: WorkspaceMember[];
};

export function leadDisplayName(lead: {
  first_name: string | null;
  last_name: string | null;
  phone?: string | null;
}) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.phone || "Unnamed lead";
}

export function sourceLabel(source: LeadSourceRef | null) {
  if (!source) return "Unknown";
  return (
    source.campaign_name ??
    source.form_name ??
    source.source_name ??
    source.page_name ??
    source.provider
  );
}

/* ---------------------------------------------------------- display helpers */

/** Short label for the assignee cell, e.g. "Jamie D." */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** The provider a source came from, normalised to the taxonomy the UI knows. */
export function sourceProvider(source: LeadSourceRef | null): string {
  return (source?.provider ?? "unknown").toLowerCase();
}

/**
 * Human sentence for the machine attention reason stored on the lead. Falls
 * back to a readable form of the raw code so an unknown reason still reads.
 */
const ATTENTION_REASONS: Record<string, string> = {
  no_follow_up: "No follow-up has been sent yet",
  follow_up_overdue: "Follow-up is overdue",
  human_requested: "The lead asked to speak to a person",
  review_required: "Qualification needs a human decision",
  send_failed: "The last message could not be delivered",
  no_response: "No response to the last follow-up",
};

export function attentionReasonLabel(reason: string | null) {
  if (!reason) return "Needs attention";
  return ATTENTION_REASONS[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Last-activity summary for the list views: the most recent thing that
 * happened, described in the product's own words rather than a raw column.
 */
export function lastActivity(lead: LeadListRow): {
  at: string | null;
  label: string;
} {
  if (lead.won_at) return { at: lead.won_at, label: "Marked won" };
  if (lead.lost_at) return { at: lead.lost_at, label: "Marked lost" };
  if (lead.booked_at) return { at: lead.booked_at, label: "Job scheduled" };
  if (
    lead.first_replied_at &&
    (!lead.last_contact_at ||
      new Date(lead.first_replied_at) >= new Date(lead.last_contact_at))
  ) {
    return { at: lead.first_replied_at, label: "Lead replied" };
  }
  if (lead.last_contact_at) return { at: lead.last_contact_at, label: "Message sent" };
  if (lead.first_contacted_at) {
    return { at: lead.first_contacted_at, label: "First message sent" };
  }
  return { at: lead.created_at, label: "Lead created" };
}
