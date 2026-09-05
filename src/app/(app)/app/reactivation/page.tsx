import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus } from "lucide-react";
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
  type ReactivationView,
} from "@/lib/campaigns/reactivation-filters";
import { PlanLimitState } from "@/components/ui/feedback";
import { CampaignToolbar, CampaignViewSwitch } from "@/components/reactivation/campaign-toolbar";
import { ReactivationContent } from "@/components/reactivation/reactivation-content";
import { ReactivationSummary } from "@/components/reactivation/reactivation-summary";
import { ReactivationDetailDrawerHost } from "@/components/reactivation/reactivation-detail-drawer-host";
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
  const defaultView: ReactivationView = stored === "list" ? "list" : "cards";
  const filters = parseReactivationFilters(params, defaultView);
  const campaignId = first(params.campaign);

  // Fetched together rather than in sequence: none of these depend on each
  // other, so the page never waterfalls. The drawer's detail is only fetched
  // when a campaign is actually open.
  const [entitlements, summary, campaigns, audiences, detail] = await Promise.all([
    getEntitlements(workspace.businessId),
    getReactivationSummary(workspace.businessId),
    listReactivationCampaigns(workspace.businessId),
    getAudienceOptions(workspace.businessId),
    campaignId
      ? getReactivationCampaignDetail(workspace.businessId, campaignId)
      : Promise.resolve(null),
  ]);

  const canManage = hasRole(workspace.role, "admin");
  const enabled = entitlements.campaignsEnabled;
  const canCreate = canManage && enabled;

  const page = applyReactivationFilters(campaigns, filters);
  const tags = [...new Set(campaigns.flatMap((campaign) => campaign.tags))].sort(
    (a, b) => a.localeCompare(b, "en-GB"),
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em] text-content sm:text-[34px]">
            Reactivation
          </h1>
          <p className="mt-1 max-w-3xl text-[14px] text-content-muted sm:text-[15px]">
            Recover value from older eligible leads without turning ClientTurn
            into a marketing automation suite.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <CampaignViewSwitch value={filters.view} />
          {canCreate && (
            <Link
              href="/app/reactivation/new"
              className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-content-accent inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Plus className="size-4" aria-hidden />
              Create campaign
            </Link>
          )}
        </div>
      </header>

      {!enabled && (
        <PlanLimitState
          title="Reactivation campaigns need the Growth plan"
          description="Growth and above can re-contact an old lead list from Client Turn, with opt-outs, suppressions and quiet hours enforced automatically."
          action={
            <Link
              href="/app/settings/billing"
              className="text-content-accent text-[13px] font-medium"
            >
              See plans and upgrade
            </Link>
          }
        />
      )}

      {enabled && !canManage && (
        <p className="text-content-muted text-[13px]">
          You can see campaigns and results here. Only owners and admins can
          create, pause or cancel a campaign.
        </p>
      )}

      {/* The KPI strip belongs to the card view: in List the table is the
          subject of the page, and the reference list screen omits it. */}
      {enabled && filters.view === "cards" && (
        <ReactivationSummary summary={summary} />
      )}

      {enabled && <CampaignToolbar filters={filters} audiences={audiences} tags={tags} />}

      {enabled && (
        <ReactivationContent
          campaigns={page.rows}
          total={page.total}
          page={page.page}
          pageSize={page.pageSize}
          filters={filters}
          canManage={canManage}
          canCreate={canCreate}
          openCampaignId={detail?.id}
        />
      )}

      {enabled && (
        <p className="text-content-subtle text-[12px]">
          Test leads are never included in these figures.
        </p>
      )}

      {/* A campaign id that no longer resolves (deleted, or another
          workspace's) simply renders no drawer — the page stays usable
          rather than erroring. */}
      {detail && (
        <ReactivationDetailDrawerHost campaign={detail} canManage={canManage} />
      )}
    </div>
  );
}
