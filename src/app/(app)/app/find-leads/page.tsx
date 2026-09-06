import * as React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { parseProspectFilters } from "@/lib/prospects/filters";
import {
  getProspectFilterOptions,
  getProspectQuickCounts,
  listProspects,
} from "@/lib/prospects/queries";
import { loadDiscoverData } from "@/lib/find-leads/server/discover";
import { loadIntentData } from "@/lib/intent/queries";
import { listCampaigns } from "@/lib/outreach/queries";
import { FindLeadsView } from "@/components/find-leads/find-leads-view";
import { DiscoverView } from "@/components/find-leads/discover/discover-view";
import { IntentView } from "@/components/find-leads/intent/intent-view";
import { CampaignsView } from "@/components/find-leads/campaigns/campaigns-view";
import { ProspectDrawerHost } from "@/components/find-leads/prospect-drawer-host";
import { PlanLimitState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import type { ViewMode } from "@/components/ui/view-toggle";

export const metadata: Metadata = { title: "Find Leads · ClientTurn" };
export const dynamic = "force-dynamic";

const VIEW_COOKIE = "ct-find-leads-list-mode";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FindLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore, workspace] = await Promise.all([
    searchParams,
    cookies(),
    requireWorkspace(),
  ]);

  const filters = parseProspectFilters(params);
  const prospectId = first(params.prospect);

  // Read server-side so a list-view user never sees a flash of cards.
  const stored = cookieStore.get(VIEW_COOKIE)?.value;
  const viewMode: ViewMode = stored === "list" ? "list" : "card";

  const entitlements = await getV4Entitlements(workspace.businessId);

  // Sourcing is plan-gated. The rail hides the destination when the plan does
  // not include it, but a direct URL still has to be refused here — hiding is
  // a courtesy, this is the enforcement.
  if (!entitlements.sourcingEnabled) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Find Leads"
          description="Use AI to find, verify and engage high-quality prospects for your business."
          size="lg"
        />
        <PlanLimitState
          title="Find Leads is not included on your plan"
          description="Sourcing new prospects is available on Starter and above. Your existing leads, follow-up and reactivation are unaffected."
          action={
            <a
              href="/app/settings?view=billing"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              See plans
            </a>
          }
        />
      </div>
    );
  }

  const onDiscover = filters.view === "discover";

  // Nothing below depends on anything else, so the page never waterfalls. The
  // prospect list is only fetched for the view that shows it — Discover must
  // not pay to page a table nobody is looking at.
  const [prospects, counts, options, discoverData, intentData, campaignData] =
    await Promise.all([
    filters.view === "prospects"
      ? listProspects(workspace.businessId, filters)
      : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: filters.pageSize }),
    getProspectQuickCounts(workspace.businessId),
    getProspectFilterOptions(workspace.businessId),
    loadDiscoverData(workspace.businessId),
    filters.view === "intent" ? loadIntentData(workspace.businessId) : Promise.resolve(null),
    filters.view === "campaigns" ? listCampaigns(workspace.businessId) : Promise.resolve(null),
  ]);

  const canManage = hasRole(workspace.role, "admin");
  const firstName = workspace.businessName.split(" ")[0] ?? "";

  return (
    <>
      <FindLeadsView
        filters={filters}
        kpis={discoverData.kpis}
        prospects={{ rows: prospects.rows, total: prospects.total }}
        counts={counts}
        options={options}
        viewMode={viewMode}
        canManage={canManage}
        discover={
          onDiscover ? (
            <DiscoverView
              data={discoverData}
              firstName={firstName}
              canManage={canManage}
            />
          ) : null
        }
        intent={
          intentData ? <IntentView data={intentData} canManage={canManage} /> : null
        }
        campaigns={
          campaignData ? <CampaignsView data={campaignData} canManage={canManage} /> : null
        }
      />
      <ProspectDrawerHost
        businessId={workspace.businessId}
        prospectId={prospectId ?? null}
        canManage={canManage}
      />
    </>
  );
}
