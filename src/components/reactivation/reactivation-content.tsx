"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Repeat, SearchX } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import {
  hasActiveReactivationFilters,
  type ReactivationFilters,
} from "@/lib/campaigns/reactivation-filters";
import type { ReactivationCampaignRow } from "@/lib/campaigns/reactivation-types";
import { CampaignCard } from "./campaign-card";
import { CampaignTable } from "./campaign-table";
import { useReactivationParams } from "./use-reactivation-params";

/**
 * `CampaignCardGrid` — four across on a wide desktop, two on a large tablet,
 * one on mobile. When the detail drawer is open the grid keeps its own
 * container query, so cards reflow to fit the narrowed page rather than
 * being clipped.
 */
function CampaignCardGrid({
  campaigns,
  canManage,
  openCampaignId,
  onOpen,
}: {
  campaigns: ReactivationCampaignRow[];
  canManage: boolean;
  openCampaignId?: string;
  onOpen: (id: string) => void;
}) {
  return (
    // Container queries, not viewport breakpoints: when the detail drawer
    // opens it takes ~40% of the page, and the grid has to drop from four
    // columns to two even though the window has not changed size.
    <div className="@container/grid">
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          "@min-[500px]/grid:grid-cols-2",
          "@min-[820px]/grid:grid-cols-3",
          "@min-[1080px]/grid:grid-cols-4",
        )}
      >
        {campaigns.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            canManage={canManage}
            selected={campaign.id === openCampaignId}
            onOpen={() => onOpen(campaign.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function ReactivationContent({
  campaigns,
  total,
  page,
  pageSize,
  filters,
  canManage,
  canCreate,
  openCampaignId,
}: {
  campaigns: ReactivationCampaignRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ReactivationFilters;
  canManage: boolean;
  canCreate: boolean;
  openCampaignId?: string;
}) {
  const { setParams, openCampaign, clearFilters } = useReactivationParams();
  const filtered = hasActiveReactivationFilters(filters);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-xs">
        {filtered ? (
          <EmptyState
            icon={SearchX}
            title="No campaigns match these filters"
            description="Try a different search, status or date range — or clear the filters to see every campaign in this workspace."
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Repeat}
            title="No reactivation campaigns yet"
            description="Create a campaign to reconnect with older eligible leads. Leads that opted out, already booked, or were contacted recently are excluded automatically."
            action={
              canCreate ? (
                <Link
                  href="/app/reactivation/new"
                  className="bg-primary text-on-primary hover:bg-primary-hover inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Create campaign
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    );
  }

  const pagination = (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      noun="campaigns"
      onPageChange={(next) => setParams({ page: next === 1 ? null : String(next) })}
      className={filters.view === "cards" ? "border-t-0 px-0" : undefined}
    />
  );

  if (filters.view === "list") {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        <CampaignTable
          campaigns={campaigns}
          canManage={canManage}
          sort={filters.sort}
          openCampaignId={openCampaignId}
          onOpen={openCampaign}
        />
        {pagination}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <CampaignCardGrid
        campaigns={campaigns}
        canManage={canManage}
        openCampaignId={openCampaignId}
        onOpen={openCampaign}
      />
      {total > pageSize && pagination}
    </div>
  );
}
