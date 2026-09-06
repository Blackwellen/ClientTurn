import * as React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  getAudienceOptions,
  getReactivationCampaignDetail,
  getReactivationSummary,
  listReactivationCampaigns,
} from "@/lib/campaigns/reactivation-queries";
import {
  applyReactivationFilters,
  parseReactivationFilters,
  type ReactivationView as ViewMode,
} from "@/lib/campaigns/reactivation-filters";
import { ReactivationView } from "@/components/reactivation/reactivation-view";
import { REACTIVATION_VIEW_COOKIE } from "@/components/reactivation/use-reactivation-params";

export const metadata: Metadata = { title: "Reactivation · Client Turn" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReactivationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore, workspace] = await Promise.all([
    searchParams,
    cookies(),
    requireWorkspace(),
  ]);

  // The stored view preference is read server-side so a list-view user never
  // sees a flash of cards. An explicit `?view=` always wins — a shared link
  // should show what the sender saw.
  const stored = cookieStore.get(REACTIVATION_VIEW_COOKIE)?.value;
  const defaultView: ViewMode = stored === "list" ? "list" : "cards";
  const filters = parseReactivationFilters(params, defaultView);
  const campaignId = first(params.campaign);

  // Fetched together rather than in sequence: none of these depend on each
  // other, so the page never waterfalls. The drawer's detail is only fetched
  // when a campaign is actually open.
  const [entitlements, summary, campaigns, audiences, detail] =
    await Promise.all([
      getEntitlements(workspace.businessId),
      getReactivationSummary(workspace.businessId),
      listReactivationCampaigns(workspace.businessId),
      getAudienceOptions(workspace.businessId),
      campaignId
        ? getReactivationCampaignDetail(workspace.businessId, campaignId)
        : Promise.resolve(null),
    ]);

  const page = applyReactivationFilters(campaigns, filters);
  const tags = [...new Set(campaigns.flatMap((campaign) => campaign.tags))].sort(
    (a, b) => a.localeCompare(b, "en-GB"),
  );

  return (
    <ReactivationView
      summary={summary}
      campaigns={page.rows}
      total={page.total}
      page={page.page}
      pageSize={page.pageSize}
      filters={filters}
      audiences={audiences}
      tags={tags}
      detail={detail}
      canManage={hasRole(workspace.role, "admin")}
      enabled={entitlements.campaignsEnabled}
    />
  );
}
