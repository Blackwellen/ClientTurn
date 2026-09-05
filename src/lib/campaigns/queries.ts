import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { leadDisplayName } from "@/lib/leads/types";
import {
  MAX_CAMPAIGN_AUDIENCE,
  suppressionLabel,
  type AudienceFilter,
  type AudiencePreview,
  type AudienceSampleRow,
  type CampaignContactRow,
  type CampaignContactsParams,
  type CampaignDetail,
  type CampaignListRow,
  type SuppressionGroup,
} from "./types";

const SCAN_LIMIT = 10_000;

type AudienceLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  opted_out: boolean;
  human_takeover: boolean;
  status: string;
  last_contact_at: string | null;
  created_at: string;
  services: { name: string } | null;
};

export type AudienceResolution = {
  preview: AudiencePreview;
  eligibleLeadIds: string[];
};

function sampleRow(lead: AudienceLeadRow): AudienceSampleRow {
  return {
    id: lead.id,
    name: leadDisplayName(lead),
    phone: lead.phone_normalized ?? lead.phone,
    service: lead.services?.name ?? null,
    lastContactAt: lead.last_contact_at,
  };
}

/**
 * Resolves who a reactivation campaign would actually reach. Suppression is
 * mandatory and is recomputed here every time — a stored audience is never
 * trusted at send time.
 */
export async function resolveAudience(
  businessId: string,
  filter: AudienceFilter,
  channel: "sms" | "whatsapp" = "sms",
  /** The worker has no user session, so it passes the service-role client. */
  client?: SupabaseClient<Database>,
): Promise<AudienceResolution> {
  const supabase = client ?? (await createClient());

  let query = supabase
    .from("leads")
    .select(
      `id, first_name, last_name, phone, phone_normalized, opted_out,
       human_takeover, status, last_contact_at, created_at,
       services ( name )`,
    )
    .eq("business_id", businessId)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);

  if (filter.serviceId) query = query.eq("service_id", filter.serviceId);
  if (filter.sourceId) query = query.eq("source_id", filter.sourceId);
  if (filter.statuses.length > 0) query = query.in("status", filter.statuses);
  if (filter.createdAfter) {
    query = query.gte("created_at", `${filter.createdAfter}T00:00:00.000Z`);
  }
  if (filter.createdBefore) {
    query = query.lt("created_at", `${filter.createdBefore}T23:59:59.999Z`);
  }

  const [{ data }, suppressionResult] = await Promise.all([
    query,
    supabase
      .from("contact_suppressions")
      .select("normalized_contact")
      .eq("business_id", businessId)
      .in("channel", [channel, "all"])
      .limit(SCAN_LIMIT),
  ]);

  const leads = (data ?? []) as unknown as AudienceLeadRow[];
  const suppressed = new Set(
    (suppressionResult.data ?? []).map((row) => row.normalized_contact),
  );

  const cooldownBefore =
    Date.now() - filter.lastContactedBeforeDays * 864e5;

  const eligible: AudienceLeadRow[] = [];
  const excluded: { lead: AudienceLeadRow; reason: string }[] = [];

  for (const lead of leads) {
    const number = lead.phone_normalized ?? lead.phone;
    let reason: string | null = null;

    if (lead.opted_out) reason = "opted_out";
    else if (!number) reason = "invalid_number";
    else if (suppressed.has(number)) reason = "suppressed";
    else if (lead.status === "BOOKED" || lead.status === "WON") {
      reason = "already_booked";
    } else if (lead.human_takeover) reason = "active_conversation";
    else if (
      lead.last_contact_at &&
      new Date(lead.last_contact_at).getTime() > cooldownBefore
    ) {
      reason = "contacted_recently";
    }

    if (reason) excluded.push({ lead, reason });
    else eligible.push(lead);
  }

  const counts = new Map<string, number>();
  for (const entry of excluded) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }

  const suppression: SuppressionGroup[] = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      label: suppressionLabel(reason),
      count,
    }));

  const capped = eligible.length > MAX_CAMPAIGN_AUDIENCE;
  const kept = eligible.slice(0, MAX_CAMPAIGN_AUDIENCE);

  return {
    eligibleLeadIds: kept.map((lead) => lead.id),
    preview: {
      matched: leads.length,
      eligible: kept.length,
      suppressed: suppression,
      sample: kept.slice(0, 8).map(sampleRow),
      excludedSample: excluded.slice(0, 8).map((entry) => ({
        ...sampleRow(entry.lead),
        reason: entry.reason,
      })),
      cappedAt: capped ? MAX_CAMPAIGN_AUDIENCE : null,
      truncated: leads.length >= SCAN_LIMIT,
    },
  };
}

export async function listCampaigns(
  businessId: string,
): Promise<CampaignListRow[]> {
  const supabase = await createClient();

  const [{ data: campaigns }, { data: contacts }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, name, status, channel, created_at, scheduled_at, launched_at",
      )
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("campaign_contacts")
      .select("campaign_id, state, sent_at, replied_at, leads ( booked_at )")
      .eq("business_id", businessId)
      .limit(SCAN_LIMIT),
  ]);

  const totals = new Map<
    string,
    { audience: number; sent: number; replied: number; booked: number }
  >();

  const launchedAt = new Map(
    (campaigns ?? []).map((campaign) => [
      campaign.id,
      new Date(campaign.launched_at ?? campaign.created_at).getTime(),
    ]),
  );

  for (const contact of (contacts ?? []) as unknown as {
    campaign_id: string;
    state: string;
    sent_at: string | null;
    replied_at: string | null;
    leads: { booked_at: string | null } | null;
  }[]) {
    const entry = totals.get(contact.campaign_id) ?? {
      audience: 0,
      sent: 0,
      replied: 0,
      booked: 0,
    };
    entry.audience += 1;
    if (contact.sent_at) entry.sent += 1;
    if (contact.replied_at) entry.replied += 1;
    if (
      contact.leads?.booked_at &&
      new Date(contact.leads.booked_at).getTime() >=
        (launchedAt.get(contact.campaign_id) ?? 0)
    ) {
      entry.booked += 1;
    }
    totals.set(contact.campaign_id, entry);
  }

  return (campaigns ?? []).map((campaign) => {
    const entry = totals.get(campaign.id);
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      channel: campaign.channel,
      audience: entry?.audience ?? 0,
      sent: entry?.sent ?? 0,
      replied: entry?.replied ?? 0,
      booked: entry?.booked ?? 0,
      createdAt: campaign.created_at,
      scheduledAt: campaign.scheduled_at,
    };
  });
}

type ContactJoinRow = {
  id: string;
  lead_id: string;
  state: string;
  stopped_reason: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  replied_at: string | null;
  leads: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    booked_at: string | null;
  } | null;
};

export async function getCampaignDetail(
  businessId: string,
  campaignId: string,
  params: CampaignContactsParams,
): Promise<CampaignDetail | null> {
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return null;

  let contactQuery = supabase
    .from("campaign_contacts")
    .select(
      `id, lead_id, state, stopped_reason, sent_at, delivered_at, replied_at,
       leads ( first_name, last_name, phone, booked_at )`,
      { count: "exact" },
    )
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .range(
      (params.page - 1) * params.pageSize,
      params.page * params.pageSize - 1,
    );

  if (params.state !== "all") {
    contactQuery = contactQuery.eq("state", params.state);
  }

  const [{ data: contactRows, count }, { data: allStates }] = await Promise.all([
    contactQuery,
    supabase
      .from("campaign_contacts")
      .select("state, sent_at, delivered_at, replied_at, lead_id, leads(booked_at)")
      .eq("business_id", businessId)
      .eq("campaign_id", campaignId)
      .limit(SCAN_LIMIT),
  ]);

  const totals = {
    audience: 0,
    sent: 0,
    delivered: 0,
    replied: 0,
    failed: 0,
    stopped: 0,
    pending: 0,
    booked: 0,
  };

  for (const row of (allStates ?? []) as unknown as {
    state: string;
    sent_at: string | null;
    delivered_at: string | null;
    replied_at: string | null;
    leads: { booked_at: string | null } | null;
  }[]) {
    totals.audience += 1;
    if (row.sent_at) totals.sent += 1;
    if (row.delivered_at) totals.delivered += 1;
    if (row.replied_at) totals.replied += 1;
    if (row.state === "failed") totals.failed += 1;
    if (row.state === "stopped" || row.state === "suppressed") {
      totals.stopped += 1;
    }
    if (row.state === "pending" || row.state === "scheduled") {
      totals.pending += 1;
    }
    if (row.leads?.booked_at) {
      const bookedAt = new Date(row.leads.booked_at).getTime();
      const from = campaign.launched_at
        ? new Date(campaign.launched_at).getTime()
        : new Date(campaign.created_at).getTime();
      if (bookedAt >= from) totals.booked += 1;
    }
  }

  const contacts: CampaignContactRow[] = (
    (contactRows ?? []) as unknown as ContactJoinRow[]
  ).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    name: row.leads ? leadDisplayName(row.leads) : "Unnamed lead",
    phone: row.leads?.phone ?? null,
    state: row.state,
    stoppedReason: row.stopped_reason,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    repliedAt: row.replied_at,
    booked: Boolean(row.leads?.booked_at),
  }));

  const summary = campaign.suppression_summary as Record<string, unknown> | null;
  const suppressionSummary: SuppressionGroup[] = Object.entries(
    summary && typeof summary === "object" ? summary : {},
  )
    .filter(([, value]) => typeof value === "number")
    .map(([reason, value]) => ({
      reason,
      label: suppressionLabel(reason),
      count: value as number,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    channel: campaign.channel,
    messageTemplate: campaign.message_template,
    followupTemplate: campaign.followup_template,
    scheduledAt: campaign.scheduled_at,
    launchedAt: campaign.launched_at,
    completedAt: campaign.completed_at,
    createdAt: campaign.created_at,
    sendRatePerMinute: campaign.send_rate_per_minute,
    filterConfig: campaign.filter_config,
    suppressionSummary,
    totals,
    contacts,
    contactsTotal: count ?? contacts.length,
  };
}

export async function listImports(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("imports")
    .select(
      "id, original_filename, status, row_count, valid_count, invalid_count, imported_count, created_at",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}
