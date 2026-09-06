import * as React from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { PlanLimitState } from "@/components/ui/feedback";
import { TabLink, TabLinkBar } from "@/components/ui/tabs";
import {
  AUDIENCE_FILTERS,
  loadCampaignActivity,
  loadCampaignAudience,
  loadCampaignHeader,
  loadCampaignOverview,
  loadCampaignPerformance,
  loadCampaignSequence,
  type AudienceFilter,
} from "@/lib/outreach/campaigns/detail";
import { CampaignDetailHeader } from "@/components/find-leads/campaigns/detail/campaign-header";
import { CampaignOverviewTab } from "@/components/find-leads/campaigns/detail/overview";
import {
  CampaignActivityTab,
  CampaignAudienceTab,
  CampaignPerformanceTab,
  CampaignSequenceTab,
} from "@/components/find-leads/campaigns/detail/tabs";

export const dynamic = "force-dynamic";

const VIEWS = ["overview", "audience", "sequence", "performance", "activity"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  overview: "Overview",
  audience: "Audience",
  sequence: "Sequence",
  performance: "Performance",
  activity: "Activity",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}): Promise<Metadata> {
  const { campaignId } = await params;
  const workspace = await requireWorkspace();
  const campaign = await loadCampaignHeader(workspace.businessId, campaignId);
  return { title: campaign ? `${campaign.name} · ClientTurn` : "Campaign · ClientTurn" };
}

/**
 * `/app/find-leads/campaigns/[campaignId]`
 *
 * Five internal views behind `?view=`, so each is linkable and the browser's
 * Back button moves between them rather than leaving the campaign. Only the
 * view being rendered is loaded — Overview must not pay to page an audience
 * table nobody is looking at.
 */
export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ campaignId }, query, workspace] = await Promise.all([
    params,
    searchParams,
    requireWorkspace(),
  ]);

  const entitlements = await getV4Entitlements(workspace.businessId);
  if (!entitlements.coldEmailEnabled) {
    return (
      <div className="space-y-5">
        <PlanLimitState
          title="Cold email campaigns are not included on your plan"
          description="Acquisition campaigns are available on Starter and above."
          action={
            <Link
              href="/app/settings?view=billing"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              See plans
            </Link>
          }
        />
      </div>
    );
  }

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const requestedView = first(query.view) as View | undefined;
  const view: View = VIEWS.includes(requestedView as View)
    ? (requestedView as View)
    : "overview";

  const header = await loadCampaignHeader(workspace.businessId, campaignId);
  // Scoped by `business_id` in the loader, so a campaign in another workspace
  // is indistinguishable from one that does not exist.
  if (!header) notFound();

  // A draft has no results to show. Send the reader back to the wizard rather
  // than rendering six empty cards.
  if (header.status === "DRAFT") {
    redirect(`/app/find-leads/campaigns/new?draft=${campaignId}`);
  }

  const canManage = hasRole(workspace.role, "admin");

  const requestedFilter = first(query.filter) as AudienceFilter | undefined;
  const filter: AudienceFilter = AUDIENCE_FILTERS.includes(
    requestedFilter as AudienceFilter,
  )
    ? (requestedFilter as AudienceFilter)
    : "all";

  return (
    <div className="space-y-5">
      <CampaignDetailHeader campaign={header} canManage={canManage} />

      <TabLinkBar aria-label="Campaign views">
        {VIEWS.map((key) => (
          <TabLink
            key={key}
            href={`/app/find-leads/campaigns/${campaignId}?view=${key}`}
            active={view === key}
          >
            {VIEW_LABELS[key]}
          </TabLink>
        ))}
      </TabLinkBar>

      {view === "overview" && <OverviewView campaignId={campaignId} businessId={workspace.businessId} canManage={canManage} />}
      {view === "audience" && (
        <AudienceView
          campaignId={campaignId}
          businessId={workspace.businessId}
          filter={filter}
          page={Number(first(query.page) ?? 1) || 1}
        />
      )}
      {view === "sequence" && (
        <SequenceView campaignId={campaignId} businessId={workspace.businessId} />
      )}
      {view === "performance" && (
        <PerformanceView campaignId={campaignId} businessId={workspace.businessId} />
      )}
      {view === "activity" && (
        <ActivityView campaignId={campaignId} businessId={workspace.businessId} />
      )}
    </div>
  );
}

async function OverviewView({
  businessId,
  campaignId,
  canManage,
}: {
  businessId: string;
  campaignId: string;
  canManage: boolean;
}) {
  const overview = await loadCampaignOverview(businessId, campaignId);
  if (!overview) notFound();
  return <CampaignOverviewTab data={overview} canManage={canManage} />;
}

async function AudienceView({
  businessId,
  campaignId,
  filter,
  page,
}: {
  businessId: string;
  campaignId: string;
  filter: AudienceFilter;
  page: number;
}) {
  const { rows, total } = await loadCampaignAudience({
    businessId,
    campaignId,
    filter,
    page: Math.max(1, page),
    pageSize: 50,
  });

  return (
    <CampaignAudienceTab
      campaignId={campaignId}
      filter={filter}
      rows={rows}
      total={total}
    />
  );
}

async function SequenceView({
  businessId,
  campaignId,
}: {
  businessId: string;
  campaignId: string;
}) {
  const sequence = await loadCampaignSequence(businessId, campaignId);
  return <CampaignSequenceTab sequence={sequence} />;
}

async function PerformanceView({
  businessId,
  campaignId,
}: {
  businessId: string;
  campaignId: string;
}) {
  const performance = await loadCampaignPerformance(businessId, campaignId);
  return <CampaignPerformanceTab performance={performance} />;
}

async function ActivityView({
  businessId,
  campaignId,
}: {
  businessId: string;
  campaignId: string;
}) {
  const entries = await loadCampaignActivity(businessId, campaignId);
  return <CampaignActivityTab entries={entries} />;
}
