import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadEmailAccount } from "@/lib/email/store";
import {
  EMPTY_FUNNEL,
  type CampaignAudience,
  type CampaignFunnel,
  type CampaignListData,
  type CampaignPerformance,
  type CampaignRow,
  type CampaignStatus,
  type SenderIdentityRow,
  type UpcomingSend,
} from "./types";

export * from "./types";

/**
 * Acquisition campaign reads.
 *
 * The funnel comes from `outreach_campaign_results()` — one round trip that
 * aggregates recipients, prospects and messages in Postgres. Counting those in
 * the app would mean pulling every recipient row for every campaign on the
 * page, which is exactly the truncation trap §21.7 warns about.
 *
 * Cost and budget columns are never selected: they are revoked from the browser
 * role (0041), and the customer-facing meters read percentages instead.
 */

export async function listCampaigns(businessId: string): Promise<CampaignListData> {
  const supabase = await createClient();

  const [
    { data: rows },
    { data: results },
    { data: steps },
    readyCount,
    senderRows,
    mailbox,
    { data: budgetRows },
    { data: performanceRows },
    { data: upcomingRows },
  ] = await Promise.all([
      supabase
        .from("outreach_campaigns")
        .select(
          `id, name, description, status, minimum_grade, priority, auto_optimize,
           review_before_outreach, daily_contact_cap, monthly_contact_cap,
           sender_identity_id, active_sequence_id, audience_json, launched_at, updated_at,
           conversion_goals ( name ), icp_profiles ( name )`,
        )
        .eq("business_id", businessId)
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false }),
      supabase.rpc("outreach_campaign_results", { p_business_id: businessId }),
      supabase
        .from("outreach_steps")
        .select("sequence_id")
        .eq("business_id", businessId)
        .eq("enabled", true),
      supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .in("status", ["READY", "APPROVED"])
        .is("campaign_id", null)
        .is("promoted_to_lead_id", null),
      supabase
        .from("sender_identities")
        .select("id, email, display_name, status, cold_enabled, daily_send_cap, postal_footer")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("created_at", { ascending: true }),
      loadEmailAccount(businessId),
      // Budget as a ratio only. The amounts stay behind the definer function —
      // see 0041 and 0051.
      supabase.rpc("outreach_campaign_budget_usage", { p_business_id: businessId }),
      supabase.rpc("outreach_campaign_performance", {
        p_business_id: businessId,
        p_days: 30,
      }),
      supabase.rpc("outreach_upcoming_sends", { p_business_id: businessId, p_limit: 6 }),
    ]);

  const budgetByCampaign = new Map<string, { percent: number | null; hasCap: boolean }>();
  for (const row of budgetRows ?? []) {
    budgetByCampaign.set(row.campaign_id, {
      percent: row.percent_used === null ? null : Number(row.percent_used),
      hasCap: row.has_cap,
    });
  }

  const funnelByCampaign = new Map<string, CampaignFunnel>();
  for (const row of results ?? []) {
    funnelByCampaign.set(row.campaign_id, {
      audience: row.audience_count,
      contacted: row.contacted_count,
      delivered: row.delivered_count,
      bounced: row.bounced_count,
      replies: row.reply_count,
      positiveReplies: row.positive_reply_count,
      optOuts: row.opt_out_count,
      promoted: row.promoted_count,
      converted: row.converted_count,
      stopped: row.stopped_count,
      pending: row.pending_count,
    });
  }

  const stepsBySequence = new Map<string, number>();
  for (const row of steps ?? []) {
    stepsBySequence.set(row.sequence_id, (stepsBySequence.get(row.sequence_id) ?? 0) + 1);
  }

  const campaigns: CampaignRow[] = (rows ?? []).map((row) => {
    const goal = row.conversion_goals as unknown as { name: string } | null;
    const icp = row.icp_profiles as unknown as { name: string } | null;
    const budget = budgetByCampaign.get(row.id);

    return {
      audience: readAudience(row.audience_json, icp?.name ?? null),
      budgetPercent: budget?.percent ?? null,
      hasBudgetCap: budget?.hasCap ?? false,
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as CampaignStatus,
      minimumGrade: row.minimum_grade,
      priority: row.priority,
      autoOptimize: row.auto_optimize,
      reviewBeforeOutreach: row.review_before_outreach,
      dailyContactCap: row.daily_contact_cap,
      monthlyContactCap: row.monthly_contact_cap,
      senderIdentityId: row.sender_identity_id,
      conversionGoalName: goal?.name ?? null,
      icpProfileName: icp?.name ?? null,
      sequenceStepCount: row.active_sequence_id
        ? (stepsBySequence.get(row.active_sequence_id) ?? 0)
        : 0,
      launchedAt: row.launched_at,
      updatedAt: row.updated_at,
      funnel: funnelByCampaign.get(row.id) ?? EMPTY_FUNNEL,
    };
  });

  // The builder needs the identities themselves, not just whether any exist:
  // it has to name the address a campaign will send from before launch.
  const senders: SenderIdentityRow[] = (senderRows.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    coldEnabled: row.cold_enabled,
    dailySendCap: row.daily_send_cap,
    hasPostalFooter: Boolean(row.postal_footer),
  }));

  const performanceRow = Array.isArray(performanceRows) ? performanceRows[0] : null;
  const performance = toPerformance(performanceRow);

  const upcomingSends: UpcomingSend[] = (upcomingRows ?? []).map((row) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    prospectCount: Number(row.prospect_count),
    dueAt: row.due_at,
  }));

  return {
    campaigns,
    performance,
    upcomingSends,
    unassignedReady: readyCount.count ?? 0,
    // "Has a sender" means one that could actually run a cold campaign.
    hasSender: senders.some(
      (sender) => sender.status === "VERIFIED" && sender.coldEnabled,
    ),
    senders,
    mailboxConnected: Boolean(mailbox),
  };
}

/**
 * The stored audience blob, read defensively.
 *
 * `audience_json` is written by the campaign builder and by the search planner,
 * so a campaign created by an older version may carry a different shape. Every
 * field is optional and anything unrecognised is dropped rather than rendered:
 * a malformed blob must produce a thinner card, not a broken one.
 */
function readAudience(value: unknown, icpName: string | null): CampaignAudience {
  const blob = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

  const locations = Array.isArray(blob.locations)
    ? blob.locations.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];

  const radius =
    typeof blob.radiusMiles === "number" && Number.isFinite(blob.radiusMiles)
      ? blob.radiusMiles
      : null;

  const segment =
    typeof blob.segment === "string" && blob.segment.trim() ? blob.segment.trim() : icpName;

  return { segment, locations: locations.slice(0, 4), radiusMiles: radius };
}

function toPerformance(
  row: {
    contacted: number;
    replies: number;
    qualified: number;
    prior_qualified: number;
  } | null,
): CampaignPerformance {
  const contacted = row?.contacted ?? 0;
  const qualified = row?.qualified ?? 0;
  const prior = row?.prior_qualified ?? 0;

  return {
    contacted,
    replies: row?.replies ?? 0,
    qualified,
    priorQualified: prior,
    conversionRate: contacted > 0 ? qualified / contacted : null,
    // No previous window means the trend is unknown, not flat. Rendering +0%
    // against a month with no data would be a claim we cannot support.
    qualifiedTrend: prior > 0 ? (qualified - prior) / prior : null,
  };
}
