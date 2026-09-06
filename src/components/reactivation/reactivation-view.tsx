import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PlanLimitState } from "@/components/ui/feedback";
import type { ReactivationFilters } from "@/lib/campaigns/reactivation-filters";
import type {
  ReactivationCampaignDetail,
  ReactivationCampaignRow,
  ReactivationSummary as SummaryData,
} from "@/lib/campaigns/reactivation-types";
import { CampaignToolbar, CampaignViewSwitch } from "./campaign-toolbar";
import { ReactivationContent } from "./reactivation-content";
import { ReactivationSummary } from "./reactivation-summary";
import { ReactivationDetailDrawerHost } from "./reactivation-detail-drawer-host";

/**
 * The whole Reactivation surface, minus data access. Keeping it presentational
 * means the dev preview at `/dev/reactivation-preview` renders byte-identical
 * markup to the real page, so a visual check there is a check of production.
 */
export function ReactivationView({
  summary,
  campaigns,
  total,
  page,
  pageSize,
  filters,
  audiences,
  tags,
  detail,
  canManage,
  enabled,
}: {
  summary: SummaryData;
  campaigns: ReactivationCampaignRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ReactivationFilters;
  audiences: string[];
  tags: string[];
  detail: ReactivationCampaignDetail | null;
  canManage: boolean;
  enabled: boolean;
}) {
  const canCreate = canManage && enabled;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.03em] text-content sm:text-[34px]">
            Reactivation
          </h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-snug text-content-muted sm:text-[15px]">
            Recover value from older eligible leads without turning ClientTurn
            into a marketing automation suite.
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2.5 sm:w-auto">
          <CampaignViewSwitch value={filters.view} />
          {canCreate && (
            <Link
              href="/app/reactivation/new"
              className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-content-accent inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[14px] font-semibold shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
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
              href="/app/settings?section=billing"
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

      {enabled && (
        <CampaignToolbar filters={filters} audiences={audiences} tags={tags} />
      )}

      {enabled && (
        <ReactivationContent
          campaigns={campaigns}
          total={total}
          page={page}
          pageSize={pageSize}
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
