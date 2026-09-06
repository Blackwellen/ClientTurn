import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  EMPTY_FUNNEL,
  type CampaignFunnel,
  type CampaignRow,
  type CampaignStatus,
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

export type CampaignListData = {
  campaigns: CampaignRow[];
  /** Prospects ready and approved but not yet in any campaign. */
  unassignedReady: number;
  hasSender: boolean;
};

export async function listCampaigns(businessId: string): Promise<CampaignListData> {
  const supabase = await createClient();

  const [{ data: rows }, { data: results }, { data: steps }, readyCount, senderCount] =
    await Promise.all([
      supabase
        .from("outreach_campaigns")
        .select(
          `id, name, description, status, minimum_grade, priority, auto_optimize,
           review_before_outreach, daily_contact_cap, monthly_contact_cap,
           sender_identity_id, active_sequence_id, launched_at, updated_at,
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
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "VERIFIED")
        .eq("active", true),
    ]);

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

    return {
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

  return {
    campaigns,
    unassignedReady: readyCount.count ?? 0,
    hasSender: (senderCount.count ?? 0) > 0,
  };
}
